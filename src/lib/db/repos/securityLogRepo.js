import { getAdapter } from "../driver.js";
import { makeKv } from "../helpers/kvStore.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

export async function recordSecurityEvent(evt) {
  try {
    const db = await getAdapter();
    await db.run(
      "INSERT INTO securityEvents (type, source, ip, detail, createdAt) VALUES (?,?,?,?,?)",
      [evt?.type || "unknown", evt?.source || "", evt?.ip || "", stringifyJson(evt?.detail || evt || {}), new Date().toISOString()]
    );
  } catch {}
}
