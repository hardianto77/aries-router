import fs from "node:fs";
import net from "node:net";
import dns from "node:dns/promises";
import path from "node:path";
import { ProxyAgent, Socks5ProxyAgent, fetch as undiciFetch } from "undici";
import {
  DATACENTER_KEYWORDS,
  FORBIDDEN_NON_RESI_HOSTS,
  maskProxyUrl,
} from "./residentialProxyEngine.js";

const DATA_DIR = process.env.DATA_DIR || "/home/ubuntu/.aries-router";
const ASN_CACHE_PATH = path.join(DATA_DIR, "asn_cache.json");
const POOL_JSON_PATH = path.join(DATA_DIR, "residential_fresh_pool.json");
const RESI_TXT_PATH = "/home/ubuntu/resi-fresh-alive.txt";
const RESI_GW_RELOAD_URL = (process.env.RESI_GATEWAY_STATUS_URL || "http://127.0.0.1:20189/status").replace(/\/status$/, "/reload");
const VPS_PUBLIC_IP = process.env.VPS_PUBLIC_IP || "43.163.99.76";

const ASN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TCP_PRECHECK_TIMEOUT_MS = 850;
const PROBE_TIMEOUT_MS = 2800;
const MAX_SINGLE_LATENCY_MS = 2300;
const MAX_AVG_LATENCY_MS = 1750;
const MAX_JITTER_MS = 1100;

const IPV4_RE = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/;
const DATACENTER_WORD_RE = /\b(aws|ovh|vps|vpn|tor|cdn|colo|cloud|server|servers|proxy|warp|dedi|hosted|wholesale|transit|backbone|your-server)\b/i;
const EDUCATION_RE = /(\buniversity\b|\bcollege\b|\bschool\b|\beducational\b|\bacademi\b|\buniversitas\b|\bcampus\b|\bsurfnet\b|\bresearch\s+network\b|\.edu\b|\.ac\.[a-z]{2}\b)/i;

const EXTRA_DC_KEYWORDS = [
  "solusindo", "telematika", "selaras citra", "murni makmur", "brightdata", "oxylabs",
  "smartproxy", "iproyal", "proxyrack", "luminati", "serverfarm", "hostwinds", "vds", "sia veesp", "veesp", "netsec",
];
const ALL_DC_KEYWORDS = Array.from(new Set([...DATACENTER_KEYWORDS, ...EXTRA_DC_KEYWORDS]));

