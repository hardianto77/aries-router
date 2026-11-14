import { getAdapter } from "../driver.js";
import { makeKv } from "../helpers/kvStore.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

export async function notify(n) {
  try {
    const db = await getAdapter();
    const kind = n?.kind || "generic";
    await db.run(
      "INSERT INTO notifications (kind, level, title, message, meta, createdAt) VALUES (?,?,?,?,?,?)",
      [kind, n?.level || "info", n?.title || "", n?.message || "", stringifyJson(n?.meta || {}), new Date().toISOString()]
    );
  } catch {}
}
export async function clearNotificationByKind(kind) {
  try {
    const db = await getAdapter();
    await db.run("DELETE FROM notifications WHERE kind = ?", [kind]);
  } catch {}
}
