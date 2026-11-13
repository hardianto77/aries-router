import os

DB_PATH = os.getenv("PV_DB", "proxyvault.db")

# Admin bootstrap (created on first run if no users exist) — CHANGE THESE
ADMIN_USERNAME = os.getenv("PV_ADMIN_USER", "admin")
ADMIN_PASSWORD = os.getenv("PV_ADMIN_PASS", "admin123")

SESSION_TTL = 7 * 24 * 3600          # 7 days

VALIDATE_TIMEOUT = 8                  # seconds per proxy check
VALIDATE_CONCURRENCY = 300
MAX_FAILED_CHECKS = 3                 # before a proxy is marked dead
MAX_CANDIDATES = 12000                # sampled per round after dedupe
AUTO_DEDUPE = True                    # drop rows sharing ip:port after each round

SITE_CHECK_TIMEOUT = 10               # seconds per proxy when testing a URL
SITE_CHECK_LIMIT = 100                # default proxies per site check
SITE_CHECK_CONCURRENCY = 50

GEO_ENRICH = True                     # ip-api.com batch enrichment
GEO_MAX = 2000                        # cap enrichment per run

# ── Signup-gated sources ─────────────────────────────────────────────
# Driven by temp-mail + headless Chrome. Point these at the free-tier
# signup form of the gated source you use. Selectors are config, not
# code. You are responsible for complying with each site's ToS.
SIGNUP_SOURCES = [
    # {
    #     "name": "getproxy",
    #     "signup_url":    "https://example-site.com/register",
    #     "login_url":     "https://example-site.com/login",
    #     "proxies_url":   "https://example-site.com/dashboard/proxies",
    #     "email_verification": True,          # click link or enter code from temp mail
    #     "verification_mode": "link",          # "link" | "code"
    #     "code_selector": "input[name=code]",  # only if mode == "code"
    #     "accounts": 3,                         # temp-mail accounts to farm
    #     "selectors": {
    #         "email":    "input[name=email]",
    #         "password": "input[name=password]",
    #         "submit":   "button[type=submit]",
    #         "proxies":  ".proxy-list",         # container holding ip:port text
    #     },
    # },
]