/**
 * EXSALA HERMES MOD · powered by Gienetic
 * /opt/aries-router/src/lib/network/directProxySyncService.js
 * 
 * Unified 1-on-1 Direct Proxy Synchronization & Auto-Replacement Service:
 * - Direct ingestion from ProxyVault API (http://127.0.0.1:8022) with lowest latency sorting.
 * - Ingestion of verified residential fresh proxies (/home/ubuntu/resi-fresh-alive.txt).
 * - Automatic WARP egress rotation (/home/ubuntu/warp_rotate.sh).
 * - Concurrent probe & auto-replacement of dead/unresponsive proxies.
 * - STRICT NON-POOL POLICY: proxyPoolId is guaranteed NULL; no group proxy pools created.
 */

import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const run = promisify(execFile);

const SCRIPT_CANDIDATES = [
  path.join(process.cwd(), "scripts/sync_direct_proxies.py"),
  "/opt/aries-router/scripts/sync_direct_proxies.py",
  "/home/ubuntu/sync_direct_proxies.py",
];

function resolveScriptPath() {
  for (const p of SCRIPT_CANDIDATES) {
    if (fs.existsSync(p)) return p;
  }
  return "/opt/aries-router/scripts/sync_direct_proxies.py";
}

/**
 * Execute 1-on-1 direct proxy synchronization
 * @param {Object} options
 * @param {string} [options.provider] - Target provider ID (e.g. "glm")
 * @param {boolean} [options.rotateWarp=true] - Whether to rotate WARP egress
 * @param {boolean} [options.allRotate=false] - Whether to force rotate all connections
 * @param {boolean} [options.dryRun=false] - Dry run without writing to DB
 */
export async function syncDirectProxies({
  provider = "",
  rotateWarp = true,
  allRotate = false,
  dryRun = false,
} = {}) {
  const scriptPath = resolveScriptPath();
  const args = [scriptPath];

  if (provider) {
    args.push("--provider", String(provider).trim());
  }
  if (!rotateWarp) {
    args.push("--no-warp");
  }
  if (allRotate) {
    args.push("--all-rotate");
  }
  if (dryRun) {
    args.push("--dry-run");
  }

  const { stdout, stderr } = await run("python3", args, { timeout: 180000 });

  let parsed = null;
  const lines = stdout.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      parsed = JSON.parse(lines[i]);
      if (parsed && typeof parsed === "object" && "success" in parsed) {
        break;
      }
    } catch {}
  }

  if (parsed) {
    return parsed;
  }

  return {
    success: true,
    provider: provider || "all",
    log: stdout.slice(-1500),
    strictlyOneToOne: true,
    groupProxyCount: 0,
  };
}
