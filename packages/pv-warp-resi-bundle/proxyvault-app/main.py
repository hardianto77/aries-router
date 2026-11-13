import asyncio
import json
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, Request, Form
from fastapi.responses import (JSONResponse, RedirectResponse, PlainTextResponse,
                               HTMLResponse, FileResponse, StreamingResponse)
from fastapi.staticfiles import StaticFiles

from app.config import (ADMIN_USERNAME, ADMIN_PASSWORD, SIGNUP_SOURCES,
                        VALIDATE_TIMEOUT, VALIDATE_CONCURRENCY, MAX_FAILED_CHECKS,
                        MAX_CANDIDATES, AUTO_DEDUPE, GEO_ENRICH, GEO_MAX,
                        SITE_CHECK_TIMEOUT, SITE_CHECK_LIMIT, SITE_CHECK_CONCURRENCY)
from app.database import init_db, db, execute, executemany
from app.security import (create_user, get_user, verify_password,
                          create_session, session_user, destroy_session)
from app.engine import engine
from app import sitecheck

DIST = Path(__file__).resolve().parent.parent / "web" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    if AUTO_DEDUPE:
        removed = await engine.dedupe()
        if removed:
            print(f"dedupe removed {removed} duplicate listings at startup")
    async with db().execute("SELECT COUNT(*) c FROM users") as cur:
        if (await cur.fetchone())["c"] == 0:
            await create_user(ADMIN_USERNAME, ADMIN_PASSWORD, is_admin=True)
            print(f"!! bootstrapped admin '{ADMIN_USERNAME}' — change the default password")
    yield


app = FastAPI(title="ProxyVault", lifespan=lifespan)

PUBLIC_PREFIXES = ("/login", "/register", "/api/login", "/api/register",
                   "/assets/", "/favicon")


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    if path.startswith(PUBLIC_PREFIXES):
        return await call_next(request)
    user = await session_user(request.cookies.get("pv_session"))
    if not user:
        if path.startswith("/api/"):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        return RedirectResponse("/login", status_code=303)
    request.state.user = user
    return await call_next(request)


# ── auth api ───────────────────────────────────────────────────────────
@app.post("/api/login")
async def api_login(username: str = Form(...), password: str = Form(...)):
    user = await get_user(username)
    if not user or not verify_password(password, user["pass_hash"]):
        return JSONResponse({"error": "Invalid credentials"}, status_code=401)
    token = await create_session(user["id"])
    resp = JSONResponse({"ok": True})
    resp.set_cookie("pv_session", token, httponly=True, samesite="lax", max_age=7 * 24 * 3600)
    return resp


@app.post("/api/register")
async def api_register(username: str = Form(...), password: str = Form(...)):
    if len(username) < 3 or len(password) < 6:
        return JSONResponse({"error": "username ≥3 chars, password ≥6 chars"}, status_code=400)
    try:
        await create_user(username, password)
    except Exception:
        return JSONResponse({"error": "username taken"}, status_code=400)
    user = await get_user(username)
    token = await create_session(user["id"])
    resp = JSONResponse({"ok": True})
    resp.set_cookie("pv_session", token, httponly=True, samesite="lax", max_age=7 * 24 * 3600)
    return resp


@app.post("/api/logout")
async def api_logout(request: Request):
    token = request.cookies.get("pv_session")
    if token:
        await destroy_session(token)
    resp = JSONResponse({"ok": True})
    resp.delete_cookie("pv_session")
    return resp


@app.get("/api/me")
async def api_me(request: Request):
    return {"username": request.state.user["username"],
            "is_admin": bool(request.state.user["is_admin"])}


