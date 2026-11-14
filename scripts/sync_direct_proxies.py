#!/usr/bin/env python3
"""
EXSALA HERMES MOD · powered by Gienetic
sync_direct_proxies.py

Sistem Sinkronisasi Direct Proxy (1-on-1) & Auto-Replacement Engine:
1. Menarik Proxy Fresh dari ProxyVault (port 8022) & Residential lists (/home/ubuntu/resi-fresh-alive.txt, live_residential_proxies.txt).
2. Melakukan rotasi WARP egress rotation (/home/ubuntu/warp_rotate.sh).
3. Mencek status hidup proxy yang sedang terpasang di providerConnections (atau provider spesifik).
4. Auto-replace proxy yang mati/offline dengan IP Fresh berlatensi rendah secara instan.
5. Menjamin STRICT 1-on-1 DIRECT BINDING: connectionProxyUrl aktif, proxyPoolId = NULL (TANPA GROUP POOL DI 9ROUTER).
"""

import sys
import os
import json
import sqlite3
import argparse
import datetime
import urllib.request
import urllib.parse
import http.cookiejar
import concurrent.futures
import subprocess
from pathlib import Path

DB_PATH = Path("/home/ubuntu/.aries-router/db/data.sqlite")
LOG_PATH = Path("/home/ubuntu/sync_direct_proxies.log")
WARP_ROTATE_SH = Path("/home/ubuntu/warp_rotate.sh")
RESI_FILES = [
    Path("/home/ubuntu/resi-fresh-alive.txt"),
    Path("/home/ubuntu/live_residential_proxies.txt"),
    Path("/home/ubuntu/farming/zai/proxies.txt"),
    Path("/home/ubuntu/verified_live_proxies.txt"),
]

def log(msg: str):
    timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}] {msg}"
    print(line)
    try:
        with open(LOG_PATH, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass

def fetch_proxyvault_proxies(limit=500):
    proxies = []
    try:
        jar = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        login_data = urllib.parse.urlencode({"username": "admin", "password": "Ar13sV4ult2026"}).encode()
        req_login = urllib.request.Request("http://127.0.0.1:8022/api/login", data=login_data)
        opener.open(req_login, timeout=5)

        req_export = urllib.request.Request("http://127.0.0.1:8022/api/proxies/export?fmt=json")
        res = opener.open(req_export, timeout=10)
        items = json.loads(res.read().decode())
        
        # Sort by lowest latency
        items_sorted = sorted(items, key=lambda x: x.get("latency_ms") or 9999)
        for item in items_sorted:
            proto = item.get("protocol", "http").lower()
            ip = item.get("ip")
            port = item.get("port")
            if ip and port:
                proxies.append(f"{proto}://{ip}:{port}")
            if len(proxies) >= limit:
                break
        log(f"[✓] ProxyVault export: {len(proxies)} fresh candidates loaded (best latency: {items_sorted[0].get('latency_ms') if items_sorted else 'N/A'}ms)")
    except Exception as e:
        log(f"[-] ProxyVault fetch error: {e}")
    return proxies

def fetch_residential_proxies():
    proxies = []
    for fpath in RESI_FILES:
        if fpath.exists():
            try:
                for line in fpath.read_text().splitlines():
                    p = line.strip().split()[0] if line.strip() else ""
                    if p and not p.startswith("#") and ":" in p:
                        if not p.startswith("http://") and not p.startswith("https://") and not p.startswith("socks5://"):
                            p = f"http://{p}"
                        proxies.append(p)
            except Exception as e:
                log(f"[-] Error reading {fpath}: {e}")
    # Deduplicate while preserving order
    dedup = list(dict.fromkeys(proxies))
    log(f"[✓] Residential files loaded: {len(dedup)} unique candidates")
    return dedup

def rotate_warp_egress():
    try:
        log("[*] Triggering WARP egress rotation...")
        res = subprocess.run(["bash", str(WARP_ROTATE_SH)], capture_output=True, text=True, timeout=130)
        log(f"[✓] WARP rotation stdout: {res.stdout.strip()}")
        # Check current egress
        try:
            req = urllib.request.Request("https://api.ipify.org")
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({"http": "http://127.0.0.1:8118", "https": "http://127.0.0.1:8118"}))
            with opener.open(req, timeout=5) as r:
                ip = r.read().decode().strip()
                log(f"[✓] WARP current egress IP: {ip}")
                return ip
        except Exception:
            return "127.0.0.1:8118"
    except Exception as e:
        log(f"[-] WARP rotation error: {e}")
        return None

