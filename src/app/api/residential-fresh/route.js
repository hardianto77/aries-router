import { NextResponse } from "next/server";
import fs from "node:fs";

/**
 * Residential Fresh Proxy Module API
 * Manages the local rotating residential gateway (resi_gw.py on :20188).
 * - GET  /api/residential-fresh     -> full status (nodes, health, egress IPs)
 * - POST /api/residential-fresh     -> actions: refresh | restart | probe
 */

const GATEWAY = "http://127.0.0.1:20188";
const STATUS = "http://127.0.0.1:20189";
const ALIVE_FILE = "/home/ubuntu/resi-fresh-alive.txt";
const REFRESH_SH = "/home/ubuntu/refresh_fresh_proxies.sh";
const RESIDENTIAL_RE = /^45\.148\./; // pvdata residential range observed

function readAliveList(mask = true) {
  try {
    const lines = fs.readFileSync(ALIVE_FILE, "utf8").split("\n").filter(l => l.startsWith("http"));
    return lines.map(l => {
      try {
        const u = new URL(l);
        return {
          host: u.hostname,
          port: u.port,
          masked: `${u.protocol}//${u.username ? "***:" : ""}${u.password ? "***@" : ""}${u.hostname}:${u.port}`,
        };
      } catch { return { masked: l }; }
    });
  } catch { return []; }
}

async function jsonFetch(url, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    return await r.json();
  } finally { clearTimeout(t); }
}

async function egressIp(timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch("https://api.ipify.org?format=json", {
      signal: ctrl.signal,
      dispatcher: new (await import("undici")).ProxyAgent(GATEWAY),
    });
    const d = await r.json();
    return d.ip || null;
  } catch { return null; } finally { clearTimeout(t); }
}

export async function GET() {
  const started = Date.now();
  let gw = null;
  try { gw = await jsonFetch(STATUS, 5000); } catch { /* gateway down */ }
  const alive = readAliveList();
  const residentialCount = gw?.nodes?.filter(n => !n.host.includes("127.0.0.1") && n.host !== "4.144.146.21").length ?? 0;
  const resiEgress = await egressIp();
  return NextResponse.json({
    success: true,
    module: "Residential Fresh Proxy",
    gateway: {
      listening: !!gw,
      engine: gw?.engine || null,
      upstreams: gw?.upstreams ?? 0,
      alive: gw?.alive ?? 0,
      nodes: (gw?.nodes || []).map(n => ({
        ...n,
        kind: n.host === "127.0.0.1" ? "warp" : n.host === "4.144.146.21" ? "safety-net-datacenter" : "residential",
      })),
    },
    pool: {
      total: alive.length,
      residentialEntries: alive.filter(a => a.host?.includes("pvdata")).length,
    },
    currentEgress: { ip: resiEgress, isResidential: resiEgress ? RESIDENTIAL_RE.test(resiEgress) : null },
    responseMs: Date.now() - started,
  });
}

export async function POST(request) {
  let body = {};
  try { body = await request.json(); } catch { /* default */ }
  const action = String(body.action || "").toLowerCase();
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);

  if (action === "refresh") {
    try {
      await run("bash", [REFRESH_SH], { timeout: 120000 });
      return NextResponse.json({ success: true, action, message: "Fresh residential pool refreshed + WARP rotated" });
    } catch (e) {
      return NextResponse.json({ success: false, error: String(e).slice(0, 200) }, { status: 500 });
    }
  }
  if (action === "restart") {
    try {
      await run("bash", ["-c", "pkill -f resi_gw.py; sleep 1; setsid nohup /usr/bin/python3 /home/ubuntu/resi_gw.py >> /tmp/resi_gw.log 2>&1 < /dev/null & sleep 3"], { timeout: 20000 });
      return NextResponse.json({ success: true, action, message: "Gateway restarted" });
    } catch (e) {
      return NextResponse.json({ success: false, error: String(e).slice(0, 200) }, { status: 500 });
    }
  }
  if (action === "probe") {
    const ip = await egressIp();
    return NextResponse.json({
      success: !!ip,
      egressIp: ip,
      isResidential: ip ? RESIDENTIAL_RE.test(ip) : null,
      latencyMs: 0,
    });
  }
  return NextResponse.json({ success: false, error: "Unknown action. Use: refresh | restart | probe" }, { status: 400 });
}
