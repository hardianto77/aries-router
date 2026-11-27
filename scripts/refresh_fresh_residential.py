#!/usr/bin/env python3
"""
Pure-Residential Fresh IP Harvester, 3-Stage Verifier & Direct Per-Provider Injector (v6.0)
- Strictly Pure-Residential ONLY: checks BOTH ingress proxy host IP AND egress exit IP!
  Blocks WARP, loopback, transparent (VPS IP leak), VPN/Tor, Compromised servers,
  University/Campus (.edu/education), and all Datacenter/Cloud/Hosting/IPXO ASNs (fail-closed).
- Multi-source harvesting: existing verified pool + expanded fresh live proxy feeds
  (cached 10m) + local pure-residential seed files (zero ProxyVault, zero seren harvest).
- 3-Stage Verification:
  1) Fast asyncio TCP + HTTP CONNECT / SOCKS5 + TLS pre-screen (high concurrency, pre-filtered against cached DC IPs)
  2) Strict 2/2 consecutive HTTPS TLS (:443) double-probe:
     - Pass 1: IP echo (checkip.amazonaws.com / httpbin / icanhazip / seeip)
     - Pass 2: Real AI edge reachability (generativelanguage.googleapis.com/generate_204 -> HTTP 204)
     Primary threshold avg latency <= 1800ms (soft fallback <= 2200ms only if < 6 fast nodes found).
  3) Multi-provider ASN verification on BOTH ingress IP & egress IP:
     ip-api.com batch (with asname + reverse + hosting + proxy + mobile) + ipinfo.io + RDAP fallback
     with 24h disk cache (/home/ubuntu/.aries-router/asn_cache.json).
- Strict 1-node-per-ingress-IP and 1-node-per-egress-IP deduplication (stops multi-port single-host bottlenecks).
- Instant dead/DC/slow deletion from managed pool files, pool JSON, and proxyPools DB.
- Direct 1-on-1 per-provider injection (proxyPoolId = NULL, zero group proxy pools),
  prioritizing cleanest (proxy=False) & fastest nodes for heaviest providers,
  and keeping pool_manager_sync in sync for manual Apply Proxy picker.
"""
import asyncio
import base64
import concurrent.futures
import datetime
import ipaddress
import json
import logging
import os
import re
import socket
import sqlite3
import ssl
import struct
import subprocess
import sys
import time
import urllib.parse
import urllib.request

logging.getLogger("asyncio").setLevel(logging.CRITICAL)

DB_PATH = "/home/ubuntu/.aries-router/db/data.sqlite"
OUT_TXT = "/home/ubuntu/resi-fresh-alive.txt"
OUT_JSON = "/home/ubuntu/.aries-router/residential_fresh_pool.json"
ASN_CACHE_PATH = "/home/ubuntu/.aries-router/asn_cache.json"
FEED_CACHE_PATH = "/tmp/resi_feed_cache_v6.json"
RESI_GW_URL = "http://127.0.0.1:20188"
RESI_GW_RELOAD = "http://127.0.0.1:20189/reload"
VPS_PUBLIC_IP = os.environ.get("VPS_PUBLIC_IP", "43.163.99.76")

PRIMARY_LATENCY_MS = 900.0
FALLBACK_LATENCY_MS = 1250.0
MAX_JITTER_MS = 750.0
SCREEN_TIMEOUT = 2.5
PROBE_TIMEOUT = 3.0
FEED_CACHE_TTL_SEC = 600
ASN_CACHE_TTL_SEC = 24 * 3600
MAX_SCREEN_CANDIDATES = 8500
MAX_VERIFIED_POOL = 80
IPV4_RE = re.compile(r"\b(\d{1,3}(?:\.\d{1,3}){3})\b")
TLS_CTX = ssl.create_default_context()

LOCAL_PROVIDERS = {"local-device", "searxng", "edge-tts", "google-tts", "devin-cli", "opencode", "openai-compatible-chat-openhop", "openai-compatible-chat-kilo"}

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

READONLY_SEED_FILES = [
    "/home/ubuntu/live_proxyscrape.txt",
    "/home/ubuntu/combined_fast_proxies.txt",
    "/home/ubuntu/fast_verified_pool.txt",
    "/home/ubuntu/mafia_working.txt",
    "/home/ubuntu/verified_live_proxies.txt",
    "/home/ubuntu/vps_rock_solid_proxies.txt",
    "/home/ubuntu/vps_verified_live_proxies.txt",
]

