// Restored job modules (fork v0.5.387) — kv-backed job store.
import { getAdapter } from "./driver.js";
import { makeKv } from "./helpers/kvStore.js";
import { parseJson, stringifyJson } from "./helpers/jsonCol.js";

const jobsKv = makeKv("dashboardJobs");

const DEFAULT_POLL_MS = 1000;
export const DASHBOARD_JOB_POLL_MS = DEFAULT_POLL_MS;

function newId() {
  return "job_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function createDashboardJob(kind, payload, handler) {
  const id = newId();
  const job = {
    id,
    kind,
    payload: payload || null,
    status: "queued",
    progress: 0,
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await jobsKv.set(id, stringifyJson(job));
  // fire-and-forget async run if handler provided
  if (typeof handler === "function") {
    (async () => {
      try {
        await updateDashboardJob(id, { status: "running" });
        const result = await handler(job, (progress) => updateDashboardJob(id, { progress }));
        await updateDashboardJob(id, { status: "done", progress: 100, result: result ?? null });
      } catch (e) {
        await updateDashboardJob(id, { status: "error", error: String(e?.message || e).slice(0, 500) });
      }
    })();
  }
  return job;
}

export async function updateDashboardJob(id, patch) {
  const raw = await jobsKv.get(id);
  const job = raw ? parseJson(raw) : null;
  if (!job) return null;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  await jobsKv.set(id, stringifyJson(job));
  return job;
}

export async function getDashboardJob(id) {
  const raw = await jobsKv.get(id);
  return raw ? parseJson(raw) : null;
}

export async function listDashboardJobs(limit = 50) {
  const all = await jobsKv.getAll();
  const list = Object.values(all || {}).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return list.slice(0, limit);
}

export async function cancelDashboardJob(id) {
  const job = await getDashboardJob(id);
  if (!job) return null;
  return updateDashboardJob(id, { status: "cancelled" });
}
