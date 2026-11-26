/**
 * ============================================================================
 * Aries Fresh Residential IP Proxy Engine v4.2 (Pure-Residential, Zero-Timeout)
 * ============================================================================
 * Module: residentialProxyEngine.js
 * Location: /opt/aries-router/src/lib/network/residentialProxyEngine.js
 */

import fs from "node:fs";
import { ProxyAgent, Socks5ProxyAgent, fetch as undiciFetch } from "undici";

let TLS_ECDH_CURVE = "auto";
try {
  const tls = await import("../../../open-sse/config/tlsConfig.js").catch(() => null);
  if (tls?.TLS_ECDH_CURVE) TLS_ECDH_CURVE = tls.TLS_ECDH_CURVE;
} catch {}

export const PURE_RESIDENTIAL_GATEWAY_URL = process.env.RESI_GATEWAY_URL || "http://127.0.0.1:20188";
export const PURE_RESIDENTIAL_STATUS_URL = process.env.RESI_GATEWAY_STATUS_URL || "http://127.0.0.1:20189/status";

export const DATACENTER_KEYWORDS = [
  "amazon", "aws", "google", "microsoft", "azure", "alibaba", "aliyun", "oracle", "tencent",
  "digitalocean", "linode", "akamai", "ovh", "hetzner", "choopa", "vultr", "cloudflare",
  "fastly", "contabo", "leaseweb", "m247", "hostinger", "godaddy", "scaleway", "server",
  "hosting", "datacenter", "data center", "cloud", "vps", "dedicated", "colocation", "colo",
  "cdn", "telepoint", "cogent", "zenlayer", "ucloud", "rackspace", "softlayer", "psychz",
  "layeronline", "hostkey", "quadranet", "estnoc", "realcloud", "serverius", "fdcservers",
  "frantech", "buyvm", "limestone", "datapacket", "packet", "gcore", "kamatera", "ionos",
  "strato", "upcloud", "cherry servers", "worldstream", "nforce", "xtom", "sharktech",
  "colocrossing", "reliablesite", "quadra", "gthost", "ctrls", "orion network",
  "bunny technology", "lixium", "timeweb", "layershift", "haoxiangyun", "selectel", "akene",
  "cogento", "oneprovider", "brainstorm network", "ptisp", "almouroltec", "pvdatanet",
  "pvdata", "real time data", "servers tech", "franet", "warp", "mullvad", "nordvpn",
  "protonvpn", "surfshark", "expressvpn", "datacamp", "cdn77", "online sas",
  "constant company", "netcup", "zscaler", "natanetwork", "huawei", "servidores", "nexosystems",
  "3xk", "antbox", "baykov", "church of cyberology", "tor exit", "emerald onion", "calyx", "quintex",
];

export const FORBIDDEN_NON_RESI_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "::1",
  "0.0.0.0",
  "4.144.146.21",
  "34.43.46.91",
  "103.237.102.191",
  "80.65.211.149",
  "pt1.cactussstp.com",
  "bul2.stealthtunnel.net",
  "pg.stealthtunnel.net",
  "de-fra.pvdata.host",
  "nl-ams.pvdata.host",
]);

export const DEFAULT_RESIDENTIAL_CONFIG = {
  enabled: true,
  strictResidentialOnly: true,
  hedgeEnabled: true,
  hedgeDelayMs: 750,
  connectTimeoutMs: 2400,
  headersTimeoutMs: 6000,
  probeTimeoutMs: 4200,
  requestTimeoutMs: 20000,
  quarantineDurationSec: 30,
  maxConsecutiveFailures: 2,
  probeIntervalSec: 30,
  rotationStrategy: "hedge-race",
};

const IPV4_REGEX = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/;
const POOL_JSON_PATH = "/home/ubuntu/.aries-router/residential_fresh_pool.json";
const PROBE_ECHO_ENDPOINTS = [
  "https://httpbin.org/ip",
  "https://checkip.amazonaws.com",
  "https://icanhazip.com",
  "https://api.seeip.org/jsonip",
];