AMP = chr(38)
PUBLIC_FEEDS = [
    ("http", f"https://api.proxyscrape.com/v2/?request=displayproxies{AMP}protocol=http{AMP}timeout=3000{AMP}country=all{AMP}ssl=yes{AMP}anonymity=all"),
    ("socks5", f"https://api.proxyscrape.com/v2/?request=displayproxies{AMP}protocol=socks5{AMP}timeout=3000"),
    ("http", "https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/http.txt"),
    ("https", "https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/https.txt"),
    ("socks5", "https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/socks5.txt"),
    ("http", "https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt"),
    ("socks5", "https://raw.githubusercontent.com/roosterkid/openproxylist/main/SOCKS5_RAW.txt"),
    ("http", "https://raw.githubusercontent.com/elliottophellia/yakumo/master/results/http/global/http_checked.txt"),
    ("socks5", "https://raw.githubusercontent.com/elliottophellia/yakumo/master/results/socks5/global/socks5_checked.txt"),
    ("http", "https://raw.githubusercontent.com/zloi-user/hideip.me/main/http.txt"),
    ("https", "https://raw.githubusercontent.com/zloi-user/hideip.me/main/https.txt"),
    ("socks5", "https://raw.githubusercontent.com/zloi-user/hideip.me/main/socks5.txt"),
    ("http", "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt"),
    ("socks5", "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt"),
    ("http", "https://raw.githubusercontent.com/sunny9577/proxy-scraper/master/generated/http_proxies.txt"),
    ("socks5", "https://raw.githubusercontent.com/sunny9577/proxy-scraper/master/generated/socks5_proxies.txt"),
    ("http", f"https://proxylist.geonode.com/api/proxy-list?limit=500{AMP}page=1{AMP}sort_by=lastChecked{AMP}sort_type=desc{AMP}protocols=http%2Chttps"),
    ("socks5", f"https://proxylist.geonode.com/api/proxy-list?limit=500{AMP}page=1{AMP}sort_by=lastChecked{AMP}sort_type=desc{AMP}protocols=socks5"),
    ("http", "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt"),
    ("socks5", "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/socks5/data.txt"),
    ("http", "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt"),
    ("socks5", "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt"),
    ("socks5", "https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt"),
]

DATACENTER_KEYWORDS = (
    "amazon", "amazonaws", "google", "googleusercontent", "microsoft", "azure", "alibaba", "aliyun",
    "oracle", "tencent", "digitalocean", "linode", "akamai", "hetzner", "choopa", "vultr",
    "cloudflare", "fastly", "contabo", "leaseweb", "m247", "hostinger", "godaddy", "scaleway",
    "hosting", "datacenter", "data center", "dedicated", "colocation", "telepoint", "cogent",
    "zenlayer", "ucloud", "rackspace", "softlayer", "psychz", "layeronline", "hostkey", "quadranet",
    "estnoc", "realcloud", "serverius", "fdcservers", "frantech", "buyvm", "limestone", "datapacket",
    "gcore", "kamatera", "ionos", "strato", "upcloud", "cherry servers", "worldstream", "nforce",
    "xtom", "sharktech", "colocrossing", "reliablesite", "gthost", "ctrls", "orion network",
    "bunny technology", "lixium", "timeweb", "layershift", "haoxiangyun", "selectel", "akene",
    "cogento", "oneprovider", "brainstorm network", "ptisp", "almouroltec", "pvdatanet", "pvdata",
    "real time data", "servers tech", "franet", "mullvad", "nordvpn", "protonvpn", "surfshark",
    "expressvpn", "datacamp", "cdn77", "online sas", "constant company", "netcup", "zscaler",
    "natanetwork", "huawei", "servidores", "nexosystems", "3xk", "antbox", "baykov",
    "church of cyberology", "tor exit", "emerald onion", "calyx", "quintex",
    "ipxo", "chunkserve", "nhanhoa", "datawagon", "hostpapa", "techties", "imaqliq",
    "alucio", "superhub", "cloud net", "blsync", "it host", "aceville", "cognetcloud",
    "reliable communications", "compromised", "floppydata", "stealthtunnel",
    "brightdata", "oxylabs", "smartproxy", "iproyal", "proxyrack", "luminati",
    "solusindo", "telematika", "selaras citra", "murni makmur", "vds", "sia veesp", "veesp", "netsec",
)