export const HARVEST_FEEDS = [
  { protocol: "http", url: "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&proxy_format=protocolipport&format=text&timeout=2500" },
  { protocol: "http", url: "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=http&timeout=2500&country=all&ssl=yes&anonymity=all" },
  { protocol: "socks5", url: "https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=2500" },
  { protocol: "http", url: "https://proxylist.geonode.com/api/proxy-list?limit=300&page=1&sort_by=lastChecked&sort_type=desc" },
  { protocol: "http", url: "https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/http.txt" },
  { protocol: "https", url: "https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/https.txt" },
  { protocol: "socks5", url: "https://raw.githubusercontent.com/vakhov/fresh-proxy-list/master/socks5.txt" },
  { protocol: "http", url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt" },
  { protocol: "socks5", url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt" },
  { protocol: "http", url: "https://raw.githubusercontent.com/sunny9577/proxy-scraper/master/generated/http_proxies.txt" },
  { protocol: "http", url: "https://raw.githubusercontent.com/stormsia/proxy-list/main/working_proxies.txt" },
  { protocol: "http", url: "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-http.txt" },
  { protocol: "http", url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt" },
  { protocol: "socks5", url: "https://raw.githubusercontent.com/TheSpeedX/SOCKS-List/master/socks5.txt" },
  { protocol: "socks5", url: "https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt" },
  { protocol: "http", url: "https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt" },
  { protocol: "http", url: "https://raw.githubusercontent.com/elliottophellia/yakumo/master/results/http/global/http_checked.txt" },
  { protocol: "http", url: "https://raw.githubusercontent.com/komutan234/Proxy-List-Free/main/proxies/http.txt" },
  { protocol: "http", url: "https://raw.githubusercontent.com/tuanminpay/live-proxy/master/http.txt" },
  { protocol: "http", url: "https://raw.githubusercontent.com/officialputuid/KangProxy/KangProxy/http.txt" },
  { protocol: "http", url: "https://raw.githubusercontent.com/databay-labs/free-proxy-list/master/http.txt" },
  { protocol: "http", url: "https://raw.githubusercontent.com/litportnet/free-proxy-list/live/proxies/http.txt" },
  { protocol: "http", url: "https://raw.githubusercontent.com/proxylist-to/proxy-list/main/http.txt" },
  { protocol: "http", url: "https://raw.githubusercontent.com/Zaeem20/FREE_PROXIES_LIST/master/http.txt" },
  { protocol: "http", url: "https://raw.githubusercontent.com/prxchk/proxy-list/main/http.txt" },
  { protocol: "http", url: "https://raw.githubusercontent.com/MuRongPIG/Proxy-Master/main/http.txt" },
  { protocol: "http", url: "https://raw.githubusercontent.com/zevtyardt/proxy-list/main/http.txt" },
  { protocol: "http", url: "https://raw.githubusercontent.com/ErcinDedeoglu/proxies/main/proxies/http.txt" },
  { protocol: "http", url: "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt" },
  { protocol: "http", url: "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/http/data.txt" },
  { protocol: "socks5", url: "https://cdn.jsdelivr.net/gh/proxifly/free-proxy-list@main/proxies/protocols/socks5/data.txt" },
];

export function isPublicIPv4(ip) {
  if (!ip || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) return false;
  const parts = ip.split(".").map(Number);
  if (parts.some((n) => n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (ip === VPS_PUBLIC_IP) return false;
  return true;
}

export function subnet24(ip) {
  if (!ip || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) return "";
  return ip.split(".").slice(0, 3).join(".");
}

export function normalizeCandidateLine(raw, defaultProtocol = "http") {
  const token = String(raw || "").trim().split(/\s+/)[0] || "";
  if (!token || token.startsWith("#") || token.startsWith("residential://")) return null;
  let candidate = token;
  if (!/^(https?|socks5h?):\/\//i.test(candidate)) {
    if (/^socks4:\/\//i.test(candidate)) return null;
    const parts = candidate.split(":");
    if (parts.length === 4 && /^\d+$/.test(parts[1])) {
      candidate = `${defaultProtocol}://${encodeURIComponent(parts[2])}:${encodeURIComponent(parts[3])}@${parts[0]}:${parts[1]}`;
    } else if (parts.length === 2 && /^\d+$/.test(parts[1])) {
      candidate = `${defaultProtocol}://${parts[0]}:${parts[1]}`;
    } else {
      return null;
    }
  }
  try {
    const u = new URL(candidate);
    const scheme = u.protocol.replace(":", "").toLowerCase();
    if (!["http", "https", "socks5", "socks5h"].includes(scheme)) return null;
    const host = (u.hostname || "").toLowerCase();
    const port = Number(u.port);
    if (!host || !port || port < 1 || port > 65535) return null;
    if (FORBIDDEN_NON_RESI_HOSTS.has(host) || host === VPS_PUBLIC_IP) return null;
    if (host.endsWith(".pvdata.host") || host.endsWith(".stealthtunnel.net") || host.endsWith(".floppydata.com") || host.endsWith(".edu")) {
      return null;
    }
    if (net.isIPv4(host) && !isPublicIPv4(host)) return null;
    const normalizedScheme = scheme === "socks5h" ? "socks5" : scheme;
    const auth = u.username ? `${u.username}:${u.password || ""}@` : "";
    return `${normalizedScheme}://${auth}${host}:${port}`;
  } catch {
    return null;
  }
}

function loadAsnCache() {
  try {
    if (!fs.existsSync(ASN_CACHE_PATH)) return {};
    const raw = JSON.parse(fs.readFileSync(ASN_CACHE_PATH, "utf8"));
    const now = Date.now();
    const out = {};
    for (const [ip, v] of Object.entries(raw || {})) {
      const ts = Number(v?._ts || 0) * (Number(v?._ts || 0) < 1e12 ? 1000 : 1);
      if (v && now - ts < ASN_CACHE_TTL_MS) out[ip] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function saveAsnCache(cache) {
  try {
    fs.mkdirSync(path.dirname(ASN_CACHE_PATH), { recursive: true });
    const tmp = `${ASN_CACHE_PATH}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(cache), "utf8");
    fs.renameSync(tmp, ASN_CACHE_PATH);
  } catch {}
}

export function classifyAsnStrict(info, { strictNoProxyFlag = true } = {}) {
  if (!info || (!info.isp && !info.org && !info.as)) {
    return { ok: false, networkClass: "unverified", proxyFlagged: false, reason: "ASN metadata unavailable (fail-closed)" };
  }
  const hosting = Boolean(info.hosting || info.security_hosting);
  const vpnOrTor = Boolean(info.security_vpn || info.security_tor);
  const proxyFlagged = Boolean(info.proxy || info.security_proxy);
  const combined = `${info.isp || ""} ${info.org || ""} ${info.as || ""} ${info.asname || ""} ${info.reverse || ""} ${info.domain || ""}`.toLowerCase();

  if (hosting || info.ipwho_type === "hosting") {
    return { ok: false, networkClass: "datacenter", proxyFlagged, reason: `Hosting/DC ASN (${info.isp || info.as || "flagged"})` };
  }
  if (vpnOrTor) {
    return { ok: false, networkClass: "datacenter", proxyFlagged, reason: `VPN/Tor ASN (${info.isp || info.as || "flagged"})` };
  }
  if (EDUCATION_RE.test(combined)) {
    return { ok: false, networkClass: "education", proxyFlagged, reason: `Education/Campus ASN (${info.isp || ""})` };
  }
  const kw = ALL_DC_KEYWORDS.find((k) => combined.includes(k));
  if (kw) {
    return { ok: false, networkClass: "datacenter", proxyFlagged, reason: `Datacenter keyword "${kw}" (${info.isp || ""})` };
  }
  const mWord = combined.match(DATACENTER_WORD_RE);
  if (mWord) {
    return { ok: false, networkClass: "datacenter", proxyFlagged, reason: `Datacenter pattern "${mWord[1]}" (${info.isp || ""})` };
  }
  if (strictNoProxyFlag && proxyFlagged) {
    return { ok: false, networkClass: "proxy_flagged", proxyFlagged: true, reason: `Proxy-flagged IP (${info.isp || ""})` };
  }
  return {
    ok: true,
    networkClass: info.mobile ? "mobile" : "residential",
    proxyFlagged,
    reason: info.mobile ? "Verified Mobile ISP" : "Verified Pure-Residential ISP",
  };
}

export async function lookupAsnBatch(ips = []) {
  const unique = Array.from(new Set(ips.filter((ip) => isPublicIPv4(ip))));
  const cache = loadAsnCache();
  const out = {};
  const missing = [];

  for (const ip of unique) {
    const c = cache[ip];
    if (c && (c.isp || c.as) && ("ipwho_checked" in c || "asname" in c)) {
      out[ip] = c;
    } else {
      missing.push(ip);
    }
  }

  for (let i = 0; i < missing.length; i += 80) {
    const batch = missing.slice(i, i + 80);
    try {
      const res = await fetch(
        "http://ip-api.com/batch?fields=query,status,country,countryCode,city,isp,org,as,asname,reverse,hosting,proxy,mobile",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(batch),
          signal: AbortSignal.timeout(6000),
        }
      );
      if (res.ok) {
        const rows = await res.json();
        for (const r of rows || []) {
          if (r?.status === "success" && r.query) {
            out[r.query] = { ...(out[r.query] || {}), ...r };
          }
        }
      }
    } catch {}
  }

  await Promise.allSettled(
    missing.map(async (ip) => {
      const cur = out[ip] ? { ...out[ip] } : { query: ip };
      try {
        const r = await fetch(`https://ipwho.is/${ip}`, { signal: AbortSignal.timeout(3500) });
        if (r.ok) {
          const w = await r.json();
          if (w && w.success !== false) {
            cur.ipwho_checked = true;
            cur.ipwho_type = w.type || "";
            cur.country = cur.country || w.country;
            cur.countryCode = cur.countryCode || w.country_code;
            cur.city = cur.city || w.city;
            cur.isp = cur.isp || w.connection?.isp || w.connection?.org || "";
            cur.org = cur.org || w.connection?.org || "";
            cur.domain = cur.domain || w.connection?.domain || "";
            if (!cur.as && w.connection?.asn) cur.as = `AS${w.connection.asn} ${cur.org || cur.isp}`.trim();
            cur.security_hosting = Boolean(w.security?.hosting || w.type === "hosting");
            cur.security_proxy = Boolean(w.security?.proxy);
            cur.security_vpn = Boolean(w.security?.vpn);
            cur.security_tor = Boolean(w.security?.tor);
          }
        }
      } catch {}

      if (!cur.isp && !cur.as) {
        try {
          const r2 = await fetch(`https://ipinfo.io/${ip}/json`, { signal: AbortSignal.timeout(3500) });
          if (r2.ok) {
            const d2 = await r2.json();
            if (d2?.org) {
              cur.isp = d2.org;
              cur.org = d2.org;
              cur.as = d2.org;
              cur.countryCode = cur.countryCode || d2.country;
              cur.country = cur.country || d2.country;
              cur.city = cur.city || d2.city;
            }
          }
        } catch {}
      }

      if (cur.isp || cur.as) {
        cur._ts = Math.floor(Date.now() / 1000);
        out[ip] = cur;
        cache[ip] = cur;
      }
    })
  );

  saveAsnCache(cache);
  return out;
}

export async function resolveHostIPv4(hostname) {
  if (net.isIPv4(hostname)) return hostname;
  try {
    const addrs = await dns.resolve4(hostname);
    return addrs?.[0] || null;
  } catch {
    return null;
  }
}

export function tcpPrecheck(proxyUrl, timeoutMs = TCP_PRECHECK_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL(proxyUrl); } catch { return resolve(false); }
    const host = parsed.hostname;
    const port = Number(parsed.port);
    if (!host || !port) return resolve(false);

    const sock = new net.Socket();
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { sock.destroy(); } catch {}
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
    try { sock.connect(port, host); } catch { finish(false); }
  });
}

function makeAgent(proxyUrl, timeoutMs = PROBE_TIMEOUT_MS) {
  const parsed = new URL(proxyUrl);
  const connTimeout = Math.min(1800, timeoutMs);
  if (parsed.protocol.startsWith("socks5")) {
    return new Socks5ProxyAgent(proxyUrl, {
      connectTimeout: connTimeout,
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
    });
  }
  return new ProxyAgent({
    uri: proxyUrl,
    connect: { timeout: connTimeout },
    headersTimeout: timeoutMs,
    bodyTimeout: timeoutMs,
  });
}

export async function probeProxyStrict(proxyUrl, timeoutMs = PROBE_TIMEOUT_MS) {
  let dispatcher;
  let hardTimer;
  const hardLimitMs = Math.max(4200, timeoutMs * 2 + 800);
  const work = (async () => {
  try {
    dispatcher = makeAgent(proxyUrl, timeoutMs);
    const echoEndpoints = [
      "https://api.ipify.org",
      "https://checkip.amazonaws.com",
      "https://icanhazip.com",
    ];

    let egressIp = null;
    let lat1 = null;
    try {
      const winner = await Promise.any(
        echoEndpoints.map(async (ep) => {
          const t0 = Date.now();
          const res = await undiciFetch(ep, {
            dispatcher,
            signal: AbortSignal.timeout(timeoutMs),
            headers: { "User-Agent": "Aries-Harvest/2.0" },
          });
          const lat = Date.now() - t0;
          if (res.status === 429 || res.status === 407) {
            throw Object.assign(new Error(`HTTP ${res.status}`), { fatalReason: `HTTP ${res.status}`, rateLimited: res.status === 429 });
          }
          if (!res.ok || lat > MAX_SINGLE_LATENCY_MS) {
            throw new Error(`HTTP ${res.status} (${lat}ms)`);
          }
          const body = await res.text();
          if (/<html|<head|<title/i.test(body)) throw new Error("HTML challenge");
          const m = body.match(IPV4_RE);
          const extractedIp = m?.[1] || null;
          if (!extractedIp || !isPublicIPv4(extractedIp)) throw new Error("Non-public IP");
          return { egressIp: extractedIp, lat };
        })
      );
      egressIp = winner.egressIp;
      lat1 = winner.lat;
    } catch (aggErr) {
      const firstErr = aggErr?.errors?.[0];
      if (firstErr?.fatalReason) {
        return { ok: false, reason: firstErr.fatalReason, rateLimited: Boolean(firstErr.rateLimited) };
      }
    }
    if (!egressIp) return { ok: false, reason: "Echo failed/timeout" };

    const check204 = async (targetUrl) => {
      const t0 = Date.now();
      const res = await undiciFetch(targetUrl, {
        dispatcher,
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "User-Agent": "Aries-Harvest/2.0" },
      });
      const lat = Date.now() - t0;
      if (res.status === 429) return { ok: false, rateLimited: true, reason: "HTTP 429 rate-limited" };
      if (res.status !== 204 && !res.ok) return { ok: false, reason: `HTTP ${res.status}` };
      if (lat > MAX_SINGLE_LATENCY_MS) return { ok: false, reason: `Slow ${lat}ms` };
      return { ok: true, lat };
    };

    const [p2, p3] = await Promise.all([
      check204("https://generativelanguage.googleapis.com/generate_204"),
      check204("https://www.gstatic.com/generate_204"),
    ]);
    if (!p2.ok) return p2;
    if (!p3.ok) return p3;

    const lats = [lat1, p2.lat, p3.lat];
    const avgLatencyMs = Math.round((lat1 + p2.lat + p3.lat) / 3);
    const jitterMs = Math.max(...lats) - Math.min(...lats);
    if (avgLatencyMs > MAX_AVG_LATENCY_MS) {
      return { ok: false, reason: `Avg latency ${avgLatencyMs}ms > ${MAX_AVG_LATENCY_MS}ms` };
    }
    if (jitterMs > MAX_JITTER_MS) {
      return { ok: false, reason: `High jitter ${jitterMs}ms` };
    }

    const parsed = new URL(proxyUrl);
    const ingressIp = await resolveHostIPv4(parsed.hostname);
    if (!isPublicIPv4(ingressIp)) {
      return { ok: false, reason: "Invalid ingress IP" };
    }

    return {
      ok: true,
      proxyUrl,
      maskedUrl: maskProxyUrl(proxyUrl),
      protocol: parsed.protocol.replace(":", ""),
      ingressIp,
      egressIp,
      latencyMs: avgLatencyMs,
      maxLatencyMs: Math.max(...lats),
      jitterMs,
      stabilityPct: 100,
    };
  } catch (err) {
    return { ok: false, reason: err?.message || "Probe error" };
  } finally {
    clearTimeout(hardTimer);
    try { Promise.resolve(dispatcher?.destroy?.()).catch(() => {}); } catch {}
  }
  })();
  const timeoutGuard = new Promise((resolve) => {
    hardTimer = setTimeout(() => {
      try { Promise.resolve(dispatcher?.destroy?.()).catch(() => {}); } catch {}
      resolve({ ok: false, reason: "Probe hard timeout" });
    }, hardLimitMs);
  });
  return Promise.race([work, timeoutGuard]);
}

export async function fetchFeedCandidates(maxScan = 15000, customFeeds = [], options = {}) {
  const {
    excludeUrls = null,
    includeLocalSeeds = true,
    includePreviousPoolFile = false,
  } = options || {};
  const excludedSet = excludeUrls instanceof Set ? excludeUrls : new Set(Array.isArray(excludeUrls) ? excludeUrls : []);
  const asnCache = loadAsnCache();
  const seen = new Set();
  const feedCandidates = [];
  const seedCandidates = [];

  const feeds = [
    ...HARVEST_FEEDS,
    ...(Array.isArray(customFeeds) ? customFeeds : [])
      .map((u) => String(u || "").trim())
      .filter((u) => u.startsWith("http"))
      .map((url) => ({ protocol: "http", url })),
  ];

  await Promise.allSettled(
    feeds.map(async ({ protocol, url }) => {
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(4500),
        });
        if (!res.ok) return;
        const text = await res.text();
        if (url.includes("geonode.com")) {
          const data = JSON.parse(text);
          for (const row of data?.data || []) {
            const proto = (row.protocols || []).includes("socks5") ? "socks5" : protocol;
            const norm = normalizeCandidateLine(`${proto}://${row.ip}:${row.port}`, proto);
            if (norm && !seen.has(norm) && !excludedSet.has(norm.toLowerCase())) {
              seen.add(norm);
              feedCandidates.push(norm);
            }
          }
          return;
        }
        for (const line of text.split(/\r?\n/)) {
          const norm = normalizeCandidateLine(line, protocol);
          if (norm && !seen.has(norm) && !excludedSet.has(norm.toLowerCase())) {
            seen.add(norm);
            feedCandidates.push(norm);
          }
        }
      } catch {}
    })
  );

  if (includeLocalSeeds) {
    const jsonSeeds = includePreviousPoolFile
      ? [POOL_JSON_PATH, path.join(DATA_DIR, "residential_farm_pool.json")]
      : [path.join(DATA_DIR, "residential_farm_pool.json")];
    for (const seedJson of jsonSeeds) {
      try {
        if (!fs.existsSync(seedJson)) continue;
        const raw = JSON.parse(fs.readFileSync(seedJson, "utf8"));
        for (const n of raw?.nodes || []) {
          const norm = normalizeCandidateLine(n?.url || "");
          if (norm && !seen.has(norm) && !excludedSet.has(norm.toLowerCase())) {
            seen.add(norm);
            seedCandidates.push(norm);
          }
        }
      } catch {}
    }
    const txtSeeds = includePreviousPoolFile
      ? [RESI_TXT_PATH, "/home/ubuntu/clean_residential.txt", "/home/ubuntu/live_residential_proxies.txt", "/home/ubuntu/fast_verified_pool.txt"]
      : ["/home/ubuntu/clean_residential.txt", "/home/ubuntu/live_residential_proxies.txt", "/home/ubuntu/fast_verified_pool.txt"];
    for (const seedTxt of txtSeeds) {
      try {
        if (!fs.existsSync(seedTxt)) continue;
        const text = fs.readFileSync(seedTxt, "utf8");
        for (const line of text.split(/\r?\n/)) {
          const norm = normalizeCandidateLine(line, "http");
          if (norm && !seen.has(norm) && !excludedSet.has(norm.toLowerCase())) {
            seen.add(norm);
            seedCandidates.push(norm);
          }
        }
      } catch {}
    }
  }

  // Prioritize unused residential seeds + ASN-cached residential feeds first so target counts fill quickly,
  // followed by fresh shuffled live feed candidates (filtering out known datacenter/VPN hosts).
  feedCandidates.sort(() => Math.random() - 0.5);
  seedCandidates.sort(() => Math.random() - 0.5);
  const combined = [...seedCandidates.slice(0, 600), ...feedCandidates, ...seedCandidates.slice(600)];
  const cachedResiFirst = [];
  const uncachedFeed = [];
  const hostCounts = new Map();
  for (const u of combined) {
    const host = new URL(u).hostname;
    const cached = asnCache[host];
    if (cached) {
      const verdict = classifyAsnStrict(cached, { strictNoProxyFlag: true });
      if (!verdict.ok) continue;
      const cnt = hostCounts.get(host) || 0;
      if (cnt >= 2) continue;
      hostCounts.set(host, cnt + 1);
      cachedResiFirst.push(u);
      continue;
    }
    const cnt = hostCounts.get(host) || 0;
    if (cnt >= 2) continue;
    hostCounts.set(host, cnt + 1);
    uncachedFeed.push(u);
  }
  const filtered = [...cachedResiFirst, ...uncachedFeed];

  return filtered.slice(0, Math.max(50, Math.min(Number(maxScan) || 15000, 45000)));
}

