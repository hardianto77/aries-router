#!/usr/bin/env python3
"""
Pure-Residential Fresh IP Harvester, 3-Stage Verifier & Direct Per-Provider Injector (v5.0)
- Strictly Pure-Residential ONLY: blocks WARP, loopback, transparent (VPS IP leak),
  VPN/Tor, and all Datacenter/Cloud/Hosting ASNs (fail-closed).
- Multi-source harvesting: existing verified pool + ProxyVault DB (alive non-DC)
  + local proxy lists + live public proxy feeds (cached 10m).
- 3-Stage Verification:
  1) Fast asyncio TCP + HTTP CONNECT / SOCKS5 + TLS pre-screen (high concurrency)
  2) Strict 2/2 consecutive HTTPS TLS (:443) double-probe:
     - Pass 1: IP echo (httpbin / aws checkip / icanhazip / seeip — avoids ipify 429)
     - Pass 2: Global HTTPS reachability (gstatic/cloudflare generate_204 -> HTTP 204)
     Both passes must succeed with avg latency <= 2800ms, no 402/403/407/429.
  3) Multi-provider ASN verification (ip-api.com + ipwho.is + ipinfo.io fallback)
     with disk cache (/home/ubuntu/.aries-router/asn_cache.json).
- Instant dead-proxy deletion from active pool files, pool JSON, and proxyPools DB.
- Direct 1-on-1 per-provider injection (proxyPoolId = NULL, zero group proxy pools)
  and keeps pool_manager_sync in sync for manual Apply Proxy picker.
"""
import asyncio
import base64
import concurrent.futures
import datetime
import ipaddress
import json
import os
import re
import sqlite3
import ssl
import struct
import subprocess
import sys
import time
import urllib.parse
import urllib.request

DB_PATH = "/home/ubuntu/.aries-router/db/data.sqlite"
PV_DB_PATH = "/home/ubuntu/proxyvault/proxyvault.db"
OUT_TXT = "/home/ubuntu/resi-fresh-alive.txt"
OUT_JSON = "/home/ubuntu/.aries-router/residential_fresh_pool.json"
ASN_CACHE_PATH = "/home/ubuntu/.aries-router/asn_cache.json"
FEED_CACHE_PATH = "/tmp/resi_feed_cache.json"
RESI_GW_URL = "http://127.0.0.1:20188"
RESI_GW_RELOAD = "http://127.0.0.1:20189/reload"
VPS_PUBLIC_IP = os.environ.get("VPS_PUBLIC_IP", "43.163.99.76")

MAX_ACCEPTABLE_LATENCY_MS = 2800.0
SCREEN_TIMEOUT = 2.8
PROBE_TIMEOUT = 3.5
FEED_CACHE_TTL_SEC = 600
ASN_CACHE_TTL_SEC = 24 * 3600
MAX_SCREEN_CANDIDATES = 2200
MAX_VERIFIED_POOL = 80
IPV4_RE = re.compile(r"\b(\d{1,3}(?:\.\d{1,3}){3})\b")
TLS_CTX = ssl.create_default_context()

LOCAL_PROVIDERS = {"local-device", "searxng", "edge-tts", "google-tts"}

# Active managed residential pool files (dead entries pruned immediately)
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

# Read-only seed/harvester files (never overwritten; fed into screening)
READONLY_SEED_FILES = [
    "/home/ubuntu/.aries-router/pv_pool.json",
    "/home/ubuntu/farming/zai/proxies.txt",
    "/home/ubuntu/proxyvault_live.txt",
    "/home/ubuntu/live_proxyscrape.txt",
    "/home/ubuntu/combined_fast_proxies.txt",
    "/home/ubuntu/fast_verified_pool.txt",
    "/home/ubuntu/mafia_working.txt",
    "/home/ubuntu/working_proxy.txt",
    "/home/ubuntu/verified_live_proxies.txt",
    "/home/ubuntu/vps_rock_solid_proxies.txt",
    "/home/ubuntu/vps_verified_live_proxies.txt",
]

