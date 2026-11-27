#!/usr/bin/env python3
"""
sync_direct_proxies.py (Pure-Residential Direct 1-on-1 Edition)
- Strictly NO group proxy pool (proxyPoolId = NULL everywhere, including providerStrategies).
- Strictly NO WARP (127.0.0.1:8118) and NO Datacenter proxies.
- Probes every proxied provider connection directly; if dead, timeout, WARP, datacenter, or group-bound,
  auto-injects direct Pure-Residential egress (http://127.0.0.1:20188) directly onto that provider connection.
"""
import argparse
import concurrent.futures
import datetime
import json
import sqlite3
import subprocess
from pathlib import Path

DB_PATH = Path("/home/ubuntu/.aries-router/db/data.sqlite")
LOG_PATH = Path("/home/ubuntu/sync_direct_proxies.log")
RESI_ALIVE_TXT = Path("/home/ubuntu/resi-fresh-alive.txt")
RESI_POOL_JSON = Path("/home/ubuntu/.aries-router/residential_fresh_pool.json")
RESI_GW_URL = "http://127.0.0.1:20188"
EXCLUDED_PROVIDERS = ("local-device", "searxng", "edge-tts", "google-tts", "devin-cli", "opencode", "openai-compatible-chat-openhop", "openai-compatible-chat-kilo")


def log(msg: str):
    ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    try:
        with open(LOG_PATH, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass


def load_verified_residential_urls() -> list[str]:
    urls = []
    if RESI_POOL_JSON.exists():
        try:
            data = json.loads(RESI_POOL_JSON.read_text())
            for node in data.get("nodes", []):
                u = node.get("url")
                if u and "127.0.0.1:8118" not in u and "4.144.146.21" not in u:
                    urls.append(u)
        except Exception:
            pass
    if not urls and RESI_ALIVE_TXT.exists():
        try:
            for line in RESI_ALIVE_TXT.read_text().splitlines():
                u = line.strip().split()[0] if line.strip() else ""
                if u.startswith(("http://", "https://", "socks5://")) and "127.0.0.1:8118" not in u and "4.144.146.21" not in u:
                    urls.append(u)
        except Exception:
            pass
    return list(dict.fromkeys(urls))


def probe_proxy_alive(proxy_url: str, timeout: float = 3.5) -> bool:
    if not proxy_url:
        return False
    if any(bad in proxy_url for bad in ("127.0.0.1:8118", "127.0.0.1:40000", "4.144.146.21", "34.43.46.91", "103.237.102.191", "residential://")):
        return False
    try:
        r = subprocess.run(
            ["curl", "-s", "-m", str(timeout), "-x", proxy_url, "https://api.ipify.org?format=json"],
            capture_output=True,
            text=True,
            timeout=timeout + 2,
        )
        return r.returncode == 0 and '"ip"' in r.stdout
    except Exception:
        return False


def sync_provider_proxies(provider=None, auto_replace_dead=True, dry_run=False):
    if not DB_PATH.exists():
        return {"success": False, "error": "Database not found"}

    fresh_pool = load_verified_residential_urls()
    if len(fresh_pool) < 3:
        subprocess.run(["/usr/bin/python3", "/opt/aries-router/scripts/refresh_fresh_residential.py"], timeout=120)
        fresh_pool = load_verified_residential_urls()

    if not fresh_pool:
        return {"success": False, "error": "No verified fresh residential proxies available"}

    con = sqlite3.connect(DB_PATH, timeout=30)
    cur = con.cursor()
    placeholders = ",".join("?" for _ in EXCLUDED_PROVIDERS)
    if provider:
        cur.execute("SELECT rowid, id, provider, data FROM providerConnections WHERE isActive=1 AND provider = ?", (provider,))
    else:
        cur.execute(f"SELECT rowid, id, provider, data FROM providerConnections WHERE isActive=1 AND provider NOT IN ({placeholders})", EXCLUDED_PROVIDERS)

    rows = cur.fetchall()
    conn_list = []
    for rowid, cid, prov, raw in rows:
        d = json.loads(raw) if raw else {}
        psd = d.get("providerSpecificData") or {}
        curl = psd.get("connectionProxyUrl") or d.get("connectionProxyUrl") or ""
        pid = psd.get("proxyPoolId") or d.get("proxyPoolId")
        conn_list.append({"rowid": rowid, "id": cid, "provider": prov, "data": d, "proxyUrl": curl, "poolId": pid})

    dead_conns = []
    alive_conns = []
    if auto_replace_dead:
        with concurrent.futures.ThreadPoolExecutor(max_workers=25) as ex:
            futures = {ex.submit(probe_proxy_alive, c["proxyUrl"], 3.5): c for c in conn_list}
            for fut in concurrent.futures.as_completed(futures):
                c = futures[fut]
                ok = False
                try:
                    ok = fut.result()
                except Exception:
                    ok = False
                if ok and c["poolId"] is None:
                    alive_conns.append(c)
                else:
                    dead_conns.append(c)
    else:
        dead_conns = conn_list

    replaced = 0
    for c in dead_conns:
        d = c["data"]
        psd = d.get("providerSpecificData") or {}
        psd["connectionProxyEnabled"] = True
        psd["proxyPoolId"] = None
        psd["connectionProxyUrl"] = RESI_GW_URL
        psd["connectionNoProxy"] = psd.get("connectionNoProxy") or "127.0.0.1,localhost,"
        d["providerSpecificData"] = psd
        d["connectionProxyEnabled"] = True
        d["proxyPoolId"] = None
        d["connectionProxyUrl"] = RESI_GW_URL
        if not dry_run:
            cur.execute("UPDATE providerConnections SET data=? WHERE rowid=?", (json.dumps(d, ensure_ascii=False), c["rowid"]))
        replaced += 1

    if not dry_run:
        s_row = cur.execute("SELECT id, data FROM settings WHERE id=1").fetchone()
        if s_row and s_row[1]:
            try:
                s_obj = json.loads(s_row[1])
                strats = s_obj.get("providerStrategies")
                changed = False
                if isinstance(strats, dict):
                    for cfg in strats.values():
                        if isinstance(cfg, dict) and cfg.get("proxyPoolId") is not None:
                            cfg["proxyPoolId"] = None
                            changed = True
                if changed:
                    cur.execute("UPDATE settings SET data=? WHERE id=1", (json.dumps(s_obj),))
            except Exception:
                pass
        con.commit()
    con.close()

    res = {
        "success": True,
        "provider": provider or "all",
        "totalConnections": len(conn_list),
        "aliveKept": len(alive_conns),
        "replacedDirectResidential": replaced,
        "poolAvailable": len(fresh_pool),
        "groupProxyCount": 0,
        "warpBlocked": True,
        "datacenterBlocked": True,
    }
    log(f"[+] PURE-RESIDENTIAL DIRECT SYNC: {json.dumps(res)}")
    return res


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sync Direct Pure-Residential Fresh IPs (No Group Pools, No Datacenter, No WARP)")
    parser.add_argument("--provider", type=str, default=None)
    parser.add_argument("--no-warp", action="store_true")
    parser.add_argument("--all-rotate", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    print(json.dumps(sync_provider_proxies(args.provider, not args.all_rotate, args.dry_run), indent=2))
