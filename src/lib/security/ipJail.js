import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir";
import { recordSecurityEvent } from "@/lib/db/repos/securityLogRepo.js";

/**
 * In-Memory Dynamic IP Auto-Banning & Jailing (Internal Fail2Ban Engine)
 *
 * Rules:
 * 1. Tracks failed login attempts and malicious probe requests per IP/Subnet.
 * 2. Thresholds:
 *    - 5 failed login attempts in 5 minutes -> JAILED (default 30 mins)
 *    - 3 malicious probe signatures (SQLi, Path Traversal, Script Injection) -> JAILED (60 mins)
 * 3. Fast-path lookup: checked on every incoming request in custom-server.js
 *    and rejected with HTTP 403 / TCP reset before Next.js or SQLite is touched.
 * 4. Whitelist: 127.0.0.1, ::1, and loopbacks are NEVER jailed.
 */

const JAIL_STATE_FILE = path.join(DATA_DIR, "ip-jail-state.json");

// IP -> { jailedUntil: timestamp, reason: string, strikes: number, lastStrikeAt: timestamp }
const jailedIps = new Map();
// IP -> { count: number, firstSeenAt: timestamp }
const failTracker = new Map();
// IP -> { count: number, firstSeenAt: timestamp }
const probeTracker = new Map();

// Load persisted state if exists
try {
  if (fs.existsSync(JAIL_STATE_FILE)) {
    const raw = JSON.parse(fs.readFileSync(JAIL_STATE_FILE, "utf8"));
    const now = Date.now();
    for (const [ip, data] of Object.entries(raw || {})) {
      if (data && data.jailedUntil > now) {
        jailedIps.set(ip, data);
      }
    }
  }
} catch {}

function persistJailState() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const obj = Object.fromEntries(jailedIps);
    fs.writeFileSync(JAIL_STATE_FILE, JSON.stringify(obj, null, 2), { mode: 0o600 });
  } catch {}
}

const DEFAULT_LOGIN_FAIL_THRESHOLD = 5;
const DEFAULT_PROBE_THRESHOLD = 3;
const DEFAULT_JAIL_DURATION_MS = 30 * 60 * 1000; // 30 minutes
const PROBE_JAIL_DURATION_MS = 60 * 60 * 1000;    // 60 minutes
const TRACKER_WINDOW_MS = 5 * 60 * 1000;          // 5 minutes window

export function isLocalOrLoopback(ip) {
  if (!ip) return true;
  const clean = String(ip).trim().replace(/^::ffff:/, "");
  return clean === "127.0.0.1" || clean === "::1" || clean === "localhost";
}

/**
 * Check if an IP is currently banned / jailed.
 * Fast O(1) in-memory lookup.
 */
export function isIpJailed(ip) {
  if (!ip || isLocalOrLoopback(ip)) return false;
  const clean = String(ip).trim().replace(/^::ffff:/, "");
  const record = jailedIps.get(clean);
  if (!record) return false;

  if (Date.now() >= record.jailedUntil) {
    jailedIps.delete(clean);
    persistJailState();
    return false;
  }
  return true;
}

/**
 * Get jail record details if jailed
 */
export function getJailDetails(ip) {
  if (!ip || isLocalOrLoopback(ip)) return null;
  const clean = String(ip).trim().replace(/^::ffff:/, "");
  const record = jailedIps.get(clean);
  if (!record) return null;
  const remainingMs = record.jailedUntil - Date.now();
  if (remainingMs <= 0) {
    jailedIps.delete(clean);
    persistJailState();
    return null;
  }
  return {
    ip: clean,
    reason: record.reason,
    remainingSeconds: Math.ceil(remainingMs / 1000),
    jailedUntil: new Date(record.jailedUntil).toISOString(),
    strikes: record.strikes || 1,
  };
}

/**
 * Jail an IP explicitly for a duration with a reason.
 */