PUBLIC_FEEDS = [
    ("http", "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=4000&country=all&ssl=yes&anonymity=all"),
    ("socks5", "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=4000"),
    ("http", "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt"),
    ("socks5", "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/socks5/data.txt"),
    ("http", "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt"),
    ("socks5", "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt"),
    ("http", "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt"),
    ("socks5", "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt"),
    ("socks5", "https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt"),
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
    "expressvpn", "datacamp", "cdn77", "online sas", "constant company", "netcup",
    "zscaler", "natanetwork", "huawei", "servidores", "nexosystems", "3xk", "antbox", "baykov",
    "church of cyberology", "tor exit", "emerald onion", "calyx", "quintex",
)

FORBIDDEN_HOSTS = {
    "127.0.0.1", "localhost", "::1", "0.0.0.0", VPS_PUBLIC_IP,
    "4.144.146.21", "34.43.46.91", "103.237.102.191", "80.65.211.149",
    "pt1.cactussstp.com", "bul2.stealthtunnel.net", "pg.stealthtunnel.net",
    "de-fra.pvdata.host", "nl-ams.pvdata.host",
}

IP_ECHO_ENDPOINTS = (
    "https://httpbin.org/ip",
    "https://checkip.amazonaws.com",
    "https://icanhazip.com",
    "https://api.seeip.org/jsonip",
)
REACHABILITY_ENDPOINT = "https://www.gstatic.com/generate_204"
TRANSPORT_ERR_RE = re.compile(
    r"429|rate.?limit|502|503|504|524|407|402|proxy|timeout|tunnel|fetch failed|ECONNREFUSED|ETIMEDOUT|ECONNRESET|socket",
    re.I,
)


def now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def normalize_proxy_line(raw: str, default_proto: str = "http") -> str | None:
    s = (raw or "").strip().split()[0] if (raw or "").strip() else ""
    if not s or s.startswith("#") or s.startswith("residential://"):
        return None
    if not s.startswith(("http://", "https://", "socks5://", "socks5h://")):
        parts = s.split(":")
        if len(parts) == 4 and parts[1].isdigit():
            s = f"{default_proto}://{urllib.parse.quote(parts[2], safe='')}:{urllib.parse.quote(parts[3], safe='')}@{parts[0]}:{parts[1]}"
        elif len(parts) == 2 and parts[1].isdigit():
            s = f"{default_proto}://{parts[0]}:{parts[1]}"
        else:
            return None
    try:
        u = urllib.parse.urlparse(s)
        if not u.hostname or not u.port:
            return None
        if u.scheme == "socks4":
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
        if host.endswith((".pvdata.host", ".stealthtunnel.net", ".floppydata.com")):
            return True
        if any(p in url for p in (":8118", ":40000", ":20188")):
            return True
        return False
    except Exception:
        return True


def endpoint_key(url: str) -> str:
    u = urllib.parse.urlparse(url)
    proto = (u.scheme or "http").lower()
    if proto == "socks5h":
        proto = "socks5"
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


def _read_file_candidates(fpath: str, out: list[str], seen_keys: set[str]):
    if not os.path.exists(fpath):
        return
    try:
        if fpath.endswith(".json"):
            data = json.load(open(fpath))
            items = data.get("nodes") or data.get("urls") or (data if isinstance(data, list) else [])
            lines = []
            for entry in items:
                if isinstance(entry, dict):
                    u = entry.get("proxy_url") or entry.get("url") or ""
                    if u:
                        lines.append(u)
                elif isinstance(entry, str):
                    lines.append(entry)
        else:
            lines = open(fpath).read().splitlines()
        for line in lines:
            norm = normalize_proxy_line(line)
            if not norm or is_forbidden(norm):
                continue
            ek = endpoint_key(norm)
            if ek not in seen_keys:
                seen_keys.add(ek)
                out.append(norm)
    except Exception:
        pass


def _load_proxyvault_candidates(out: list[str], seen_keys: set[str]):
    if not os.path.exists(PV_DB_PATH):
        return
    try:
        con = sqlite3.connect(PV_DB_PATH, timeout=10)
        rows = con.execute(
            """SELECT protocol, ip, port, isp FROM proxies
               WHERE alive = 1 AND protocol IN ('http', 'https', 'socks5')
               ORDER BY https DESC, COALESCE(latency_ms, 9999) ASC
               LIMIT 1500"""
        ).fetchall()
        con.close()
        for proto, ip, port, isp in rows:
            isp_low = (isp or "").lower()
            if any(kw in isp_low for kw in DATACENTER_KEYWORDS):
                continue
            url = f"{proto}://{ip}:{port}"
            if is_forbidden(url):
                continue
            ek = endpoint_key(url)
            if ek not in seen_keys:
                seen_keys.add(ek)
                out.append(url)
    except Exception:
        pass