# ── engine api ─────────────────────────────────────────────────────────
@app.post("/api/collect")
async def api_collect(request: Request):
    body = await request.json()
    target = max(1, min(int(body.get("target", 100)), 50_000))
    protocols = [p for p in body.get("protocols", ["http"]) if p in ("http", "socks4", "socks5")]
    rounds = max(1, min(int(body.get("rounds", 3)), 10))
    use_custom = bool(body.get("use_custom", True))
    if not protocols:
        return JSONResponse({"error": "pick at least one protocol"}, status_code=400)
    ok = await engine.start(target, protocols, rounds, use_custom)
    return {"ok": ok, "error": None if ok else "engine busy"}


@app.post("/api/stop")
async def api_stop():
    engine.stop()
    return {"ok": True}


async def _status_payload() -> dict:
    st = dict(engine.state)
    if st["running"] and st["started_at"]:
        st["elapsed_s"] = int(time.time() - st["started_at"])
    async with db().execute("SELECT COUNT(*) c FROM proxies WHERE alive=1") as cur:
        st["alive"] = (await cur.fetchone())["c"]
    async with db().execute("SELECT COUNT(*) c FROM proxies WHERE alive=0") as cur:
        st["dead"] = (await cur.fetchone())["c"]
    st["logs"] = [{"ts": t, "level": l, "msg": m} for t, l, m in list(engine.logs)[-150:]]
    st["signup_sources"] = len(SIGNUP_SOURCES)
    return st


@app.get("/api/status")
async def api_status():
    return await _status_payload()


@app.get("/api/stream")
async def api_stream(request: Request):
    async def gen():
        while True:
            if await request.is_disconnected():
                break
            payload = await _status_payload()
            yield f"data: {json.dumps(payload)}\n\n"
            await asyncio.sleep(1)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    })


# ── stats api ──────────────────────────────────────────────────────────
@app.get("/api/stats")
async def api_stats():
    async def one(sql: str, params: tuple = ()):
        async with db().execute(sql, params) as cur:
            return [dict(r) for r in await cur.fetchall()]

    totals = (await one(
        "SELECT SUM(alive=1) alive, SUM(alive=0) dead, COUNT(*) total FROM proxies"
    ))[0]
    protocols = await one(
        "SELECT protocol, COUNT(*) c, AVG(latency_ms) avg_ms FROM proxies "
        "WHERE alive=1 GROUP BY protocol ORDER BY c DESC")
    anonymity = await one(
        "SELECT anonymity, COUNT(*) c FROM proxies WHERE alive=1 GROUP BY anonymity")
    countries = await one(
        "SELECT country_code code, country, COUNT(*) c FROM proxies "
        "WHERE alive=1 AND country_code IS NOT NULL GROUP BY country_code "
        "ORDER BY c DESC LIMIT 8")
    latency = await one(
        """SELECT CASE
             WHEN latency_ms IS NULL THEN 'n/a'
             WHEN latency_ms < 250 THEN '<250'
             WHEN latency_ms < 500 THEN '250-500'
             WHEN latency_ms < 1000 THEN '500-1k'
             WHEN latency_ms < 2000 THEN '1-2k'
             ELSE '2s+' END bucket, COUNT(*) c
           FROM proxies WHERE alive=1 GROUP BY bucket""")
    duplicates = (await one(
        "SELECT COUNT(*) - COUNT(DISTINCT ip || ':' || port) c FROM proxies"
    ))[0]["c"] or 0
    return {
        "totals": {"alive": totals["alive"] or 0, "dead": totals["dead"] or 0,
                   "total": totals["total"] or 0, "duplicates": duplicates},
        "protocols": protocols,
        "anonymity": anonymity,
        "countries": countries,
        "latency": latency,
    }


@app.get("/api/settings")
async def api_settings():
    return {
        "validate_timeout": VALIDATE_TIMEOUT,
        "validate_concurrency": VALIDATE_CONCURRENCY,
        "max_failed_checks": MAX_FAILED_CHECKS,
        "max_candidates": MAX_CANDIDATES,
        "auto_dedupe": AUTO_DEDUPE,
        "site_check_timeout": SITE_CHECK_TIMEOUT,
        "site_check_limit": SITE_CHECK_LIMIT,
        "geo_enrich": GEO_ENRICH,
        "geo_max": GEO_MAX,
        "signup_sources": [s.get("name", "unnamed") for s in SIGNUP_SOURCES],
    }


