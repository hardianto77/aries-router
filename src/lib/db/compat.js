// compat.js — fork-API compatibility layer (v0.5.387)
import { getAdapter } from "./driver.js";
import { stringifyJson, parseJson } from "./helpers/jsonCol.js";
import { createProxyPool, deleteProxyPool } from "./repos/proxyPoolsRepo.js";

export async function createProxyPools(list) {
  const out = [];
  for (const item of Array.isArray(list) ? list : [list]) {
    out.push(await createProxyPool(item));
  }
  return out;
}

export async function deleteProxyPools(ids) {
  const out = [];
  for (const id of Array.isArray(ids) ? ids : [ids]) {
    out.push(await deleteProxyPool(id));
  }
  return out;
}

// ---------- error logs ----------
export async function recordErrorLog(entry) {
  try {
    const db = await getAdapter();
    await db.run(
      "INSERT INTO errorLogs (level, source, message, detail, createdAt) VALUES (?,?,?,?,?)",
      [entry?.level || "error", entry?.source || "", String(entry?.message || "").slice(0, 2000), stringifyJson(entry || {}), new Date().toISOString()]
    );
  } catch {}
}

export async function getErrorLogs(limit = 100) {
  try {
    const db = await getAdapter();
    const rows = await db.all("SELECT * FROM errorLogs ORDER BY id DESC LIMIT ?", [limit]);
    return (rows || []).map((r) => ({ ...r, detail: parseJson(r.detail) }));
  } catch { return []; }
}

export async function clearErrorLogs() {
  try {
    const db = await getAdapter();
    await db.run("DELETE FROM errorLogs");
  } catch {}
}

// ---------- db summary ----------
export async function getDbSummary() {
  const db = await getAdapter();
  const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  const summary = {};
  for (const t of tables || []) {
    try {
      const row = await db.get(`SELECT COUNT(*) AS c FROM "${t.name}"`);
      summary[t.name] = row?.c || 0;
    } catch { summary[t.name] = null; }
  }
  return summary;
}
