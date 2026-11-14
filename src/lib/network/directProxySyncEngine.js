/**
 * EXSALA HERMES MOD · powered by Gienetic
 * directProxySyncEngine.js
 * 
 * Modul Engine Bundle Terintegrasi untuk Aries Router:
 * - Sinkronisasi otomatis ProxyVault (port 8022) + Residential IP Fresh + WARP Egress Rotation.
 * - Binding murni 1-on-1 direct proxy (`connectionProxyUrl`), TANPA group proxy pool (`proxyPoolId = null`).
 * - Monitoring & Auto-replace instan jika mendeteksi proxy/WARP yang mati/unreachable.
 * - Terintegrasi langsung dengan SQLite `providerConnections` dan database adapter 9Router.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";

const run = promisify(execFile);
const PYTHON_SCRIPT = "/opt/aries-router/scripts/sync_direct_proxies.py";

/**
 * Menjalankan proses sinkronisasi direct proxy 1-on-1.
 * 
 * @param {Object} options
 * @param {string} [options.provider] - Target provider (e.g. 'glm', 'openai', atau kosong untuk semua)
 * @param {boolean} [options.rotateWarp=true] - Memicu rotasi egress IP WARP
 * @param {boolean} [options.allRotate=false] - Rotasi seluruh proxy tanpa mengecek status hidup
 * @returns {Promise<Object>} Hasil sinkronisasi
 */
export async function executeDirectProxySync(options = {}) {
  const { provider = "", rotateWarp = true, allRotate = false } = options;

  const args = [PYTHON_SCRIPT];
  if (provider) {
    args.push("--provider", String(provider).trim());
  }
  if (!rotateWarp) {
    args.push("--no-warp");
  }
  if (allRotate) {
    args.push("--all-rotate");
  }

  try {
    const { stdout, stderr } = await run("python3", args, { timeout: 180000 });
    
    let parsedResult = null;
    const lines = stdout.trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        parsedResult = JSON.parse(lines[i]);
        if (parsedResult && typeof parsedResult === "object" && "success" in parsedResult) {
          break;
        }
      } catch {}
    }

    if (parsedResult) {
      return parsedResult;
    }

    return {
      success: true,
      log: stdout.slice(-1500),
      rawError: stderr ? stderr.slice(-500) : null,
      message: "Sync completed with raw output",
    };
  } catch (error) {
    return {
      success: false,
      error: String(error.message || error).slice(0, 500),
    };
  }
}
