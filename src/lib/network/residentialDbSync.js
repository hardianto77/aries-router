import fs from "node:fs";
import { getProxyPools, createProxyPool, updateProxyPool, deleteProxyPools, getProviderConnections } from "@/models";
import { getSettings, updateSettings } from "@/lib/localDb";
import {
  globalResidentialPool,
  sanitizeResidentialConfig,
  maskProxyUrl,
} from "./residentialProxyEngine.js";

export const RESIDENTIAL_GATEWAY_ID = "residential-auto-hedge";
export const VPS_RESIDENTIAL_SOURCE_FILES = [
  "/home/ubuntu/resi-tested-alive.txt",
  "/home/ubuntu/live_residential_proxies.txt",
  "/home/ubuntu/residential_proxy_mafia.txt",
];

export function isManagedResidentialRecord(pool) {
  if (!pool) return false;
  if (pool.id === RESIDENTIAL_GATEWAY_ID) return true;
  if (pool.type === "residential") return true;
  if (pool.ipType === "residential" || pool.ipType === "datacenter") return true;
  return false;
}

export async function loadSyncedResidentialState() {
  const [settings, allPools, connections] = await Promise.all([
    getSettings().catch(() => ({})),
    getProxyPools().catch(() => []),
    getProviderConnections().catch(() => []),
  ]);

  const config = sanitizeResidentialConfig(settings?.residentialProxyConfig || {});
  globalResidentialPool.setConfig(config);

  const usageMap = new Map();
  const providerSummaryMap = new Map();

  for (const conn of connections) {
    const pid = conn?.providerSpecificData?.proxyPoolId;
    if (pid) usageMap.set(pid, (usageMap.get(pid) || 0) + 1);

    const prov = conn.provider;
    if (!providerSummaryMap.has(prov)) {
      providerSummaryMap.set(prov, {
        provider: prov,
        totalConnections: 0,
        activeConnections: 0,
        residentialBoundCount: 0,
      });
    }
    const entry = providerSummaryMap.get(prov);
    entry.totalConnections++;
    if (conn.isActive !== false) entry.activeConnections++;
  }

  const managedRecords = allPools.filter((p) => isManagedResidentialRecord(p) && p.id !== RESIDENTIAL_GATEWAY_ID);
  const resiIds = new Set(managedRecords.map((p) => p.id));
  resiIds.add(RESIDENTIAL_GATEWAY_ID);

  for (const conn of connections) {
    const pid = conn?.providerSpecificData?.proxyPoolId;
    if (pid && resiIds.has(pid)) {
      const entry = providerSummaryMap.get(conn.provider);
      if (entry) entry.residentialBoundCount++;
    }
  }

  globalResidentialPool.syncNodes(managedRecords);
  const metrics = globalResidentialPool.getMetrics(usageMap);

  const gatewayPool = allPools.find((p) => p.id === RESIDENTIAL_GATEWAY_ID) || null;
  const providers = Array.from(providerSummaryMap.values())
    .filter((p) => p.activeConnections > 0)
    .sort((a, b) => b.activeConnections - a.activeConnections || a.provider.localeCompare(b.provider));

  return {
    config,
    metrics,
    nodes: metrics.nodes,
    gatewayPool: gatewayPool
      ? {
          id: gatewayPool.id,
          name: gatewayPool.name,
          isActive: gatewayPool.isActive,
          boundConnectionCount: usageMap.get(gatewayPool.id) || 0,
        }
      : null,
    providers,
  };
}

