import { getAdapter } from "../driver.js";
import { makeKv } from "../helpers/kvStore.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

export async function getAutoBackupConfig() {
  const raw = await autoBackupKv.get("config");
  return raw ? parseJson(raw) : { enabled: false, intervalHours: 24, keep: 5 };
}
export async function setAutoBackupConfig(cfg) {
  await autoBackupKv.set("config", stringifyJson(cfg ?? {}));
}
export async function getAutoBackupStatus() {
  const raw = await autoBackupKv.get("status");
  return raw ? parseJson(raw) : { lastRun: null, ok: null };
}
export async function setAutoBackupStatus(st) {
  await autoBackupKv.set("status", stringifyJson(st ?? {}));
}
