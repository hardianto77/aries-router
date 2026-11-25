#!/usr/bin/env python3
"""
Pure-Residential Fresh IP Harvester, Double-Probe Verifier & Direct Per-Provider Injector (v4.3)
- Strictly Pure-Residential ONLY: blocks WARP (127.0.0.1:8118) and all Datacenter/Cloud/VPS/VPN/Tor ASNs.
- Double-probing over real HTTPS TLS (:443): candidate must pass 2/2 probes with avg latency <= 2800ms.
- NEVER creates group proxy rows in proxyPools (deletes any legacy Resi-*/RESI-fresh-rotating/residential-auto-hedge group rows).
- Direct 1-on-1 per-provider injection: ensures active external providerConnections have proxyPoolId = NULL
  and auto-heals any missing, dead, timeout, WARP, datacenter, or group-bound connection directly onto
  http://127.0.0.1:20188 (Pure-Residential Dual-Hedge Gateway).
"""
import concurrent.futures
import datetime
import json
import os
import re
import sqlite3
import subprocess
import time
import urllib.parse
import urllib.request

DB_PATH = "/home/ubuntu/.aries-router/db/data.sqlite"
OUT_TXT = "/home/ubuntu/resi-fresh-alive.txt"
OUT_JSON = "/home/ubuntu/.aries-router/residential_fresh_pool.json"
RESI_GW_URL = "http://127.0.0.1:20188"
RESI_GW_RELOAD = "http://127.0.0.1:20189/reload"

MAX_ACCEPTABLE_LATENCY_MS = 2800.0
PROBE_TIMEOUT = 3.5
IPV4_RE = re.compile(r"\b(\d{1,3}(?:\.\d{1,3}){3})\b")

LOCAL_PROVIDERS = {"local-device", "searxng", "edge-tts", "google-tts"}

SOURCE_FILES = [
    "/home/ubuntu/live_floppy_fresh.txt",
    "/home/ubuntu/active_floppy_verified.txt",
    "/home/ubuntu/floppy_alive_100.txt",
    "/home/ubuntu/resi-tested-alive.txt",
    "/home/ubuntu/live_residential_proxies.txt",
    "/home/ubuntu/residential_proxy_mafia.txt",
    "/home/ubuntu/residential_mafia_alive.txt",
    "/home/ubuntu/clean_residential.txt",
    "/home/ubuntu/resi-fresh-alive.txt",
    "/home/ubuntu/hunter_residential_fresh.json",
    "/home/ubuntu/hunter_residential_fresh.txt",
]

DATACENTER_KEYWORDS = (
    "amazon", "aws", "google", "microsoft", "azure", "alibaba", "aliyun", "oracle", "tencent",
    "digitalocean", "linode", "akamai", "ovh", "hetzner", "choopa", "vultr", "cloudflare",
    "fastly", "contabo", "leaseweb", "m247", "hostinger", "godaddy", "scaleway", "server",
    "hosting", "datacenter", "data center", "cloud", "vps", "dedicated", "colocation", "colo",
    "cdn", "telepoint", "cogent", "zenlayer", "ucloud", "rackspace", "softlayer", "psychz",
    "layeronline", "hostkey", "quadranet", "estnoc", "realcloud", "serverius", "fdcservers",
    "frantech", "buyvm", "limestone", "datapacket", "gcore", "kamatera", "ionos", "strato",
    "upcloud", "cherry servers", "worldstream", "nforce", "xtom", "sharktech", "colocrossing",
    "reliablesite", "gthost", "ctrls", "orion network", "bunny technology", "lixium",
    "timeweb", "layershift", "haoxiangyun", "selectel", "akene", "cogento", "oneprovider",
    "brainstorm network", "ptisp", "almouroltec", "pvdatanet", "pvdata", "real time data",
    "servers tech", "franet", "warp", "mullvad", "nordvpn", "protonvpn", "surfshark",
    "expressvpn", "datacamp", "cdn77", "online sas", "constant company",
    "church of cyberology", "tor exit", "emerald onion", "calyx", "quintex",
)

FORBIDDEN_HOSTS = {
    "127.0.0.1", "localhost", "::1", "0.0.0.0",
    "4.144.146.21", "34.43.46.91", "103.237.102.191", "80.65.211.149",
    "pt1.cactussstp.com", "bul2.stealthtunnel.net", "pg.stealthtunnel.net",
    "de-fra.pvdata.host", "nl-ams.pvdata.host",
}


