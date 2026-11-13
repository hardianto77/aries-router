"""Signup-gated source harvester.

Flow per account:
  temp-mail inbox -> headless Chrome signup -> email verification
  -> login -> scrape proxy list from dashboard.

Selectors/URLs come from SIGNUP_SOURCES in config — tune them to the
target site's actual markup. Requires: playwright install chromium
"""
import asyncio, re, random, string
import aiohttp
from app.config import SIGNUP_SOURCES
from app.tempmail import TempMailClient, extract_link, extract_code

_IP_PORT = re.compile(r"\b(\d{1,3}(?:\.\d{1,3}){3}):(\d{2,5})\b")


def _rand_pw(n: int = 14) -> str:
    return "".join(random.choices(string.ascii_letters + string.digits, k=n))


async def _run_account(http: aiohttp.ClientSession, src: dict) -> list[str]:
    from playwright.async_api import async_playwright

    mail = TempMailClient(http)
    account = await mail.create_account()
    domain = account["address"].split("@")[1]
    password = _rand_pw()

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        page = await browser.new_page()
        sel = src["selectors"]

        # -- signup ----------------------------------------------------
        await page.goto(src["signup_url"], wait_until="domcontentloaded", timeout=45_000)
        await page.fill(sel["email"], account["address"])
        await page.fill(sel["password"], password)
        await page.click(sel["submit"])
        await page.wait_for_timeout(4000)

        # -- email verification ---------------------------------------
        if src.get("email_verification"):
            msg = await mail.wait_for_message(account, pattern=domain)
            if not msg:
                await browser.close()
                return []
            if src.get("verification_mode") == "code":
                code = extract_code(msg["body"])
                if code:
                    await page.fill(src["code_selector"], code)
                    await page.click(sel["submit"])
                    await page.wait_for_timeout(3000)
            else:
                link = extract_link(msg["body"], domain)
                if link:
                    await page.goto(link, wait_until="domcontentloaded")
                    await page.wait_for_timeout(3000)

        # -- login (in case verification logged us out) ----------------
        await page.goto(src["login_url"], wait_until="domcontentloaded")
        await page.fill(sel["email"], account["address"])
        await page.fill(sel["password"], password)
        await page.click(sel["submit"])
        await page.wait_for_timeout(4000)

        # -- harvest ----------------------------------------------------
        await page.goto(src["proxies_url"], wait_until="domcontentloaded")
        await page.wait_for_timeout(2000)
        text = await page.inner_text(sel["proxies"]) if await page.query_selector(sel["proxies"]) \
            else await page.content()
        await browser.close()

    return [m.group(0) for m in _IP_PORT.finditer(text)]


async def harvest(http: aiohttp.ClientSession, log) -> list[tuple[str, str]]:
    """Run every configured signup source. Returns [(protocol, 'ip:port')]."""
    out = []
    for src in SIGNUP_SOURCES:
        log("info", f"[{src['name']}] farming {src.get('accounts', 1)} temp-mail account(s)")
        results = await asyncio.gather(
            *[_run_account(http, src) for _ in range(src.get("accounts", 1))],
            return_exceptions=True,
        )
        for r in results:
            if isinstance(r, Exception):
                log("warn", f"[{src['name']}] account failed: {r!r}")
                continue
            for item in r:
                out.append(("http", item))
        log("info", f"[{src['name']}] harvested {sum(len(r) for r in results if not isinstance(r, Exception))} raw entries")
    return out