import { randomUUID } from "node:crypto";
import { getAdapter } from "../driver.js";

function ensureTable(db) {
  db.run(`CREATE TABLE IF NOT EXISTS vouchers (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT,
    description TEXT DEFAULT '',
    tokenLimit INTEGER DEFAULT 0,
    allowedModels TEXT DEFAULT '*',
    expiresInDays INTEGER DEFAULT 0,
    maxUses INTEGER DEFAULT 0,
    usedCount INTEGER DEFAULT 0,
    isActive INTEGER DEFAULT 1,
    createdAt TEXT NOT NULL
  )`);
  db.run(`CREATE TABLE IF NOT EXISTS voucherClaims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voucherId TEXT NOT NULL,
    keyId TEXT,
    apiKeyPrefix TEXT,
    ip TEXT,
    claimedAt TEXT NOT NULL
  )`);
}

export async function getVouchers() {
  const db = await getAdapter();
  ensureTable(db);
  return db.prepare("SELECT * FROM vouchers ORDER BY createdAt DESC").all();
}

export async function getVoucherById(id) {
  const db = await getAdapter();
  ensureTable(db);
  return db.prepare("SELECT * FROM vouchers WHERE id = ?").get(id) || null;
}

export async function getVoucherByCode(code) {
  const db = await getAdapter();
  ensureTable(db);
  return db.prepare("SELECT * FROM vouchers WHERE UPPER(code) = UPPER(?)").get(String(code || "")) || null;
}

export async function createVoucher(data) {
  const db = await getAdapter();
  ensureTable(db);
  const v = {
    id: data.id || randomUUID(),
    code: String(data.code || data.name || "").toUpperCase(),
    name: data.name || data.code,
    description: data.description || "",
    tokenLimit: Number(data.tokenLimit) || 0,
    allowedModels: data.allowedModels || "*",
    expiresInDays: Number(data.expiresInDays) || 0,
    maxUses: Number(data.maxUses) || 0,
    usedCount: Number(data.usedCount) || 0,
    isActive: data.isActive === undefined ? 1 : (data.isActive ? 1 : 0),
    createdAt: new Date().toISOString(),
  };
  db.prepare("INSERT INTO vouchers (id, code, name, description, tokenLimit, allowedModels, expiresInDays, maxUses, usedCount, isActive, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(v.id, v.code, v.name, v.description, v.tokenLimit, v.allowedModels, v.expiresInDays, v.maxUses, v.usedCount, v.isActive, v.createdAt);
  return v;
}

export async function updateVoucher(id, data) {
  const db = await getAdapter();
  ensureTable(db);
  const existing = await getVoucherById(id);
  if (!existing) return null;
  const merged = { ...existing, ...data };
  db.prepare("UPDATE vouchers SET code=?, name=?, description=?, tokenLimit=?, allowedModels=?, expiresInDays=?, maxUses=?, usedCount=?, isActive=? WHERE id=?")
    .run(String(merged.code||"").toUpperCase(), merged.name, merged.description||"", Number(merged.tokenLimit)||0, merged.allowedModels||"*", Number(merged.expiresInDays)||0, Number(merged.maxUses)||0, Number(merged.usedCount)||0, merged.isActive?1:0, id);
  return { ...merged, id };
}

export async function deleteVoucher(id) {
  const db = await getAdapter();
  ensureTable(db);
  db.prepare("DELETE FROM vouchers WHERE id = ?").run(id);
  db.prepare("DELETE FROM voucherClaims WHERE voucherId = ?").run(id);
  return true;
}

export async function getVoucherClaims(voucherId = null) {
  const db = await getAdapter();
  ensureTable(db);
  if (voucherId) return db.prepare("SELECT * FROM voucherClaims WHERE voucherId = ? ORDER BY claimedAt DESC").all(voucherId);
  return db.prepare("SELECT * FROM voucherClaims ORDER BY claimedAt DESC").all();
}

export async function recordVoucherClaim({ voucherId, keyId, apiKeyPrefix, ip }) {
  const db = await getAdapter();
  ensureTable(db);
  db.prepare("INSERT INTO voucherClaims (voucherId, keyId, apiKeyPrefix, ip, claimedAt) VALUES (?,?,?,?,?)")
    .run(voucherId, keyId || null, apiKeyPrefix || null, ip || null, new Date().toISOString());
  db.prepare("UPDATE vouchers SET usedCount = usedCount + 1 WHERE id = ?").run(voucherId);
  return true;
}

export async function getActiveBansosVoucher() {
  const db = await getAdapter();
  ensureTable(db);
  const rows = db.prepare("SELECT * FROM vouchers WHERE isActive = 1 AND UPPER(code) = 'BANSOS' ORDER BY createdAt DESC LIMIT 1").all();
  if (rows.length) return rows[0];
  const any = db.prepare("SELECT * FROM vouchers WHERE isActive = 1 ORDER BY createdAt DESC LIMIT 1").all();
  return any[0] || null;
}

export async function claimVoucher(voucher, ip = null, created = null) {
  // Compatibility shim: record the claim against the voucher. The caller
  // (claim route) creates the API key itself and stores the receipt.
  const db = await getAdapter();
  ensureTable(db);
  const vid = typeof voucher === "string" ? voucher : (voucher && voucher.id);
  if (!vid) return { ok: false };
  db.prepare("UPDATE vouchers SET usedCount = usedCount + 1 WHERE id = ?").run(vid);
  db.prepare("INSERT INTO voucherClaims (voucherId, keyId, apiKeyPrefix, ip, claimedAt) VALUES (?,?,?,?,?)")
    .run(vid, (created && created.id) || null, (created && created.key ? String(created.key).slice(0, 12) : null), ip, new Date().toISOString());
  return { ok: true };
}
