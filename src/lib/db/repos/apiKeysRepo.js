export { parseAllowedModels, matchesAllowedModels } from "./allowedModels.js";
import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { keyAccessFromColumns, keyAccessToColumns } from "@/shared/utils/keyAccess.js";
import { KEY_ACCESS_UNRESTRICTED } from "@/shared/constants/keyAccess.js";

function rowToKey(row) {
  if (!row) return null;
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    machineId: row.machineId,
    isActive: row.isActive === 1 || row.isActive === true,
    createdAt: row.createdAt,
    access: keyAccessFromColumns(row.accessRestricted, row.accessAllow),
    allowedModels: row.allowedModels !== undefined ? row.allowedModels : null,
  };
}

export async function getApiKeys() {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY createdAt ASC`);
  return rows.map(rowToKey);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

// Used by the /v1 handlers to read the presented key's access settings.
export async function getApiKeyByKey(key) {
  if (!key) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE key = ?`, [key]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    createdAt: new Date().toISOString(),
    access: { restricted: false, allow: [] },
  };
  // Sync BOTH model columns at creation: when a whitelist is supplied, write it
  // into accessRestricted/accessAllow too, otherwise /v1/models leaks every
  // model because endpoints read the access columns, not allowedModels.
  const allowedStr = String(apiKey.allowedModels || "*").trim();
  const cols = allowedStr && allowedStr !== "*"
    ? keyAccessToColumns({ restricted: true, allow: allowedStr.split(",").map((m) => m.trim()).filter(Boolean) })
    : keyAccessToColumns(KEY_ACCESS_UNRESTRICTED);
  const allowedModelsColumn = allowedStr || "*";
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, accessRestricted, accessAllow, allowedModels) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, apiKey.createdAt, cols.accessRestricted, cols.accessAllow, allowedModelsColumn]
  );
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;
    const merged = { ...rowToKey(row), ...data };
    const cols = keyAccessToColumns(merged.access);
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ?, accessRestricted = ?, accessAllow = ?, allowedModels = COALESCE(?, allowedModels) WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, cols.accessRestricted, cols.accessAllow, merged.allowedModels !== undefined ? String(merged.allowedModels) : null, id]
    );
    result = rowToKey(db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]));
  });
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  return (res?.changes ?? 0) > 0;
}

// Allowed-model patterns of a key, or null when the key may use every model.
// Backed by the per-key access columns (accessRestricted + accessAllow JSON list);
// the /v1/models listing reads these through getAllowedModelsOfKey.

// Pattern language shared with usage dashboards (import from here).


export async function getAllowedModelsOfKey(key) {
  const raw = typeof key === "string" ? key.trim() : "";
  if (!raw) return null;
  try {
    const db = await getAdapter();
    const row = db.get(`SELECT accessRestricted, accessAllow, allowedModels FROM apiKeys WHERE key = ?`, [raw]);
    if (!row) return null;
    const access = keyAccessFromColumns(row.accessRestricted, row.accessAllow);
    if (access.allow.length) return access.allow;
    // Legacy fallback: per-key allowedModels column (comma patterns, "*" = all).
    const legacy = String(row.allowedModels || "").trim();
    if (legacy && legacy !== "*") {
      const pats = legacy.split(",").map((m) => m.trim()).filter(Boolean);
      if (pats.length) return pats;
    }
    return null;
  } catch {
    return null;
  }
}

export async function validateApiKey(key) {
  const db = await getAdapter();
  const row = db.get(`SELECT isActive FROM apiKeys WHERE key = ?`, [key]);
  if (!row) return false;
  return row.isActive === 1 || row.isActive === true;
}

// Restored from d915f17c (lost in keyAccess rewrite)
export async function reconcileAllowedModels({ removed = [], renamed = {} } = {}) {
  if (!removed.length && !Object.keys(renamed).length) {
    return { updated: 0, emptied: [] };
  }
  try {
    const keys = await getApiKeys();
    let updated = 0;
    const emptied = [];

    for (const key of keys) {
      const result = applyModelChangesToAllowList(key.allowedModels, { removed, renamed });
      if (result.emptied) { emptied.push(key.name || key.id); continue; }
      if (!result.changed) continue;
      await updateApiKey(key.id, { allowedModels: result.value });
      updated++;
    }
    return { updated, emptied };
  } catch (err) {
    console.error("[reconcileAllowedModels] failed to follow model change:", err);
    return { updated: 0, emptied: [] };
  }
}

export function recordApiKeyUsageInWindow(key, tokens = 0) {
  if (!key) return;
  const now = Date.now();
  if (!rateLimits[key]) rateLimits[key] = [];
  rateLimits[key].push({ ts: now, tokens: tokens || 0 });
}

export function parsePermissions(permStr) {
  if (!permStr) return { ...DEFAULT_PERMISSIONS };
  if (typeof permStr === "object") return permStr;
  try {
    return JSON.parse(permStr);
  } catch {
    return { ...DEFAULT_PERMISSIONS };
  }
}

export function utcDayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

