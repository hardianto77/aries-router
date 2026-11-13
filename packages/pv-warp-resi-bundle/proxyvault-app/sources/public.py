"""Public no-auth proxy firehoses. Raw ip:port feeds + JSON APIs."""
import asyncio, re
import aiohttp

RAW = {
    "http": [
        "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt",
        "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt",
        "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt",
        "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=10000&country=all&ssl=all&anonymity=all",
        "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt",
        "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt",
    ],
    "socks4": [
        "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks4.txt",
        "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt",
        "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks4&timeout=10000",
    ],
    "socks5": [
        "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt",
        "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt",
        "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/socks5/data.txt",
        "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=10000",
    ],
}

GEONODE = "https://proxylist.geonode.com/api/proxy-list"

_PLAIN = re.compile(r"^(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})$")
_TYPED = re.compile(r"(https?|socks[45])://(\d{1,3}(?:\.\d{1,3}){3}:\d{2,5})")


async def _fetch_text(session, url, proto_hint: str) -> list[tuple[str, str]]:
    out = []
    try:
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as r:
            if r.status != 200:
                return out
            for line in (await r.text()).splitlines():
                line = line.strip()
                m = _TYPED.search(line)
                if m:
                    proto = "http" if m.group(1) in ("http", "https") else m.group(1)
                    out.append((proto, m.group(2)))
                    continue
                if _PLAIN.match(line):
                    out.append((proto_hint, line))
    except Exception:
        pass
    return out


async def _fetch_geonode(session, protocols: set[str]) -> list[tuple[str, str]]:
    out, page = [], 1
    while page <= 6:
        try:
            async with session.get(
                GEONODE,
                params={"limit": 500, "page": page, "sort_by": "lastChecked",
                        "sort_type": "desc"},
                timeout=aiohttp.ClientTimeout(total=30),
            ) as r:
                data = await r.json()
        except Exception:
            break
        rows = data.get("data", [])
        for p in rows:
            if set(p.get("protocols", [])) & protocols:
                out.append((next(iter(set(p["protocols"]) & protocols)),
                            f"{p['ip']}:{p['port']}"))
        if len(rows) < 500:
            break
        page += 1
    return out


async def fetch_all(protocols: set[str]) -> list[tuple[str, str]]:
    """Returns [(protocol, 'ip:port')] deduplicated."""
    connector = aiohttp.TCPConnector(limit=30)
    async with aiohttp.ClientSession(connector=connector) as session:
        tasks = [_fetch_text(session, u, proto)
                 for proto in protocols for u in RAW.get(proto, [])]
        tasks.append(_fetch_geonode(session, protocols))
        results = await asyncio.gather(*tasks)

    seen, out = set(), []
    for batch in results:
        for entry in batch:
            if entry[0] not in protocols or entry in seen:
                continue
            seen.add(entry)
            out.append(entry)
    return out