export async function runWithConcurrency(items, concurrency, fn, shouldStop) {
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      if (shouldStop && shouldStop()) break;
      const cur = idx++;
      await fn(items[cur], cur);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, worker));
}

export function syncHarvestedToResidentialFiles(pools = []) {
  try {
    const activeResi = pools
      .filter((p) => p?.isActive !== false && p?.proxyUrl && p?.isResidential === true && p?.ipType !== "datacenter" && p?.proxyFlagged !== true)
      .sort((a, b) => (a.latencyMs || 9999) - (b.latencyMs || 9999));

    const nodes = activeResi.slice(0, 80).map((p) => ({
      url: p.proxyUrl,
      maskedUrl: maskProxyUrl(p.proxyUrl),
      ingressIp: p.ingressIp || p.egressIp || null,
      egressIp: p.egressIp || null,
      latencyMs: p.latencyMs || 500,
      jitterMs: p.jitterMs || 0,
      country: p.country || p.loc || null,
      countryCode: p.countryCode || p.loc || null,
      city: p.city || null,
      isp: p.isp || null,
      asn: p.asn || null,
      networkClass: p.networkClass || "residential",
      proxyFlagged: Boolean(p.proxyFlagged),
      isResidential: true,
      verifiedAt: p.lastTestedAt || new Date().toISOString(),
    }));

    fs.mkdirSync(path.dirname(POOL_JSON_PATH), { recursive: true });
    fs.writeFileSync(
      POOL_JSON_PATH,
      JSON.stringify({ updatedAt: new Date().toISOString(), count: nodes.length, nodes }, null, 2)
    );
    fs.writeFileSync(RESI_TXT_PATH, nodes.map((n) => n.url).join("\n") + (nodes.length ? "\n" : ""));
    fetch(RESI_GW_RELOAD_URL, { method: "POST", signal: AbortSignal.timeout(2500) }).catch(() => {});
  } catch {}
}

