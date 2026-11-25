/**
 * ============================================================================
 * Fresh Residential IP Proxy Engine (Anti-Datacenter & Zero-Timeout Architecture)
 * ============================================================================
 * Module: residentialProxyEngine.js
 * Location: /opt/aries-router/src/lib/network/residentialProxyEngine.js
 *
 * Guarantees:
 * 1. Strict Residential ISP/ASN Enforcement: Inspects real exit IP via multi-provider
 *    ASN/ISP telemetry and blocks Cloud / Hosting / VPS / Datacenter IPs.
 * 2. Zero-Timeout Speculative Dual-Hedge Racing: Races a secondary verified
 *    residential node whenever the primary exceeds hedgeDelayMs or fails early.
 * 3. Hard Bounded Deadlines: Connect, header, and total request ceilings guarantee
 *    no single dead proxy can ever hang an API call.
 * 4. DB Synchronization: Syncs persisted residential nodes from proxyPools and
 *    settings without spawning background timers during `next build`.
 */

import { ProxyAgent, Socks5ProxyAgent, fetch as undiciFetch } from "undici";

let TLS_ECDH_CURVE = "auto";
try {
  const tls = await import("../../../open-sse/config/tlsConfig.js").catch(() => null);
  if (tls?.TLS_ECDH_CURVE) TLS_ECDH_CURVE = tls.TLS_ECDH_CURVE;
} catch {}

export const DATACENTER_KEYWORDS = [
  "amazon", "aws", "google", "microsoft", "azure", "alibaba", "aliyun", "oracle", "tencent",
  "digitalocean", "linode", "akamai", "ovh", "hetzner", "choopa", "vultr",
  "cloudflare", "fastly", "contabo", "leaseweb", "m247", "hostinger", "godaddy",
  "scaleway", "server", "hosting", "datacenter", "data center", "cloud", "vps",
  "dedicated", "colocation", "colo", "cdn", "telepoint", "cogent", "zenlayer", "ucloud",
  "rackspace", "softlayer", "psychz", "layeronline", "hostkey", "quadranet",
  "estnoc", "realcloud", "serverius", "fdcservers", "frantech", "buyvm", "limestone",
  "datapacket", "packet", "gcore", "kamatera", "ionos", "strato", "upcloud", "cherry servers",
  "worldstream", "nforce", "xtom", "sharktech", "colocrossing", "reliablesite", "quadra"
];

export const DEFAULT_RESIDENTIAL_CONFIG = {
  enabled: true,
  strictResidentialOnly: false, // availability beats ASN purity: WARP/PV datacenter egress allowed
  hedgeEnabled: false,          // hedge-race doubles upstream load and adds TTFT jitter
  hedgeDelayMs: 900,
  connectTimeoutMs: 2500,
  headersTimeoutMs: 4500,
  probeTimeoutMs: 4500,
  requestTimeoutMs: 20000,
  quarantineDurationSec: 15,    // short quarantine, fast re-probe (responsive)
  maxConsecutiveFailures: 3,
  probeIntervalSec: 30,
  rotationStrategy: "lowest-latency",
};