const deadProxyMap = globalThis.__ariesDeadProxyUrls || (globalThis.__ariesDeadProxyUrls = new Map());

export function markProxyUrlDead(proxyUrl, ttlMs = 10 * 60 * 1000, reason = "dead") {
  const key = String(proxyUrl || "").trim();
  if (!key || key.includes("127.0.0.1:20188")) return;
  deadProxyMap.set(key, { expiresAt: Date.now() + ttlMs, reason });
}

export function isProxyUrlDead(proxyUrl) {
  const key = String(proxyUrl || "").trim();
  if (!key) return false;
  const entry = deadProxyMap.get(key);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    deadProxyMap.delete(key);
    return false;
  }
  return true;
}

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

export function isForbiddenNonResidentialUrl(rawUrl) {
  try {
    const s = String(rawUrl || "").trim();
    if (!s) return true;
    if (s.startsWith("residential://")) return false;
    const u = new URL(s);
    const host = (u.hostname || "").toLowerCase();
    if (!host || FORBIDDEN_NON_RESI_HOSTS.has(host)) return true;
    if (host.endsWith(".pvdata.host") || host.endsWith(".stealthtunnel.net")) return true;
    if (s.includes("127.0.0.1:8118") || s.includes("127.0.0.1:40000")) return true;
    return false;
  } catch {
    return true;
  }
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
    if (!host || !port || !/^\d+$/.test(port)) throw new Error("Invalid host:port:user:pass entry");
    const parsed = new URL(`http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`);
    return parsed.toString();
  }

  if (parts.length === 2) {
    const [host, port] = parts;
    if (!host || !port || !/^\d+$/.test(port)) throw new Error("Invalid host:port entry");
    const parsed = new URL(`http://${host}:${port}`);
    return parsed.toString();
  }

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

export function createBoundedDispatcher(proxyUrl, config = DEFAULT_RESIDENTIAL_CONFIG, { isProbe = false } = {}) {
  const parsed = new URL(proxyUrl);
  const effectiveHeadersTimeout = isProbe
    ? (config.headersTimeoutMs || 4500)
    : Math.max(config.headersTimeoutMs || 15000, 35000);
  const common = {
    uri: proxyUrl,
    connect: {
      timeout: config.connectTimeoutMs || 2500,
      ecdhCurve: TLS_ECDH_CURVE,
    },
    requestTls: { ecdhCurve: TLS_ECDH_CURVE },
    headersTimeout: effectiveHeadersTimeout,
    bodyTimeout: isProbe ? 8000 : Math.max(config.requestTimeoutMs || 20000, 60000),
    maxHeaderSize: 64 * 1024,
    pipelining: 1,
  };
  if (parsed.protocol === "socks5:" || parsed.protocol === "socks5h:") {
    if (parsed.protocol === "socks5h:") parsed.protocol = "socks5:";
    return new Socks5ProxyAgent(parsed, common);
  }
  return new ProxyAgent(common);
}

