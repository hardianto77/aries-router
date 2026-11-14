import { getDashboardJob, updateDashboardJob } from "./dashboardJobs.js";
const handlers = {};
export function registerDashboardJobHandler(kind, fn) { handlers[kind] = fn; }
export function getDashboardJobHandler(kind) { return handlers[kind] || null; }
export async function runDashboardJob(jobId) {
  const job = await getDashboardJob(jobId);
  if (!job) return null;
  const fn = handlers[job.kind];
  if (!fn) return job;
  try {
    await updateDashboardJob(jobId, { status: "running" });
    const result = await fn(job, (p) => updateDashboardJob(jobId, { progress: p }));
    await updateDashboardJob(jobId, { status: "done", progress: 100, result: result ?? null });
  } catch (e) {
    await updateDashboardJob(jobId, { status: "error", error: String(e?.message || e).slice(0, 500) });
  }
  return getDashboardJob(jobId);
}
export default handlers;
