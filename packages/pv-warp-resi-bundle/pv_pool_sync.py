#!/usr/bin/env python3
# pv_pool_sync.py v2 — Fitur bawaan 9router:
#   ProxyVault -> health-check -> pool proxyPools -> assignment langsung ke
#   SETIAP akun provider (per-connection, TANPA group proxy).
#   Proxy/WARP yang mati: auto-diganti dengan yang baru (PV backfill / WARP rotate).
# Cron tiap 15 menit + tombol "Sinkron ProxyVault" di dashboard.
import json, sqlite3, subprocess, urllib.request, urllib.parse, uuid, hashlib, datetime, sys
from concurrent.futures import ThreadPoolExecutor

DB = "/home/ubuntu/.aries-router/db/data.sqlite"
PV = "http://127.0.0.1:8022/api/proxies/export?fmt=json"
PV_LOGIN = "http://127.0.0.1:8022/api/login"
WARP_URL = "http://127.0.0.1:8118"
TOP_N = 100           # jumlah proxy sehat di pool
CAND_N = 120          # kandidat yang di-health-check
HC_TIMEOUT = 8        # detik per health-check
TH_RECENT_HOURS = 24  # TH rows yang dirotasi

def now(): return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")

import http.cookiejar
_op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

def pv_candidates():
    try:
        data = urllib.parse.urlencode({"username":"admin","password":"Ar13sV4ult2026"}).encode()
        _op.open(PV_LOGIN, data=data, timeout=15)
        d = json.loads(_op.open(PV, timeout=30).read())
        rows = [r for r in d if r.get("latency_ms")]
        rows.sort(key=lambda r: r["latency_ms"])
        return [f"http://{r['ip']}:{r['port']}" for r in rows[:CAND_N]]
    except Exception as e:
        print("[PV] err:", e); return []

def _check(url):
    try:
        import urllib.request as u
        proxy = u.ProxyHandler({"http": url, "https": url})
        op = u.build_opener(proxy)
        op.open("https://api.ipify.org", timeout=HC_TIMEOUT).read(64)
        return url, True
    except Exception:
        return url, False

def healthy_pool(cands):
    """Health-check paralel, urut sesuai urutan kandidat (latency asc)."""
    result = {}
    with ThreadPoolExecutor(max_workers=15) as ex:
        for url, ok in ex.map(_check, cands):
            result[url] = ok
    return [u for u in cands if result.get(u)]

def warp_alive():
    try:
        import urllib.request as u
        op = u.build_opener(u.ProxyHandler({"http": WARP_URL, "https": WARP_URL}))
        op.open("https://api.ipify.org", timeout=HC_TIMEOUT).read(64)
        return True
    except Exception:
        return False

def warp_fix():
    print("[WARP] egress mati -> rotasi...")
    try:
        subprocess.run(["/home/ubuntu/warp_rotate.sh"], timeout=180, capture_output=True)
        # force rotate: hapus guard 'recent' dengan hapus log
        open("/home/ubuntu/warp_rotate.log", "a").close()
        subprocess.run(["bash","-c","sed -i '$ d' /home/ubuntu/warp_rotate.log; /home/ubuntu/warp_rotate.sh"], timeout=180, capture_output=True)
    except Exception as e:
        print("[WARP] rotate err:", e)
    return warp_alive()

def stable_idx(key, n):
    return int(hashlib.md5(key.encode()).hexdigest(), 16) % n

