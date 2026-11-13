import { NextResponse } from "next/server";
import { readFile, stat } from "fs/promises";
import { execFile } from "child_process";
import { promisify } from "util";

export const dynamic = "force-dynamic";

const run = promisify(execFile);

/** GET /api/proxy-pools/pv-status — status singkat WARP + ProxyVault + sync terakhir */
export async function GET(request) {
  try {
    const out = await run("sqlite3", ["/home/ubuntu/.aries-router/db/data.sqlite",
      "select count(*) from proxyPools where isActive=1 and json_extract(data,'$.name') like 'PV-%'; select count(*) from proxyPools where isActive=1 and json_extract(data,'$.name')='WARP-egress-fresh'; select count(*) from proxyPools where isActive=1;"], { timeout: 20000 });
    const [pv, warp, total] = out.stdout.trim().split("\n").map((n) => Number(n) || 0);
    let warpIp = null;
    try {
      const log = await readFile("/home/ubuntu/warp_rotate.log", "utf8");
      warpIp = (log.trim().split("\n").pop() || "").match(/egress: ([0-9.]+)/)?.[1] || null;
    } catch {}
    let lastSync = null;
    try { lastSync = (await stat("/home/ubuntu/pv_pool_sync.log")).mtime.toISOString(); } catch {}
    // Residential fresh count (resi-fresh-alive.txt ∩ pv_pool.json)
    let resiTotal = 0, resiAlive = 0;
    try {
      const fsM = await import("node:fs");
      const resi = fsM.readFileSync("/home/ubuntu/resi-fresh-alive.txt", "utf8")
        .split("\n").map((l) => l.trim().split(/\s+/)[0]).filter((l) => l.startsWith("http"));
      resiTotal = resi.length;
      const pool = JSON.parse(fsM.readFileSync("/home/ubuntu/.aries-router/pv_pool.json", "utf8"));
      const urls = new Set(pool.urls || []);
      resiAlive = resi.filter((u) => urls.has(u)).length;
    } catch {}
    return NextResponse.json({ success: true, pvActive: pv, warpInPool: warp, poolActive: total, warpIp, lastSync, resiTotal, resiAlive });
  } catch (e) {
    return NextResponse.json({ success: false, error: String(e.message || e).slice(0, 300) }, { status: 500 });
  }
}
