#!/usr/bin/env python3
# pv_pool_sync.py v2 — Fitur bawaan 9router:
#   ProxyVault -> health-check -> pool proxyPools -> assignment langsung ke
#   SETIAP akun provider (per-connection, TANPA group proxy).
#   Proxy/WARP yang mati: auto-diganti dengan yang baru (PV backfill / WARP rotate).
# Cron tiap 15 menit + tombol "Sinkron ProxyVault" di dashboard.
import json, sqlite3, subprocess, urllib.request, urllib.parse, uuid, hashlib, datetime, sys, time
from concurrent.futures import ThreadPoolExecutor

DB = "/home/ubuntu/.aries-router/db/data.sqlite"
PV = "http://127.0.0.1:8022/api/proxies/export?fmt=json"
PV_LOGIN = "http://127.0.0.1:8022/api/login"
WARP_URL = "http://127.0.0.1:8118"
RESI_URL = "http://127.0.0.1:20188"  # rotating residential gateway (fresh IP per request)
TOP_N = 200           # jumlah proxy sehat di pool
CAND_N = 300          # kandidat yang di-health-check
HC_TIMEOUT = 10        # detik per health-check
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
    # 3 HTTPS probes, >=2 must succeed: router traffic is HTTPS CONNECT and single-pass
    # successes are flaky (measured: same proxy flips 200 -> 000 between attempts).
    ok = 0
    lat = []
    for _ in range(3):
        t0 = time.time()
        try:
            r = subprocess.run(
                ["curl", "-s", "-o", "/dev/null", "-w", "%{http_code}",
                 "--max-time", str(HC_TIMEOUT), "-x", url, "https://api.ipify.org"],
                capture_output=True, timeout=HC_TIMEOUT + 4,
            )
            if r.stdout.decode().strip() == "200":
                ok += 1
                lat.append(time.time() - t0)
        except Exception:
            pass
    return url, ok >= 2, (sum(lat) / len(lat) if lat else 99)


def healthy_pool(cands):
    """Parallel health-check, keep >=2/3 successes, order by measured latency."""
    result = {}
    with ThreadPoolExecutor(max_workers=40) as ex:
        for url, ok, lat in ex.map(_check, cands):
            if ok:
                result[url] = lat
    return [u for u, _ in sorted(result.items(), key=lambda kv: kv[1])]


