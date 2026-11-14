import { NextResponse } from "next/server";
import { execFile } from "node:child_process";

export const dynamic = "force-dynamic";

/**
 * POST /api/proxy-pools/pv-sync
 * ProxyVault + Residential fresh + WARP egress -> pool -> per-account rotation.
 * One-on-one direct binding (no proxy groups). Dead proxies/WARP auto-replaced.
 */
export async function POST(request) {
  try {
    let body = {};
    try { body = await request.json(); } catch {}
    const force = body.force !== false ? ["--force"] : [];
    const log = await new Promise((resolve, reject) => {
      execFile(
        "python3",
        ["/opt/aries-router/scripts/pv_pool_sync.py", ...force],
        { timeout: 150000, maxBuffer: 10 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err && !stdout) return reject(err);
          resolve(stdout + (stderr ? "\n" + stderr : ""));
        }
      );
    });
    const grab = (re) => {
      const m = log.match(re);
      return m ? Number(m[1]) : 0;
    };
    const healthy = grab(/\[pool\] total egress sehat: (\d+)/);
    const resiAlive = grab(/\[resi\] sehat: (\d+)/);
    const resiTotal = grab(/\[resi\] sehat: \d+\/(\d+)/);
    const rotated = grab(/akun provider ter-assign: (\d+)/);
    const warpOk = /\[WARP\] alive: True/.test(log);
    const skipped = /skip/.test(log) && healthy === 0;
    return NextResponse.json({
      success: true,
      poolAdded: healthy,
      resiAlive,
      resiTotal,
      rotatedProviders: rotated,
      warpOk,
      skipped,
      log: log.split("\n").slice(-25).join("\n"),
    });
  } catch (error) {
    console.error("[pv-sync] error:", error);
    return NextResponse.json(
      { success: false, error: String(error.message || error).slice(0, 500) },
      { status: 500 }
    );
  }
}
