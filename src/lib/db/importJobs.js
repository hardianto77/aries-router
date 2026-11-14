import { makeKv } from "./helpers/kvStore.js";
import { parseJson, stringifyJson } from "./helpers/jsonCol.js";
const kv = makeKv("importJobs");
export async function createImportJob(meta) {
  const id = "imp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const job = { id, ...meta, status: "queued", createdAt: new Date().toISOString() };
  await kv.set(id, stringifyJson(job));
  return job;
}
export async function getImportJob(id) {
  const raw = await kv.get(id);
  return raw ? parseJson(raw) : null;
}
export async function updateImportJob(id, patch) {
  const raw = await kv.get(id);
  const job = raw ? parseJson(raw) : null;
  if (!job) return null;
  Object.assign(job, patch);
  await kv.set(id, stringifyJson(job));
  return job;
}
