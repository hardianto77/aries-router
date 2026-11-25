"""Sync Proxy Manager (residential_fresh_pool.json) -> Proxy Pools module.

Adds every verified residential node as an individual proxyPools row so the
manual "Apply Proxy" modal lists them alongside existing pools. Existing
residential-managed rows are refreshed; dead ones (no longer in the verified
pool) are deactivated. Group-pool architecture is untouched — this only
populates the manual Apply Proxy picker from the Proxy Manager data.
"""
import json
import os
import sqlite3

DB = "/home/ubuntu/.aries-router/db/data.sqlite"
POOL_JSON = "/home/ubuntu/.aries-router/residential_fresh_pool.json"
MANAGED_FLAG = "resi-manager"


def main():
    nodes = []
    if os.path.exists(POOL_JSON):
        try:
            data = json.load(open(POOL_JSON))
            nodes = data.get("nodes") or []
        except Exception:
            nodes = []
    now = None
    try:
        data = json.load(open(POOL_JSON))
        now = data.get("updatedAt")
    except Exception:
        pass

    import datetime
    now = now or datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")

    verified_urls = [n.get("url") for n in nodes if n.get("url")]
    con = sqlite3.connect(DB, timeout=60)
    con.execute("PRAGMA journal_mode=WAL")
    cur = con.cursor()

    added = refreshed = deactivated = 0

    # Upsert one pool row per verified residential node
    for node in nodes:
        url = node.get("url") or ""
        if not url:
            continue
        masked = node.get("maskedUrl") or url
        name = f"Resi-{node.get('egressIp') or masked.split('@')[-1]} ({node.get('countryCode') or node.get('country') or '??'})"
        pool_data = json.dumps({
            "name": name,
            "proxyUrl": url,
            "noProxy": "127.0.0.1,localhost,",
            "protocol": url.split("://")[0],
            "boundConnectionCount": 0,
            "lastTestedAt": node.get("verifiedAt") or now,
            "lastError": None,
            "resiManager": True,
            "egressIp": node.get("egressIp"),
            "country": node.get("country"),
            "city": node.get("city"),
            "latencyMs": node.get("latencyMs"),
            "networkClass": node.get("networkClass"),
        }, ensure_ascii=False)

        existing = cur.execute(
            "SELECT id FROM proxyPools WHERE json_extract(data,'$.resiManager')=1 AND json_extract(data,'$.proxyUrl')=?",
            (url,),
        ).fetchone()
        if existing:
            cur.execute(
                "UPDATE proxyPools SET isActive=1, testStatus='active', data=?, updatedAt=? WHERE id=?",
                (pool_data, now, existing[0]),
            )
            refreshed += 1
        else:
            cur.execute(
                "INSERT INTO proxyPools (id, isActive, testStatus, data, createdAt, updatedAt) "
                "VALUES (lower(hex(randomblob(4)) || '-' || hex(randomblob(2))) || '-resi-' || lower(hex(randomblob(2))) || '-' || lower(hex(randomblob(3))), 1, 'active', ?, ?, ?)",
                (pool_data, now, now),
            )
            added += 1

    # Deactivate managed rows whose URL is no longer verified (dead/rotated out)
    if verified_urls:
        qmarks = ",".join("?" * len(verified_urls))
        cur.execute(
            f"UPDATE proxyPools SET isActive=0, testStatus='retired', updatedAt=? "
            f"WHERE json_extract(data,'$.resiManager')=1 AND isActive=1 "
            f"AND json_extract(data,'$.proxyUrl') NOT IN ({qmarks})",
            (now, *verified_urls),
        )
        deactivated = cur.rowcount

    con.commit()
    con.close()
    out = {
        "success": True,
        "verifiedResidential": len(verified_urls),
        "poolsAdded": added,
        "poolsRefreshed": refreshed,
        "poolsDeactivated": deactivated,
    }
    print(json.dumps(out))


if __name__ == "__main__":
    main()