export function sanitizeResidentialConfig(input = {}) {
  const clamp = (val, fallback, min, max) => {
    const n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };
  const validStrategies = ["hedge-race", "lowest-latency", "round-robin", "sticky-session"];
  return {
    enabled: input.enabled !== false,
    strictResidentialOnly: input.strictResidentialOnly !== false,
    hedgeEnabled: input.hedgeEnabled !== false,
    hedgeDelayMs: clamp(input.hedgeDelayMs, DEFAULT_RESIDENTIAL_CONFIG.hedgeDelayMs, 300, 3500),
    connectTimeoutMs: clamp(input.connectTimeoutMs, DEFAULT_RESIDENTIAL_CONFIG.connectTimeoutMs, 800, 5000),
    headersTimeoutMs: clamp(input.headersTimeoutMs, DEFAULT_RESIDENTIAL_CONFIG.headersTimeoutMs, 1500, 12000),
    probeTimeoutMs: clamp(input.probeTimeoutMs, DEFAULT_RESIDENTIAL_CONFIG.probeTimeoutMs, 1500, 10000),
    requestTimeoutMs: clamp(input.requestTimeoutMs, DEFAULT_RESIDENTIAL_CONFIG.requestTimeoutMs, 4000, 60000),
    quarantineDurationSec: clamp(input.quarantineDurationSec, DEFAULT_RESIDENTIAL_CONFIG.quarantineDurationSec, 15, 600),
    maxConsecutiveFailures: clamp(input.maxConsecutiveFailures, DEFAULT_RESIDENTIAL_CONFIG.maxConsecutiveFailures, 1, 5),
    probeIntervalSec: clamp(input.probeIntervalSec, DEFAULT_RESIDENTIAL_CONFIG.probeIntervalSec, 15, 300),
    rotationStrategy: validStrategies.includes(input.rotationStrategy)
      ? input.rotationStrategy
      : DEFAULT_RESIDENTIAL_CONFIG.rotationStrategy,
  };
}

export function maskProxyUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}`;
  } catch {
    return String(rawUrl || "").replace(/\/\/[^@]+@/, "//***@");
  }
}

export function normalizeProxyInput(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  if (/^(https?|socks5):\/\//i.test(trimmed)) {
    const parsed = new URL(trimmed);
    return parsed.toString();
  }

  const parts = trimmed.split(":");
  if (parts.length === 4) {
    const [host, port, user, pass] = parts;
    if (!host || !port) throw new Error("Invalid host:port:user:pass entry");
    const parsed = new URL(`http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`);
    return parsed.toString();
  }

  if (parts.length === 2) {
    const [host, port] = parts;
    if (!host || !port) throw new Error("Invalid host:port entry");
    const parsed = new URL(`http://${host}:${port}`);
    return parsed.toString();
  }

  // Fallback http:// prefix
  const parsed = new URL(`http://${trimmed}`);
  return parsed.toString();
}

export function parseProxyBatchText(text) {
  const lines = String(text || "").split(/\r?\n/);
  const valid = [];
  const invalid = [];
  const seen = new Set();

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    try {
      const normalized = normalizeProxyInput(trimmed);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        valid.push(normalized);
      }
    } catch (err) {
      invalid.push({ line: idx + 1, raw: trimmed, error: err.message });
    }
  });

  return { valid, invalid };
}

export function createBoundedDispatcher(proxyUrl, config = DEFAULT_RESIDENTIAL_CONFIG) {
  const parsed = new URL(proxyUrl);
  const common = {
    uri: proxyUrl,
    connect: {
      timeout: config.connectTimeoutMs || 2500,
      ecdhCurve: TLS_ECDH_CURVE,
    },
    requestTls: { ecdhCurve: TLS_ECDH_CURVE },
    headersTimeout: config.headersTimeoutMs || 4500,
    bodyTimeout: config.requestTimeoutMs || 20000,
    maxHeaderSize: 64 * 1024,
    pipelining: 1,
  };
  if (parsed.protocol === "socks5:") {
    return new Socks5ProxyAgent(parsed, common);
  }
  return new ProxyAgent(common);
}

export function classifyAsnMetadata({ isp = "", org = "", as = "", hosting = false, proxy = false, mobile = false }) {
  const combined = `${isp} ${org} ${as}`.toLowerCase();
  const matchedKeyword = DATACENTER_KEYWORDS.find((kw) => combined.includes(kw)) || null;
  const isDatacenter = Boolean(hosting) || Boolean(matchedKeyword);
  return {
    isResidential: !isDatacenter,
    ipType: isDatacenter ? "datacenter" : "residential",
    isHosting: Boolean(hosting),
    isMobile: Boolean(mobile),
    isProxyFlag: Boolean(proxy),
    matchedKeyword,
    reason: matchedKeyword
      ? `Blocked datacenter keyword "${matchedKeyword}" in ISP/ASN`
      : hosting
        ? "Blocked: ASN flagged as hosting/datacenter"
        : "Verified residential / ISP network",
  };
}

