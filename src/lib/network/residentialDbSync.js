import fs from "node:fs";
import { fetch as undiciFetch } from "undici";
import {
  getProxyPools,
  createProxyPool,
  updateProxyPool,
  deleteProxyPools,
  getProviderConnections,
  updateProviderConnection,
} from "@/models";
import { getSettings, updateSettings } from "@/lib/localDb";
import {
  globalResidentialPool,
  sanitizeResidentialConfig,
  maskProxyUrl,
  normalizeProxyInput,
  isForbiddenNonResidentialUrl,
  PURE_RESIDENTIAL_STATUS_URL,
  PURE_RESIDENTIAL_GATEWAY_URL,
} from "./residentialProxyEngine.js";

export const RESIDENTIAL_GATEWAY_ID = "residential-auto-hedge";
export const RESI_ROTATING_POOL_ID = "8564ef81-7101-4e86-af4b-cd436fa5d50f";

export const VPS_RESIDENTIAL_SOURCE_FILES = [
  "/home/ubuntu/live_floppy_fresh.txt",
  "/home/ubuntu/active_floppy_verified.txt",
  "/home/ubuntu/floppy_alive_100.txt",
  "/home/ubuntu/resi-fresh-alive.txt",
  "/home/ubuntu/resi-tested-alive.txt",
  "/home/ubuntu/live_residential_proxies.txt",
  "/home/ubuntu/residential_proxy_mafia.txt",
  "/home/ubuntu/clean_residential.txt",
];

export function isManagedResidentialRecord(pool) {
  if (!pool) return false;
  if (pool.id === RESIDENTIAL_GATEWAY_ID || pool.id === RESI_ROTATING_POOL_ID) return true;
  if (pool.type === "residential") return true;
  if (pool.ipType === "residential" || pool.ipType === "datacenter") return true;
  return false;
}