export function isHarvestManagedPool(pool) {
  if (!pool) return false;
  const n = String(pool.name || "");
  return (
    pool.harvestedBy === "proxy-harvest" ||
    n.startsWith("Resi-") ||
    n.startsWith("harvest-") ||
    n.startsWith("seren-") ||
    n.startsWith("FreeProxy-") ||
    n.startsWith("Proxy-cron-") ||
    pool.resiManager === true
  );
}

export async function pruneAndVerifyHarvestedPools({
  getProxyPools,
  updateProxyPool,
  deleteProxyPools,
  getProviderConnections = null,
  strictNoProxyFlag = true,
}) {
  const [all, conns] = await Promise.all([
    getProxyPools(),
    typeof getProviderConnections === "function" ? getProviderConnections().catch(() => []) : Promise.resolve([]),
  ]);
  const boundIds = new Set(
    (conns || []).map((c) => c?.providerSpecificData?.proxyPoolId).filter(Boolean)
  );
  const managed = all.filter((p) => isHarvestManagedPool(p) && !boundIds.has(p.id));
  const toDelete = [];
  const kept = [];
  const seenEgress = new Set();
  const seenIngress = new Set();
  let datacenterBlocked = 0;
  let deadOrRateLimited = 0;

  const probeResults = [];
  await runWithConcurrency(managed, 20, async (pool) => {
    const aliveTcp = await tcpPrecheck(pool.proxyUrl, 900);
    if (!aliveTcp) {
      toDelete.push(pool.id);
      deadOrRateLimited++;
      return;
    }
    const p1 = await probeProxyStrict(pool.proxyUrl, PROBE_TIMEOUT_MS);
    if (!p1.ok) {
      toDelete.push(pool.id);
      deadOrRateLimited++;
      return;
    }
    const p2 = await probeProxyStrict(pool.proxyUrl, PROBE_TIMEOUT_MS);
    if (!p2.ok) {
      toDelete.push(pool.id);
      deadOrRateLimited++;
      return;
    }
    const probe = {
      ...p2,
      latencyMs: Math.round((p1.latencyMs + p2.latencyMs) / 2),
      jitterMs: Math.max(p1.jitterMs, p2.jitterMs),
    };
    probeResults.push({ pool, probe });
  });

  const ips = Array.from(new Set(probeResults.flatMap(({ probe }) => [probe.ingressIp, probe.egressIp]).filter(Boolean)));
  const asnMap = ips.length ? await lookupAsnBatch(ips) : {};

  probeResults.sort((a, b) => a.probe.latencyMs - b.probe.latencyMs);

  for (const { pool, probe } of probeResults) {
    const inVerdict = classifyAsnStrict(asnMap[probe.ingressIp], { strictNoProxyFlag });
    const egVerdict = classifyAsnStrict(asnMap[probe.egressIp], { strictNoProxyFlag });
    if (!inVerdict.ok || !egVerdict.ok) {
      toDelete.push(pool.id);
      datacenterBlocked++;
      continue;
    }
    if (seenIngress.has(probe.ingressIp) || seenEgress.has(probe.egressIp)) {
      toDelete.push(pool.id);
      continue;
    }
    seenIngress.add(probe.ingressIp);
    seenEgress.add(probe.egressIp);

    const egInfo = asnMap[probe.egressIp] || {};
    const updated = {
      ...pool,
      isActive: true,
      testStatus: "active",
      lastError: null,
      lastTestedAt: new Date().toISOString(),
      ingressIp: probe.ingressIp,
      egressIp: probe.egressIp,
      latencyMs: probe.latencyMs,
      jitterMs: probe.jitterMs,
      stabilityPct: 100,
      country: egInfo.country || pool.country || null,
      countryCode: egInfo.countryCode || pool.countryCode || null,
      city: egInfo.city || pool.city || null,
      isp: egInfo.isp || pool.isp || null,
      asn: egInfo.as || pool.asn || null,
      networkClass: egVerdict.networkClass,
      ipType: "residential",
      isResidential: true,
      proxyFlagged: egVerdict.proxyFlagged || inVerdict.proxyFlagged,
      harvestedBy: "proxy-harvest",
    };
    await updateProxyPool(pool.id, updated);
    kept.push(updated);
  }

  if (toDelete.length > 0) {
    await deleteProxyPools(toDelete);
  }
  syncHarvestedToResidentialFiles(kept);
  return { checked: managed.length, kept: kept.length, deleted: toDelete.length, datacenterBlocked, deadOrRateLimited };
}

