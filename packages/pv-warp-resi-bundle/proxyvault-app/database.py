import aiosqlite
from app.config import DB_PATH

_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    pass_hash TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS proxies (
    ip TEXT NOT NULL,
    port INTEGER NOT NULL,
    protocol TEXT NOT NULL,
    anonymity TEXT DEFAULT 'unknown',
    latency_ms INTEGER,
    https INTEGER DEFAULT 0,
    country TEXT,
    country_code TEXT,
    city TEXT,
    isp TEXT,
    source TEXT,
    alive INTEGER DEFAULT 1,
    checks_failed INTEGER DEFAULT 0,
    last_checked TEXT,
    added_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (ip, port, protocol)
);
CREATE INDEX IF NOT EXISTS idx_alive ON proxies(alive, protocol);

CREATE TABLE IF NOT EXISTS site_checks (
    ip TEXT NOT NULL,
    port INTEGER NOT NULL,
    protocol TEXT NOT NULL,
    url TEXT NOT NULL,
    ok INTEGER NOT NULL DEFAULT 0,
    status INTEGER,
    latency_ms INTEGER,
    error TEXT,
    checked_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (ip, port, protocol, url)
);
CREATE INDEX IF NOT EXISTS idx_site_checks_url ON site_checks(url, checked_at);
"""

_conn: aiosqlite.Connection | None = None
_write_lock = None


async def init_db() -> aiosqlite.Connection:
    global _conn, _write_lock
    _conn = await aiosqlite.connect(DB_PATH, timeout=10)
    _conn.row_factory = aiosqlite.Row
    await _conn.execute("PRAGMA journal_mode=WAL")
    await _conn.execute("PRAGMA busy_timeout=10000")
    await _conn.executescript(_SCHEMA)
    await _conn.commit()
    _write_lock = __import__("asyncio").Lock()
    return _conn


def db() -> aiosqlite.Connection:
    assert _conn is not None, "database not initialised"
    return _conn


async def execute(sql: str, params: tuple = ()):
    async with _write_lock:
        cur = await db().execute(sql, params)
        await db().commit()
        return cur


async def executemany(sql: str, rows):
    async with _write_lock:
        await db().executemany(sql, rows)
        await db().commit()