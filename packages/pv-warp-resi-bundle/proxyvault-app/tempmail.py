"""Disposable-mail client on top of the mail.tm public API.

Creates random inboxes programmatically and polls the inbox for
verification links / codes — the identity layer for signup-gated sources.
"""
import asyncio, random, re, string, time
import aiohttp

API = "https://api.mail.tm"


def _rand(n: int = 12) -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


class TempMailClient:
    def __init__(self, session: aiohttp.ClientSession):
        self.s = session

    async def create_account(self) -> dict:
        """Returns {address, password, token, account_id}."""
        async with self.s.get(f"{API}/domains") as r:
            domains = await r.json()
        domain = next(d["domain"] for d in domains["hydra:member"] if d.get("isActive"))

        address = f"{_rand(10)}@{domain}"
        password = _rand(16)
        async with self.s.post(f"{API}/accounts",
                               json={"address": address, "password": password}) as r:
            if r.status not in (200, 201):
                raise RuntimeError(f"mail.tm account create failed: {r.status}")
            account = await r.json()

        async with self.s.post(f"{API}/token",
                               json={"address": address, "password": password}) as r:
            token = (await r.json())["token"]

        return {"address": address, "password": password, "token": token,
                "account_id": account["id"]}

    async def wait_for_message(self, account: dict, timeout: int = 150,
                               pattern: str | None = None) -> dict | None:
        """Poll inbox until a message arrives (optionally matching pattern)."""
        deadline = time.time() + timeout
        headers = {"Authorization": f"Bearer {account['token']}"}
        while time.time() < deadline:
            async with self.s.get(f"{API}/messages", headers=headers) as r:
                data = await r.json()
            for msg in data.get("hydra:member", []):
                async with self.s.get(f"{API}/messages/{msg['id']}",
                                      headers=headers) as r:
                    full = await r.json()
                text = (full.get("text") or "") + (full.get("html") and " ".join(full["html"]) or "")
                if pattern is None or re.search(pattern, text):
                    return {"subject": full.get("subject", ""), "body": text}
            await asyncio.sleep(5)
        return None


def extract_link(body: str, domain_hint: str) -> str | None:
    m = re.search(rf'https?://[^\s<>"\']*{re.escape(domain_hint)}[^\s<>"\']*', body)
    if m:
        return m.group(0)
    m = re.search(r'https?://[^\s<>"\']*(verify|activate|confirm|token)[^\s<>"\']*', body, re.I)
    return m.group(0) if m else None


def extract_code(body: str) -> str | None:
    m = re.search(r'\b(\d{4,8})\b', re.sub(r"<[^>]+>", " ", body))
    return m.group(1) if m else None