DATACENTER_WORD_RE = re.compile(
    r"\b(aws|ovh|vps|vpn|tor|cdn|colo|cloud|server|servers|proxy|warp|dedi|hosted|wholesale|transit|backbone|your-server)\b",
    re.I,
)

EDUCATION_RE = re.compile(
    r"(\buniversity\b|\bcollege\b|\bschool\b|\beducational\b|\bacademi\b|\buniversitas\b|\bcampus\b|\bsurfnet\b|\bresearch\s+network\b|\.edu\b|\.ac\.[a-z]{2}\b)",
    re.I,
)

FORBIDDEN_HOSTS = {
    "127.0.0.1", "localhost", "::1", "0.0.0.0", VPS_PUBLIC_IP,
    "4.144.146.21", "34.43.46.91", "103.237.102.191", "80.65.211.149",
    "pt1.cactussstp.com", "bul2.stealthtunnel.net", "pg.stealthtunnel.net",
    "de-fra.pvdata.host", "nl-ams.pvdata.host",
}

IP_ECHO_ENDPOINTS = (
    "https://1.1.1.1/cdn-cgi/trace",
    "https://checkip.amazonaws.com",
    "https://api.ipify.org?format=json",
    "https://httpbin.org/ip",
)
REACHABILITY_ENDPOINT = "https://generativelanguage.googleapis.com/generate_204"
FALLBACK_REACHABILITY_ENDPOINT = "https://www.gstatic.com/generate_204"
TRANSPORT_ERR_RE = re.compile(
    r"429|rate.?limit|502|504|524|407|402|proxy|timeout|tunnel|fetch failed|ECONNREFUSED|ETIMEDOUT|ECONNRESET|socket",
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
        if host.endswith((".pvdata.host", ".stealthtunnel.net", ".floppydata.com", ".edu", ".edu.tw", ".ac.th")):
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


def resolve_host_ip(url: str) -> str:
    try:
        host = (urllib.parse.urlparse(url).hostname or "").strip()
        if not host:
            return ""
        try:
            ipaddress.ip_address(host)
            return host
        except ValueError:
            return socket.gethostbyname(host)
    except Exception:
        return ""


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
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=7) as r:
                    raw = r.read().decode("utf-8", "ignore")
                if "geonode.com" in url:
                    for row in (json.loads(raw).get("data") or []):
                        ip, port = row.get("ip"), row.get("port")
                        prots = row.get("protocols") or [proto]
                        p = "socks5" if "socks5" in prots else "http"
                        if ip and port:
                            norm = f"{p}://{ip}:{port}"
                            if not is_forbidden(norm):
                                found.append(norm)
                else:
                    for ln in raw.splitlines():
                        norm = normalize_proxy_line(ln, default_proto=proto)
                        if norm and not is_forbidden(norm):
                            found.append(norm)
            except Exception:
                pass
            return found

        with concurrent.futures.ThreadPoolExecutor(max_workers=12) as ex:
            for batch in ex.map(fetch_one, PUBLIC_FEEDS):
                feed_urls.extend(batch)
        try:
            json.dump({"ts": now, "urls": feed_urls[:14000]}, open(FEED_CACHE_PATH, "w"))
        except Exception:
            pass

    for u in feed_urls:
        if is_forbidden(u):
            continue
        ek = endpoint_key(u)
        if ek not in seen_keys:
            seen_keys.add(ek)
            out.append(u)


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


def classify_asn(info: dict | None) -> tuple[bool, str, str]:
    if not info:
        return False, "unverified", "ASN lookup unavailable"
    if info.get("hosting") is True or info.get("security_hosting") is True or info.get("ipwho_type") == "hosting":
        return False, "datacenter", f"Hosting/DC ASN ({info.get('isp', 'unknown')})"
    if info.get("security_vpn") is True or info.get("security_tor") is True:
        return False, "datacenter", f"VPN/Tor ASN ({info.get('isp', 'unknown')})"
    if info.get("proxy") is True or info.get("security_proxy") is True:
        return False, "proxy_flagged", f"Proxy-flagged IP ({info.get('isp', 'unknown')})"
    comb = " ".join([
        str(info.get("isp") or ""),
        str(info.get("org") or ""),
        str(info.get("as") or ""),
        str(info.get("asname") or ""),
        str(info.get("reverse") or ""),
        str(info.get("domain") or ""),
    ]).lower()
    if not comb.strip():
        return False, "unverified", "Empty ASN metadata"
    if EDUCATION_RE.search(comb):
        return False, "datacenter", f"Campus/Education proxy blocked ({info.get('isp', '')})"
    for kw in DATACENTER_KEYWORDS:
        if kw in comb:
            return False, "datacenter", f"Datacenter keyword '{kw}' ({info.get('isp', '')})"
    m_word = DATACENTER_WORD_RE.search(comb)
    if m_word:
        return False, "datacenter", f"Datacenter pattern '{m_word.group(1)}' ({info.get('isp', '')})"
    if info.get("mobile"):
        return True, "mobile", "Mobile ISP"
    return True, "residential", "Pure Residential ISP"