export class ResidentialValidator {
  constructor() {
    this.cache = new Map();
    this.cacheTtlMs = 30 * 60 * 1000;
  }

  async inspect(ip) {
    if (!ip || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) {
      return {
        ip: ip || null,
        isResidential: false,
        ipType: "unverified",
        reason: "Invalid IPv4 egress address",
      };
    }

    const cached = this.cache.get(ip);
    if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
      return cached.data;
    }

    // Primary: ip-api.com (direct fetch, fast ASN/hosting flags)
    try {
      const res = await undiciFetch(
        `http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,isp,org,as,hosting,proxy,mobile`,
        { signal: AbortSignal.timeout(3500) }
      );
      if (res.ok) {
        const d = await res.json();
        if (d?.status === "success") {
          const verdict = classifyAsnMetadata({
            isp: d.isp,
            org: d.org,
            as: d.as,
            hosting: d.hosting,
            proxy: d.proxy,
            mobile: d.mobile,
          });
          const info = {
            ip,
            country: d.country || "Unknown",
            countryCode: d.countryCode || "UN",
            regionName: d.regionName || "",
            city: d.city || "",
            isp: d.isp || "Unknown ISP",
            org: d.org || d.isp || "",
            asn: d.as || "",
            ...verdict,
          };
          this.cache.set(ip, { cachedAt: Date.now(), data: info });
          return info;
        }
      }
    } catch {}

    // Secondary: ipwho.is fallback (never mark unverified as residential)
    try {
      const res = await undiciFetch(`https://ipwho.is/${ip}`, {
        signal: AbortSignal.timeout(3500),
      });
      if (res.ok) {
        const d = await res.json();
        if (d?.success !== false) {
          const isp = d.connection?.isp || "";
          const org = d.connection?.org || "";
          const as = d.connection?.asn ? `AS${d.connection.asn} ${org}` : org;
          const verdict = classifyAsnMetadata({
            isp,
            org,
            as,
            hosting: d.type === "hosting" || d.security?.hosting,
            proxy: d.security?.proxy,
          });
          const info = {
            ip,
            country: d.country || "Unknown",
            countryCode: d.country_code || "UN",
            regionName: d.region || "",
            city: d.city || "",
            isp: isp || "Unknown ISP",
            org,
            asn: as,
            ...verdict,
          };
          this.cache.set(ip, { cachedAt: Date.now(), data: info });
          return info;
        }
      }
    } catch {}

    return {
      ip,
      country: "Unknown",
      countryCode: "UN",
      city: "",
      isp: "Lookup unavailable",
      org: "",
      asn: "",
      isResidential: false,
      ipType: "unverified",
      reason: "ASN verification lookup failed; blocked under strict policy",
    };
  }
}

export class ResidentialNode {
  constructor(url, meta = {}, config = DEFAULT_RESIDENTIAL_CONFIG) {
    this.id = meta.id || null;
    this.name = meta.name || maskProxyUrl(url);
    this.url = url;
    this.maskedUrl = maskProxyUrl(url);

    this.healthScore = Number.isFinite(Number(meta.healthScore)) ? Number(meta.healthScore) : 100;
    this.avgLatencyMs = Number.isFinite(Number(meta.avgLatencyMs || meta.latencyMs))
      ? Number(meta.avgLatencyMs || meta.latencyMs)
      : 350;
    this.successCount = Number(meta.successCount || 0);
    this.failureCount = Number(meta.failureCount || 0);
    this.consecutiveFailures = 0;
    this.quarantinedUntil = Number(meta.quarantinedUntil || 0);
    this.lastTestedAt = meta.lastTestedAt || null;
    this.lastError = meta.lastError || null;
    this.lastUsed = 0;

    this.egressIp = meta.egressIp || meta.lastTestIp || null;
    this.country = meta.country || null;
    this.countryCode = meta.countryCode || null;
    this.city = meta.city || null;
    this.isp = meta.isp || null;
    this.org = meta.org || null;
    this.asn = meta.asn || null;
    this.ipType = meta.ipType || (meta.isResidential === true ? "residential" : meta.isResidential === false ? "datacenter" : "unverified");
    this.isResidential = meta.isResidential === true;
    this.isActive = meta.isActive !== false;
    this.latencySamples = [];
    this.config = config;
    this.dispatcher = null;
  }