export function jailIp(ip, reason = "Automated security lockout", durationMs = DEFAULT_JAIL_DURATION_MS) {
  if (!ip || isLocalOrLoopback(ip)) return;
  const clean = String(ip).trim().replace(/^::ffff:/, "");
  const now = Date.now();
  const existing = jailedIps.get(clean);
  const strikes = (existing?.strikes || 0) + 1;
  const effectiveDuration = durationMs * Math.min(strikes, 4); // Progressive escalation up to 4x

  jailedIps.set(clean, {
    jailedUntil: now + effectiveDuration,
    reason,
    strikes,
    jailedAt: now,
  });

  persistJailState();

  console.warn(`[AutoJail] 🚨 BANNED IP ${clean} for ${Math.round(effectiveDuration / 60000)}m | Reason: ${reason} (Strike #${strikes})`);

  // Record into persistent SQLite securityEvents
  recordSecurityEvent({
    type: "ip.jailed",
    severity: "critical",
    ip: clean,
    actor: "auto-jail",
    method: "SECURITY",
    path: "/api/security/jail",
    status: 403,
    detail: JSON.stringify({ reason, strikes, durationMinutes: Math.round(effectiveDuration / 60000) }),
  }).catch(() => {});
}

/**
 * Unjail / whitelist an IP
 */
export function unjailIp(ip) {
  if (!ip) return false;
  const clean = String(ip).trim().replace(/^::ffff:/, "");
  const deleted = jailedIps.delete(clean);
  failTracker.delete(clean);
  probeTracker.delete(clean);
  if (deleted) persistJailState();
  return deleted;
}

/**
 * Record a login failure for IP. Triggers jail if threshold exceeded.
 */
export function recordLoginFailure(ip, detail = "Failed login attempt") {
  if (!ip || isLocalOrLoopback(ip)) return;
  const clean = String(ip).trim().replace(/^::ffff:/, "");
  const now = Date.now();

  const entry = failTracker.get(clean) || { count: 0, firstSeenAt: now };
  if (now - entry.firstSeenAt > TRACKER_WINDOW_MS) {
    entry.count = 1;
    entry.firstSeenAt = now;
  } else {
    entry.count += 1;
  }
  failTracker.set(clean, entry);

  if (entry.count >= DEFAULT_LOGIN_FAIL_THRESHOLD) {
    failTracker.delete(clean);
    jailIp(clean, `Exceeded ${DEFAULT_LOGIN_FAIL_THRESHOLD} failed logins within 5 minutes`, DEFAULT_JAIL_DURATION_MS);
  }
}

/**
 * Record a malicious probe signature detected for IP. Triggers longer jail.
 */
export function recordProbeViolation(ip, probeType = "Malicious probe") {
  if (!ip || isLocalOrLoopback(ip)) return;
  const clean = String(ip).trim().replace(/^::ffff:/, "");
  const now = Date.now();

  const entry = probeTracker.get(clean) || { count: 0, firstSeenAt: now };
  if (now - entry.firstSeenAt > TRACKER_WINDOW_MS) {
    entry.count = 1;
    entry.firstSeenAt = now;
  } else {
    entry.count += 1;
  }
  probeTracker.set(clean, entry);

  if (entry.count >= DEFAULT_PROBE_THRESHOLD) {
    probeTracker.delete(clean);
    jailIp(clean, `Security violation: ${entry.count} probe attempts (${probeType})`, PROBE_JAIL_DURATION_MS);
  }
}

/**
 * Clear trackers on successful login
 */
export function clearFailures(ip) {
  if (!ip) return;
  const clean = String(ip).trim().replace(/^::ffff:/, "");
  failTracker.delete(clean);
}

/**
 * List all currently jailed IPs with expiration and details
 */
export function listJailedIps() {
  const now = Date.now();
  const list = [];
  for (const [ip, data] of jailedIps.entries()) {
    if (data.jailedUntil > now) {
      list.push({
        ip,
        reason: data.reason,
        remainingSeconds: Math.ceil((data.jailedUntil - now) / 1000),
        jailedUntil: new Date(data.jailedUntil).toISOString(),
        jailedAt: data.jailedAt ? new Date(data.jailedAt).toISOString() : null,
        strikes: data.strikes || 1,
      });
    }
  }
  return list;
}