def gather_candidates() -> list[str]:
    asn_cache = _load_asn_cache()
    seen_keys: set[str] = set()
    priority: list[str] = []

    # 1. Existing verified Proxy Harvest pools in SQLite + verified files first
    if os.path.exists(DB_PATH):
        try:
            con = sqlite3.connect(DB_PATH, timeout=10)
            for (raw,) in con.execute("SELECT data FROM proxyPools WHERE isActive=1").fetchall():
                d = json.loads(raw) if raw else {}
                u = normalize_proxy_line(d.get("proxyUrl") or "")
                if u and not is_forbidden(u) and d.get("proxyFlagged") is not True:
                    ek = endpoint_key(u)
                    if ek not in seen_keys:
                        seen_keys.add(ek)
                        priority.append(u)
            con.close()
        except Exception:
            pass
    _read_file_candidates(OUT_JSON, priority, seen_keys)
    for fp in SOURCE_FILES:
        _read_file_candidates(fp, priority, seen_keys)

    # 2. Fresh live public feeds BEFORE local seed files
    _load_public_feed_candidates(priority, seen_keys)

    # 3. Local pure-residential seed files
    for fp in READONLY_SEED_FILES:
        _read_file_candidates(fp, priority, seen_keys)

    # Pre-filter out candidates whose ingress IP is already known datacenter/education in asn_cache,
    # and cap ports per ingress host to 2 during screening so one tunnel host doesn't hog slots.
    filtered: list[str] = []
    per_host_count: dict[str, int] = {}
    for u in priority:
        host = (urllib.parse.urlparse(u).hostname or "").lower()
        if not host:
            continue
        cached = asn_cache.get(host)
        if cached:
            ok, _, _ = classify_asn(cached)
            if not ok:
                continue
        cnt = per_host_count.get(host, 0)
        if cnt >= 2:
            continue
        per_host_count[host] = cnt + 1
        filtered.append(u)
        if len(filtered) >= MAX_SCREEN_CANDIDATES:
            break
    return filtered


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
            reader, writer = await _async_open_tunnel(url, "checkip.amazonaws.com", 443, SCREEN_TIMEOUT)
            new_tr = await asyncio.wait_for(
                loop.start_tls(writer.transport, writer.transport.get_protocol(), TLS_CTX, server_hostname="checkip.amazonaws.com"),
                timeout=SCREEN_TIMEOUT,
            )
            writer._transport = new_tr
            writer.write(b"GET / HTTP/1.1\r\nHost: checkip.amazonaws.com\r\nConnection: close\r\n\r\n")
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
    sem = asyncio.Semaphore(260)
    results = await asyncio.gather(*(_fast_screen_one(u, sem) for u in cands), return_exceptions=True)
    return [r for r in results if isinstance(r, str)]


def single_https_probe(url: str) -> tuple[str | None, float | None]:
    for endpoint in IP_ECHO_ENDPOINTS[:3]:
        t0 = time.monotonic()
        try:
            r = subprocess.run(
                ["curl", "-sS", "-4", "--max-time", str(PROBE_TIMEOUT), "-w", "\nHTTP_CODE:%{http_code}", "-x", url, endpoint],
                capture_output=True,
                text=True,
                timeout=PROBE_TIMEOUT + 1.0,
            )
            lat_ms = (time.monotonic() - t0) * 1000.0
            if r.returncode != 0 or lat_ms > FALLBACK_LATENCY_MS:
                continue
            body, _, code_line = (r.stdout or "").rpartition("HTTP_CODE:")
            code = int(code_line.strip()) if code_line.strip().isdigit() else 0
            if code in (429, 403, 407):
                return None, None
            if code != 200 or "<html" in body.lower():
                continue
            extracted = None
            if "/cdn-cgi/trace" in endpoint:
                for ln in body.splitlines():
                    if ln.startswith("ip="):
                        extracted = ln[3:].strip()
                        break
            if not extracted:
                m = IPV4_RE.search(body)
                if m:
                    extracted = m.group(1)
            if extracted and extracted != VPS_PUBLIC_IP:
                return extracted, lat_ms
        except Exception:
            continue
    return None, None