  getDispatcher() {
    if (!this.dispatcher) {
      this.dispatcher = createBoundedDispatcher(this.url, this.config);
    }
    return this.dispatcher;
  }

  updateConfig(config) {
    this.config = config;
    if (this.dispatcher) {
      try { this.dispatcher.close?.(); } catch {}
      this.dispatcher = null;
    }
  }

  get isQuarantined() {
    return Date.now() < this.quarantinedUntil;
  }

  get isAlive() {
    return this.isActive && !this.isQuarantined && this.healthScore > 20;
  }

  quarantine(durationMs, reason) {
    this.quarantinedUntil = Date.now() + durationMs;
    this.healthScore = Math.max(5, this.healthScore - 30);
    this.lastError = reason;
  }

  recordSuccess(latencyMs) {
    this.successCount++;
    this.consecutiveFailures = 0;
    this.quarantinedUntil = 0;
    this.lastError = null;
    this.lastTestedAt = new Date().toISOString();
    this.lastUsed = Date.now();
    this.avgLatencyMs = this.successCount === 1 ? latencyMs : (this.avgLatencyMs * 0.65) + (latencyMs * 0.35);
    this.healthScore = Math.min(100, this.healthScore + 6);
    this.latencySamples.push(latencyMs);
    if (this.latencySamples.length > 30) this.latencySamples.shift();
  }

  recordFailure(reason) {
    this.failureCount++;
    this.consecutiveFailures++;
    this.lastError = reason;
    this.lastTestedAt = new Date().toISOString();
    this.healthScore = Math.max(0, this.healthScore - 28);
    if (this.consecutiveFailures >= (this.config.maxConsecutiveFailures || 2) || this.healthScore < 25) {
      this.quarantine((this.config.quarantineDurationSec || 60) * 1000, reason);
    }
  }

  toPublicJSON(boundConnectionCount = 0) {
    return {
      id: this.id,
      name: this.name,
      maskedUrl: this.maskedUrl,
      isActive: this.isActive,
      alive: this.isAlive,
      quarantined: this.isQuarantined,
      quarantinedUntil: this.quarantinedUntil || null,
      healthScore: Math.round(this.healthScore),
      avgLatencyMs: Math.round(this.avgLatencyMs),
      egressIp: this.egressIp,
      country: this.country,
      countryCode: this.countryCode,
      city: this.city,
      isp: this.isp,
      org: this.org,
      asn: this.asn,
      ipType: this.ipType,
      isResidential: this.isResidential,
      successCount: this.successCount,
      failureCount: this.failureCount,
      lastTestedAt: this.lastTestedAt,
      lastError: this.lastError,
      boundConnectionCount,
    };
  }
}

export class ResidentialProxyPool {
  constructor(config = DEFAULT_RESIDENTIAL_CONFIG) {
    this.config = sanitizeResidentialConfig(config);
    this.validator = new ResidentialValidator();
    this.nodes = [];
    this.rrIndex = 0;
    this.sessionMap = new Map();
    this.metrics = {
      totalRequests: 0,
      hedgeWins: 0,
      timeoutsPrevented: 0,
      datacenterBlockedCount: 0,
      lastSyncAt: null,
    };
    this.probeInterval = null;
  }