# ── proxy data api ─────────────────────────────────────────────────────
SORTS = {
    "latency": "latency_ms IS NULL, latency_ms",
    "port": "port",
    "last_checked": "last_checked DESC",
    "country": "country IS NULL, country",
}


@app.get("/api/proxies")
async def api_proxies(protocol: str | None = None, country: str | None = None,
                      anonymity: str | None = None, q: str | None = None,
                      sort: str = "latency", offset: int = 0, limit: int = 500):
    where = "WHERE alive=1"
    params: list = []
    if protocol:
        where += " AND protocol=?"; params.append(protocol)
    if country:
        where += " AND country_code=?"; params.append(country)
    if anonymity:
        where += " AND anonymity=?"; params.append(anonymity)
    if q:
        where += " AND (ip LIKE ? OR isp LIKE ? OR country LIKE ?)"
        params += [f"%{q}%"] * 3

    async with db().execute(f"SELECT COUNT(*) c FROM proxies {where}", tuple(params)) as cur:
        total = (await cur.fetchone())["c"]

    order = SORTS.get(sort, SORTS["latency"])
    async with db().execute(
        f"SELECT * FROM proxies {where} ORDER BY {order} LIMIT ? OFFSET ?",
        tuple(params) + (min(limit, 5000), max(offset, 0)),
    ) as cur:
        rows = [dict(r) for r in await cur.fetchall()]
    async with db().execute(
        "SELECT DISTINCT country_code FROM proxies WHERE alive=1 AND country_code IS NOT NULL"
    ) as cur:
        countries = sorted(r["country_code"] for r in await cur.fetchall())
    return {"proxies": rows, "countries": countries, "total": total}


@app.get("/api/proxies/export")
async def api_export(protocol: str | None = None, fmt: str = "txt"):
    sql = "SELECT ip, port, protocol, anonymity, latency_ms, country_code FROM proxies WHERE alive=1"
    params: list = []
    if protocol:
        sql += " AND protocol=?"; params.append(protocol)
    sql += " ORDER BY latency_ms IS NULL, latency_ms"
    async with db().execute(sql, tuple(params)) as cur:
        rows = await cur.fetchall()
    if fmt == "json":
        return JSONResponse([dict(r) for r in rows])
    lines = [f'{r["protocol"]}://{r["ip"]}:{r["port"]}' for r in rows]
    return PlainTextResponse("\n".join(lines), headers={
        "Content-Disposition": "attachment; filename=proxies.txt"})


@app.post("/api/proxies/purge-dead")
async def api_purge_dead():
    async with db().execute("SELECT COUNT(*) c FROM proxies WHERE alive=0") as cur:
        removed = (await cur.fetchone())["c"]
    await execute("DELETE FROM proxies WHERE alive=0")
    engine.log("info", f"purged {removed} dead proxies")
    return {"ok": True, "removed": removed}


@app.post("/api/proxies/recheck")
async def api_recheck():
    ok = await engine.start_recheck()
    if not ok:
        return JSONResponse({"ok": False, "error": "engine busy"}, status_code=409)
    return {"ok": True}


# ── dedupe + site checks ───────────────────────────────────────────────
@app.post("/api/proxies/dedupe")
async def api_dedupe():
    if engine.busy():
        return JSONResponse({"ok": False, "error": "engine busy"}, status_code=409)
    removed = await engine.dedupe()
    engine.log("info", f"dedupe removed {removed} duplicate listings")
    return {"ok": True, "removed": removed}