def _load_public_feed_candidates(out: list[str], seen_keys: set[str]):
    now = time.time()
    feed_urls: list[str] = []
    used_cache = False
    if os.path.exists(FEED_CACHE_PATH):
        try:
            cache = json.load(open(FEED_CACHE_PATH))
            if now - float(cache.get("ts", 0)) < FEED_CACHE_TTL_SEC and cache.get("urls"):
                feed_urls = cache["urls"]
                used_cache = True
        except Exception:
            pass

    if not used_cache:
        def fetch_one(item):
            proto, url = item
            found = []
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "curl/8.5"})
                with urllib.request.urlopen(req, timeout=8) as r:
                    for ln in r.read().decode("utf-8", "ignore").splitlines():
                        norm = normalize_proxy_line(ln, default_proto=proto)
                        if norm and not is_forbidden(norm):
                            found.append(norm)
            except Exception:
                pass
            return found

        with concurrent.futures.ThreadPoolExecutor(max_workers=len(PUBLIC_FEEDS)) as ex:
            for batch in ex.map(fetch_one, PUBLIC_FEEDS):
                feed_urls.extend(batch)
        try:
            json.dump({"ts": now, "urls": feed_urls[:6000]}, open(FEED_CACHE_PATH, "w"))
        except Exception:
            pass

    for u in feed_urls:
        if is_forbidden(u):
            continue
        ek = endpoint_key(u)
        if ek not in seen_keys:
            seen_keys.add(ek)
            out.append(u)


def gather_candidates() -> list[str]:
    seen_keys: set[str] = set()
    priority: list[str] = []
    # 1. Existing verified pool + managed files first
    _read_file_candidates(OUT_JSON, priority, seen_keys)
    for fp in SOURCE_FILES:
        _read_file_candidates(fp, priority, seen_keys)
    # 2. ProxyVault alive non-DC proxies
    _load_proxyvault_candidates(priority, seen_keys)
    # 3. Local seed files
    for fp in READONLY_SEED_FILES:
        _read_file_candidates(fp, priority, seen_keys)
    # 4. Live public feeds (capped to avoid excessive probing)
    feed_list: list[str] = []
    _load_public_feed_candidates(feed_list, seen_keys)
    combined = priority + feed_list
    return combined[:MAX_SCREEN_CANDIDATES]


async def _async_open_tunnel(url: str, target_host: str, target_port: int, timeout: float):
    u = urllib.parse.urlparse(url)
    scheme = (u.scheme or "http").lower()
    host = u.hostname
    port = u.port or (1080 if scheme.startswith("socks") else 8080)
    user = urllib.parse.unquote(u.username or "")
    pwd = urllib.parse.unquote(u.password or "")

    reader, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout=timeout)
    try:
        if scheme.startswith("socks5"):
            writer.write(b"\x05\x02\x00\x02" if (user or pwd) else b"\x05\x01\x00")
            await writer.drain()
            ver, method = await asyncio.wait_for(reader.readexactly(2), timeout=timeout)
            if ver != 5 or method == 0xFF:
                raise RuntimeError("socks5 auth rejected")
            if method == 0x02:
                ub, pb = user.encode(), pwd.encode()
                writer.write(bytes([1, len(ub)]) + ub + bytes([len(pb)]) + pb)
                await writer.drain()
                _, st = await asyncio.wait_for(reader.readexactly(2), timeout=timeout)
                if st != 0:
                    raise RuntimeError("socks5 auth failed")
            try:
                ip_obj = ipaddress.ip_address(target_host)
                addr = (b"\x01" if ip_obj.version == 4 else b"\x04") + ip_obj.packed
            except ValueError:
                hb = target_host.encode("idna")
                addr = bytes([3, len(hb)]) + hb
            writer.write(b"\x05\x01\x00" + addr + struct.pack("!H", target_port))
            await writer.drain()
            hdr = await asyncio.wait_for(reader.readexactly(4), timeout=timeout)
            if hdr[1] != 0:
                raise RuntimeError(f"socks5 connect err {hdr[1]}")
            atyp = hdr[3]
            if atyp == 1:
                await asyncio.wait_for(reader.readexactly(6), timeout=timeout)
            elif atyp == 3:
                alen = (await asyncio.wait_for(reader.readexactly(1), timeout=timeout))[0]
                await asyncio.wait_for(reader.readexactly(alen + 2), timeout=timeout)
            elif atyp == 4:
                await asyncio.wait_for(reader.readexactly(18), timeout=timeout)
        else:
            req = f"CONNECT {target_host}:{target_port} HTTP/1.1\r\nHost: {target_host}:{target_port}\r\n"
            if user or pwd:
                tok = base64.b64encode(f"{user}:{pwd}".encode()).decode("ascii")
                req += f"Proxy-Authorization: Basic {tok}\r\n"
            req += "Proxy-Connection: keep-alive\r\n\r\n"
            writer.write(req.encode("ascii"))
            await writer.drain()
            status = await asyncio.wait_for(reader.readline(), timeout=timeout)
            if b" 200" not in status:
                raise RuntimeError(status.decode(errors="ignore").strip()[:40])
            while True:
                line = await asyncio.wait_for(reader.readline(), timeout=timeout)
                if line in (b"\r\n", b"\n", b""):
                    break
        return reader, writer
    except Exception:
        try:
            writer.close()
        except Exception:
            pass
        raise