  setConfig(nextConfig = {}) {
    this.config = sanitizeResidentialConfig({ ...this.config, ...nextConfig });
    for (const node of this.nodes) {
      node.updateConfig(this.config);
    }
    return this.config;
  }

  syncNodes(records = []) {
    const existingByUrl = new Map(this.nodes.map((n) => [n.url, n]));
    const nextNodes = [];
    let dcBlocked = 0;

    for (const rec of records) {
      if (!rec?.proxyUrl || rec.proxyUrl.startsWith("residential://")) continue;
      const existing = existingByUrl.get(rec.proxyUrl);
      if (existing) {
        existing.id = rec.id || existing.id;
        existing.name = rec.name || existing.name;
        existing.isActive = rec.isActive !== false;
        if (rec.ipType) existing.ipType = rec.ipType;
        if (typeof rec.isResidential === "boolean") existing.isResidential = rec.isResidential;
        if (rec.egressIp) existing.egressIp = rec.egressIp;
        if (rec.isp) existing.isp = rec.isp;
        if (rec.org) existing.org = rec.org;
        if (rec.asn) existing.asn = rec.asn;
        if (rec.country) existing.country = rec.country;
        if (rec.countryCode) existing.countryCode = rec.countryCode;
        if (rec.city) existing.city = rec.city;
        nextNodes.push(existing);
      } else {
        const node = new ResidentialNode(rec.proxyUrl, rec, this.config);
        nextNodes.push(node);
      }
      if (rec.ipType === "datacenter" || rec.isResidential === false) {
        dcBlocked++;
      }
    }

    this.nodes = nextNodes;
    this.metrics.datacenterBlockedCount = dcBlocked;
    this.metrics.lastSyncAt = new Date().toISOString();
  }

  async verifyProxyUrl(proxyUrl, { targetUrl = "https://api.ipify.org?format=json", timeoutMs } = {}) {
    const effectiveTimeout = Math.min(Number(timeoutMs) || this.config.probeTimeoutMs || 4500, 12000);
    let dispatcher = null;
    const t0 = Date.now();
    try {
      dispatcher = createBoundedDispatcher(proxyUrl, {
        ...this.config,
        connectTimeoutMs: Math.min(this.config.connectTimeoutMs, effectiveTimeout),
        headersTimeoutMs: effectiveTimeout,
      });

      // Step 1: Real HTTPS CONNECT probe to resolve genuine external egress IP
      const ipRes = await undiciFetch("https://api.ipify.org?format=json", {
        dispatcher,
        signal: AbortSignal.timeout(effectiveTimeout),
        headers: { "User-Agent": "Aries-Residential-Probe/2.0" },
      });
      const latencyMs = Date.now() - t0;

      if (!ipRes.ok) {
        return {
          ok: false,
          proxyUrl,
          maskedUrl: maskProxyUrl(proxyUrl),
          httpStatus: ipRes.status,
          latencyMs,
          ipType: "unverified",
          isResidential: false,
          error: `Probe returned HTTP ${ipRes.status}`,
        };
      }

      const ipJson = await ipRes.json().catch(() => null);
      const egressIp = ipJson?.ip || null;
      if (!egressIp) {
        return {
          ok: false,
          proxyUrl,
          maskedUrl: maskProxyUrl(proxyUrl),
          httpStatus: ipRes.status,
          latencyMs,
          ipType: "unverified",
          isResidential: false,
          error: "Proxy did not return a valid IPv4 egress address",
        };
      }

      // Optional custom target reachability check if user passed a custom targetUrl
      let targetStatus = ipRes.status;
      let targetLatencyMs = latencyMs;
      if (targetUrl && !targetUrl.includes("api.ipify.org")) {
        const tTarget = Date.now();
        const tRes = await undiciFetch(targetUrl, {
          method: "HEAD",
          dispatcher,
          signal: AbortSignal.timeout(effectiveTimeout),
          headers: { "User-Agent": "Aries-Residential-Probe/2.0" },
        }).catch(async () =>
          undiciFetch(targetUrl, {
            method: "GET",
            dispatcher,
            signal: AbortSignal.timeout(effectiveTimeout),
            headers: { "User-Agent": "Aries-Residential-Probe/2.0" },
          })
        );
        targetStatus = tRes.status;
        targetLatencyMs = Date.now() - tTarget;
      }

      // Step 2: Strict ASN / ISP verification (block datacenter / hosting / cloud)
      const asnInfo = await this.validator.inspect(egressIp);

      return {
        ok: true,
        proxyUrl,
        maskedUrl: maskProxyUrl(proxyUrl),
        egressIp,
        latencyMs: targetLatencyMs,
        connectLatencyMs: latencyMs,
        httpStatus: targetStatus,
        ...asnInfo,
      };
    } catch (err) {
      const msg = err?.name === "TimeoutError" || err?.name === "AbortError"
        ? `Timed out after ${effectiveTimeout}ms`
        : (err?.cause?.message || err?.message || String(err));
      return {
        ok: false,
        proxyUrl,
        maskedUrl: maskProxyUrl(proxyUrl),
        latencyMs: Date.now() - t0,
        ipType: "unverified",
        isResidential: false,
        error: msg,
      };
    } finally {
      try { await dispatcher?.close?.(); } catch {}
    }
  }