@app.post("/api/proxies/test")
async def api_test_proxies(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "invalid JSON body"}, status_code=400)

    url = str(body.get("url", "")).strip()
    if not url.startswith(("http://", "https://")):
        return JSONResponse({"error": "url must start with http:// or https://"},
                            status_code=400)

    protocol = body.get("protocol") or None
    country = body.get("country") or None
    anonymity = body.get("anonymity") or None
    limit = max(1, min(int(body.get("limit", SITE_CHECK_LIMIT)), 200))
    timeout = max(2.0, min(float(body.get("timeout", SITE_CHECK_TIMEOUT)), 30.0))

    sql = "SELECT ip, port, protocol, country_code, isp FROM proxies WHERE alive=1"
    params: list = []
    if protocol:
        sql += " AND protocol=?"; params.append(protocol)
    if country:
        sql += " AND country_code=?"; params.append(country)
    if anonymity:
        sql += " AND anonymity=?"; params.append(anonymity)
    sql += " ORDER BY latency_ms IS NULL, latency_ms LIMIT ?"
    params.append(limit)
    async with db().execute(sql, tuple(params)) as cur:
        rows = [dict(r) for r in await cur.fetchall()]

    if not rows:
        return {"url": url, "total": 0, "passed": 0, "failed": 0,
                "avg_latency_ms": None, "results": []}

    items = [(r["ip"], r["port"], r["protocol"]) for r in rows]
    results = await sitecheck.test_many(
        items, url, timeout=timeout, concurrency=SITE_CHECK_CONCURRENCY)
    meta = {(r["ip"], r["port"], r["protocol"]): r for r in rows}
    checked_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    merged = []
    for result in results:
        source = meta.get((result["ip"], result["port"], result["protocol"]), {})
        merged.append({
            **result,
            "country_code": source.get("country_code"),
            "isp": source.get("isp"),
            "checked_at": checked_at,
        })

    await executemany(
        """INSERT INTO site_checks
             (ip, port, protocol, url, ok, status, latency_ms, error, checked_at)
           VALUES (?,?,?,?,?,?,?,?,?)
           ON CONFLICT(ip, port, protocol, url) DO UPDATE SET
             ok=excluded.ok, status=excluded.status,
             latency_ms=excluded.latency_ms, error=excluded.error,
             checked_at=excluded.checked_at""",
        [(r["ip"], r["port"], r["protocol"], url, int(r["ok"]), r["status"],
          r["latency_ms"], r["error"], checked_at) for r in merged],
    )

    passed = sum(1 for r in merged if r["ok"])
    latencies = [r["latency_ms"] for r in merged if r["ok"] and r["latency_ms"] is not None]
    return {
        "url": url,
        "total": len(merged),
        "passed": passed,
        "failed": len(merged) - passed,
        "avg_latency_ms": round(sum(latencies) / len(latencies)) if latencies else None,
        "results": merged,
    }


@app.get("/api/site-checks")
async def api_site_checks(url: str | None = None, limit: int = 100):
    sql = "SELECT * FROM site_checks"
    params: list = []
    if url:
        sql += " WHERE url=?"
        params.append(url)
    sql += " ORDER BY checked_at DESC LIMIT ?"
    params.append(max(1, min(limit, 500)))
    async with db().execute(sql, tuple(params)) as cur:
        rows = [dict(r) for r in await cur.fetchall()]
    return {"checks": rows}


# ── SPA static hosting ─────────────────────────────────────────────────
if (DIST / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/{full_path:path}", response_class=HTMLResponse)
async def spa(full_path: str):
    if full_path.startswith("api/"):
        return JSONResponse({"error": "not found"}, status_code=404)
    candidate = (DIST / full_path).resolve()
    if full_path and candidate.is_file() and DIST.resolve() in candidate.parents:
        return FileResponse(candidate)
    index = DIST / "index.html"
    if not index.exists():
        return HTMLResponse(
            "<h1>Frontend not built</h1><p>Run <code>cd web &amp;&amp; npm install &amp;&amp; npm run build</code>.</p>",
            status_code=503)
    return FileResponse(index)