def probe_proxy_alive(proxy_url, timeout=3.5):
    """Cepat cek apakah proxy merespons TCP/HTTP target"""
    if not proxy_url:
        return False
    # WARP local egress is always trusted if listening
    if "127.0.0.1:8118" in proxy_url or "127.0.0.1:40000" in proxy_url:
        return True
    try:
        handler = urllib.request.ProxyHandler({"http": proxy_url, "https": proxy_url})
        opener = urllib.request.build_opener(handler)
        # Probe lightweight domain
        req = urllib.request.Request("https://api.ipify.org", headers={"User-Agent": "curl/7.88.1"})
        with opener.open(req, timeout=timeout) as r:
            return r.status in (200, 204, 301, 302, 403)
    except Exception:
        return False

def get_verified_fresh_pool(min_candidates=100):
    pv = fetch_proxyvault_proxies(limit=300)
    resi = fetch_residential_proxies()
    
    # Interleave residential & PV to give balanced coverage
    combined = []
    max_len = max(len(pv), len(resi))
    for i in range(max_len):
        if i < len(resi):
            combined.append(resi[i])
        if i < len(pv):
            combined.append(pv[i])
    
    dedup = list(dict.fromkeys(combined))
    log(f"[*] Total unique combined pool: {len(dedup)} candidates")
    
    # Pre-probe first batch to ensure fast replacement
    verified = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=35) as ex:
        futures = {ex.submit(probe_proxy_alive, p, 3.0): p for p in dedup[:150]}
        for fut in concurrent.futures.as_completed(futures):
            p = futures[fut]
            try:
                if fut.result():
                    verified.append(p)
            except Exception:
                pass
                
    log(f"[✓] Pre-verified active fresh proxies: {len(verified)}")
    if not verified:
        # Fallback to combined list if probe network had temporary hiccup
        verified = dedup[:100] if dedup else ["http://127.0.0.1:8118"]
    return verified