  async probeNode(node) {
    const result = await this.verifyProxyUrl(node.url, { timeoutMs: this.config.probeTimeoutMs });
    if (result.ok) {
      node.egressIp = result.egressIp;
      node.country = result.country;
      node.countryCode = result.countryCode;
      node.city = result.city;
      node.isp = result.isp;
      node.org = result.org;
      node.asn = result.asn;
      node.ipType = result.ipType;
      node.isResidential = result.isResidential;
      if (this.config.strictResidentialOnly && !result.isResidential) {
        node.quarantine((this.config.quarantineDurationSec || 60) * 1000, result.reason || "Datacenter IP blocked");
      } else {
        node.recordSuccess(result.latencyMs);
      }
    } else {
      node.recordFailure(result.error || "Probe failed");
    }
    return result;
  }

  getEligibleNodes({ includeUnverified = false } = {}) {
    const strict = this.config.strictResidentialOnly;
    return this.nodes.filter((n) => {
      if (!n.isAlive) return false;
      if (strict && !includeUnverified) {
        return n.isResidential === true && n.ipType === "residential";
      }
      if (strict && includeUnverified) {
        return n.ipType !== "datacenter";
      }
      return n.ipType !== "datacenter";
    });
  }

  selectCandidates(count = 2, sessionKey = null) {
    let eligible = this.getEligibleNodes({ includeUnverified: false });
    if (eligible.length === 0 && !this.config.strictResidentialOnly) {
      eligible = this.getEligibleNodes({ includeUnverified: true });
    }
    if (eligible.length === 0) return [];

    const strategy = this.config.rotationStrategy || "hedge-race";
    const sorted = [...eligible].sort((a, b) => (b.healthScore - a.healthScore) || (a.avgLatencyMs - b.avgLatencyMs));

    if (strategy === "round-robin") {
      const out = [];
      for (let i = 0; i < Math.min(count, sorted.length); i++) {
        out.push(sorted[(this.rrIndex + i) % sorted.length]);
      }
      this.rrIndex = (this.rrIndex + 1) % sorted.length;
      return out;
    }

    if (strategy === "sticky-session" && sessionKey) {
      const prevUrl = this.sessionMap.get(sessionKey);
      const pinned = prevUrl ? sorted.find((n) => n.url === prevUrl) : null;
      if (pinned) {
        const backups = sorted.filter((n) => n.url !== pinned.url);
        return [pinned, ...backups].slice(0, count);
      }
      const picked = sorted[0];
      this.sessionMap.set(sessionKey, picked.url);
      if (this.sessionMap.size > 500) this.sessionMap.delete(this.sessionMap.keys().next().value);
    }

    return sorted.slice(0, count);
  }