export function classifyAsnMetadata({
  isp = "",
  org = "",
  as = "",
  domain = "",
  hosting = false,
  proxy = false,
  mobile = false,
}) {
  const combined = `${isp} ${org} ${as} ${domain}`.toLowerCase();
  const matchedKeyword = DATACENTER_KEYWORDS.find((kw) => combined.includes(kw)) || null;
  const isDatacenter = Boolean(hosting) || Boolean(matchedKeyword);

  let networkClass = "residential";
  if (isDatacenter) {
    networkClass = "datacenter";
  } else if (mobile) {
    networkClass = "mobile";
  } else if (combined.includes("university") || combined.includes(".edu") || combined.includes("educational")) {
    networkClass = "education";
  }

  return {
    isResidential: !isDatacenter,
    ipType: isDatacenter ? "datacenter" : "residential",
    networkClass,
    isHosting: Boolean(hosting),
    isMobile: Boolean(mobile),
    isProxyFlag: Boolean(proxy),
    matchedKeyword,
    reason: matchedKeyword
      ? `Blocked datacenter keyword "${matchedKeyword}" in ISP/ASN`
      : hosting
        ? "Blocked: ASN flagged as hosting/datacenter"
        : networkClass === "mobile"
          ? "Verified mobile carrier ISP"
          : networkClass === "education"
            ? "Verified campus/educational ISP"
            : "Verified residential ISP network",
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
        networkClass: "unverified",
        reason: "Invalid IPv4 egress address",
      };
    }

    const cached = this.cache.get(ip);
    if (cached && Date.now() - cached.cachedAt < this.cacheTtlMs) {
      return cached.data;
    }

    const [ipApiRes, ipWhoRes] = await Promise.allSettled([
      undiciFetch(
        `http://ip-api.com/json/${ip}?fields=status,country,countryCode,regionName,city,isp,org,as,hosting,proxy,mobile`,
        { signal: AbortSignal.timeout(3500) }
      ).then((r) => (r.ok ? r.json() : null)),
      undiciFetch(`https://ipwho.is/${ip}`, {
        signal: AbortSignal.timeout(3500),
      }).then((r) => (r.ok ? r.json() : null)),
    ]);

    const d1 = ipApiRes.status === "fulfilled" && ipApiRes.value?.status === "success" ? ipApiRes.value : null;
    const d2 = ipWhoRes.status === "fulfilled" && ipWhoRes.value?.success !== false ? ipWhoRes.value : null;

    if (d1 || d2) {
      const isp1 = d1?.isp || "";
      const isp2 = d2?.connection?.isp || "";
      const org1 = d1?.org || "";
      const org2 = d2?.connection?.org || "";
      const domain = d2?.connection?.domain || "";
      const as1 = d1?.as || "";
      const as2 = d2?.connection?.asn ? `AS${d2.connection.asn} ${org2}` : "";
      const hosting = Boolean(d1?.hosting) || d2?.type === "hosting" || Boolean(d2?.security?.hosting);
      const proxy = Boolean(d1?.proxy) || Boolean(d2?.security?.proxy);
      const mobile = Boolean(d1?.mobile);

      const verdict = classifyAsnMetadata({
        isp: [isp1, isp2].filter(Boolean).join(" | "),
        org: [org1, org2].filter(Boolean).join(" | "),
        as: [as1, as2].filter(Boolean).join(" | "),
        domain,
        hosting,
        proxy,
        mobile,
      });

      const info = {
        ip,
        country: d1?.country || d2?.country || "Unknown",
        countryCode: d1?.countryCode || d2?.country_code || "UN",
        regionName: d1?.regionName || d2?.region || "",
        city: d1?.city || d2?.city || "",
        isp: isp1 || isp2 || "Unknown ISP",
        org: org1 || org2 || isp1 || isp2 || "",
        asn: as1 || as2 || "",
        ...verdict,
      };
      this.cache.set(ip, { cachedAt: Date.now(), data: info });
      return info;
    }

    try {
      const res = await undiciFetch(`https://ipinfo.io/${ip}/json`, {
        signal: AbortSignal.timeout(3500),
      });
      if (res.ok) {
        const d = await res.json();
        if (d?.ip) {
          const verdict = classifyAsnMetadata({
            isp: d.org || "",
            org: d.org || "",
            as: d.org || "",
          });
          const info = {
            ip,
            country: d.country || "Unknown",
            countryCode: d.country || "UN",
            regionName: d.region || "",
            city: d.city || "",
            isp: d.org || "Unknown ISP",
            org: d.org || "",
            asn: d.org || "",
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
      networkClass: "unverified",
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
    try {
      this.protocol = new URL(url).protocol.replace(":", "").toLowerCase();
    } catch {
      this.protocol = "http";
    }

    this.healthScore = Number.isFinite(Number(meta.healthScore)) ? Number(meta.healthScore) : 100;
    this.avgLatencyMs = Number.isFinite(Number(meta.avgLatencyMs || meta.latencyMs))
      ? Number(meta.avgLatencyMs || meta.latencyMs)
      : 500;
    this.successCount = Number(meta.successCount || 0);
    this.failureCount = Number(meta.failureCount || 0);
    this.consecutiveFailures = 0;
    this.quarantinedUntil = Number(meta.quarantinedUntil || 0);
    this.lastTestedAt = meta.lastTestedAt || null;
    this.lastSuccessAt = meta.lastSuccessAt || (meta.isActive && !meta.lastError ? meta.lastTestedAt : null);
    this.lastError = meta.lastError || null;
    this.lastUsed = 0;

    this.egressIp = meta.egressIp || meta.lastTestIp || null;
    this.country = meta.country || null;
    this.countryCode = meta.countryCode || null;
    this.city = meta.city || null;
    this.isp = meta.isp || null;
    this.org = meta.org || null;
    this.asn = meta.asn || null;
    this.networkClass = meta.networkClass || (meta.isResidential === true ? "residential" : meta.isResidential === false ? "datacenter" : "unverified");
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
    return this.isActive && !this.isQuarantined && !isProxyUrlDead(this.url) && this.healthScore > 20;
  }

  get stabilityPct() {
    const total = this.successCount + this.failureCount;
    if (total === 0) return this.isAlive ? 100 : 0;
    return Math.round((this.successCount / total) * 100);
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
    const nowIso = new Date().toISOString();
    this.lastTestedAt = nowIso;
    this.lastSuccessAt = nowIso;
    this.lastUsed = Date.now();
    this.avgLatencyMs = this.successCount === 1 ? latencyMs : (this.avgLatencyMs * 0.6) + (latencyMs * 0.4);
    this.healthScore = Math.min(100, this.healthScore + 8);
    this.latencySamples.push(latencyMs);
    if (this.latencySamples.length > 30) this.latencySamples.shift();
  }

  recordFailure(reason) {
    this.failureCount++;
    this.consecutiveFailures++;
    this.lastError = reason;
    this.lastTestedAt = new Date().toISOString();
    this.healthScore = Math.max(0, this.healthScore - 30);
    if (this.consecutiveFailures >= (this.config.maxConsecutiveFailures || 2) || this.healthScore < 25) {
      this.quarantine((this.config.quarantineDurationSec || 30) * 1000, reason);
    }
  }

  toPublicJSON(boundConnectionCount = 0) {
    return {
      id: this.id,
      name: this.name,
      protocol: this.protocol,
      maskedUrl: this.maskedUrl,
      isActive: this.isActive,
      alive: this.isAlive,
      quarantined: this.isQuarantined,
      quarantinedUntil: this.quarantinedUntil || null,
      healthScore: Math.round(this.healthScore),
      stabilityPct: this.stabilityPct,
      avgLatencyMs: Math.round(this.avgLatencyMs),
      egressIp: this.egressIp,
      country: this.country,
      countryCode: this.countryCode,
      city: this.city,
      isp: this.isp,
      org: this.org,
      asn: this.asn,
      networkClass: this.networkClass,
      ipType: this.ipType,
      isResidential: this.isResidential,
      successCount: this.successCount,
      failureCount: this.failureCount,
      consecutiveFailures: this.consecutiveFailures,
      lastTestedAt: this.lastTestedAt,
      lastSuccessAt: this.lastSuccessAt,
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
    this.gatewayAgent = null;
    this.recentEvents = [];
    this.metrics = {
      totalRequests: 0,
      hedgeWins: 0,
      timeoutsPrevented: 0,
      autoInjections: 0,
      datacenterBlockedCount: 0,
      lastSyncAt: null,
      lastMonitorAt: null,
    };
    this.probeInterval = null;
  }

  recordEvent(type, detail, meta = {}) {
    this.recentEvents.unshift({
      ts: new Date().toISOString(),
      type,
      detail,
      ...meta,
    });
    if (this.recentEvents.length > 30) {
      this.recentEvents.length = 30;
    }
  }

  getGatewayAgent() {
    if (!this.gatewayAgent) {
      this.gatewayAgent = new ProxyAgent({
        uri: PURE_RESIDENTIAL_GATEWAY_URL,
        connect: { timeout: this.config.connectTimeoutMs || 2400, ecdhCurve: TLS_ECDH_CURVE },
        requestTls: { ecdhCurve: TLS_ECDH_CURVE },
        headersTimeout: Math.max(this.config.headersTimeoutMs || 6000, 12000),
        bodyTimeout: this.config.requestTimeoutMs || 20000,
        maxHeaderSize: 64 * 1024,
      });
    }
    return this.gatewayAgent;
  }

  hydrateFromPoolFileIfNeeded() {
    try {
      if (!fs.existsSync(POOL_JSON_PATH)) return false;
      const st = fs.statSync(POOL_JSON_PATH);
      if (this.nodes.length > 0 && this._lastFileMtimeMs === st.mtimeMs) return true;
      const raw = JSON.parse(fs.readFileSync(POOL_JSON_PATH, "utf8"));
      const nodes = Array.isArray(raw?.nodes) ? raw.nodes : [];
      if (nodes.length > 0) {
        this.syncNodes(nodes.map((n, i) => ({
          id: `resi-file-${i}`,
          name: `Resi-${n.egressIp || "node"} (${n.countryCode || "??"})`,
          proxyUrl: n.url,
          isActive: true,
          isResidential: true,
          ipType: "residential",
          networkClass: n.networkClass || "residential",
          egressIp: n.egressIp,
          country: n.country,
          countryCode: n.countryCode,
          city: n.city,
          isp: n.isp,
          org: n.org,
          asn: n.asn,
          latencyMs: n.latencyMs,
          lastTestedAt: n.verifiedAt,
        })));
        this._lastFileMtimeMs = st.mtimeMs;
        return true;
      }
    } catch {}
    return false;
  }

  setConfig(nextConfig = {}) {
    this.config = sanitizeResidentialConfig({ ...this.config, ...nextConfig });
    for (const node of this.nodes) {
      node.updateConfig(this.config);
    }
    if (this.gatewayAgent) {
      try { this.gatewayAgent.close?.(); } catch {}
      this.gatewayAgent = null;
    }
    return this.config;
  }

  ensureMonitorStarted() {
    if (this.probeInterval) return;
    if (typeof process !== "undefined" && process.env?.NEXT_PHASE === "phase-production-build") return;
    const intervalMs = Math.max(15000, (this.config.probeIntervalSec || 30) * 1000);
    this.probeInterval = setInterval(() => {
      this.runBackgroundHealthSweep().catch(() => {});
    }, intervalMs);
    this.probeInterval.unref?.();
  }

  async runBackgroundHealthSweep() {
    if (this._sweeping) return;
    this._sweeping = true;
    try {
      const now = Date.now();
      const stale = this.nodes.filter((n) => {
        if (!n.isActive) return false;
        if (n.ipType === "datacenter") return false;
        if (n.quarantinedUntil > 0 && now >= n.quarantinedUntil) return true;
        if (!n.lastTestedAt) return true;
        return now - new Date(n.lastTestedAt).getTime() >= (this.config.probeIntervalSec || 30) * 1000;
      });
      const batch = stale.slice(0, 8);
      await Promise.allSettled(batch.map((n) => this.probeNode(n)));
      this.metrics.lastMonitorAt = new Date().toISOString();
    } finally {
      this._sweeping = false;
    }
  }

  syncNodes(records = []) {
    const existingByUrl = new Map(this.nodes.map((n) => [n.url, n]));
    const nextNodes = [];
    const seenUrls = new Set();
    let dcBlocked = 0;

    for (const rec of records) {
      const u = String(rec?.proxyUrl || "").trim();
      if (!u || u.startsWith("residential://") || seenUrls.has(u)) continue;
      seenUrls.add(u);

      if (isForbiddenNonResidentialUrl(u)) {
        dcBlocked++;
        continue;
      }

      const existing = existingByUrl.get(u);
      if (existing) {
        existing.id = rec.id || existing.id;
        existing.name = rec.name || existing.name;
        existing.isActive = rec.isActive !== false;
        if (rec.ipType) existing.ipType = rec.ipType;
        if (rec.networkClass) existing.networkClass = rec.networkClass;
        if (typeof rec.isResidential === "boolean") existing.isResidential = rec.isResidential;
        if (rec.egressIp) existing.egressIp = rec.egressIp;
        if (rec.isp) existing.isp = rec.isp;
        if (rec.org) existing.org = rec.org;
        if (rec.asn) existing.asn = rec.asn;
        if (rec.country) existing.country = rec.country;
        if (rec.countryCode) existing.countryCode = rec.countryCode;
        if (rec.city) existing.city = rec.city;
        if (rec.lastError !== undefined) existing.lastError = rec.lastError;
        if (rec.lastTestedAt) existing.lastTestedAt = rec.lastTestedAt;
        if (Number.isFinite(Number(rec.latencyMs)) && existing.successCount === 0) {
          existing.avgLatencyMs = Number(rec.latencyMs);
        }
        nextNodes.push(existing);
      } else {
        const node = new ResidentialNode(u, rec, this.config);
        nextNodes.push(node);
      }
      if (rec.ipType === "datacenter" || rec.isResidential === false) {
        dcBlocked++;
      }
    }

    this.nodes = nextNodes;
    this.metrics.datacenterBlockedCount = dcBlocked;
    this.metrics.lastSyncAt = new Date().toISOString();
    this.ensureMonitorStarted();
  }

  async verifyProxyUrl(proxyUrl, { targetUrl = "https://api.ipify.org?format=json", timeoutMs } = {}) {
    const effectiveTimeout = Math.min(Number(timeoutMs) || this.config.probeTimeoutMs || 4200, 10000);
    if (isForbiddenNonResidentialUrl(proxyUrl)) {
      return {
        ok: false,
        proxyUrl,
        maskedUrl: maskProxyUrl(proxyUrl),
        latencyMs: 0,
        ipType: "datacenter",
        networkClass: "datacenter",
        isResidential: false,
        reason: "Blocked: WARP / loopback / known datacenter host",
        error: "Blocked under Pure-Residential policy",
      };
    }

    let dispatcher = null;
    const t0 = Date.now();
    try {
      dispatcher = createBoundedDispatcher(proxyUrl, {
        ...this.config,
        connectTimeoutMs: Math.min(this.config.connectTimeoutMs || 2400, effectiveTimeout),
        headersTimeoutMs: effectiveTimeout,
      }, { isProbe: true });

      let egressIp = null;
      let ipStatus = 0;
      let lastEchoErr = "No IP echo response";
      for (const echoUrl of PROBE_ECHO_ENDPOINTS) {
        try {
          const ipRes = await undiciFetch(echoUrl, {
            dispatcher,
            signal: AbortSignal.timeout(effectiveTimeout),
            headers: { "User-Agent": "Aries-Residential-Probe/4.2" },
          });
          ipStatus = ipRes.status;
          if (!ipRes.ok) {
            lastEchoErr = `Probe returned HTTP ${ipRes.status}`;
            continue;
          }
          const raw = await ipRes.text();
          const m = raw.match(IPV4_REGEX);
          if (m) {
            egressIp = m[1];
            break;
          }
          lastEchoErr = "Proxy did not return a valid IPv4 egress address";
        } catch (err) {
          lastEchoErr = err?.name === "TimeoutError" || err?.name === "AbortError"
            ? `Timed out after ${effectiveTimeout}ms`
            : (err?.cause?.message || err?.message || String(err));
        }
      }

      const latencyMs = Date.now() - t0;
      if (!egressIp) {
        return {
          ok: false,
          proxyUrl,
          maskedUrl: maskProxyUrl(proxyUrl),
          httpStatus: ipStatus,
          latencyMs,
          ipType: "unverified",
          networkClass: "unverified",
          isResidential: false,
          error: lastEchoErr,
        };
      }

      let targetStatus = ipStatus || 200;
      let targetLatencyMs = latencyMs;
      if (targetUrl && !targetUrl.includes("api.ipify.org")) {
        const tTarget = Date.now();
        const tRes = await undiciFetch(targetUrl, {
          method: "HEAD",
          dispatcher,
          signal: AbortSignal.timeout(effectiveTimeout),
          headers: { "User-Agent": "Aries-Residential-Probe/4.2" },
        }).catch(async () =>
          undiciFetch(targetUrl, {
            method: "GET",
            dispatcher,
            signal: AbortSignal.timeout(effectiveTimeout),
            headers: { "User-Agent": "Aries-Residential-Probe/4.2" },
          })
        );
        targetStatus = tRes.status;
        targetLatencyMs = Date.now() - tTarget;
      }

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
        networkClass: "unverified",
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
      node.networkClass = result.networkClass;
      node.ipType = result.ipType;
      node.isResidential = result.isResidential;
      if (this.config.strictResidentialOnly && !result.isResidential) {
        node.quarantine((this.config.quarantineDurationSec || 30) * 1000, result.reason || "Datacenter IP blocked");
        this.recordEvent("datacenter_blocked", `${node.maskedUrl} (${result.egressIp}) blocked: ${result.isp || result.reason}`);
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
      return n.ipType !== "datacenter";
    });
  }

  selectCandidates(count = 3, sessionKey = null) {
    this.hydrateFromPoolFileIfNeeded();
    const eligible = this.getEligibleNodes({ includeUnverified: false });
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

  async fetchViaPureResidentialGateway(url, options = {}, totalTimeoutMs = 20000) {
    const t0 = Date.now();
    const timeoutSignal = AbortSignal.timeout(totalTimeoutMs);
    const signals = [timeoutSignal];
    if (options.signal) signals.push(options.signal);
    const combinedSignal = AbortSignal.any ? AbortSignal.any(signals) : timeoutSignal;

    const res = await undiciFetch(url, {
      ...options,
      dispatcher: this.getGatewayAgent(),
      signal: combinedSignal,
    });
    if (res.status === 502 && !url.includes("127.0.0.1")) {
      throw new Error("Pure-Residential Gateway returned HTTP 502");
    }
    const latencyMs = Date.now() - t0;
    this.metrics.autoInjections++;
    this.metrics.timeoutsPrevented++;
    this.recordEvent("gateway_inject", `Auto-injected via Pure-Residential Gateway (:20188) in ${latencyMs}ms`);
    return Object.assign(res, {
      _residentialMeta: {
        node: "127.0.0.1:20188 (Pure-Residential Gateway)",
        egressIp: null,
        isp: "Verified Pure-Residential Pool",
        latencyMs,
        hedgeWon: true,
        injectedViaGateway: true,
      },
    });
  }

  async hedgeFetch(url, options = {}, meta = {}) {
    this.metrics.totalRequests++;
    const totalTimeoutMs = Math.min(Number(meta.timeoutMs) || this.config.requestTimeoutMs || 20000, 60000);
    const candidates = this.selectCandidates(3, meta.sessionKey || null);

    if (candidates.length === 0) {
      return await this.fetchViaPureResidentialGateway(url, options, totalTimeoutMs);
    }

    const hedgeEnabled = this.config.hedgeEnabled !== false && candidates.length > 1;
    const primary = candidates[0];
    const secondary = candidates.length > 1 ? candidates[1] : null;
    const backup = candidates.length > 2 ? candidates[2] : null;
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
        if (res.status === 402 || res.status === 407 || res.status === 429 || res.status === 502 || res.status === 503 || res.status === 504 || res.status === 524) {
          node.recordFailure(`HTTP ${res.status} via ${node.maskedUrl}`);
          markProxyUrlDead(node.url, res.status === 429 ? 5 * 60 * 1000 : 10 * 60 * 1000, `HTTP ${res.status}`);
          this.recordEvent("node_quarantined", `${node.maskedUrl} quarantined after HTTP ${res.status}`);
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
          return Object.assign(res, {
            _residentialMeta: {
              node: node.maskedUrl,
              egressIp: node.egressIp,
              isp: node.isp,
              countryCode: node.countryCode,
              latencyMs,
              hedgeWon: false,
            },
          });
        } catch (err) {
          errors.push(`${node.maskedUrl}: ${err.message}`);
          if (options.signal?.aborted) throw err;
        }
      }
      if (!hasLockedOrStreamBody) {
        try {
          return await this.fetchViaPureResidentialGateway(url, options, totalTimeoutMs);
        } catch (gwErr) {
          errors.push(`gateway: ${gwErr.message}`);
        }
      }
      throw new Error(`All residential proxy attempts failed: ${errors.join(" | ")}`);
    }

    try {
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
          if (settled) return;
          settled = true;
          if (hedgeTimer) clearTimeout(hedgeTimer);
          if (options.signal) options.signal.removeEventListener("abort", onParentAbort);
          if (isHedge) {
            this.metrics.hedgeWins++;
            this.metrics.timeoutsPrevented++;
            this.metrics.autoInjections++;
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
            if (!settled) {
              if (!hedgeStarted) startSecondary();
              checkAllFailed(`${primary.maskedUrl}: ${err.message}`);
            }
          });

        hedgeTimer = setTimeout(startSecondary, this.config.hedgeDelayMs || 750);
      });
    } catch (raceErr) {
      if (options.signal?.aborted) throw raceErr;
      return await this.fetchViaPureResidentialGateway(url, options, totalTimeoutMs);
    }
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
    const p50LatencyMs = latencies.length
      ? Math.round(latencies[Math.floor((latencies.length - 1) * 0.5)])
      : 0;
    const p95LatencyMs = latencies.length
      ? Math.round(latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))])
      : 0;

    const totalOk = residentialNodes.reduce((s, n) => s + n.successCount, 0);
    const totalFail = residentialNodes.reduce((s, n) => s + n.failureCount, 0);
    const successRatePct = (totalOk + totalFail) > 0
      ? Math.round((totalOk / (totalOk + totalFail)) * 100)
      : healthyResidential.length > 0 ? 100 : 0;

    return {
      engine: "Aries Pure-Residential Proxy Engine v4.2",
      totalNodes: this.nodes.length,
      verifiedResidentialCount: residentialNodes.length,
      healthyResidentialCount: healthyResidential.length,
      datacenterBlockedCount: Math.max(datacenterNodes.length, this.metrics.datacenterBlockedCount),
      quarantinedCount: quarantinedNodes.length,
      avgLatencyMs,
      p50LatencyMs,
      p95LatencyMs,
      successRatePct,
      hedgeWins: this.metrics.hedgeWins,
      timeoutsPrevented: this.metrics.timeoutsPrevented,
      autoInjections: this.metrics.autoInjections,
      totalRequests: this.metrics.totalRequests,
      lastSyncAt: this.metrics.lastSyncAt,
      lastMonitorAt: this.metrics.lastMonitorAt,
      recentEvents: this.recentEvents.slice(0, 12),
      nodes: this.nodes.map((n) => n.toPublicJSON(usageMap.get(n.id) || 0)),
    };
  }
}

const g = globalThis;
export const globalResidentialPool = g.__ariesResidentialPool || (g.__ariesResidentialPool = new ResidentialProxyPool());
export default globalResidentialPool;
