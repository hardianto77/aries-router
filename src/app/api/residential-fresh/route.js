import fs from "node:fs";
import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { getProviderConnections, getProxyPools, updateProviderConnection, updateProxyPool, deleteProxyPools } from "@/models";
import { pruneAndVerifyHarvestedPools, syncHarvestedToResidentialFiles, distributeHarvestedFairlyToProviders } from "@/lib/network/pureResidentialHarvester.js";

const run = promisify(execFile);
export const dynamic = "force-dynamic";

const GATEWAY = process.env.RESI_GATEWAY_URL || "http://127.0.0.1:20188";
const STATUS_URL = process.env.RESI_GATEWAY_STATUS_URL || "http://127.0.0.1:20189/status";
const POOL_JSON = "/home/ubuntu/.aries-router/residential_fresh_pool.json";
const REFRESH_PY = "/opt/aries-router/scripts/refresh_fresh_residential.py";
const LOCAL_PROVIDERS = new Set(["local-device", "searxng", "edge-tts", "google-tts", "devin-cli", "opencode", "openai-compatible-chat-openhop", "openai-compatible-chat-kilo"]);
const TRANSPORT_ERR_RE = /429|rate.?limit|502|503|504|524|407|402|proxy|timeout|tunnel|fetch failed|ECONNREFUSED|ETIMEDOUT|ECONNRESET/i;

function maskProxyUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    const auth = u.username || u.password ? "***:***@" : "";
    return `${u.protocol}//${auth}${u.hostname}${u.port ? `:${u.port}` : ""}`;
  } catch {
    return String(rawUrl || "").replace(/\/\/[^@]+@/, "//***@");
  }
}