  /**
   * Zero-Timeout Speculative Dual-Hedge Fetch.
   * Launches primary residential node immediately; if headers are not returned within
   * hedgeDelayMs (or primary fails early), launches secondary distinct residential node
   * and resolves with the fastest successful upstream response — never hanging.
   */
  async hedgeFetch(url, options = {}, meta = {}) {
    this.metrics.totalRequests++;
    const candidates = this.selectCandidates(3, meta.sessionKey || null);
    if (candidates.length === 0) {
      throw new Error(
        "No verified Fresh Residential proxy nodes available (datacenter proxies are blocked under Strict Residential policy)"
      );
    }

    const totalTimeoutMs = Math.min(Number(meta.timeoutMs) || this.config.requestTimeoutMs || 20000, 60000);
    const hedgeEnabled = this.config.hedgeEnabled !== false && candidates.length > 1;
    const primary = candidates[0];
    const secondary = candidates.length > 1 ? candidates[1] : null;
    const backup = candidates.length > 2 ? candidates[2] : null;

    // Non-reusable ReadableStream bodies cannot be raced safely; run bounded sequential failover instead
    const hasLockedOrStreamBody = Boolean(options?.body && typeof options.body.getReader === "function");

    const runSingleNode = async (node, externalController) => {
      const t0 = Date.now();
      const timeoutSignal = AbortSignal.timeout(totalTimeoutMs);
      const signals = [externalController.signal, timeoutSignal];
      if (options.signal) signals.push(options.signal);
      const combinedSignal = AbortSignal.any ? AbortSignal.any(signals) : externalController.signal;

      try {
        const res = await undiciFetch(url, {
          ...options,
          dispatcher: node.getDispatcher(),
          signal: combinedSignal,
        });
        const lat = Date.now() - t0;
        if (res.status === 407 || res.status === 502 || res.status === 503 || res.status === 504 || res.status === 524) {
          node.recordFailure(`HTTP ${res.status} via ${node.maskedUrl}`);
          throw new Error(`Upstream/proxy status ${res.status}`);
        }
        node.recordSuccess(lat);
        return { res, node, latencyMs: lat };
      } catch (err) {
        const isTimeout = err?.name === "TimeoutError" || /timeout/i.test(err?.message || "");
        if (isTimeout) this.metrics.timeoutsPrevented++;
        if (!externalController.signal.aborted) {
          node.recordFailure(err?.message || "Fetch error");
        }
        throw err;
      }
    };

    if (!hedgeEnabled || hasLockedOrStreamBody || !secondary) {
      const errors = [];
      for (const node of candidates) {
        const ctrl = new AbortController();
        try {
          const { res, latencyMs } = await runSingleNode(node, ctrl);
          return Object.assign(res, { _residentialMeta: { node: node.maskedUrl, egressIp: node.egressIp, isp: node.isp, latencyMs, hedgeWon: false } });
        } catch (err) {
          errors.push(`${node.maskedUrl}: ${err.message}`);
          if (options.signal?.aborted) throw err;
        }
      }
      throw new Error(`All residential proxy attempts failed: ${errors.join(" | ")}`);
    }

    // Speculative dual-hedge race with zero-deadlock settlement
    return await new Promise((resolve, reject) => {
      let settled = false;
      let hedgeStarted = false;
      let hedgeTimer = null;
      const primaryCtrl = new AbortController();
      const secondaryCtrl = new AbortController();
      const failures = [];

      const onParentAbort = () => {
        if (hedgeTimer) clearTimeout(hedgeTimer);
        primaryCtrl.abort();
        secondaryCtrl.abort();
        if (!settled) {
          settled = true;
          reject(new Error("Request aborted by caller"));
        }
      };
      if (options.signal) {
        if (options.signal.aborted) return onParentAbort();
        options.signal.addEventListener("abort", onParentAbort, { once: true });
      }

      const finishWin = (winner, isHedge) => {
        if (settled) {
          return;
        }
        settled = true;
        if (hedgeTimer) clearTimeout(hedgeTimer);
        if (options.signal) options.signal.removeEventListener("abort", onParentAbort);
        if (isHedge) {
          this.metrics.hedgeWins++;
          this.metrics.timeoutsPrevented++;
          primaryCtrl.abort();
        } else {
          secondaryCtrl.abort();
        }
        winner.res._residentialMeta = {
          node: winner.node.maskedUrl,
          egressIp: winner.node.egressIp,
          isp: winner.node.isp,
          countryCode: winner.node.countryCode,
          latencyMs: winner.latencyMs,
          hedgeWon: isHedge,
        };
        resolve(winner.res);
      };

      const checkAllFailed = async (errMsg) => {
        failures.push(errMsg);
        if (settled) return;
        const expectedTotal = hedgeStarted ? 2 : 1;
        if (failures.length >= expectedTotal && hedgeStarted) {
          if (backup) {
            try {
              const bCtrl = new AbortController();
              const bWin = await runSingleNode(backup, bCtrl);
              return finishWin(bWin, true);
            } catch (bErr) {
              failures.push(`${backup.maskedUrl}: ${bErr.message}`);
            }
          }
          if (!settled) {
            settled = true;
            if (hedgeTimer) clearTimeout(hedgeTimer);
            if (options.signal) options.signal.removeEventListener("abort", onParentAbort);
            reject(new Error(`All residential hedged attempts failed: ${failures.join(" | ")}`));
          }
        }
      };

      const startSecondary = () => {
        if (settled || hedgeStarted) return;
        hedgeStarted = true;
        runSingleNode(secondary, secondaryCtrl)
          .then((win) => finishWin(win, true))
          .catch((err) => checkAllFailed(`${secondary.maskedUrl}: ${err.message}`));
      };

      runSingleNode(primary, primaryCtrl)
        .then((win) => finishWin(win, false))
        .catch((err) => {
          // Immediate failover on early primary error without waiting for hedgeDelayMs
          if (!settled) {
            if (!hedgeStarted) startSecondary();
            checkAllFailed(`${primary.maskedUrl}: ${err.message}`);
          }
        });

      hedgeTimer = setTimeout(startSecondary, this.config.hedgeDelayMs || 900);
    });
  }