def reachability_probe(url: str) -> list[float] | None:
    lats = []
    for endpoint in (REACHABILITY_ENDPOINT, FALLBACK_REACHABILITY_ENDPOINT):
        t0 = time.monotonic()
        try:
            r = subprocess.run(
                ["curl", "-sS", "-4", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", str(PROBE_TIMEOUT), "-x", url, endpoint],
                capture_output=True,
                text=True,
                timeout=PROBE_TIMEOUT + 1.0,
            )
            lat_ms = (time.monotonic() - t0) * 1000.0
            if r.returncode != 0 or lat_ms > FALLBACK_LATENCY_MS:
                return None
            code = int(r.stdout.strip()) if r.stdout.strip().isdigit() else 0
            if code not in (200, 204):
                return None
            lats.append(lat_ms)
        except Exception:
            return None
    return lats


def probe_candidate(url: str):
    """Require 3/3 HTTPS TLS passes (IP echo + Gemini TLS + gstatic TLS) with low latency & jitter."""
    ip1, lat1 = single_https_probe(url)
    if not ip1 or lat1 is None:
        return None
    lats = reachability_probe(url)
    if not lats or len(lats) < 2:
        return None
    ip2, lat4 = single_https_probe(url)
    if not ip2 or lat4 is None:
        return None
    all_lats = [lat1, lats[0], lats[1], lat4]
    avg_lat = round(sum(all_lats) / len(all_lats), 1)
    jitter_ms = round(max(all_lats) - min(all_lats), 1)
    if avg_lat > FALLBACK_LATENCY_MS or jitter_ms > MAX_JITTER_MS:
        return None
    in_ip = resolve_host_ip(url)
    if not in_ip:
        return None
    return {"url": url, "inIp": in_ip, "egressIp": ip1, "latencyMs": avg_lat, "jitterMs": jitter_ms}


def batch_lookup_ip(ips: list[str]) -> dict[str, dict]:
    cache = _load_asn_cache()
    out: dict[str, dict] = {}
    missing = []
    for ip in ips:
        if not ip:
            continue
        if ip in cache and ("asname" in cache[ip] or "reverse" in cache[ip]):
            out[ip] = cache[ip]
        else:
            missing.append(ip)

    if not missing:
        return out

    for i in range(0, len(missing), 90):
        batch = missing[i : i + 90]
        try:
            req = urllib.request.Request(
                "http://ip-api.com/batch?fields=query,status,country,countryCode,city,isp,org,as,asname,reverse,hosting,proxy,mobile",
                data=json.dumps(batch).encode("utf-8"),
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                for row in json.loads(resp.read().decode("utf-8")):
                    if row.get("status") == "success" and row.get("query"):
                        out[row["query"]] = row
        except Exception:
            pass

    def enrich_missing(ip: str):
        cur = dict(out.get(ip) or {"query": ip})
        try:
            with urllib.request.urlopen(f"https://ipwho.is/{ip}", timeout=3.5) as resp:
                w = json.loads(resp.read().decode("utf-8"))
            if isinstance(w, dict) and w.get("success") is not False:
                conn = w.get("connection") or {}
                sec = w.get("security") or {}
                cur["ipwho_checked"] = True
                cur["ipwho_type"] = w.get("type") or ""
                cur["country"] = cur.get("country") or w.get("country")
                cur["countryCode"] = cur.get("countryCode") or w.get("country_code")
                cur["city"] = cur.get("city") or w.get("city")
                cur["isp"] = cur.get("isp") or conn.get("isp") or conn.get("org") or ""
                cur["org"] = cur.get("org") or conn.get("org") or ""
                cur["domain"] = cur.get("domain") or conn.get("domain") or ""
                if not cur.get("as") and conn.get("asn"):
                    cur["as"] = f"AS{conn.get('asn')} {cur['org'] or cur['isp']}".strip()
                cur["security_hosting"] = bool(sec.get("hosting") or w.get("type") == "hosting")
                cur["security_proxy"] = bool(sec.get("proxy"))
                cur["security_vpn"] = bool(sec.get("vpn"))
                cur["security_tor"] = bool(sec.get("tor"))
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
                    cur["reverse"] = ii.get("hostname") or cur.get("reverse") or ""
                    cur["countryCode"] = cur.get("countryCode") or ii.get("country")
                    cur["country"] = cur.get("country") or ii.get("country")
                    cur["city"] = cur.get("city") or ii.get("city")
            except Exception:
                pass
        if not cur.get("isp") and not cur.get("as"):
            try:
                with urllib.request.urlopen(f"https://rdap.apnic.net/ip/{ip}", timeout=4) as resp:
                    rd = json.loads(resp.read().decode("utf-8"))
                name = rd.get("name") or ""
                rems = []
                for rem in rd.get("remarks", []):
                    rems.extend(rem.get("description", []))
                desc = " ".join(rems[:3])
                if name or desc:
                    cur["isp"] = name
                    cur["org"] = desc or name
            except Exception:
                pass
        return ip, cur

    need_fallback = [ip for ip in missing if not (out.get(ip) or {}).get("ipwho_checked") or (not (out.get(ip) or {}).get("isp") and not (out.get(ip) or {}).get("as"))]
    if need_fallback:
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as ex:
            for ip, cur in ex.map(enrich_missing, need_fallback):
                if cur.get("isp") or cur.get("as"):
                    out[ip] = cur

    now_ts = time.time()
    for ip in missing:
        if ip in out and (out[ip].get("isp") or out[ip].get("as")):
            out[ip]["_ts"] = now_ts
            cache[ip] = out[ip]

    _save_asn_cache(cache)
    return out


def sync_db_direct_only(verified_urls) -> dict:
    """
    ZERO group proxy pools. Each PROVIDER gets its OWN DEDICATED verified
    residential proxy endpoint (where pool size allows), bound directly on that
    provider's connections (proxyPoolId = NULL).
    Heaviest providers receive the cleanest & lowest-latency endpoints first.
    Dead / datacenter / WARP / disabled / errored / stale bindings are replaced immediately.
    """
    verified_list = [u for u in (verified_urls or []) if u]
    if os.path.exists(DB_PATH):
        try:
            _con = sqlite3.connect(DB_PATH, timeout=10)
            _db_candidates = []
            for (_pid, _raw) in _con.execute("SELECT id, data FROM proxyPools WHERE isActive=1").fetchall():
                _d = json.loads(_raw) if _raw else {}
                _u = str(_d.get("proxyUrl") or "").strip()
                _lat = _d.get("latencyMs")
                if (
                    _u
                    and _u not in verified_list
                    and _d.get("isResidential") is True
                    and _d.get("ipType") != "datacenter"
                    and _d.get("proxyFlagged") is not True
                    and (_lat is None or float(_lat) <= FALLBACK_LATENCY_MS)
                    and not is_forbidden(_u)
                ):
                    _db_candidates.append((_pid, _u))
            if _db_candidates:
                with concurrent.futures.ThreadPoolExecutor(max_workers=12) as _ex:
                    _futs = {_ex.submit(reachability_probe, _u): (_pid, _u) for (_pid, _u) in _db_candidates}
                    for _fut in concurrent.futures.as_completed(_futs):
                        _pid, _u = _futs[_fut]
                        _lats = None
                        try:
                            _lats = _fut.result()
                        except Exception:
                            _lats = None
                        if _lats and max(_lats) <= FALLBACK_LATENCY_MS:
                            verified_list.append(_u)
                        else:
                            # Mark truly dead/laggy DB pool inactive without punishing ipify hiccups
                            _con.execute("UPDATE proxyPools SET isActive=0, testStatus='error' WHERE id=?", (_pid,))
                _con.commit()
            _con.close()
        except Exception:
            pass
    if not verified_list and os.path.exists(OUT_JSON):
        try:
            cached_nodes = json.load(open(OUT_JSON)).get("nodes") or []
            verified_list = [n.get("url") for n in cached_nodes if n.get("url") and not n.get("proxyFlagged")]
        except Exception:
            pass
    verified_set = set(verified_list)
    if not verified_list:
        return {"removedGroupPools": 0, "healedDirectConnections": 0, "clearedLocal": 0, "perProviderUnique": 0, "activeProviders": 0}
    if not os.path.exists(DB_PATH):
        return {"removedGroupPools": 0, "healedDirectConnections": 0, "clearedLocal": 0, "perProviderUnique": 0, "activeProviders": 0}

    t = now_iso()
    con = sqlite3.connect(DB_PATH, timeout=60)
    con.execute("PRAGMA journal_mode=WAL")
    cur = con.cursor()

    cur.execute(
        """DELETE FROM proxyPools
           WHERE id = 'residential-auto-hedge'
              OR json_extract(data, '$.name') = 'RESI-fresh-rotating'
              OR json_extract(data, '$.name') = 'Fresh Residential Auto-Hedge Gateway'
              OR json_extract(data, '$.name') LIKE 'seren-%'
              OR json_extract(data, '$.name') LIKE 'FreeProxy-%'
              OR json_extract(data, '$.name') LIKE 'PV-%'
              OR json_extract(data, '$.name') = 'WARP-egress-fresh'
              OR json_extract(data, '$.name') LIKE 'Proxy-cron-%'"""
    )
    removed_groups = cur.rowcount

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

    rows = cur.execute("SELECT id, provider, data FROM providerConnections WHERE isActive=1").fetchall()
    healed = 0
    cleared_local = 0

    prov_counts: dict[str, int] = {}
    for _, prov, _ in rows:
        if prov not in LOCAL_PROVIDERS:
            prov_counts[prov] = prov_counts.get(prov, 0) + 1

    # Prioritize heaviest providers first so they get cleanest/fastest dedicated endpoints
    external_providers = sorted(prov_counts.keys(), key=lambda p: (-prov_counts[p], p))

    used_endpoints: set[str] = set()
    used_hosts: set[str] = set()
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
        chost = (urllib.parse.urlparse(curl).hostname or "").lower()
        if enabled and not pid and curl in verified_set and not has_err:
            if len(verified_list) < len(external_providers) or (curl not in used_endpoints and chost not in used_hosts):
                prov_existing_healthy[prov] = curl
                used_endpoints.add(curl)
                if chost:
                    used_hosts.add(chost)

    prov_url: dict[str, str] = {}
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

    # Fair round-robin spread across ALL verified pure-residential IPs for every provider & connection
    fair_providers = sorted(prov_counts.keys(), key=lambda p: (prov_counts[p], p))
    prov_conn_rr: dict[str, int] = {}
    prov_base_idx = {p: idx for idx, p in enumerate(fair_providers)}
    def next_target_for_conn(prov: str) -> str:
        cidx = prov_conn_rr.get(prov, 0)
        prov_conn_rr[prov] = cidx + 1
        slot = (prov_base_idx.get(prov, 0) + cidx) % len(verified_list)
        return verified_list[slot]

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

        # Group bindings (proxyPoolId) are never kept active; fall through to direct 1-on-1 binding below.

        target = next_target_for_conn(prov)
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


def main():
    cands = gather_candidates()
    print(f"[resi-refresh] stage-1 screening {len(cands)} candidates...")
    screened = asyncio.run(fast_screen_candidates(cands))
    print(f"[resi-refresh] stage-2 double-probing {len(screened)} live HTTPS candidates (target <= {int(PRIMARY_LATENCY_MS)}ms + genai 204)...")

    alive_raw = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=70) as ex:
        for res in ex.map(probe_candidate, screened):
            if res:
                alive_raw.append(res)

    ips = list({ip for r in alive_raw for ip in (r["inIp"], r["egressIp"]) if ip})
    asn_map = batch_lookup_ip(ips)

    candidates_clean = []
    dc_blocked = []
    for r in alive_raw:
        in_info = asn_map.get(r["inIp"])
        eg_info = asn_map.get(r["egressIp"])
        ok_in, _, reason_in = classify_asn(in_info)
        ok_eg, net_cls, reason_eg = classify_asn(eg_info)
        if not ok_in:
            dc_blocked.append({"url": r["url"], "egressIp": r["egressIp"], "reason": f"ingress: {reason_in}"})
            continue
        if not ok_eg:
            dc_blocked.append({"url": r["url"], "egressIp": r["egressIp"], "reason": f"egress: {reason_eg}"})
            continue
        proxy_flagged = bool((in_info or {}).get("proxy") or (eg_info or {}).get("proxy"))
        candidates_clean.append((r, eg_info, net_cls, proxy_flagged))

    # Prefer <= PRIMARY_LATENCY_MS (1800ms) first; only use 1800..2200ms if < 6 fast nodes exist.
    fast_clean = [c for c in candidates_clean if c[0]["latencyMs"] <= PRIMARY_LATENCY_MS]
    pool_source = fast_clean if len(fast_clean) >= 6 else candidates_clean

    # Sort: clean proxy=False before proxy=True, then lowest latency first
    pool_source.sort(key=lambda item: (0 if item[0]["latencyMs"] <= PRIMARY_LATENCY_MS else 1, 0 if not item[3] else 1, item[0]["latencyMs"]))

    verified = []
    seen_ingress_ips = set()
    seen_egress_ips = set()
    for r, info, net_cls, proxy_flagged in pool_source:
        if r["inIp"] in seen_ingress_ips or r["egressIp"] in seen_egress_ips:
            continue
        seen_ingress_ips.add(r["inIp"])
        seen_egress_ips.add(r["egressIp"])
        verified.append({
            "url": r["url"],
            "maskedUrl": mask_url(r["url"]),
            "ingressIp": r["inIp"],
            "egressIp": r["egressIp"],
            "latencyMs": r["latencyMs"],
            "jitterMs": r.get("jitterMs", 0),
            "country": info.get("country"),
            "countryCode": info.get("countryCode"),
            "city": info.get("city"),
            "isp": (info.get("isp") or "").split(" | ")[0],
            "org": (info.get("org") or "").split(" | ")[0],
            "asn": info.get("as"),
            "networkClass": net_cls,
            "proxyFlagged": proxy_flagged,
            "isResidential": True,
            "verifiedAt": now_iso(),
        })
        if len(verified) >= MAX_VERIFIED_POOL:
            break

    existing_db_verified = []
    if os.path.exists(DB_PATH):
        try:
            _con = sqlite3.connect(DB_PATH, timeout=10)
            for (_raw,) in _con.execute("SELECT data FROM proxyPools WHERE isActive=1").fetchall():
                _d = json.loads(_raw) if _raw else {}
                if _d.get("isResidential") is True and _d.get("proxyFlagged") is not True and _d.get("proxyUrl"):
                    existing_db_verified.append(_d)
            _con.close()
        except Exception:
            pass
    if verified and (len(verified) >= 5 or len(verified) >= len(existing_db_verified)):
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

    if os.path.exists(DB_PATH) and verified:
        try:
            import uuid
            _con_ins = sqlite3.connect(DB_PATH, timeout=30)
            _existing_urls = set()
            _active_cnt = 0
            for (_act, _raw) in _con_ins.execute("SELECT isActive, data FROM proxyPools").fetchall():
                _d = json.loads(_raw) if _raw else {}
                _u = str(_d.get("proxyUrl") or "").strip().lower()
                if _u:
                    _existing_urls.add(_u)
                if _act:
                    _active_cnt += 1
            _ts = now_iso()
            for v in verified:
                if _active_cnt >= 40:
                    break
                _u = str(v.get("url") or "").strip()
                if not _u or _u.lower() in _existing_urls or v.get("proxyFlagged"):
                    continue
                _cc = v.get("countryCode") or "XX"
                _proto = "socks5" if _u.startswith("socks5") else "http"
                _payload = {
                    "name": f"Resi-{v['egressIp']} ({_cc})",
                    "proxyUrl": _u,
                    "type": _proto,
                    "strictProxy": False,
                    "noProxy": "127.0.0.1,localhost,",
                    "ingressIp": v.get("ingressIp"),
                    "egressIp": v.get("egressIp"),
                    "country": v.get("country"),
                    "countryCode": _cc,
                    "city": v.get("city"),
                    "isp": (v.get("isp") or "Residential")[:28],
                    "asn": v.get("asn"),
                    "networkClass": v.get("networkClass") or "residential",
                    "ipType": "residential",
                    "isResidential": True,
                    "proxyFlagged": False,
                    "latencyMs": round(float(v.get("latencyMs") or 500)),
                    "jitterMs": round(float(v.get("jitterMs") or 0)),
                    "stabilityPct": 100,
                    "lastError": None,
                    "lastTestedAt": _ts,
                    "harvestedBy": "proxy-harvest",
                    "harvestRunId": _ts,
                }
                _con_ins.execute(
                    "INSERT INTO proxyPools (id, isActive, testStatus, data, createdAt, updatedAt) VALUES (?, 1, 'active', ?, ?, ?)",
                    (str(uuid.uuid4()), json.dumps(_payload, ensure_ascii=False), _ts, _ts),
                )
                _existing_urls.add(_u.lower())
                _active_cnt += 1
            _con_ins.commit()
            _con_ins.close()
        except Exception:
            pass

    db_stats = sync_db_direct_only([v["url"] for v in verified])



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
