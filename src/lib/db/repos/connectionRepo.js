import { getAdapter } from "../driver.js";
import { makeKv } from "../helpers/kvStore.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

export async function getConnectionConfig(connectionId) {
  const raw = await connKv.get(String(connectionId));
  return raw ? parseJson(raw) : null;
}
export async function setConnectionConfig(connectionId, config) {
  await connKv.set(String(connectionId), stringifyJson(config ?? {}));
}