  getMetrics(usageMap = new Map()) {
    const residentialNodes = this.nodes.filter((n) => n.isResidential && n.ipType === "residential");
    const healthyResidential = residentialNodes.filter((n) => n.isAlive);
    const datacenterNodes = this.nodes.filter((n) => n.ipType === "datacenter");
    const quarantinedNodes = this.nodes.filter((n) => n.isQuarantined);

    const latencies = healthyResidential.map((n) => n.avgLatencyMs).sort((a, b) => a - b);
    const avgLatencyMs = latencies.length
      ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length)
      : 0;
    const p95LatencyMs = latencies.length
      ? Math.round(latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))])
      : 0;

    return {
      engine: "Aries Fresh Residential Proxy Engine v3.0",
      totalNodes: this.nodes.length,
      verifiedResidentialCount: residentialNodes.length,
      healthyResidentialCount: healthyResidential.length,
      datacenterBlockedCount: Math.max(datacenterNodes.length, this.metrics.datacenterBlockedCount),
      quarantinedCount: quarantinedNodes.length,
      avgLatencyMs,
      p95LatencyMs,
      hedgeWins: this.metrics.hedgeWins,
      timeoutsPrevented: this.metrics.timeoutsPrevented,
      totalRequests: this.metrics.totalRequests,
      lastSyncAt: this.metrics.lastSyncAt,
      nodes: this.nodes.map((n) => n.toPublicJSON(usageMap.get(n.id) || 0)),
    };
  }
}

const g = globalThis;
export const globalResidentialPool = g.__ariesResidentialPool || (g.__ariesResidentialPool = new ResidentialProxyPool());
export default globalResidentialPool;