def main():
    _con0 = sqlite3.connect(DB, timeout=10)
    _n0 = _con0.execute("select count(*) from providerConnections").fetchone()[0]
    _con0.close()
    if _n0 > 150000:
        print(f"[GUARD] providerConnections={_n0} (>150k) - indikasi banjir import, sync di-skip. Cek DB!")
        sys.exit(1)
    t = now()
    cands = pv_candidates()
    # residential fresh: ~/resi-fresh-alive.txt (klasifikasi ip-api, hosting=false)
    try:
        resi = [l.strip().split()[0] for l in open("/home/ubuntu/resi-fresh-alive.txt")
                if l.strip().startswith("http")]
    except Exception:
        resi = []
    for u in resi:
        if u not in cands: cands.insert(0, u)
    print(f"[PV] candidates: {len(cands)} (resi: {len(resi)})")
    alive = healthy_pool(cands)
    print(f"[PV] healthy: {len(alive)}")
    warp_ok = warp_alive()
    if not warp_ok:
        warp_ok = warp_fix()
    print(f"[WARP] alive: {warp_ok}")

    if not alive and not warp_ok:
        print("[ABORT] tidak ada egress hidup"); sys.exit(1)

    alive_set = set(alive)
    resi_alive = [u for u in resi if u in alive_set]
    print(f"[resi] sehat: {len(resi_alive)}/{len(resi)}")
    urls = ([WARP_URL] if warp_ok else []) + alive[:TOP_N]
    print(f"[pool] total egress sehat: {len(urls)}")

    import os
    sig = hashlib.md5(("|".join(urls)).encode()).hexdigest()
    sigfile = "/home/ubuntu/.aries-router/pv_pool.sig"
    try:
        if os.path.exists(sigfile) and open(sigfile).read().strip() == sig and "--force" not in sys.argv:
            print("[skip] pool tidak berubah, DB tidak disentuh")
            json.dump({"urls": urls, "ts": t}, open("/home/ubuntu/.aries-router/pv_pool.json","w"))
            return
    except Exception: pass
    con = sqlite3.connect(DB, timeout=60)
    con.execute("PRAGMA journal_mode=WAL")
    cur = con.cursor()
    # 1. retire PV rows lama
    cur.execute("update proxyPools set isActive=0, testStatus='retired', updatedAt=? where json_extract(data,'$.name') like 'PV-%'", (t,))
    # 2. WARP row upsert
    wdata = json.dumps({"name":"WARP-egress-fresh","proxyUrl":WARP_URL,"noProxy":"127.0.0.1,localhost,","protocol":"http","boundConnectionCount":0,"lastTestedAt":t,"lastError":None})
    row = cur.execute("select id from proxyPools where json_extract(data,'$.name')='WARP-egress-fresh'").fetchone()
    if row:
        cur.execute("update proxyPools set isActive=?, data=?, updatedAt=? where id=?", (1 if warp_ok else 0, wdata, t, row[0]))
        warp_id = row[0]
    else:
        warp_id = str(uuid.uuid4())
        cur.execute("insert into proxyPools (id, isActive, testStatus, data, createdAt, updatedAt) values (?,?, 'active',?,?,?)",
                    (warp_id, 1 if warp_ok else 0, wdata, t, t))
    # 3. insert PV rows baru (hanya yang sehat)
    url2pid = {}
    if warp_ok: url2pid[WARP_URL] = warp_id
    for u in alive[:TOP_N]:
        pid = str(uuid.uuid4())
        pdata = json.dumps({"name":f"PV-{u.split('//')[1]}","proxyUrl":u,"noProxy":"127.0.0.1,localhost,","protocol":"http","boundConnectionCount":0,"lastTestedAt":t,"lastError":None})
        cur.execute("insert into proxyPools (id, isActive, testStatus, data, createdAt, updatedAt) values (?,?, 'active',?,?,?)", (pid, 1, pdata, t, t))
        url2pid[u] = pid
    con.commit()
    print(f"[pool] rows: {len(url2pid)} (WARP {'ON' if warp_ok else 'OFF'})")

    # 4. assignment ke SEMUA akun provider aktif — SQL-side json_set, stable hash per akun
    urls_js = json.dumps(urls)
    n = len(urls)
    # CASE expr: rowid % n -> url & poolId
    url_cases = " ".join(f"when {i} then json_quote('{u}')" for i, u in enumerate(urls))
    pid_cases = " ".join(f"when {i} then json_quote('{url2pid[u]}')" for i, u in enumerate(urls))
    set_expr = (
        "json_set(data, "
        "'$.providerSpecificData.connectionProxyEnabled', json('1'), "
        f"'$.providerSpecificData.proxyPoolId', case rowid % {n} {pid_cases} end, "
        f"'$.providerSpecificData.connectionProxyUrl', case rowid % {n} {url_cases} end)"
    )
    cur.execute(f"update providerConnections set data={set_expr}, updatedAt=? where isActive=1 and provider != 'tokenharbor'", (t,))
    total = cur.rowcount
    con.commit()
    print(f"[rotate] akun provider ter-assign: {total}")
    con.close()
    # tulis pool file buat failover live di proxyFetch.js
    json.dump({"urls": urls, "ts": t}, open("/home/ubuntu/.aries-router/pv_pool.json","w"))
    print("[failover] pv_pool.json updated")
    open(sigfile, "w").write(sig)

if __name__ == "__main__":
    main()
