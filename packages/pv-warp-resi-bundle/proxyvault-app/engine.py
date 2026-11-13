"""Harvest orchestrator — runs until the target alive-proxy count is met."""
import asyncio
import random
import time
from collections import deque
from datetime import datetime, timezone

from app.config import (VALIDATE_CONCURRENCY, VALIDATE_TIMEOUT, MAX_FAILED_CHECKS,
                        MAX_CANDIDATES, AUTO_DEDUPE, GEO_ENRICH, GEO_MAX)
from app.database import db, execute, executemany
from app.sources import public, custom
from app.validator import check_batch


def _now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Engine:
    def __init__(self):
        self.state = {
            "running": False, "phase": "idle", "target": 0, "alive": 0,
            "checked": 0, "found_new": 0, "round": 0, "rounds": 0,
            "started_at": None, "elapsed_s": 0, "message": "",
            "recheck_running": False, "recheck_done": 0, "recheck_total": 0,
        }
        self.logs: deque[tuple[str, str, str]] = deque(maxlen=400)
        self._task: asyncio.Task | None = None
        self._recheck_task: asyncio.Task | None = None
        self._stop = False
        self._use_custom = True

    # ── logging ────────────────────────────────────────────────────
    def log(self, level: str, message: str):
        self.logs.append((_now(), level, message))
        print(f"[{level}] {message}")

    def _stopping(self) -> bool:
        return self._stop

    def busy(self) -> bool:
        return self.state["running"] or self.state["recheck_running"]

    # ── db helpers ─────────────────────────────────────────────────
    async def alive_count(self, protocols: set[str] | None = None) -> int:
        sql = "SELECT COUNT(*) c FROM proxies WHERE alive=1"
        params: tuple = ()
        if protocols:
            sql += " AND protocol IN (%s)" % ",".join("?" * len(protocols))
            params = tuple(protocols)
        async with db().execute(sql, params) as cur:
            return (await cur.fetchone())["c"]

    async def known_keys(self) -> set[tuple[str, str, str]]:
        async with db().execute("SELECT ip, port, protocol, last_checked FROM proxies") as cur:
            rows = await cur.fetchall()
        cutoff = time.time() - 1800  # skip entries validated < 30 min ago
        out = set()
        for r in rows:
            try:
                ts = datetime.fromisoformat(r["last_checked"]).timestamp() if r["last_checked"] else 0
            except Exception:
                ts = 0
            if ts > cutoff:
                out.add((r["ip"], str(r["port"]), r["protocol"]))
        return out

    async def store_result(self, res: dict | None, source: str):
        if res is None:
            return
        await execute(
            """INSERT INTO proxies (ip, port, protocol, anonymity, latency_ms,
               https, source, alive, checks_failed, last_checked)
               VALUES (?,?,?,?,?,?,?,1,0,?)
               ON CONFLICT(ip, port, protocol) DO UPDATE SET
                 anonymity=excluded.anonymity, latency_ms=excluded.latency_ms,
                 https=excluded.https, alive=1, checks_failed=0,
                 last_checked=excluded.last_checked""",
            (res["ip"], res["port"], res["protocol"], res["anonymity"],
             res["latency_ms"], res["https"], source, _now()),
        )

    async def dedupe(self) -> int:
        """Drop rows that share an endpoint, keeping the healthiest listing.

        Preference: alive, HTTPS-capable, lowest latency, freshest check.
        """
        cur = await execute(
            """DELETE FROM proxies WHERE rowid IN (
                 SELECT rowid FROM (
                   SELECT rowid, ROW_NUMBER() OVER (
                     PARTITION BY ip, port
                     ORDER BY alive DESC, https DESC, latency_ms IS NULL,
                              latency_ms, last_checked DESC
                   ) AS rn
                   FROM proxies
                 ) WHERE rn > 1
               )"""
        )
        return cur.rowcount or 0

    async def _auto_dedupe(self) -> int:
        if not AUTO_DEDUPE:
            return 0
        removed = await self.dedupe()
        if removed:
            self.log("info", f"dedupe removed {removed} duplicate listings")
        return removed

    async def _mark_failures(self, items: list[tuple[str, int, str]]):
        """Count a strike for known proxies that failed; three strikes = dead.

        Newly discovered dead candidates are not inserted — the table only
        tracks proxies that were alive at least once.
        """
        if not items:
            return
        await executemany(
            """UPDATE proxies SET checks_failed = checks_failed + 1,
                 alive = CASE WHEN checks_failed + 1 >= ? THEN 0 ELSE alive END,
                 last_checked = ?
               WHERE ip=? AND port=? AND protocol=?""",
            [(MAX_FAILED_CHECKS, _now(), i[0], i[1], i[2]) for i in items],
        )

    # ── pipeline phases ────────────────────────────────────────────
    async def _validate(self, raw: list[tuple[str, str]], source: str, known: set):
        items = []
        for proto, addr in raw:
            ip, _, port = addr.rpartition(":")
            if not ip or not port.isdigit():
                continue
            key = (ip, port, proto)
            if key in known:
                continue
            known.add(key)
            items.append((ip, int(port), proto))
        if not items:
            return
        self.log("info", f"validating {len(items)} candidates from {source}")

        done = [0]
        failures: list[tuple[str, int, str]] = []

        def progress():
            done[0] += 1
            if done[0] % 250 == 0:
                self.state["checked"] = done[0]
            if done[0] % 2500 == 0:
                self.log("info", f"validated {done[0]}/{len(items)} · "
                                 f"{self.state['found_new']} new")

        async def on_result(res, item):
            if res:
                await self.store_result(res, source)
                self.state["found_new"] += 1
            else:
                failures.append(item)

        await check_batch(items, VALIDATE_CONCURRENCY, on_result, progress,
                          should_stop=self._stopping, timeout=VALIDATE_TIMEOUT)
        self.state["checked"] = done[0]
        await self._mark_failures(failures)

    async def _geo_enrich(self):
        if not GEO_ENRICH or self._stop:
            return
        async with db().execute(
            "SELECT ip FROM proxies WHERE alive=1 AND country IS NULL LIMIT ?",
            (GEO_MAX,),
        ) as cur:
            ips = [r["ip"] for r in await cur.fetchall()]
        if not ips:
            return
        import aiohttp
        self.log("info", f"geo-enriching {len(ips)} proxies")
        async with aiohttp.ClientSession() as s:
            for i in range(0, len(ips), 100):
                if self._stop:
                    return
                chunk = ips[i:i + 100]
                try:
                    async with s.post(
                        "http://ip-api.com/batch?fields=status,country,countryCode,city,isp,query",
                        json=chunk, timeout=aiohttp.ClientTimeout(total=20),
                    ) as r:
                        rows = await r.json()
                    await executemany(
                        "UPDATE proxies SET country=?, country_code=?, city=?, isp=? WHERE ip=?",
                        [(x.get("country"), x.get("countryCode"), x.get("city"),
                          x.get("isp"), x.get("query")) for x in rows if x.get("status") == "success"],
                    )
                except Exception:
                    pass
                await asyncio.sleep(4)  # ip-api rate limit

    # ── main loop ──────────────────────────────────────────────────
    async def start(self, target: int, protocols: list[str], rounds: int,
                    use_custom: bool) -> bool:
        if self.busy():
            return False
        self._stop = False
        self._use_custom = use_custom
        self._task = asyncio.create_task(self._run(set(protocols), target, rounds))
        return True

    def stop(self):
        """Cancel the active collect/recheck run immediately."""
        self._stop = True
        collecting = self._task is not None and not self._task.done()
        for task in (self._task, self._recheck_task):
            if task and not task.done():
                task.cancel()
        if collecting:
            self.state["message"] = "stopping…"

    async def _run(self, protocols: set[str], target: int, rounds: int):
        st = self.state
        st.update(running=True, target=target, rounds=rounds, found_new=0,
                  checked=0, round=0, started_at=time.time(),
                  phase="starting", message="")
        st["alive"] = await self.alive_count(protocols)
        if await self._auto_dedupe():
            st["alive"] = await self.alive_count(protocols)
        self.log("info", f"engine started — target {target} · {', '.join(sorted(protocols))}")
        cancelled = False

        try:
            import aiohttp
            async with aiohttp.ClientSession() as http:
                for rnd in range(1, rounds + 1):
                    if self._stop or st["alive"] >= target:
                        break
                    st["round"] = rnd
                    st["phase"] = "fetching"
                    self.log("info", f"round {rnd}/{rounds}")

                    raw = await public.fetch_all(protocols)
                    if self._stop:
                        break
                    if len(raw) > MAX_CANDIDATES:
                        raw = random.sample(raw, MAX_CANDIDATES)
                    self.log("info", f"fetched {len(raw)} candidates")
                    known = await self.known_keys()
                    st["phase"] = "validating"
                    await self._validate(raw, "public", known)
                    st["alive"] = await self.alive_count(protocols)
                    if await self._auto_dedupe():
                        st["alive"] = await self.alive_count(protocols)
                    self.log("info", f"alive {st['alive']}/{target}")

                    if st["alive"] >= target or self._stop:
                        break

                    if self._use_custom and custom.SIGNUP_SOURCES:
                        st["phase"] = "signup"
                        raw = await custom.harvest(http, self.log)
                        if self._stop:
                            break
                        known = await self.known_keys()
                        await self._validate(raw, "signup", known)
                        st["alive"] = await self.alive_count(protocols)

                    if st["alive"] < target and rnd < rounds and not self._stop:
                        st["phase"] = "cooldown"
                        self.log("info", "cooldown 10m")
                        for _ in range(600):
                            if self._stop:
                                break
                            await asyncio.sleep(1)

            if not self._stop:
                st["phase"] = "enriching"
                await self._geo_enrich()
        except asyncio.CancelledError:
            cancelled = True
        finally:
            st["running"] = False
            try:
                st["alive"] = await self.alive_count(protocols)
            except Exception:
                pass
            if st["started_at"]:
                st["elapsed_s"] = int(time.time() - st["started_at"])
            if cancelled or self._stop:
                st["phase"], st["message"] = "stopped", "stopped by user"
                self.log("warn", "stopped by user")
            elif st["alive"] >= target:
                st["phase"], st["message"] = "done", "target met"
                self.log("ok", st["message"])
            else:
                st["phase"], st["message"] = "exhausted", "sources exhausted"
                self.log("warn", st["message"])
            self._task = None

    # ── recheck ────────────────────────────────────────────────────
    async def start_recheck(self) -> bool:
        if self.busy():
            return False
        self._stop = False
        self._recheck_task = asyncio.create_task(self._recheck())
        return True

    async def _recheck(self):
        st = self.state
        st.update(recheck_running=True, recheck_done=0, recheck_total=0)
        cancelled = False
        try:
            async with db().execute(
                "SELECT ip, port, protocol FROM proxies WHERE alive=1"
            ) as cur:
                rows = await cur.fetchall()
            items = [(r["ip"], r["port"], r["protocol"]) for r in rows]
            st["recheck_total"] = len(items)
            if not items:
                return
            self.log("info", f"rechecking {len(items)} proxies")
            failures: list[tuple[str, int, str]] = []

            def progress():
                st["recheck_done"] += 1

            async def on_result(res, item):
                if res:
                    await self.store_result(res, "recheck")
                else:
                    failures.append(item)

            await check_batch(items, 200, on_result, progress,
                              should_stop=self._stopping, timeout=VALIDATE_TIMEOUT)
            await self._mark_failures(failures)
            await self._auto_dedupe()
            if not self._stop:
                self.log("ok", "recheck complete")
        except asyncio.CancelledError:
            cancelled = True
        finally:
            st["recheck_running"] = False
            if cancelled or self._stop:
                self.log("warn", "recheck stopped")
            else:
                self.log("ok", "recheck complete")
            self._recheck_task = None


engine = Engine()
