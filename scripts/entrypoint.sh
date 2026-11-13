#!/bin/sh
# 9router runtime entrypoint (merged with upstream 0.5.181 su-exec pattern).
# 1. Fix volume ownership (persistent /app/data is mounted from the host).
# 2. Re-materialize /app/q_key.js (gateway key export) from the persistent DB:
#    /app is ephemeral while /app/data is not, so without this the key file
#    vanishes on every container recreate and the gateway 502s until someone
#    rebuilds it by hand. If the DB is not ready yet (first boot), skip quietly.
chown -R node:node /app/data /app/data-home 2>/dev/null

node -e '
const p = "/app/q_key.js";
if (!require("fs").existsSync(p)) {
  try {
    const db = require("better-sqlite3")("/app/data/db/data.sqlite");
    const row = db.prepare("SELECT key FROM apiKeys WHERE name = '"'"'mecombo'"'"'").get();
    if (row) {
      require("fs").writeFileSync(p, "module.exports.key=" + JSON.stringify(row.key) + ";");
      console.log("[entrypoint] q_key.js restored from DB");
    } else {
      console.log("[entrypoint] q_key.js: mecombo key not in DB yet, skipping");
    }
  } catch (e) {
    console.log("[entrypoint] q_key.js skipped:", e.message);
  }
}
' || true

if command -v su-exec >/dev/null 2>&1; then
  exec su-exec node "$@"
else
  # CMD already contains the full command ("node custom-server.js"); su-exec
  # needs the user prefix, a plain exec does not.
  exec "$@"
fi