export async function persistResidentialProbeResult(probeResult, existingPool = null, config = null) {
  const cfg = config || globalResidentialPool.config;
  const now = new Date().toISOString();
  const hostLabel = (() => {
    try {
      const u = new URL(probeResult.proxyUrl);
      return `${u.hostname}:${u.port || 8080}`;
    } catch {
      return maskProxyUrl(probeResult.proxyUrl);
    }
  })();

  const isResi = probeResult.ok && probeResult.isResidential === true;
  const isDc = probeResult.ok && probeResult.ipType === "datacenter";
  const shouldActivate = probeResult.ok && (cfg.strictResidentialOnly ? isResi : !isDc);
  const geoTag = probeResult.countryCode && probeResult.countryCode !== "UN" ? `-${probeResult.countryCode}` : "";
  const defaultName = isResi
    ? `Resi${geoTag} ${probeResult.isp || hostLabel}`.slice(0, 64)
    : isDc
      ? `Blocked-DC${geoTag} ${hostLabel}`.slice(0, 64)
      : `Resi-Node ${hostLabel}`.slice(0, 64);

  const payload = {
    name: existingPool?.name || defaultName,
    proxyUrl: probeResult.proxyUrl,
    noProxy: existingPool?.noProxy || "127.0.0.1,localhost,",
    type: "residential",
    isActive: shouldActivate,
    strictProxy: true,
    testStatus: !probeResult.ok ? "error" : isDc ? "datacenter_blocked" : isResi ? "active" : "unverified",
    lastTestedAt: now,
    lastError: !probeResult.ok
      ? probeResult.error || "Probe failed"
      : isDc
        ? probeResult.reason || "Blocked datacenter ASN"
        : null,
    egressIp: probeResult.egressIp || existingPool?.egressIp || null,
    lastTestIp: probeResult.egressIp || existingPool?.lastTestIp || null,
    country: probeResult.country || existingPool?.country || null,
    countryCode: probeResult.countryCode || existingPool?.countryCode || null,
    city: probeResult.city || existingPool?.city || null,
    isp: probeResult.isp || existingPool?.isp || null,
    org: probeResult.org || existingPool?.org || null,
    asn: probeResult.asn || existingPool?.asn || null,
    ipType: probeResult.ipType || "unverified",
    isResidential: isResi,
    latencyMs: probeResult.latencyMs || existingPool?.latencyMs || null,
    healthScore: shouldActivate ? 100 : isDc ? 10 : 20,
  };

  if (existingPool) {
    return await updateProxyPool(existingPool.id, payload);
  }
  return await createProxyPool(payload);
}

export async function ensureResidentialGatewayPool(activeNodeCount = 0) {
  const existing = (await getProxyPools()).find((p) => p.id === RESIDENTIAL_GATEWAY_ID);
  const now = new Date().toISOString();
  const data = {
    id: RESIDENTIAL_GATEWAY_ID,
    name: "Fresh Residential Auto-Hedge Gateway",
    proxyUrl: "residential://auto",
    noProxy: "127.0.0.1,localhost,",
    type: "residential",
    isActive: activeNodeCount > 0,
    strictProxy: true,
    testStatus: activeNodeCount > 0 ? "active" : "disabled",
    lastTestedAt: now,
    lastError: activeNodeCount > 0 ? null : "No verified residential nodes online",
    isResidential: true,
    ipType: "residential",
  };
  if (existing) {
    return await updateProxyPool(RESIDENTIAL_GATEWAY_ID, data);
  }
  return await createProxyPool(data);
}

export function collectVpsCandidateUrls(limit = 60) {
  const candidates = [];
  const seen = new Set();
  for (const filePath of VPS_RESIDENTIAL_SOURCE_FILES) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const token = line.trim().split(/\s+/)[0];
        if (!token || token.startsWith("#")) continue;
        if (!/^(https?|socks5):\/\//i.test(token)) continue;
        if (!seen.has(token)) {
          seen.add(token);
          candidates.push(token);
          if (candidates.length >= limit) return candidates;
        }
      }
    } catch {}
  }
  return candidates;
}

export async function runWithConcurrency(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const current = idx++;
      results[current] = await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export async function saveResidentialConfig(input = {}) {
  const sanitized = sanitizeResidentialConfig(input);
  await updateSettings({ residentialProxyConfig: sanitized });
  globalResidentialPool.setConfig(sanitized);
  return sanitized;
}

export { deleteProxyPools };