def resi_alive():
    """Verify RESI_URL supports real HTTPS CONNECT tunneling and returns HTTP 200 IPv4."""
    try:
        r = subprocess.run(
            ["curl", "-s", "-w", "\n%{http_code}", "--max-time", str(HC_TIMEOUT), "-x", RESI_URL, "https://api.ipify.org"],
            capture_output=True, text=True, timeout=HC_TIMEOUT + 4,
        )
        lines = (r.stdout or "").strip().splitlines()
        code = lines[-1].strip() if lines else ""
        body = lines[0].strip() if len(lines) >= 2 else ""
        if code == "200" and body and body.count(".") == 3:
            print("[resi] fresh egress sample:", body[:40])
            return True
        print(f"[resi] HTTPS CONNECT probe failed: code={code!r} body={body[:60]!r}")
        return False
    except Exception as e:
        print("[resi] err:", e)
        return False

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
    skip_warp = "--skip-warp" in sys.argv
    skip_proxy = "--skip-proxy" in sys.argv
    _con0 = sqlite3.connect(DB, timeout=10)
    _n0 = _con0.execute("select count(*) from providerConnections").fetchone()[0]
    _con0.close()
    if _n0 > 150000:
        print(f"[GUARD] providerConnections={_n0} (>150k) - indikasi banjir import, sync di-skip. Cek DB!")
        sys.exit(1)
    t = now()
    alive, resi_list, resi_file_alive = [], [], []
    if not skip_proxy:
        cands = pv_candidates()
        # residential fresh: ~/resi-fresh-alive.txt (klasifikasi ip-api, hosting=false)
        try:
            resi_list = [l.strip().split()[0] for l in open("/home/ubuntu/resi-fresh-alive.txt")
                    if l.strip().startswith("http")]
        except Exception:
            resi_list = []
        for u in resi_list:
            if u not in cands: cands.insert(0, u)
        print(f"[PV] candidates: {len(cands)} (resi: {len(resi_list)})")
        alive = healthy_pool(cands)
        print(f"[PV] healthy: {len(alive)}")
        alive_set = set(alive)
        resi_file_alive = [u for u in resi_list if u in alive_set]
        print(f"[resi-file] sehat: {len(resi_file_alive)}/{len(resi_list)}")

    warp_ok = None
    if not skip_warp:
        warp_ok = warp_alive()
        if not warp_ok:
            warp_ok = warp_fix()
        print(f"[WARP] alive: {warp_ok}")

    # resi gateway counts as usable egress; final abort is below after resi_ok probe
    if skip_proxy and (warp_ok is None or not warp_ok):
        print("[ABORT] WARP not alive after rotate"); sys.exit(1)

    # Fresh residential gateway: always injected when alive (each request = fresh residential IP,
    # replacing any dead proxy slots automatically).
    resi_ok = resi_alive()
    if resi_ok:
        print("[resi] alive: True (rotating fresh residential gateway)")
    urls = ([RESI_URL] if resi_ok else []) + ([WARP_URL] if warp_ok else []) + alive[:TOP_N]
    if not urls:
        print("[ABORT] no healthy egress (proxy, resi, warp all dead)"); sys.exit(1)
    print(f"[pool] total egress sehat: {len(urls)} (resi {'ON' if resi_ok else 'OFF'}, warp {'ON' if warp_ok else 'OFF'})")

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
    url2pid = {}
    if warp_ok: url2pid[WARP_URL] = warp_id
    # 2b. RESI rotating-gateway row upsert (explicitly disable when unhealthy)
    if resi_ok:
        rdata = json.dumps({"name":"RESI-fresh-rotating","proxyUrl":RESI_URL,"noProxy":"127.0.0.1,localhost,","protocol":"http","boundConnectionCount":0,"lastTestedAt":t,"lastError":None})
        rrow = cur.execute("select id from proxyPools where json_extract(data,'$.name')='RESI-fresh-rotating'").fetchone()
        if rrow:
            cur.execute("update proxyPools set isActive=1, testStatus='active', data=?, updatedAt=? where id=?", (rdata, t, rrow[0]))
            url2pid[RESI_URL] = rrow[0]
        else:
            rid2 = str(uuid.uuid4())
            cur.execute("insert into proxyPools (id, isActive, testStatus, data, createdAt, updatedAt) values (?,?, 'active',?,?,?)",
                        (rid2, 1, rdata, t, t))
            url2pid[RESI_URL] = rid2
    else:
        cur.execute("update proxyPools set isActive=0, testStatus='disabled', updatedAt=? where json_extract(data,'$.name')='RESI-fresh-rotating' or json_extract(data,'$.proxyUrl')=?", (t, RESI_URL))

    # 3. insert PV rows baru (hanya yang sehat)
    for u in alive[:TOP_N]:
        pid = str(uuid.uuid4())
        pdata = json.dumps({"name":f"PV-{u.split('//')[1]}","proxyUrl":u,"noProxy":"127.0.0.1,localhost,","protocol":"http","boundConnectionCount":0,"lastTestedAt":t,"lastError":None})
        cur.execute("insert into proxyPools (id, isActive, testStatus, data, createdAt, updatedAt) values (?,?, 'active',?,?,?)", (pid, 1, pdata, t, t))
        url2pid[u] = pid
    con.commit()
    print(f"[pool] rows: {len(url2pid)} (WARP {'ON' if warp_ok else 'OFF'})")

    # 4. assignment ke SEMUA akun provider aktif — SQL-side json_set, stable hash per akun
    urls_js = json.dumps(urls)
    if skip_proxy:
        # WARP-only mode: refresh pv_pool.json for live failover, do NOT touch per-connection proxy binding
        con.close()
        json.dump({"urls": urls, "ts": t}, open("/home/ubuntu/.aries-router/pv_pool.json","w"))
        open(sigfile, "w").write(sig)
        print("[failover] pv_pool.json updated (warp-only, no per-account rotation)")
        return
    n = len(urls)
    # PER-PROVIDER ISOLATION: each provider family gets its OWN slice of the pool
    # (stable hash of provider name -> start offset), so no two providers share an egress.
    # Within one provider, its accounts rotate across that provider's slice (rowid % slice).
    rows = cur.execute(
        "select id, provider from providerConnections where isActive=1 and provider NOT IN ('tokenharbor', 'antigravity', 'gemini', 'gemini-cli', 'opencode', 'openai-compatible-chat-openhop', 'freepi', 'fp')"
    ).fetchall()
    from collections import defaultdict
    prov_rows = defaultdict(list)
    for rid, prov in rows:
        prov_rows[prov].append((rid, None))
    total = 0
    assigned_map = {}
    # WEIGHTED disjoint slices: floor (2 if >50 accounts else 1) then largest-remainder
    # by account demand. Zero cross-provider overlap; big providers get fastest proxies.
    P = len(prov_rows)
    prov_counts = {p: len(r) for p, r in prov_rows.items()}
    total_conns = sum(prov_counts.values()) or 1
    plist = sorted(prov_counts, key=lambda x: (-prov_counts[x], x))
    floor = {p: (2 if prov_counts[p] > 50 else 1) for p in plist}
    base = sum(floor.values())
    alloc = dict(floor)
    if base <= n:
        extra = n - base
        demand = {p: extra * prov_counts[p] / total_conns for p in plist}
        for p in plist:
            alloc[p] += int(demand[p])
        left = n - sum(alloc.values())
        for p in sorted(plist, key=lambda p: -(demand[p] - int(demand[p]))):
            if left <= 0:
                break
            alloc[p] += 1
            left -= 1
    else:
        # pool smaller than the floor sum: hand out 1 each, biggest providers first
        alloc = {p: 0 for p in plist}
        for i, p in enumerate(plist):
            alloc[p] = 1 if i < n else 0
    print(f"[slice] pool={n} providers={P} alloc sum={sum(alloc.values())}")
    for p in plist[:6]:
        print(f"  [slice] {p[:40]}: {alloc[p]} egress for {prov_counts[p]} accounts")
    pos = 0
    for idx_prov, prov in enumerate(plist):
        k = alloc[prov]
        if k <= 0:
            slice_urls = [urls[(pos + idx_prov) % n]]
        elif pos + k <= n:
            slice_urls = urls[pos:pos + k]
            pos = (pos + k) % n
        else:
            slice_urls = urls[pos:] + urls[:k - (n - pos)]
            pos = (pos + k) % n
        rlist = prov_rows[prov]
        m = len(slice_urls)
        for k, (rid, _rowid) in enumerate(rlist):
            u = slice_urls[k % m]
            pid = url2pid[u]
            cur.execute(
                "update providerConnections set data=json_set(data, "
                "'$.providerSpecificData.connectionProxyEnabled', json('1'), "
                "'$.providerSpecificData.proxyPoolId', json_quote(?), "
                "'$.providerSpecificData.connectionProxyUrl', json_quote(?)), updatedAt=? where id=?",
                (pid, u, t, rid),
            )
            total += 1
            assigned_map.setdefault(prov, set()).add(u)
    con.commit()
    print(f"[rotate] akun provider ter-assign: {total} (providers: {len(assigned_map)})")
    for prov, us in sorted(assigned_map.items()):
        print(f"  [assign] {prov}: {len(us)} dedicated egress")
    con.close()
    # tulis pool file buat failover live di proxyFetch.js
    json.dump({"urls": urls, "ts": t}, open("/home/ubuntu/.aries-router/pv_pool.json","w"))
    print("[failover] pv_pool.json updated")
    open(sigfile, "w").write(sig)

if __name__ == "__main__":
    main()
