import { getSettings } from "../localDb.js";
export const PASSWORD_HEADER = "x-9r-password";
export async function verifyPollToken(job, token) {
  if (!token || !job?.pollToken) return false;
  return String(token) === String(job.pollToken);
}
export async function verifyDashboardPassword(pw) {
  try {
    const s = await getSettings();
    const hash = s?.adminPasswordHash || s?.passwordHash;
    if (!hash) return false;
    const bcrypt = (await import("bcryptjs")).default;
    return bcrypt.compare(String(pw || ""), hash);
  } catch { return false; }
}
