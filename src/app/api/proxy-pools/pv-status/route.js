import { NextResponse } from "next/server";
import fs from "node:fs";
import { execFile } from "node:child_process";

export const dynamic = "force-dynamic";

/**
 * GET /api/proxy-pools/pv-status
 * Pool state from pv_pool.json (written by pv_pool_sync.py).
 * Per-account binding, no proxy groups.
 */
function warpIp() {
  return new Promise((resolve) => {
    execFile("curl", ["-s", "-m", "8", "--proxy", "http://127.0.0.1:8118", "https://api.ipify.org"],
      (err, stdout) => resolve(err ? null : stdout.trim()));
  });
}

export async function GET() {
  try {
    const pool = JSON.parse(fs.readFileSync("/home/ubuntu/.aries-router/pv_pool.json", "utf8"));
    const urls = pool.urls || [];
    const warpInPool = urls.includes("http://127.0.0.1:8118") ? 1 : 0;
    const poolActive = urls.length;

    let resiTotal = 0, resiAlive = 0;
    try {
      const resi = fs.readFileSync("/home/ubuntu/resi-fresh-alive.txt", "utf8")
        .split("\n").map((l) => l.trim().split(/\s+/)[0]).filter((l) => l.startsWith("http"));
      resiTotal = resi.length;
      const set = new Set(urls);
      resiAlive = resi.filter((u) => set.has(u)).length;
    } catch {}

    let lastSync = null;
    try {
      lastSync = fs.statSync("/home/ubuntu/.aries-router/pv_pool.json").mtime.toISOString();
    } catch {}

    const warpIpVal = await warpIp();
    return NextResponse.json({
      success: true,
      pvActive: resiTotal ? resiAlive : poolActive,
      resiAlive,
      resiTotal,
      warpInPool,
      poolActive,
      warpIp: warpIpVal,
      lastSync,
      mode: "Per-account proxy binding (no groups)",
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e.message || e) }, { status: 500 });
  }
}