export async function fetchGatewayStatus(timeoutMs = 2500) {
  try {
    const res = await undiciFetch(PURE_RESIDENTIAL_STATUS_URL, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function reloadGatewayUpstreams() {
  try {
    const reloadUrl = PURE_RESIDENTIAL_STATUS_URL.replace(/\/status$/, "/reload");
    const res = await undiciFetch(reloadUrl, {
      method: "POST",
      body: "{}",
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function deduplicateResidentialPools() {
  const allPools = await getProxyPools().catch(() => []);
  const seen = new Map();
  const duplicateIds = [];
  for (const p of allPools) {
    if (p.id === RESIDENTIAL_GATEWAY_ID || p.id === RESI_ROTATING_POOL_ID) continue;
    const u = String(p.proxyUrl || "").trim();
    if (!u) continue;
    if (seen.has(u)) {
      duplicateIds.push(p.id);
    } else {
      seen.set(u, p.id);
    }
  }
  if (duplicateIds.length > 0) {
    await deleteProxyPools(duplicateIds);
  }
  return duplicateIds.length;
}

export async function loadSyncedResidentialState() {
  const [settings, allPools, connections, gatewayStatus] = await Promise.all([
    getSettings().catch(() => ({})),
    getProxyPools().catch(() => []),
    getProviderConnections().catch(() => []),
    fetchGatewayStatus(2200),
  ]);

  const config = sanitizeResidentialConfig(settings?.residentialProxyConfig || {});
  globalResidentialPool.setConfig(config);

  const usageMap = new Map();
  const providerSummaryMap = new Map();

  for (const conn of connections) {
    const psd = conn?.providerSpecificData || {};
    const pid = psd.proxyPoolId;
    if (pid) usageMap.set(pid, (usageMap.get(pid) || 0) + 1);

    const prov = conn.provider;
    if (!providerSummaryMap.has(prov)) {
      providerSummaryMap.set(prov, {
        provider: prov,
        totalConnections: 0,
        activeConnections: 0,
        residentialBoundCount: 0,
        directCount: 0,
        nonResidentialOrDeadCount: 0,
      });
    }
    const entry = providerSummaryMap.get(prov);
    entry.totalConnections++;
    if (conn.isActive !== false) entry.activeConnections++;
  }

  const poolById = new Map(allPools.map((p) => [p.id, p]));
  const managedRecords = allPools.filter(
    (p) =>
      isManagedResidentialRecord(p) &&
      p.id !== RESIDENTIAL_GATEWAY_ID &&
      p.id !== RESI_ROTATING_POOL_ID &&
      !String(p.proxyUrl || "").includes("127.0.0.1:20188") &&
      !String(p.proxyUrl || "").startsWith("residential://")
  );
  const resiIds = new Set(
    managedRecords.filter((p) => p.isActive === true && p.isResidential === true && p.ipType === "residential").map((p) => p.id)
  );
  resiIds.add(RESIDENTIAL_GATEWAY_ID);
  resiIds.add(RESI_ROTATING_POOL_ID);

  for (const conn of connections) {
    if (conn.isActive === false) continue;
    const psd = conn?.providerSpecificData || {};
    const pid = psd.proxyPoolId;
    const curl = String(psd.connectionProxyUrl || "");
    const entry = providerSummaryMap.get(conn.provider);
    if (!entry) continue;

    const pool = pid ? poolById.get(pid) : null;
    const isResiPool = pid && resiIds.has(pid);
    const isResiUrl = curl === "residential://auto" || curl.includes("127.0.0.1:20188");
    const isProxied = psd.connectionProxyEnabled === true || Boolean(pid);

    if (!isProxied) {
      entry.directCount++;
    } else if (isResiPool || isResiUrl) {
      entry.residentialBoundCount++;
    } else if (
      isForbiddenNonResidentialUrl(curl) ||
      !pool ||
      pool.isActive === false ||
      pool.testStatus === "error" ||
      pool.testStatus === "datacenter_blocked" ||
      pool.testStatus === "retired"
    ) {
      entry.nonResidentialOrDeadCount++;
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
    gateway: gatewayStatus
      ? {
          ...gatewayStatus,
          gatewayUrl: PURE_RESIDENTIAL_GATEWAY_URL,
        }
      : {
          listening: false,
          engine: "Aries Pure-Residential Fresh Gateway v4.2",
          gatewayUrl: PURE_RESIDENTIAL_GATEWAY_URL,
          upstreams: 0,
          alive: 0,
          quarantined: 0,
          datacenterBlocked: 0,
          nodes: [],
        },
    gatewayPool: gatewayPool
      ? {
          id: gatewayPool.id,
          name: gatewayPool.name,
          isActive: gatewayPool.isActive,
          boundConnectionCount:
            (usageMap.get(gatewayPool.id) || 0) + (usageMap.get(RESI_ROTATING_POOL_ID) || 0),
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
  const isDc =
    isForbiddenNonResidentialUrl(probeResult.proxyUrl) ||
    (probeResult.ok && probeResult.ipType === "datacenter");
  const shouldActivate = probeResult.ok && !isDc && (cfg.strictResidentialOnly ? isResi : true);
  const geoTag = probeResult.countryCode && probeResult.countryCode !== "UN" ? `-${probeResult.countryCode}` : "";
  const defaultName = isResi
    ? `Resi${geoTag} ${probeResult.isp || hostLabel}`.slice(0, 64)
    : isDc
      ? `Blocked-DC${geoTag} ${hostLabel}`.slice(0, 64)
      : `Resi-Node ${hostLabel}`.slice(0, 64);

  const payload = {
    name: existingPool?.name && !String(existingPool.name).startsWith("Blocked-DC") ? existingPool.name : defaultName,
    proxyUrl: probeResult.proxyUrl,
    noProxy: existingPool?.noProxy || "127.0.0.1,localhost,",
    type: "residential",
    isActive: shouldActivate,
    strictProxy: true,
    testStatus: isDc ? "datacenter_blocked" : !probeResult.ok ? "error" : isResi ? "active" : "unverified",
    lastTestedAt: now,
    lastError: isDc
      ? probeResult.reason || "Blocked datacenter/WARP ASN"
      : !probeResult.ok
        ? probeResult.error || "Probe failed"
        : null,
    egressIp: probeResult.egressIp || existingPool?.egressIp || null,
    lastTestIp: probeResult.egressIp || existingPool?.lastTestIp || null,
    country: probeResult.country || existingPool?.country || null,
    countryCode: probeResult.countryCode || existingPool?.countryCode || null,
    city: probeResult.city || existingPool?.city || null,
    isp: probeResult.isp || existingPool?.isp || null,
    org: probeResult.org || existingPool?.org || null,
    asn: probeResult.asn || existingPool?.asn || null,
    networkClass: isDc ? "datacenter" : probeResult.networkClass || existingPool?.networkClass || "unverified",
    ipType: isDc ? "datacenter" : probeResult.ipType || "unverified",
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
  const gwStatus = await fetchGatewayStatus(1500);
  const gwAlive = gwStatus?.alive || 0;
  const totalHealthy = Math.max(activeNodeCount, gwAlive);
  const existing = (await getProxyPools()).find((p) => p.id === RESIDENTIAL_GATEWAY_ID);
  const now = new Date().toISOString();
  const data = {
    id: RESIDENTIAL_GATEWAY_ID,
    name: "Fresh Residential Auto-Hedge Gateway",
    proxyUrl: "residential://auto",
    noProxy: "127.0.0.1,localhost,",
    type: "residential",
    isActive: totalHealthy > 0,
    strictProxy: true,
    testStatus: totalHealthy > 0 ? "active" : "disabled",
    lastTestedAt: now,
    lastError: totalHealthy > 0 ? null : "No verified residential nodes online",
    isResidential: true,
    ipType: "residential",
  };
  if (existing) {
    return await updateProxyPool(RESIDENTIAL_GATEWAY_ID, data);
  }
  return await createProxyPool(data);
}

export async function healDeadAndNonResidentialConnections({ provider = null, resetProxyErrors = true } = {}) {
  const [allPools, connections, gwStatus] = await Promise.all([
    getProxyPools(),
    getProviderConnections(),
    fetchGatewayStatus(1500),
  ]);

  const poolById = new Map(allPools.map((p) => [p.id, p]));
  const healthyResiNodes = allPools.filter(
    (p) =>
      p.isActive === true &&
      p.isResidential === true &&
      p.ipType === "residential" &&
      p.id !== RESIDENTIAL_GATEWAY_ID &&
      !isForbiddenNonResidentialUrl(p.proxyUrl)
  );

  if (healthyResiNodes.length === 0 && !(gwStatus?.alive > 0)) {
    throw new Error("No verified Fresh Residential nodes online to inject.");
  }

  await ensureResidentialGatewayPool(healthyResiNodes.length);

  let healedCount = 0;
  let checkedCount = 0;
  for (const conn of connections) {
    if (conn.isActive === false) continue;
    if (provider && conn.provider !== provider) continue;

    const psd = conn.providerSpecificData || {};
    if (psd.connectionProxyEnabled !== true && !psd.proxyPoolId) continue;

    checkedCount++;
    const pid = psd.proxyPoolId;
    const curl = String(psd.connectionProxyUrl || "");
    const pool = pid ? poolById.get(pid) : null;

    const isBadPool =
      (pid && !pool) ||
      (pool && (pool.isActive === false || pool.testStatus === "error" || pool.testStatus === "datacenter_blocked" || pool.testStatus === "retired")) ||
      (pool && pool.id !== RESIDENTIAL_GATEWAY_ID && pool.id !== RESI_ROTATING_POOL_ID && isForbiddenNonResidentialUrl(pool.proxyUrl));
    const isBadUrl = isForbiddenNonResidentialUrl(curl) && curl !== "residential://auto" && !curl.includes("127.0.0.1:20188");
    const hasTransportErr = typeof conn.lastError === "string" && /502|504|524|407|proxy|timeout|tunnel|ECONNREFUSED|ETIMEDOUT/i.test(conn.lastError);

    if (isBadPool || isBadUrl || (resetProxyErrors && hasTransportErr)) {
      const patch = {
        providerSpecificData: {
          ...psd,
          proxyPoolId: RESIDENTIAL_GATEWAY_ID,
          connectionProxyEnabled: true,
          connectionProxyUrl: "residential://auto",
          connectionNoProxy: psd.connectionNoProxy || "127.0.0.1,localhost,",
        },
      };
      if (resetProxyErrors && hasTransportErr) {
        patch.testStatus = "active";
        patch.lastError = null;
      }
      await updateProviderConnection(conn.id, patch);
      healedCount++;
    }
  }

  globalResidentialPool.recordEvent(
    "auto_heal",
    `Checked ${checkedCount} proxied connections; injected pure-residential egress into ${healedCount} dead/non-residential connection(s).`
  );

  return { checkedCount, healedCount };
}

export function collectVpsCandidateUrls(limit = 200) {
  const candidates = [];
  const seen = new Set();
  for (const filePath of VPS_RESIDENTIAL_SOURCE_FILES) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const token = line.trim().split(/\s+/)[0];
        if (!token || token.startsWith("#")) continue;
        let normalized = null;
        try {
          normalized = normalizeProxyInput(token);
        } catch {
          continue;
        }
        if (!normalized || isForbiddenNonResidentialUrl(normalized)) continue;
        if (!seen.has(normalized)) {
          seen.add(normalized);
          candidates.push(normalized);
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
