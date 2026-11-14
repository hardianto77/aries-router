import { getAdapter } from "../driver.js";
import { makeKv } from "../helpers/kvStore.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

export function parseAllowedModels(value) {
  if (!value) return null;
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value).split(",").map((s) => s.trim()).filter(Boolean);
}
export function matchesAllowedModels(models, allowed) {
  const list = parseAllowedModels(allowed);
  if (!list || !list.length) return true;
  const set = new Set(list.map((s) => s.toLowerCase()));
  return (Array.isArray(models) ? models : [models]).every((m) => {
    const name = typeof m === "string" ? m : m?.id || m?.model || "";
    if (set.has(String(name).toLowerCase())) return true;
    // prefix wildcard "provider/*"
    return list.some((pat) => pat.endsWith("*") && String(name).toLowerCase().startsWith(pat.slice(0, -1).toLowerCase()));
  });
}
