import { getAdapter } from "../driver.js";
import { makeKv } from "../helpers/kvStore.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

export function sanitizeHistorySnapshot(snap) {
  const clone = { ...(snap || {}) };
  delete clone.adminPasswordHash;
  delete clone.passwordHash;
  delete clone.JWT_SECRET;
  return clone;
}
export async function snapshotSettings(label) {
  try {
    const db = await getAdapter();
    const rows = await db.all("SELECT key, value FROM settings");
    const snap = {};
    for (const r of rows) snap[r.key] = parseJson(r.value);
    await db.run(
      "INSERT INTO settingsHistory (label, snapshot, createdAt) VALUES (?,?,?)",
      [label || "manual", stringifyJson(sanitizeHistorySnapshot(snap)), new Date().toISOString()]
    );
    // keep last 20
    await db.run(
      "DELETE FROM settingsHistory WHERE id NOT IN (SELECT id FROM settingsHistory ORDER BY id DESC LIMIT 20)"
    );
  } catch {}
}
export async function listSettingsHistory(limit = 20) {
  const db = await getAdapter();
  const rows = await db.all("SELECT id, label, createdAt FROM settingsHistory ORDER BY id DESC LIMIT ?", [limit]);
  return rows || [];
}
export async function getSettingsSnapshot(id) {
  const db = await getAdapter();
  const row = await db.get("SELECT snapshot FROM settingsHistory WHERE id = ?", [id]);
  return row ? parseJson(row.snapshot) : null;
}
export async function getSettingsSnapshotCount() {
  const db = await getAdapter();
  const row = await db.get("SELECT COUNT(*) AS c FROM settingsHistory");
  return row?.c || 0;
}
