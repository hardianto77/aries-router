import hashlib, os, time
from app.database import execute, db
from app.config import SESSION_TTL


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return salt.hex() + "$" + dk.hex()


def verify_password(password: str, stored: str) -> bool:
    salt_hex, dk_hex = stored.split("$", 1)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), 200_000)
    return dk.hex() == dk_hex


async def create_user(username: str, password: str, is_admin: bool = False):
    await execute(
        "INSERT INTO users (username, pass_hash, is_admin) VALUES (?, ?, ?)",
        (username, hash_password(password), int(is_admin)),
    )


async def get_user(username: str):
    cur = await db().execute("SELECT * FROM users WHERE username = ?", (username,))
    return await cur.fetchone()


async def create_session(user_id: int) -> str:
    token = os.urandom(32).hex()
    await execute(
        "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
        (token, user_id, time.time() + SESSION_TTL),
    )
    return token


async def session_user(token: str | None):
    if not token:
        return None
    cur = await db().execute(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id "
        "WHERE s.token = ? AND s.expires_at > ?",
        (token, time.time()),
    )
    return await cur.fetchone()


async def destroy_session(token: str):
    await execute("DELETE FROM sessions WHERE token = ?", (token,))