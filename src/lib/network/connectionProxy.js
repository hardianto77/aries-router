import { getProxyPoolById } from "@/models";
import { globalResidentialPool, isProxyUrlDead } from "./residentialProxyEngine.js";

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function isForbiddenNonResidential(proxyUrl) {
  const s = normalizeString(proxyUrl);
  if (!s) return false;
  if (s.startsWith("residential://")) return false;
  return (
    s.includes("127.0.0.1:8118") ||
    s.includes("127.0.0.1:40000") ||
    s.includes("4.144.146.21") ||
    s.includes("34.43.46.91") ||
    s.includes("103.237.102.191") ||
    s.includes("floppydata.com") ||
    s.includes("stealthtunnel.net") ||
    s.includes("pvdata.host")
  );
}

function pickHealthyResidentialFallback(noProxy = "127.0.0.1,localhost,") {
  try {
    globalResidentialPool.hydrateFromPoolFileIfNeeded?.();
    const candidates = globalResidentialPool.selectCandidates(1);
    if (candidates.length > 0 && candidates[0]?.url) {
      return {
        source: "residential-auto-heal",
        proxyPoolId: null,
        proxyPool: null,
        connectionProxyEnabled: true,
        connectionProxyUrl: candidates[0].url,
        connectionNoProxy: noProxy || "127.0.0.1,localhost,",
        strictProxy: false,
      };
    }
  } catch {}
  return {
    source: "legacy",
    proxyPoolId: null,
    proxyPool: null,
    connectionProxyEnabled: true,
    connectionProxyUrl: process.env.RESI_GATEWAY_URL || "http://127.0.0.1:20188",
    connectionNoProxy: noProxy || "127.0.0.1,localhost,",
    strictProxy: false,
  };
}

const rotateState = new Map();
const quarantinedProxies = new Map();

export function quarantineProxy(poolId, ttlMs = 15 * 60 * 1000) {
  if (!poolId) return;
  quarantinedProxies.set(poolId, Date.now() + ttlMs);
}

export function isProxyQuarantined(poolId) {
  if (!poolId) return false;
  const expiresAt = quarantinedProxies.get(poolId);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    quarantinedProxies.delete(poolId);
    return false;
  }
  return true;
}

export function pickProxyPoolId(poolIds, strategy, providerId) {
  if (!poolIds || poolIds.length === 0) return null;

  const eligible = poolIds.filter((id) => !isProxyQuarantined(id));
  const activeList = eligible.length > 0 ? eligible : poolIds;

  if (activeList.length === 1) return activeList[0];

  if (strategy === "round-robin") {
    const state = rotateState.get(providerId) || { index: -1 };
    state.index = (state.index + 1) % activeList.length;
    rotateState.set(providerId, state);
    return activeList[state.index];
  }

  if (strategy === "random") {
    return activeList[Math.floor(Math.random() * activeList.length)];
  }

  return activeList[0];
}

function normalizeLegacyProxy(providerSpecificData = {}) {
  const connectionProxyEnabled =
    providerSpecificData?.connectionProxyEnabled === true ||
    providerSpecificData?.connectionProxyEnabled === 1;

  const connectionProxyUrl = normalizeString(
    providerSpecificData?.connectionProxyUrl
  );

  const connectionNoProxy = normalizeString(
    providerSpecificData?.connectionNoProxy
  );

  return {
    connectionProxyEnabled,
    connectionProxyUrl,
    connectionNoProxy,
  };
}

export async function resolveConnectionProxyConfig(
  providerSpecificData = {}
) {
  try {
    const proxyPoolIdRaw = normalizeString(
      providerSpecificData?.proxyPoolId || providerSpecificData?.connectionProxyPoolId
    );

    const proxyPoolId =
      proxyPoolIdRaw === "__none__" ? "" : proxyPoolIdRaw;

    const legacy = normalizeLegacyProxy(providerSpecificData);

    if (proxyPoolId) {
      const proxyPool = await getProxyPoolById(proxyPoolId);
      const proxyUrl = normalizeString(proxyPool?.proxyUrl);
      const noProxy = normalizeString(proxyPool?.noProxy);

      let effectiveProxyUrl = proxyUrl;
      if (/-sid-\d+/i.test(proxyUrl)) {
        const randSid = Math.floor(100000000 + Math.random() * 900000000);
        effectiveProxyUrl = proxyUrl.replace(/-sid-\d+/i, `-sid-${randSid}`);
      }

      const poolDeadOrBlocked =
        !proxyPool ||
        proxyPool.isActive !== true ||
        !effectiveProxyUrl ||
        isProxyQuarantined(proxyPoolId) ||
        isProxyUrlDead(effectiveProxyUrl) ||
        ["disabled", "retired", "error", "datacenter_blocked"].includes(proxyPool.testStatus) ||
        isForbiddenNonResidential(effectiveProxyUrl);

      if (poolDeadOrBlocked) {
        return pickHealthyResidentialFallback(noProxy || legacy.connectionNoProxy);
      }

      if (proxyPool.type === "residential" || effectiveProxyUrl.startsWith("residential://")) {
        return {
          source: "residential",
          proxyPoolId,
          proxyPool,
          type: "residential",
          connectionProxyEnabled: true,
          connectionProxyUrl: effectiveProxyUrl,
          connectionNoProxy: noProxy,
          strictProxy: proxyPool.strictProxy === true,
        };
      }
      if (proxyPool.type === "vercel" || proxyPool.type === "cloudflare" || proxyPool.type === "deno" || proxyPool.type === "netlify") {
        return {
          source: proxyPool.type,
          proxyPoolId,
          proxyPool,
          connectionProxyEnabled: false,
          connectionProxyUrl: "",
          connectionNoProxy: noProxy,
          strictProxy: proxyPool.strictProxy === true,
          vercelRelayUrl: effectiveProxyUrl,
        };
      }

      return {
        source: "pool",
        proxyPoolId,
        proxyPool,
        connectionProxyEnabled: true,
        connectionProxyUrl: effectiveProxyUrl,
        connectionNoProxy: noProxy,
        strictProxy: proxyPool.strictProxy === true,
      };
    }

    if (legacy.connectionProxyEnabled && legacy.connectionProxyUrl) {
      if (
        isForbiddenNonResidential(legacy.connectionProxyUrl) ||
        legacy.connectionProxyUrl.startsWith("residential://") ||
        isProxyUrlDead(legacy.connectionProxyUrl)
      ) {
        return pickHealthyResidentialFallback(legacy.connectionNoProxy);
      }
      return {
        source: "legacy",
        proxyPoolId: proxyPoolId || null,
        proxyPool: null,
        ...legacy,
      };
    }

    return {
      source: "none",
      proxyPoolId: proxyPoolId || null,
      proxyPool: null,
      ...legacy,
    };
  } catch (error) {
    console.error(
      "[resolveConnectionProxyConfig] Failed to resolve proxy config:",
      error
    );

    return {
      source: "error",
      proxyPoolId: null,
      proxyPool: null,
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",
      strictProxy: false,
    };
  }
}
