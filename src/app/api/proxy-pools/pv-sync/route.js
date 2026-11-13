import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";

export const dynamic = "force-dynamic";

const run = promisify(execFile);

/**
 * POST /api/proxy-pools/pv-sync
 * Sinkronisasi ProxyVault -> pool proxyPools -> rotasi IP ke masing-masing provider.
 * TIDAK membuat group proxy: setiap koneksi ter-bind langsung ke 1 row proxy (per-connection).
 */
export async function POST(request) {
  try {
    const { stdout, stderr } = await run("python3", ["/home/ubuntu/pv_pool_sync.py"], { timeout: 120000 });
    const alive = (stdout.match(/alive: (\d+)/) || [])[1] || "0";
    const pool = (stdout.match(/\[pool\] PV rows: (\d+)/) || [])[1] || "0";
    const rotated = (stdout.match(/\[rotate\] non-TH: (\d+)/) || [])[1] || "0";
    const th = (stdout.match(/TH recent: (\d+)/) || [])[1] || "0";
    return NextResponse.json({
      success: true,
      alive: Number(alive),
      poolAdded: Number(pool),
      rotatedProviders: Number(rotated),
      rotatedTokenharbor: Number(th),
      log: (stdout + (stderr ? "\n" + stderr : "")).slice(-2000),
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e.message || e).slice(0, 500) }, { status: 500 });
  }
}