async def _fast_screen_one(url: str, sem: asyncio.Semaphore) -> str | None:
    async with sem:
        loop = asyncio.get_running_loop()
        writer = None
        try:
            reader, writer = await _async_open_tunnel(url, "httpbin.org", 443, SCREEN_TIMEOUT)
            new_tr = await asyncio.wait_for(
                loop.start_tls(writer.transport, writer.transport.get_protocol(), TLS_CTX, server_hostname="httpbin.org"),
                timeout=SCREEN_TIMEOUT,
            )
            writer._transport = new_tr
            writer.write(b"GET /ip HTTP/1.1\r\nHost: httpbin.org\r\nConnection: close\r\n\r\n")
            await writer.drain()
            raw = await asyncio.wait_for(reader.read(2048), timeout=SCREEN_TIMEOUT)
            txt = raw.decode(errors="ignore")
            if "200 OK" not in txt and "200 " not in txt.splitlines()[0]:
                return None
            body = txt.split("\r\n\r\n", 1)[-1]
            m = IPV4_RE.search(body)
            if not m or m.group(1) == VPS_PUBLIC_IP:
                return None
            return url
        except Exception:
            return None
        finally:
            if writer:
                try:
                    writer.close()
                except Exception:
                    pass


async def fast_screen_candidates(cands: list[str]) -> list[str]:
    sem = asyncio.Semaphore(140)
    results = await asyncio.gather(*(_fast_screen_one(u, sem) for u in cands), return_exceptions=True)
    return [r for r in results if isinstance(r, str)]


def single_https_probe(url: str) -> tuple[str | None, float | None]:
    for endpoint in IP_ECHO_ENDPOINTS:
        t0 = time.monotonic()
        try:
            r = subprocess.run(
                ["curl", "-sS", "-4", "--max-time", str(PROBE_TIMEOUT), "-w", "\nHTTP_CODE:%{http_code}", "-x", url, endpoint],
                capture_output=True,
                text=True,
                timeout=PROBE_TIMEOUT + 1.5,
            )
            lat_ms = (time.monotonic() - t0) * 1000.0
            if r.returncode != 0 or lat_ms > MAX_ACCEPTABLE_LATENCY_MS:
                continue
            body, _, code_line = (r.stdout or "").rpartition("HTTP_CODE:")
            code = int(code_line.strip()) if code_line.strip().isdigit() else 0
            if code != 200:
                continue
            m = IPV4_RE.search(body)
            if m and m.group(1) != VPS_PUBLIC_IP:
                return m.group(1), lat_ms
        except Exception:
            continue
    return None, None