const LOCAL_DIRECT_PROVIDERS = new Set([
  "local-device", "searxng", "edge-tts", "google-tts", "devin-cli", "opencode",
  "openai-compatible-chat-openhop", "openai-compatible-chat-kilo",
]);

/**
 * Distribute verified pure-residential proxies fairly (round-robin interleaved)
 * directly to active external provider connections (proxyPoolId = null, ZERO group proxies).
 */
export function buildFairProviderAssignments(connections = [], verifiedProxies = []) {
  const eligible = (verifiedProxies || [])
    .filter((p) => p?.proxyUrl && p?.isActive !== false && p?.isResidential === true && p?.ipType !== "datacenter" && p?.proxyFlagged !== true)
    .sort((a, b) => ((a.latencyMs || 9999) + (a.jitterMs || 0) * 0.5) - ((b.latencyMs || 9999) + (b.jitterMs || 0) * 0.5));
  const fastOnly = eligible.filter((p) => !Number.isFinite(p.latencyMs) || p.latencyMs <= 950);
  const cleanProxies = fastOnly.length >= 3 ? fastOnly : eligible.slice(0, Math.max(5, fastOnly.length));

  if (cleanProxies.length === 0) {
    return { updates: [], providerStats: {}, totalExternalConnections: 0, distinctProxiesUsed: 0 };
  }

  const byProv = new Map();
  for (const c of connections || []) {
    if (!c || c.isActive === false || LOCAL_DIRECT_PROVIDERS.has(c.provider)) continue;
    const bUrl = String(c?.providerSpecificData?.baseUrl || c?.baseUrl || "");
    if (/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(bUrl)) continue;
    if (!byProv.has(c.provider)) byProv.set(c.provider, []);
    byProv.get(c.provider).push(c);
  }

  // Sort single-connection providers first so each small provider gets a distinct fast proxy,
  // then spread multi-connection providers evenly across all clean proxies with staggered offsets.
  const providers = Array.from(byProv.keys()).sort((a, b) => {
    const diff = byProv.get(a).length - byProv.get(b).length;
    return diff !== 0 ? diff : a.localeCompare(b);
  });

  const updates = [];
  const providerStats = {};
  const usedUrls = new Set();
  const K = cleanProxies.length;

  providers.forEach((prov, pIdx) => {
    const conns = byProv.get(prov);
    const urlsForProv = new Set();
    let minLat = Infinity;
    let maxLat = 0;

    conns.forEach((conn, cIdx) => {
      const slot = (pIdx + cIdx) % K;
      const picked = cleanProxies[slot];
      const psd = conn.providerSpecificData || {};
      const alreadySet =
        (psd.connectionProxyEnabled === true || psd.connectionProxyEnabled === 1) &&
        (psd.proxyPoolId === null || psd.proxyPoolId === undefined) &&
        psd.connectionProxyUrl === picked.proxyUrl &&
        !conn.lastError;

      urlsForProv.add(picked.proxyUrl);
      usedUrls.add(picked.proxyUrl);
      if (Number.isFinite(picked.latencyMs)) {
        minLat = Math.min(minLat, picked.latencyMs);
        maxLat = Math.max(maxLat, picked.latencyMs);
      }

      if (!alreadySet) {
        updates.push({
          id: conn.id,
          provider: prov,
          proxyUrl: picked.proxyUrl,
        });
      }
    });

    providerStats[prov] = {
      connections: conns.length,
      distinctProxies: urlsForProv.size,
      minLatencyMs: minLat === Infinity ? null : minLat,
      maxLatencyMs: maxLat || null,
    };
  });

  return {
    updates,
    providerStats,
    totalExternalConnections: providers.reduce((sum, p) => sum + byProv.get(p).length, 0),
    distinctProxiesUsed: usedUrls.size,
  };
}