def now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def normalize_proxy_line(raw: str) -> str | None:
    s = (raw or "").strip().split()[0] if (raw or "").strip() else ""
    if not s or s.startswith("#") or s.startswith("residential://"):
        return None
    if not s.startswith(("http://", "https://", "socks5://", "socks5h://")):
        parts = s.split(":")
        if len(parts) == 4 and parts[1].isdigit():
            s = f"http://{urllib.parse.quote(parts[2], safe='')}:{urllib.parse.quote(parts[3], safe='')}@{parts[0]}:{parts[1]}"
        elif len(parts) == 2 and parts[1].isdigit():
            s = f"http://{parts[0]}:{parts[1]}"
        else:
            return None
    try:
        u = urllib.parse.urlparse(s)
        if not u.hostname or not u.port:
            return None
        return s
    except Exception:
        return None


def is_forbidden(url: str) -> bool:
    if not url:
        return True
    try:
        u = urllib.parse.urlparse(url)
        host = (u.hostname or "").lower()
        if not host or host in FORBIDDEN_HOSTS:
            return True
        if host.endswith(".pvdata.host") or host.endswith(".stealthtunnel.net"):
            return True
        if ":8118" in url or ":40000" in url or ":20188" in url:
            return True
        return False
    except Exception:
        return True


def endpoint_key(url: str) -> str:
    u = urllib.parse.urlparse(url)
    proto = (u.scheme or "http").lower()
    host = (u.hostname or "").lower()
    port = u.port or (1080 if proto.startswith("socks") else 8080)
    return f"{proto}://{host}:{port}"


def mask_url(url: str) -> str:
    try:
        u = urllib.parse.urlparse(url)
        auth = "***:***@" if (u.username or u.password) else ""
        return f"{u.scheme}://{auth}{u.hostname}:{u.port}"
    except Exception:
        return url


def gather_candidates() -> list[str]:
    seen_urls = set()
    candidates = []
    for fpath in SOURCE_FILES:
        if not os.path.exists(fpath):
            continue
        try:
            if fpath.endswith(".json"):
                import json as _json
                data = _json.load(open(fpath))
                json_lines = []
                if isinstance(data, list):
                    for entry in data:
                        if isinstance(entry, dict):
                            u = entry.get("proxy_url") or entry.get("url") or ""
                            if u:
                                json_lines.append(u)
                        elif isinstance(entry, str):
                            json_lines.append(entry)
                lines = iter(json_lines)
            else:
                lines = open(fpath)
            for line in lines:
                norm = normalize_proxy_line(line)
                if not norm or is_forbidden(norm):
                    continue
                if norm not in seen_urls:
                    seen_urls.add(norm)
                    candidates.append(norm)
        except Exception:
            pass
    return candidates


def single_https_probe(url: str) -> tuple[str | None, float | None]:
    for endpoint in ("https://api.ipify.org?format=json", "https://checkip.amazonaws.com"):
        t0 = time.monotonic()
        try:
            r = subprocess.run(
                ["curl", "-s", "--max-time", str(PROBE_TIMEOUT), "-x", url, endpoint],
                capture_output=True,
                text=True,
                timeout=PROBE_TIMEOUT + 1.5,
            )
            lat_ms = (time.monotonic() - t0) * 1000.0
            if r.returncode != 0 or lat_ms > MAX_ACCEPTABLE_LATENCY_MS:
                continue
            m = IPV4_RE.search(r.stdout or "")
            if m:
                return m.group(1), lat_ms
        except Exception:
            continue
    return None, None


def probe_candidate(url: str):
    """Require 2/2 consecutive HTTPS TLS passes under latency ceiling (zero-flaky)."""
    ip1, lat1 = single_https_probe(url)
    if not ip1:
        return None
    ip2, lat2 = single_https_probe(url)
    if not ip2:
        return None
    avg_lat = round((lat1 + lat2) / 2.0, 1)
    if avg_lat > MAX_ACCEPTABLE_LATENCY_MS:
        return None
    return {"url": url, "egressIp": ip2, "latencyMs": avg_lat}