def reachability_probe(url: str) -> float | None:
    t0 = time.monotonic()
    try:
        r = subprocess.run(
            ["curl", "-sS", "-4", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", str(PROBE_TIMEOUT), "-x", url, REACHABILITY_ENDPOINT],
            capture_output=True,
            text=True,
            timeout=PROBE_TIMEOUT + 1.5,
        )
        lat_ms = (time.monotonic() - t0) * 1000.0
        if r.returncode == 0 and r.stdout.strip() == "204" and lat_ms <= MAX_ACCEPTABLE_LATENCY_MS:
            return lat_ms
    except Exception:
        pass
    return None


def probe_candidate(url: str):
    """Require 2/2 HTTPS TLS passes: IP echo (non-VPS IPv4) + global HTTP 204 reachability."""
    ip1, lat1 = single_https_probe(url)
    if not ip1:
        return None
    lat2 = reachability_probe(url)
    if lat2 is None:
        return None
    avg_lat = round((lat1 + lat2) / 2.0, 1)
    if avg_lat > MAX_ACCEPTABLE_LATENCY_MS:
        return None
    return {"url": url, "egressIp": ip1, "latencyMs": avg_lat}


def _load_asn_cache() -> dict:
    if not os.path.exists(ASN_CACHE_PATH):
        return {}
    try:
        raw = json.load(open(ASN_CACHE_PATH))
        now = time.time()
        return {ip: v for ip, v in raw.items() if now - float(v.get("_ts", 0)) < ASN_CACHE_TTL_SEC}
    except Exception:
        return {}


def _save_asn_cache(cache: dict):
    try:
        os.makedirs(os.path.dirname(ASN_CACHE_PATH), exist_ok=True)
        json.dump(cache, open(ASN_CACHE_PATH, "w"))
    except Exception:
        pass


def batch_lookup_ip(ips: list[str]) -> dict[str, dict]:
    cache = _load_asn_cache()
    out: dict[str, dict] = {}
    missing = []
    for ip in ips:
        if ip in cache:
            out[ip] = cache[ip]
        else:
            missing.append(ip)

    if not missing:
        return out

    for i in range(0, len(missing), 90):
        batch = missing[i : i + 90]
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

    def enrich_one(ip: str):
        cur = dict(out.get(ip) or {"query": ip})
        try:
            with urllib.request.urlopen(f"https://ipwho.is/{ip}", timeout=5) as resp:
                w = json.loads(resp.read().decode("utf-8"))
            if w.get("success") is not False:
                conn = w.get("connection") or {}
                sec = w.get("security") or {}
                cur["isp"] = " | ".join(x for x in [cur.get("isp"), conn.get("isp")] if x)
                cur["org"] = " | ".join(x for x in [cur.get("org"), conn.get("org")] if x)
                cur["domain"] = conn.get("domain") or ""
                if sec.get("hosting") is True or sec.get("vpn") is True or sec.get("tor") is True or sec.get("relay") is True or w.get("type") == "hosting":
                    cur["hosting"] = True
                if not cur.get("countryCode"):
                    cur["countryCode"] = w.get("country_code")
                if not cur.get("country"):
                    cur["country"] = w.get("country")
                if not cur.get("city"):
                    cur["city"] = w.get("city")
                if not cur.get("as") and conn.get("asn"):
                    cur["as"] = f"AS{conn.get('asn')} {conn.get('org') or ''}"
        except Exception:
            pass
        if not cur.get("isp") and not cur.get("as"):
            try:
                with urllib.request.urlopen(f"https://ipinfo.io/{ip}/json", timeout=4) as resp:
                    ii = json.loads(resp.read().decode("utf-8"))
                if ii.get("org"):
                    cur["isp"] = ii.get("org")
                    cur["org"] = ii.get("org")
                    cur["as"] = ii.get("org")
                    cur["countryCode"] = cur.get("countryCode") or ii.get("country")
                    cur["country"] = cur.get("country") or ii.get("country")
            except Exception:
                pass
        return ip, cur

    with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
        for ip, cur in ex.map(enrich_one, missing):
            if cur.get("isp") or cur.get("as"):
                cur["_ts"] = time.time()
                out[ip] = cur
                cache[ip] = cur

    _save_asn_cache(cache)
    return out


def classify_asn(info: dict | None) -> tuple[bool, str, str]:
    if not info:
        return False, "unverified", "ASN lookup unavailable"
    if info.get("hosting") is True:
        return False, "datacenter", f"Hosting/VPN ASN ({info.get('isp', 'unknown')})"
    comb = " ".join([
        str(info.get("isp") or ""),
        str(info.get("org") or ""),
        str(info.get("as") or ""),
        str(info.get("domain") or ""),
    ]).lower()
    if not comb.strip():
        return False, "unverified", "Empty ASN metadata"
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
    residential proxy endpoint (where pool size allows), bound directly on that
    provider's connections (proxyPoolId = NULL).
    Dead / datacenter / WARP / disabled / errored bindings are replaced immediately.
    """
    verified_list = [u for u in (verified_urls or []) if u]
    verified_set = set(verified_list)
    if not os.path.exists(DB_PATH):
        return {"removedGroupPools": 0, "healedDirectConnections": 0, "clearedLocal": 0, "perProviderUnique": 0, "activeProviders": 0}

    t = now_iso()
    con = sqlite3.connect(DB_PATH, timeout=60)
    con.execute("PRAGMA journal_mode=WAL")
    cur = con.cursor()

    # 1. Remove auto-created residential group proxy rows from proxyPools
    cur.execute(
        """DELETE FROM proxyPools
           WHERE id = 'residential-auto-hedge'
              OR json_extract(data, '$.name') = 'RESI-fresh-rotating'
              OR json_extract(data, '$.name') = 'Fresh Residential Auto-Hedge Gateway'"""
    )
    removed_groups = cur.rowcount

    # Retire any leftover WARP / datacenter / dead cron rows
    cur.execute(
        """UPDATE proxyPools
           SET isActive=0, testStatus='retired', updatedAt=?
           WHERE isActive=1 AND (
             json_extract(data,'$.name') LIKE 'PV-%'
             OR json_extract(data,'$.name')='WARP-egress-fresh'
             OR json_extract(data,'$.proxyUrl') LIKE '%127.0.0.1:8118%'
             OR json_extract(data,'$.proxyUrl') LIKE '%4.144.146.21%'
             OR testStatus = 'disabled'
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
                for cfg in strats.values():
                    if isinstance(cfg, dict) and cfg.get("proxyPoolId") is not None:
                        cfg["proxyPoolId"] = None
                        changed_s = True
            if changed_s:
                cur.execute("UPDATE settings SET data=?, updatedAt=? WHERE id=1", (json.dumps(s_obj), t))
        except Exception:
            pass

    # 3. Per-PROVIDER unique residential binding
    rows = cur.execute("SELECT id, provider, data FROM providerConnections WHERE isActive=1").fetchall()
    healed = 0
    cleared_local = 0
    prov_url: dict[str, str] = {}
    external_providers: list[str] = []

    for _, prov, _ in rows:
        if prov not in LOCAL_PROVIDERS and prov not in prov_url:
            external_providers.append(prov)
            if verified_list:
                prov_url[prov] = verified_list[len(prov_url) % len(verified_list)]
            else:
                prov_url[prov] = RESI_GW_URL

    # If a provider already has a healthy, newly-verified direct URL without errors, keep it
    # (unless another provider already claimed it when we have enough unique nodes!)
    used_endpoints: set[str] = set()
    prov_existing_healthy: dict[str, str] = {}
    for cid, prov, raw in rows:
        if prov in LOCAL_PROVIDERS or prov in prov_existing_healthy:
            continue
        try:
            d = json.loads(raw) if raw else {}
        except Exception:
            continue
        last_err = d.get("lastError")
        psd = d.get("providerSpecificData") or {}
        pid = psd.get("proxyPoolId") or d.get("proxyPoolId")
        curl = str(psd.get("connectionProxyUrl") or d.get("connectionProxyUrl") or "").strip()
        enabled = psd.get("connectionProxyEnabled") is True or psd.get("connectionProxyEnabled") == 1 or d.get("connectionProxyEnabled") is True
        has_err = bool(last_err and TRANSPORT_ERR_RE.search(str(last_err)))
        if enabled and not pid and curl in verified_set and not has_err:
            if len(verified_list) < len(external_providers) or curl not in used_endpoints:
                prov_existing_healthy[prov] = curl
                used_endpoints.add(curl)

    # Assign remaining providers distinct unused endpoints from verified_list
    remaining_urls = [u for u in verified_list if u not in used_endpoints]
    rr = 0
    for prov in external_providers:
        if prov in prov_existing_healthy:
            prov_url[prov] = prov_existing_healthy[prov]
        elif remaining_urls:
            prov_url[prov] = remaining_urls.pop(0)
        elif verified_list:
            prov_url[prov] = verified_list[rr % len(verified_list)]
            rr += 1
        else:
            prov_url[prov] = RESI_GW_URL

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

        has_transport_err = bool(last_err and TRANSPORT_ERR_RE.search(str(last_err)))

        # Respect healthy manual user-owned "Apply Proxy" pool bindings ONLY if pool is truly active & alive
        if pid and pid != "__none__":
            try:
                pool_row = cur.execute(
                    "SELECT isActive, testStatus, json_extract(data,'$.proxyUrl') FROM proxyPools WHERE id=?", (pid,)
                ).fetchone()
            except Exception:
                pool_row = None
            pool_url = str(pool_row[2] or "") if pool_row else ""
            pool_status = (pool_row[1] or "active") if pool_row else "missing"
            if (
                pool_row
                and pool_row[0]
                and pool_status not in ("disabled", "retired", "error", "datacenter_blocked")
                and not is_forbidden(pool_url)
                and not has_transport_err
                and (not verified_set or pool_url in verified_set)
            ):
                continue

        target = prov_url.get(prov, RESI_GW_URL)
        is_current = (curl == target and pid is None and enabled)
        if is_current and not has_transport_err:
            continue

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

    con.commit()
    con.close()
    distinct_assigned = len({u for u in prov_url.values() if u in verified_set})
    return {
        "removedGroupPools": removed_groups,
        "healedDirectConnections": healed,
        "clearedLocal": cleared_local,
        "activeProviders": len(external_providers),
        "perProviderUnique": distinct_assigned,
    }


import logging
logging.getLogger("asyncio").setLevel(logging.CRITICAL)

def main():
    cands = gather_candidates()
    print(f"[resi-refresh] stage-1 screening {len(cands)} candidates...")
    screened = asyncio.run(fast_screen_candidates(cands))
    print(f"[resi-refresh] stage-2 double-probing {len(screened)} live HTTPS candidates (max {int(MAX_ACCEPTABLE_LATENCY_MS)}ms + 204)...")

    alive_raw = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=60) as ex:
        for res in ex.map(probe_candidate, screened):
            if res:
                alive_raw.append(res)

    ips = list({r["egressIp"] for r in alive_raw})
    asn_map = batch_lookup_ip(ips)

    verified = []
    dc_blocked = []
    seen_endpoints = set()
    seen_egress_ips = set()
    for r in sorted(alive_raw, key=lambda x: x["latencyMs"]):
        info = asn_map.get(r["egressIp"])
        ok, net_cls, reason = classify_asn(info)
        if ok:
            ekey = endpoint_key(r["url"])
            if ekey in seen_endpoints or r["egressIp"] in seen_egress_ips:
                continue
            seen_endpoints.add(ekey)
            seen_egress_ips.add(r["egressIp"])
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
            if len(verified) >= MAX_VERIFIED_POOL:
                break
        else:
            dc_blocked.append({"url": r["url"], "egressIp": r["egressIp"], "reason": reason})

    if verified:
        with open(OUT_TXT, "w") as f:
            for v in verified:
                f.write(v["url"] + "\n")
        os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
        with open(OUT_JSON, "w") as f:
            json.dump({
                "updatedAt": now_iso(),
                "count": len(verified),
                "datacenterBlocked": len(dc_blocked),
                "nodes": verified,
            }, f, indent=2)

    # Dead/slow/datacenter entries are deleted immediately from managed pool files
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

    # Keep manual Apply Proxy picker (proxyPools) synchronized immediately
    try:
        sys.path.insert(0, "/opt/aries-router/scripts")
        import pool_manager_sync
        pool_manager_sync.main()
    except Exception as e:
        print(f"[resi-refresh] pool_manager_sync warn: {e}")

    try:
        req = urllib.request.Request(RESI_GW_RELOAD, data=b"{}", method="POST")
        urllib.request.urlopen(req, timeout=4).read()
    except Exception:
        pass

    out = {
        "success": True,
        "candidates": len(cands),
        "screenedAlive": len(screened),
        "aliveDoubleChecked": len(alive_raw),
        "verifiedResidential": len(verified),
        "datacenterBlocked": len(dc_blocked),
        "deadDeleted": dead_deleted,
        **db_stats,
    }
    print(json.dumps(out))


if __name__ == "__main__":
    main()