export async function distributeHarvestedFairlyToProviders({
  getProxyPools,
  getProviderConnections,
  updateProviderConnection,
}) {
  const [pools, conns] = await Promise.all([
    getProxyPools(),
    getProviderConnections(),
  ]);
  const cleanProxies = pools.filter(
    (p) => p?.isActive !== false && p?.proxyUrl && p?.isResidential === true && p?.ipType !== "datacenter" && p?.proxyFlagged !== true
  );
  const plan = buildFairProviderAssignments(conns, cleanProxies);

  if (plan.updates.length > 0 && typeof updateProviderConnection === "function") {
    for (const u of plan.updates) {
      const conn = conns.find((c) => c.id === u.id);
      if (!conn) continue;
      const nextPsd = {
        ...(conn.providerSpecificData || {}),
        connectionProxyEnabled: true,
        proxyPoolId: null,
        connectionProxyUrl: u.proxyUrl,
        connectionNoProxy: conn.providerSpecificData?.connectionNoProxy || "127.0.0.1,localhost,",
      };
      await updateProviderConnection(u.id, {
        providerSpecificData: nextPsd,
        connectionProxyEnabled: true,
        proxyPoolId: null,
        connectionProxyUrl: u.proxyUrl,
        testStatus: "active",
        lastError: null,
      });
    }
  }

  return {
    updatedConnections: plan.updates.length,
    totalExternalConnections: plan.totalExternalConnections,
    distinctProxiesUsed: plan.distinctProxiesUsed,
    providersCovered: Object.keys(plan.providerStats).length,
    providerStats: plan.providerStats,
    groupProxyPoolsCreated: 0,
  };
}