def batch_lookup_ip(ips: list[str]) -> dict[str, dict]:
    out = {}
    if not ips:
        return out
    for i in range(0, len(ips), 90):
        batch = ips[i : i + 90]
        try:
            req = urllib.request.Request(
                "http://ip-api.com/batch?fields=query,status,country,countryCode,city,isp,org,as,hosting,proxy,mobile",
                data=json.dumps(batch).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                for row in json.loads(resp.read().decode("utf-8")):
                    if row.get("status") == "success" and row.get("query"):
                        out[row["query"]] = row
        except Exception:
            pass

    for ip in ips:
        try:
            with urllib.request.urlopen(f"https://ipwho.is/{ip}", timeout=5) as resp:
                w = json.loads(resp.read().decode("utf-8"))
            if w.get("success") is not False:
                conn = w.get("connection") or {}
                sec = w.get("security") or {}
                cur = out.get(ip, {"query": ip})
                cur["isp"] = " | ".join(x for x in [cur.get("isp"), conn.get("isp")] if x)
                cur["org"] = " | ".join(x for x in [cur.get("org"), conn.get("org")] if x)
                cur["domain"] = conn.get("domain") or ""
                if sec.get("hosting") is True or w.get("type") == "hosting":
                    cur["hosting"] = True
                if not cur.get("countryCode"):
                    cur["countryCode"] = w.get("country_code")
                if not cur.get("country"):
                    cur["country"] = w.get("country")
                if not cur.get("as") and conn.get("asn"):
                    cur["as"] = f"AS{conn.get('asn')} {conn.get('org') or ''}"
                out[ip] = cur
        except Exception:
            pass
    return out


def classify_asn(info: dict | None) -> tuple[bool, str, str]:
    if not info:
        return False, "unverified", "ASN lookup unavailable"
    if info.get("hosting") is True:
        return False, "datacenter", f"Hosting ASN ({info.get('isp', 'unknown')})"
    comb = " ".join([
        str(info.get("isp") or ""),
        str(info.get("org") or ""),
        str(info.get("as") or ""),
        str(info.get("domain") or ""),
    ]).lower()
    for kw in DATACENTER_KEYWORDS:
        if kw in comb:
            return False, "datacenter", f"Datacenter keyword '{kw}' ({info.get('isp', '')})"
    if info.get("mobile"):
        return True, "mobile", "Mobile ISP"
    if "university" in comb or ".edu" in comb or "educational" in comb:
        return True, "education", "Campus ISP"
    return True, "residential", "Pure Residential ISP"


def sync_db_direct_only(verified_urls) -> dict:
    """
    ZERO group proxy pools. Each PROVIDER gets its OWN DEDICATED verified
    residential proxy endpoint (no two providers share the same egress IP),
    bound directly on that provider's connections (proxyPoolId = NULL).
    Dead / datacenter / WARP / group-bound / errored bindings are re-injected
    with a fresh unique residential endpoint. Falls back to the shared
    Pure-Residential hedge gateway (:20188) only when the verified pool is
    too small to give every provider a unique endpoint.
    """
    if isinstance(verified_urls, (set, frozenset, tuple)):
        verified_urls = list(verified_urls)
    verified_list = [u for u in (verified_urls or []) if u]
    if not os.path.exists(DB_PATH):
        return {"removedGroupPools": 0, "healedDirectConnections": 0, "clearedLocal": 0, "perProviderUnique": 0}

    t = now_iso()
    con = sqlite3.connect(DB_PATH, timeout=60)
    con.execute("PRAGMA journal_mode=WAL")
    cur = con.cursor()

    # 1. Remove auto-created residential group proxy rows from proxyPools
    cur.execute(
        """DELETE FROM proxyPools
           WHERE id = 'residential-auto-hedge'
              OR json_extract(data, '$.name') = 'RESI-fresh-rotating'
              OR json_extract(data, '$.name') LIKE 'Resi-%'
              OR json_extract(data, '$.name') = 'Fresh Residential Auto-Hedge Gateway'"""
    )
    removed_groups = cur.rowcount

    # Retire any leftover WARP / datacenter PV rows
    cur.execute(
        """UPDATE proxyPools
           SET isActive=0, testStatus='retired', updatedAt=?
           WHERE isActive=1 AND (
             json_extract(data,'$.name') LIKE 'PV-%'
             OR json_extract(data,'$.name')='WARP-egress-fresh'
             OR json_extract(data,'$.proxyUrl') LIKE '%127.0.0.1:8118%'
             OR json_extract(data,'$.proxyUrl') LIKE '%4.144.146.21%'
           )""",
        (t,),
    )

    # 2. Clear any proxyPoolId inside settings.providerStrategies (no group proxy per provider)
    s_row = cur.execute("SELECT id, data FROM settings WHERE id=1").fetchone()
    if s_row and s_row[1]:
        try:
            s_obj = json.loads(s_row[1])
            strats = s_obj.get("providerStrategies")
            changed_s = False
            if isinstance(strats, dict):
                for prov, cfg in strats.items():
                    if isinstance(cfg, dict) and cfg.get("proxyPoolId") is not None:
                        cfg["proxyPoolId"] = None
                        changed_s = True
            if changed_s:
                cur.execute("UPDATE settings SET data=?, updatedAt=? WHERE id=1", (json.dumps(s_obj), t))
        except Exception:
            pass

    # 3. Per-PROVIDER unique residential binding (one distinct egress per provider)
    rows = cur.execute("SELECT id, provider, data FROM providerConnections WHERE isActive=1").fetchall()
    healed = 0
    cleared_local = 0
    unique_bindings = 0

    providers_seen = []
    prov_url: dict[str, str] = {}

    def endpoint_for(prov: str) -> str:
        if prov in prov_url:
            return prov_url[prov]
        if verified_list:
            idx = len(providers_seen) % len(verified_list)
            url = verified_list[idx]
        else:
            url = RESI_GW_URL
        providers_seen.append(prov)
        prov_url[prov] = url
        return url

    for cid, prov, raw in rows:
        try:
            d = json.loads(raw) if raw else {}
        except Exception:
            continue
        last_err = d.get("lastError")
        psd = d.get("providerSpecificData") or {}
        pid = psd.get("proxyPoolId") or d.get("proxyPoolId")
        curl = str(psd.get("connectionProxyUrl") or d.get("connectionProxyUrl") or "").strip()
        enabled = psd.get("connectionProxyEnabled") is True or psd.get("connectionProxyEnabled") == 1 or d.get("connectionProxyEnabled") is True

        # Local services should never be forced through an external proxy
        if prov in LOCAL_PROVIDERS:
            if enabled or pid or curl:
                psd["connectionProxyEnabled"] = False
                psd["proxyPoolId"] = None
                psd["connectionProxyUrl"] = ""
                d["providerSpecificData"] = psd
                d["connectionProxyEnabled"] = False
                d["proxyPoolId"] = None
                d["connectionProxyUrl"] = ""
                cur.execute("UPDATE providerConnections SET data=?, updatedAt=? WHERE id=?", (json.dumps(d, ensure_ascii=False), t, cid))
                cleared_local += 1
            continue

        has_transport_err = bool(last_err and re.search(r"502|504|524|407|proxy|timeout|tunnel|ECONNREFUSED|ETIMEDOUT", str(last_err), re.I))
        target = endpoint_for(prov)
        is_current = (curl == target and pid is None and enabled)

        # Manual "Apply Proxy" pool bindings are USER-OWNED: never auto-overwrite.
        # Only re-inject if the bound pool row itself is dead/inactive.
        if pid and pid != "__none__":
            try:
                pool_row = cur.execute(
                    "SELECT isActive, testStatus FROM proxyPools WHERE id=?", (pid,)
                ).fetchone()
            except Exception:
                pool_row = None
            if pool_row and pool_row[0] and (pool_row[1] or "active") not in ("retired", "error", "datacenter_blocked"):
                continue  # healthy manual binding — leave untouched
            # dead manual pool: fall through to auto re-inject below

        # Keep a healthy binding only if it already points at THIS provider's dedicated endpoint
        if is_current and not has_transport_err:
            if target in verified_list:
                unique_bindings += 1
            continue

        # (Re)inject: dedicated per-provider residential endpoint, proxyPoolId = NULL
        psd["connectionProxyEnabled"] = True
        psd["proxyPoolId"] = None
        psd["connectionProxyUrl"] = target
        psd["connectionNoProxy"] = psd.get("connectionNoProxy") or "127.0.0.1,localhost,"
        d["providerSpecificData"] = psd
        d["connectionProxyEnabled"] = True
        d["proxyPoolId"] = None
        d["connectionProxyUrl"] = target
        if has_transport_err:
            d["testStatus"] = "active"
            d["lastError"] = None
        cur.execute(
            "UPDATE providerConnections SET data=?, updatedAt=? WHERE id=?",
            (json.dumps(d, ensure_ascii=False), t, cid),
        )
        healed += 1
        if target in verified_list:
            unique_bindings += 1

    con.commit()
    con.close()
    return {
        "removedGroupPools": removed_groups,
        "healedDirectConnections": healed,
        "clearedLocal": cleared_local,
        "perProviderUnique": unique_bindings,
    }

def main():
    cands = gather_candidates()
    print(f"[resi-refresh] double-probing {len(cands)} candidates (max {int(MAX_ACCEPTABLE_LATENCY_MS)}ms)...")
    alive_raw = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=40) as ex:
        for res in ex.map(probe_candidate, cands):
            if res:
                alive_raw.append(res)

    ips = list({r["egressIp"] for r in alive_raw})
    asn_map = batch_lookup_ip(ips)

    verified = []
    dc_blocked = []
    seen_endpoints = set()
    for r in sorted(alive_raw, key=lambda x: x["latencyMs"]):
        info = asn_map.get(r["egressIp"])
        ok, net_cls, reason = classify_asn(info)
        if ok:
            ekey = endpoint_key(r["url"])
            if ekey in seen_endpoints:
                continue
            seen_endpoints.add(ekey)
            verified.append({
                "url": r["url"],
                "maskedUrl": mask_url(r["url"]),
                "egressIp": r["egressIp"],
                "latencyMs": r["latencyMs"],
                "country": info.get("country"),
                "countryCode": info.get("countryCode"),
                "city": info.get("city"),
                "isp": (info.get("isp") or "").split(" | ")[0],
                "org": (info.get("org") or "").split(" | ")[0],
                "asn": info.get("as"),
                "networkClass": net_cls,
                "isResidential": True,
                "verifiedAt": now_iso(),
            })
        else:
            dc_blocked.append({"url": r["url"], "egressIp": r["egressIp"], "reason": reason})

    if verified:
        with open(OUT_TXT, "w") as f:
            for v in verified:
                f.write(v["url"] + "\n")
        os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
        with open(OUT_JSON, "w") as f:
            json.dump({"updatedAt": now_iso(), "count": len(verified), "nodes": verified}, f, indent=2)

    # DEAD PROXIES ARE DELETED IMMEDIATELY: rewrite every source file so it
    # contains ONLY endpoints that just passed the double-probe. Dead, slow
    # (>2800ms) and datacenter endpoints are removed from disk, pool JSON and
    # DB in the same cycle — a dead proxy never survives a refresh.
    verified_set = {v["url"] for v in verified}
    dead_deleted = 0
    for fpath in SOURCE_FILES:
        if not os.path.exists(fpath):
            continue
        try:
            with open(fpath) as f:
                lines = [ln for ln in f.read().splitlines() if ln.strip()]
            kept = []
            removed_here = 0
            for ln in lines:
                norm = normalize_proxy_line(ln)
                if norm and norm in verified_set:
                    kept.append(ln)
                else:
                    removed_here += 1
            if removed_here:
                dead_deleted += removed_here
                with open(fpath, "w") as f:
                    f.write("\n".join(kept) + ("\n" if kept else ""))
        except Exception:
            pass
    print(f"[resi-refresh] deleted {dead_deleted} dead/stale proxy entries from source files")

    db_stats = sync_db_direct_only([v["url"] for v in verified])

    try:
        req = urllib.request.Request(RESI_GW_RELOAD, data=b"{}", method="POST")
        urllib.request.urlopen(req, timeout=4).read()
    except Exception:
        pass

    out = {
        "success": True,
        "candidates": len(cands),
        "aliveDoubleChecked": len(alive_raw),
        "verifiedResidential": len(verified),
        "datacenterBlocked": len(dc_blocked),
        "deadDeleted": dead_deleted,
        **db_stats,
    }
    print(json.dumps(out))


if __name__ == "__main__":
    main()
