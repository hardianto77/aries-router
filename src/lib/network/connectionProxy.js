import { getProxyPoolById } from "@/models";

// Safely normalize any value into a trimmed string.
function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

// ─── Proxy pool rotation state (in-memory) ─────────────────────────
const rotateState = new Map(); // providerId → { index }

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

  return activeList[0]; // "none" or unknown
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
 * 1. Proxy Pool
 * 2. Legacy Proxy
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

      // Rotating residential proxies (e.g. res-*-sid-XXXXX):
      // Each connection request randomizes the session ID so the proxy gateway
      // assigns a fresh residential exit IP with its own clean rate limit window.
      let effectiveProxyUrl = proxyUrl;
      if (/-sid-\d+/i.test(proxyUrl)) {
        const randSid = Math.floor(100000000 + Math.random() * 900000000);
        effectiveProxyUrl = proxyUrl.replace(/-sid-\d+/i, `-sid-${randSid}`);
      }

      const isValidPool =
        proxyPool &&
        proxyPool.isActive === true &&
        effectiveProxyUrl;

      if (isValidPool) {
        /**
         * Vercel/Cloudflare/Deno/Netlify relay proxies use base URL rewriting
         * instead of HTTP_PROXY environment variables.
         */
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

            vercelRelayUrl: effectiveProxyUrl, // Still mapped to vercelRelayUrl in the unified payload since they use the exact same header spec
          };
        }

        /**
         * Standard proxy pool
         */
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
    }

    /**
     * -----------------------------
     * Legacy Proxy Fallback
     * -----------------------------
     */
    if (
      legacy.connectionProxyEnabled &&
      legacy.connectionProxyUrl
    ) {
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
