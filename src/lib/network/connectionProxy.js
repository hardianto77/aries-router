import { getProxyPoolById } from "@/models";

// Safely normalize any value into a trimmed string.
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
    s.includes("103.237.102.191")
  );
}

// Proxy pool rotation state (in-memory)
const rotateState = new Map(); // providerId -> { index }

// In-memory quarantine for proxies failing upstream checks
const quarantinedProxies = new Map(); // poolId -> unquarantineTimestamp

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

/**
 * Pick one proxy pool ID from a list based on strategy.
 * Automatically filters out quarantined proxies!
 */
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

/**
 * Normalize legacy proxy configuration.
 */
function normalizeLegacyProxy(providerSpecificData = {}) {
  const connectionProxyEnabled =
    providerSpecificData?.connectionProxyEnabled === true;

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

/**
 * Resolve final proxy configuration.
 *
 * Priority:
 * 1. Proxy Pool (auto-heals dead/quarantined/WARP/datacenter pools into Fresh Residential)
 * 2. Legacy Proxy (auto-heals WARP/datacenter URLs into Fresh Residential)
 * 3. No Proxy
 */
export async function resolveConnectionProxyConfig(
  providerSpecificData = {}
) {
  try {
    const proxyPoolIdRaw = normalizeString(
      providerSpecificData?.proxyPoolId || providerSpecificData?.connectionProxyPoolId
    );

    // "__none__" means explicitly disabled
    const proxyPoolId =
      proxyPoolIdRaw === "__none__" ? "" : proxyPoolIdRaw;

    const legacy = normalizeLegacyProxy(providerSpecificData);

    /**
     * -----------------------------
     * Proxy Pool Resolution
     * -----------------------------
     */
    if (proxyPoolId) {
      const proxyPool = await getProxyPoolById(proxyPoolId);
      const proxyUrl = normalizeString(proxyPool?.proxyUrl);
      const noProxy = normalizeString(proxyPool?.noProxy);

      // Rotating residential proxies (e.g. res-*-sid-XXXXX)
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
        proxyPool.testStatus === "datacenter_blocked" ||
        proxyPool.testStatus === "error" ||
        isForbiddenNonResidential(effectiveProxyUrl);

      if (poolDeadOrBlocked) {
        // Dead, quarantined, WARP, or datacenter pool -> auto-inject Fresh Residential gateway
        return {
          source: "legacy",
          proxyPoolId: null,
          proxyPool: null,
          connectionProxyEnabled: true,
          connectionProxyUrl: process.env.RESI_GATEWAY_URL || "http://127.0.0.1:20188",
          connectionNoProxy: noProxy || legacy.connectionNoProxy || "127.0.0.1,localhost,",
          strictProxy: true,
        };
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

    /**
     * -----------------------------
     * Legacy Proxy Fallback
     * -----------------------------
     */
    if (legacy.connectionProxyEnabled && legacy.connectionProxyUrl) {
      if (isForbiddenNonResidential(legacy.connectionProxyUrl) || legacy.connectionProxyUrl.startsWith("residential://")) {
        return {
          source: "legacy",
          proxyPoolId: null,
          proxyPool: null,
          connectionProxyEnabled: true,
          connectionProxyUrl: process.env.RESI_GATEWAY_URL || "http://127.0.0.1:20188",
          connectionNoProxy: legacy.connectionNoProxy || "127.0.0.1,localhost,",
          strictProxy: true,
        };
      }
      return {
        source: "legacy",
        proxyPoolId: proxyPoolId || null,
        proxyPool: null,
        ...legacy,
      };
    }

    /**
     * -----------------------------
     * No Proxy Config
     * -----------------------------
     */
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
