import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { getProviderConnections } from "@/models";

const run = promisify(execFile);
export const dynamic = "force-dynamic";

const GATEWAY = process.env.RESI_GATEWAY_URL || "http://127.0.0.1:20188";
const STATUS_URL = process.env.RESI_GATEWAY_STATUS_URL || "http://127.0.0.1:20189/status";
const REFRESH_PY = "/opt/aries-router/scripts/refresh_fresh_residential.py";

async function fetchGatewayStatus(timeoutMs = 3500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(STATUS_URL, { signal: ctrl.signal, cache: "no-store" });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function lookupIpMeta(ip) {
  if (!ip) return null;
  try {
    const r = await fetch(`http://ip-api.com/json/${ip}?fields=status,countryCode,isp,org,as,hosting,mobile`, {
      cache: "no-store",
    });
    const d = await r.json();
    if (d?.status === "success") {
      const comb = `${d.isp || ""} ${d.org || ""}`.toLowerCase();
      return {
        isResidential: d.hosting !== true,
        networkClass: d.mobile ? "mobile" : (comb.includes("university") || comb.includes(".edu") ? "education" : "residential"),
        isp: d.isp || "",
        asn: d.as || "",
        countryCode: d.countryCode || "",
      };
    }
  } catch {}
  return null;
}

async function probeGatewayEgress(timeoutMs = 6000) {
  const started = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const dispatcher = new ProxyAgent({ uri: GATEWAY, connect: { timeout: 2500 } });
    const r = await undiciFetch("https://api.ipify.org?format=json", { signal: ctrl.signal, dispatcher });
    const d = await r.json();
    const ip = d?.ip || null;
    if (!ip) return null;
    const meta = await lookupIpMeta(ip);
    return {
      ip,
      latencyMs: Date.now() - started,
      isResidential: meta ? meta.isResidential : true,
      networkClass: meta?.networkClass || "residential",
      countryCode: meta?.countryCode || null,
      isp: meta?.isp || null,
      asn: meta?.asn || null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export async function GET() {
  const started = Date.now();
  try {
    const [gw, egress, conns] = await Promise.all([
      fetchGatewayStatus(3500),
      probeGatewayEgress(6000),
      getProviderConnections().catch(() => []),
    ]);

    const directConnections = conns.filter((c) => {
      if (c.isActive === false) return false;
      const psd = c.providerSpecificData || {};
      const url = String(psd.connectionProxyUrl || "");
      return psd.connectionProxyEnabled === true && url.includes("127.0.0.1:20188");
    }).length;

    const liveNodes = (gw?.nodes || []).filter((n) => n.alive && !n.datacenterBlocked);

    return NextResponse.json({
      success: true,
      module: "Residential Fresh Proxy",
      directConnections,
      gateway: {
        listening: Boolean(gw?.listening),
        engine: gw?.engine || null,
        upstreams: gw?.upstreams ?? liveNodes.length,
        alive: gw?.alive ?? liveNodes.length,
        quarantined: gw?.quarantined ?? 0,
        hedgeWins: gw?.hedgeWins ?? 0,
        nodes: liveNodes,
      },
      currentEgress: egress || {
        ip: gw?.sampleEgress?.ip || null,
        isResidential: gw?.sampleEgress?.isResidential ?? null,
        networkClass: gw?.sampleEgress?.networkClass || null,
        isp: gw?.sampleEgress?.isp || null,
        asn: gw?.sampleEgress?.asn || null,
        countryCode: gw?.sampleEgress?.countryCode || null,
      },
      responseMs: Date.now() - started,
    });
  } catch (error) {
    console.error("[residential-fresh GET]", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Failed to load residential status" },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  let body = {};
  try { body = await request.json(); } catch {}
  const action = String(body.action || "").toLowerCase();

  if (action === "refresh" || action === "scan-sources") {
    try {
      const { stdout } = await run("/usr/bin/python3", [REFRESH_PY], { timeout: 120000 });
      let stats = {};
      for (const line of stdout.trim().split(/\r?\n/).reverse()) {
        try {
          const p = JSON.parse(line);
          if (p && "verifiedResidential" in p) {
            stats = p;
            break;
          }
        } catch {}
      }
      return NextResponse.json({
        success: true,
        action,
        message: `Verified ${stats.verifiedResidential ?? 0} residential IP(s) · healed ${stats.healedDirectConnections ?? 0} direct provider connection(s) (0 group pools).`,
      });
    } catch (e) {
      return NextResponse.json({ success: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 });
    }
  }

  if (action === "restart") {
    try {
      await run("sudo", ["systemctl", "restart", "residential-engine.service"], { timeout: 20000 });
      await new Promise((r) => setTimeout(r, 2500));
      const gw = await fetchGatewayStatus(2500);
      return NextResponse.json({
        success: true,
        action,
        message: `Gateway restarted (${gw?.alive ?? 0} alive residential upstreams).`,
      });
    } catch (e) {
      return NextResponse.json({ success: false, error: String(e?.message || e).slice(0, 200) }, { status: 500 });
    }
  }

  if (action === "probe") {
    const egress = await probeGatewayEgress(7000);
    return NextResponse.json({
      success: Boolean(egress?.ip),
      egressIp: egress?.ip || null,
      isResidential: egress?.isResidential ?? null,
      networkClass: egress?.networkClass || null,
      isp: egress?.isp || null,
      asn: egress?.asn || null,
      countryCode: egress?.countryCode || null,
      latencyMs: egress?.latencyMs || 0,
      message: egress?.ip
        ? `Verified ${egress.ip} (${egress.countryCode || "?"} · ${egress.isp || "ISP"}) in ${egress.latencyMs}ms`
        : "Probe timed out or no residential upstream available",
    });
  }

  return NextResponse.json(
    { success: false, error: "Unknown action. Use: refresh | restart | probe" },
    { status: 400 }
  );
}