function readPoolFileMeta() {
  try {
    if (!fs.existsSync(POOL_JSON)) return null;
    const raw = JSON.parse(fs.readFileSync(POOL_JSON, "utf8"));
    const byUrl = new Map();
    for (const n of raw?.nodes || []) {
      if (n?.url) byUrl.set(n.url, n);
    }
    return { updatedAt: raw?.updatedAt || null, datacenterBlocked: raw?.datacenterBlocked || 0, nodes: raw?.nodes || [], byUrl };
  } catch {
    return null;
  }
}

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
      signal: AbortSignal.timeout(3000),
    });
    const d = await r.json();
    if (d?.status === "success") {
      const comb = `${d.isp || ""} ${d.org || ""}`.toLowerCase();
      return {
        isResidential: d.hosting !== true && d.proxy !== true,
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
  let dispatcher = null;
  try {
    dispatcher = new ProxyAgent({ uri: GATEWAY, connect: { timeout: 2500 } });
    const endpoints = [
      "https://httpbin.org/ip",
      "https://checkip.amazonaws.com",
      "https://icanhazip.com",
      "https://api.seeip.org/jsonip",
    ];
    let ip = null;
    for (const ep of endpoints) {
      try {
        const r = await undiciFetch(ep, { signal: ctrl.signal, dispatcher });
        if (!r.ok) continue;
        const txt = await r.text();
        const m = txt.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
        if (m) {
          ip = m[1];
          break;
        }
      } catch {}
    }
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
    try { await dispatcher?.close?.(); } catch {}
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

    const poolMeta = readPoolFileMeta();
    const poolByUrl = poolMeta?.byUrl || new Map();

    let directConnections = 0;
    let deadOrErroredConnections = 0;
    const uniqueUrls = new Set();
    const providerMap = new Map();

    for (const c of conns) {
      if (c.isActive === false || LOCAL_PROVIDERS.has(c.provider)) continue;
      const psd = c.providerSpecificData || {};
      const enabled = psd.connectionProxyEnabled === true || psd.connectionProxyEnabled === 1;
      const url = String(psd.connectionProxyUrl || "").trim();
      const pid = psd.proxyPoolId || null;
      const hasErr = typeof c.lastError === "string" && TRANSPORT_ERR_RE.test(c.lastError);

      if (enabled && !pid && url) {
        directConnections++;
        uniqueUrls.add(url);
      } else if (!enabled || !url) {
        deadOrErroredConnections++;
      }
      if (hasErr) {
        deadOrErroredConnections++;
      }

      if (!providerMap.has(c.provider)) {
        const nodeMeta = poolByUrl.get(url) || null;
        providerMap.set(c.provider, {
          provider: c.provider,
          activeConnections: 0,
          proxiedConnections: 0,
          maskedProxyUrl: url ? maskProxyUrl(url) : null,
          egressIp: nodeMeta?.egressIp || (url.includes("127.0.0.1:20188") ? (egress?.ip || gw?.sampleEgress?.ip || null) : null),
          countryCode: nodeMeta?.countryCode || null,
          isp: nodeMeta?.isp || (url.includes("127.0.0.1:20188") ? "Pure-Residential Hedge Gateway" : null),
          networkClass: nodeMeta?.networkClass || "residential",
          latencyMs: nodeMeta?.latencyMs || null,
          healthy: enabled && Boolean(url) && !hasErr,
        });
      }
      const pEntry = providerMap.get(c.provider);
      pEntry.activeConnections++;
      if (enabled && url) pEntry.proxiedConnections++;
      if (hasErr) pEntry.healthy = false;
    }

    const providerBindings = Array.from(providerMap.values()).sort(
      (a, b) => b.activeConnections - a.activeConnections || a.provider.localeCompare(b.provider)
    );
    const liveNodes = (gw?.nodes || []).filter((n) => n.alive && !n.datacenterBlocked);

    return NextResponse.json({
      success: true,
      module: "Proxy Resi Gateway",
      directConnections,
      uniqueEndpointsUsed: uniqueUrls.size,
      totalActiveProviders: providerBindings.length,
      coveredProviders: providerBindings.filter((p) => p.proxiedConnections > 0 && p.healthy).length,
      deadOrErroredConnections,
      lastPoolRefreshAt: poolMeta?.updatedAt || gw?.lastRefreshAt || null,
      providerBindings,
      gateway: {
        listening: Boolean(gw?.listening),
        engine: gw?.engine || null,
        upstreams: gw?.upstreams ?? liveNodes.length,
        alive: gw?.alive ?? liveNodes.length,
        quarantined: gw?.quarantined ?? 0,
        datacenterBlocked: Math.max(gw?.datacenterBlocked ?? 0, poolMeta?.datacenterBlocked ?? 0),
        deadEvicted: gw?.deadEvicted ?? 0,
        rateLimitBlocked: gw?.rateLimitBlocked ?? 0,
        hedgeWins: gw?.hedgeWins ?? 0,
        timeoutsPrevented: gw?.timeoutsPrevented ?? 0,
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
      const pruneStats = await pruneAndVerifyHarvestedPools({
        getProxyPools,
        updateProxyPool,
        deleteProxyPools,
        getProviderConnections,
        strictNoProxyFlag: true,
      });
      const currentPools = await getProxyPools();
      syncHarvestedToResidentialFiles(currentPools);
      const distStats = await distributeHarvestedFairlyToProviders({
        getProxyPools,
        getProviderConnections,
        updateProviderConnection,
      });
      if (pruneStats.kept < 3) {
        // Trigger fresh background Python harvest only if pool is critically low
        run("/usr/bin/python3", [REFRESH_PY], { timeout: 90000 }).catch(() => {});
      }
      const stats = {
        verifiedResidential: pruneStats.kept,
        datacenterBlocked: pruneStats.datacenterBlocked,
        perProviderUnique: distStats.distinctProxiesUsed,
        activeProviders: distStats.providersCovered,
        healedDirectConnections: distStats.updatedConnections || distStats.totalExternalConnections,
      };
      return NextResponse.json({
        success: true,
        action,
        stats,
        message: `Verified ${stats.verifiedResidential} pure-residential IP(s) via Proxy Harvest (blocked ${stats.datacenterBlocked} datacenter) · fairly bound ${distStats.totalExternalConnections} conns across ${stats.activeProviders} providers (0 group pools).`,
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