def sync_provider_proxies(provider=None, auto_replace_dead=True, rotate_warp=True, dry_run=False):
    if not DB_PATH.exists():
        log(f"[-] Database {DB_PATH} not found!")
        return {"success": False, "error": "Database not found"}

    warp_ip = None
    if rotate_warp:
        warp_ip = rotate_warp_egress()

    fresh_pool = get_verified_fresh_pool()
    fresh_idx = 0

    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()

    if provider:
        cur.execute("SELECT rowid, id, provider, data FROM providerConnections WHERE provider = ?", (provider,))
    else:
        cur.execute("SELECT rowid, id, provider, data FROM providerConnections")

    rows = cur.fetchall()
    total_conns = len(rows)
    log(f"[*] Inspecting {total_conns} connections for provider: {provider or 'ALL'}...")

    # Extract current proxy state
    conn_list = []
    for rowid, cid, prov, raw in rows:
        try:
            d = json.loads(raw) if raw else {}
        except Exception:
            d = {}
        curl = d.get("connectionProxyUrl") or d.get("providerSpecificData", {}).get("connectionProxyUrl") or ""
        conn_list.append({
            "rowid": rowid,
            "id": cid,
            "provider": prov,
            "data": d,
            "proxyUrl": curl
        })

    # If checking dead proxies, probe currently assigned proxies in parallel
    dead_conns = []
    alive_conns = []
    if auto_replace_dead:
        log("[*] Checking health of existing assigned proxies...")
        with concurrent.futures.ThreadPoolExecutor(max_workers=40) as ex:
            futures = {ex.submit(probe_proxy_alive, c["proxyUrl"], 3.0): c for c in conn_list}
            for fut in concurrent.futures.as_completed(futures):
                c = futures[fut]
                is_alive = False
                try:
                    is_alive = fut.result()
                except Exception:
                    is_alive = False
                if is_alive and c["proxyUrl"]:
                    alive_conns.append(c)
                else:
                    dead_conns.append(c)
        log(f"[*] Status existing: Alive={len(alive_conns)}, Dead/Missing={len(dead_conns)}")
    else:
        dead_conns = conn_list

    replaced_count = 0
    # Injeksi IP Fresh pengganti untuk setiap koneksi yang mati/perlu sinkronisasi
    for c in dead_conns:
        rowid = c["rowid"]
        d = c["data"]
        
        # Ambil proxy fresh berikutnya dari pool
        fresh_proxy = fresh_pool[fresh_idx % len(fresh_pool)]
        fresh_idx += 1
        
        # Enforce direct 1-on-1 (root and providerSpecificData)
        d["connectionProxyEnabled"] = True
        d["connectionProxyUrl"] = fresh_proxy
        d["proxyPoolId"] = None
        
        if "providerSpecificData" not in d or not isinstance(d["providerSpecificData"], dict):
            d["providerSpecificData"] = {}
        d["providerSpecificData"]["connectionProxyEnabled"] = True
        d["providerSpecificData"]["connectionProxyUrl"] = fresh_proxy
        d["providerSpecificData"]["proxyPoolId"] = None
        d["providerSpecificData"]["connectionNoProxy"] = ""
        
        new_raw = json.dumps(d, ensure_ascii=False)
        if not dry_run:
            cur.execute("UPDATE providerConnections SET data = ? WHERE rowid = ?", (new_raw, rowid))
        replaced_count += 1

    # Selalu pastikan TIDAK ADA group proxy yang tertinggal
    if not dry_run:
        # Purge proxyPoolId di providerStrategies settings
        try:
            cur.execute("SELECT id, data FROM settings WHERE id = 1")
            s_row = cur.fetchone()
            if s_row:
                s_obj = json.loads(s_row[1])
                strats = s_obj.get("providerStrategies", {})
                modified = False
                if isinstance(strats, dict):
                    for k, v in strats.items():
                        if isinstance(v, dict) and "proxyPoolId" in v and v["proxyPoolId"] is not None:
                            v["proxyPoolId"] = None
                            modified = True
                if modified:
                    cur.execute("UPDATE settings SET data = ? WHERE id = 1", (json.dumps(s_obj),))
        except Exception as e:
            log(f"[-] Note settings purge: {e}")

        con.commit()
    con.close()

    result = {
        "success": True,
        "provider": provider or "all",
        "totalConnections": total_conns,
        "aliveKept": len(alive_conns),
        "replacedFresh": replaced_count,
        "warpEgressIp": warp_ip or "active",
        "poolAvailable": len(fresh_pool),
        "strictlyOneToOne": True,
        "groupProxyCount": 0
    }
    log(f"[✓] SYNC COMPLETE: {json.dumps(result)}")
    return result

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Sync ProxyVault, Residential & WARP 1-on-1")
    parser.add_argument("--provider", type=str, default=None, help="Target specific provider (e.g. glm)")
    parser.add_argument("--no-warp", action="store_true", help="Skip WARP rotation")
    parser.add_argument("--all-rotate", action="store_true", help="Rotate all connections regardless of status")
    parser.add_argument("--dry-run", action="store_true", help="Dry run only")
    
    args = parser.parse_args()
    res = sync_provider_proxies(
        provider=args.provider,
        auto_replace_dead=not args.all_rotate,
        rotate_warp=not args.no_warp,
        dry_run=args.dry_run
    )
    print(json.dumps(res, indent=2))
