"""Test alive proxies against an arbitrary target URL."""
import asyncio
import time

import aiohttp
from aiohttp_socks import ProxyConnector


async def test_one(ip: str, port: int, protocol: str, url: str,
                   timeout: float = 10.0) -> dict:
    started = time.monotonic()
    connector = None
    proxy = None
    try:
        if protocol == "http":
            proxy = f"http://{ip}:{port}"
        else:
            connector = ProxyConnector.from_url(f"{protocol}://{ip}:{port}", rdns=True)

        async with aiohttp.ClientSession(connector=connector) as session:
            async with session.get(
                url, proxy=proxy, allow_redirects=True,
                timeout=aiohttp.ClientTimeout(total=timeout),
            ) as response:
                await response.content.read(2048)
                latency = int((time.monotonic() - started) * 1000)
                return {
                    "ip": ip, "port": port, "protocol": protocol,
                    "ok": response.status < 400,
                    "status": response.status,
                    "latency_ms": latency,
                    "error": None,
                }
    except Exception as exc:
        return {
            "ip": ip, "port": port, "protocol": protocol,
            "ok": False, "status": None,
            "latency_ms": int((time.monotonic() - started) * 1000),
            "error": f"{type(exc).__name__}: {exc}"[:200],
        }
    finally:
        if connector is not None:
            await connector.close()


async def test_many(items: list[tuple[str, int, str]], url: str,
                    timeout: float = 10.0, concurrency: int = 50) -> list[dict]:
    sem = asyncio.Semaphore(concurrency)

    async def worker(item):
        async with sem:
            try:
                # hard ceiling: some proxies stall below the aiohttp timeout
                return await asyncio.wait_for(
                    test_one(item[0], item[1], item[2], url, timeout),
                    timeout=timeout + 2,
                )
            except asyncio.TimeoutError:
                return {
                    "ip": item[0], "port": item[1], "protocol": item[2],
                    "ok": False, "status": None, "latency_ms": int((timeout + 2) * 1000),
                    "error": f"TimeoutError: no response within {timeout + 2:.0f}s",
                }

    return list(await asyncio.gather(*(worker(item) for item in items)))
