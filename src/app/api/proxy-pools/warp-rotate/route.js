import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile } from "fs/promises";

export const dynamic = "force-dynamic";

const run = promisify(execFile);

/**
 * POST /api/proxy-pools/warp-rotate
 * Re-registration WARP -> fresh egress IP ( dipakai pool WARP-egress-fresh ).
 */
export async function POST(request) {
  try {
    await run("bash", ["/home/ubuntu/warp_rotate.sh"], { timeout: 120000 });
    let log = "";
    try { log = await readFile("/home/ubuntu/warp_rotate.log", "utf8"); } catch {}
    const last = log.trim().split("\n").pop() || "";
    const ip = (last.match(/egress: ([0-9.]+)/) || [])[1] || null;
    return NextResponse.json({ success: true, ip, lastLine: last });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e.message || e).slice(0, 500) }, { status: 500 });
  }
}
