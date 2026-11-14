import { Readable } from "stream";
import { MEMORY_CONFIG } from "../config/runtimeConfig.js";
import { dbg } from "./debugLog.js";

const originalFetch = globalThis.fetch;
const proxyDispatchers = new Map();

// ─── TLS fingerprinting via got-scraping (browser-like JA3) ───────────────
// Disabled: not in use. Kept commented for future re-enable.
// Restore the original block to re-enable per-host JA3 spoofing.
/*
let _gotScraping = null;
let _gotScrapingChecked = false;
const _gotScrapingLoggedHosts = new Set();

async function getGotScraping() {
  if (_gotScrapingChecked) return _gotScraping;
  _gotScrapingChecked = true;
  try {
    const mod = await import("got-scraping");
    _gotScraping = typeof mod.gotScraping === "function" ? mod.gotScraping : null;
    if (_gotScraping) dbg("TLS", "got-scraping loaded (browser-like JA3 enabled)");
  } catch (e) {
    console.warn(`[ProxyFetch] got-scraping unavailable, falling back to native fetch: ${e.message}`);
    _gotScraping = null;
  }
  return _gotScraping;
}

async function gotScrapingFetch(url, options) {
  const gs = await getGotScraping();
  if (!gs) return null;

  const method = (options.method || "GET").toUpperCase();
  const headersInit = options.headers || {};
  const headers = headersInit instanceof Headers
    ? Object.fromEntries(headersInit.entries())
    : { ...headersInit };

  return new Promise((resolve, reject) => {
    let settled = false;
    const stream = gs.stream({
      url,
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : options.body,
      throwHttpErrors: false,
      retry: { limit: 0 },
      timeout: { request: undefined },
      followRedirect: false,
      decompress: true,
    });

    if (options.signal) {
      const onAbort = () => { try { stream.destroy(new Error("aborted")); } catch { } };
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }

    stream.once("response", (res) => {
      if (settled) return;
      settled = true;
      const resHeaders = new Headers();
      for (const [k, v] of Object.entries(res.headers || {})) {
        if (Array.isArray(v)) v.forEach((x) => resHeaders.append(k, String(x)));
        else if (v != null) resHeaders.set(k, String(v));
      }
      const body = Readable.toWeb(stream);
      resolve(new Response(body, { status: res.statusCode, statusText: res.statusMessage || "", headers: resHeaders }));
    });

    stream.once("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

async function tryGotScrapingFetch(url, options) {
  try {
    const res = await gotScrapingFetch(url, options);
    if (res) {
      try {
        const host = new URL(typeof url === "string" ? url : url.toString()).hostname;
        if (!_gotScrapingLoggedHosts.has(host)) {
          _gotScrapingLoggedHosts.add(host);
          dbg("TLS", `using got-scraping for ${host}`);
        }
      } catch { }
    }
    return res;
  } catch (e) {
    console.warn(`[ProxyFetch] got-scraping request failed, fallback to native fetch: ${e.message}`);
    return null;
  }
}
*/

// DNS cache - use Map to avoid prototype pollution via malformed hostnames
const DNS_CACHE = new Map();
const MITM_BYPASS_HOSTS = [
  "cloudcode-pa.googleapis.com",
  "daily-cloudcode-pa.googleapis.com",
  "api.individual.githubcopilot.com",
  "q.us-east-1.amazonaws.com",
  "codewhisperer.us-east-1.amazonaws.com",
  "api2.cursor.sh",
];
const GOOGLE_DNS_SERVERS = ["8.8.8.8", "8.8.4.4"];
const HTTPS_PORT = 443;
const HTTP_SUCCESS_MIN = 200;
const HTTP_SUCCESS_MAX = 300;

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

/**
 * Resolve real IP using Google DNS (bypass system DNS)
 */
async function resolveRealIP(hostname) {
  const cached = DNS_CACHE.get(hostname);
  if (cached && Date.now() < cached.expiry) return cached.ip;

  try {
    const dns = await import("dns");
    const { promisify } = await import("util");
    const resolver = new dns.Resolver();
    resolver.setServers(GOOGLE_DNS_SERVERS);
    const resolve4 = promisify(resolver.resolve4.bind(resolver));
    const addresses = await resolve4(hostname);
    DNS_CACHE.set(hostname, { ip: addresses[0], expiry: Date.now() + MEMORY_CONFIG.dnsCacheTtlMs });
    return addresses[0];
  } catch (error) {
    console.warn(`[ProxyFetch] DNS resolve failed for ${hostname}:`, error.message);
    return null;
  }
}

/**
 * Check if request should bypass MITM DNS redirect
 */
function shouldBypassMitmDns(url) {
  try {
    const hostname = new URL(url).hostname;
    return MITM_BYPASS_HOSTS.some(host => hostname.includes(host));
  } catch { return false; }
}

function shouldBypassByNoProxy(targetUrl, noProxyValue) {
  const noProxy = normalizeString(noProxyValue);
  if (!noProxy) return false;

  let hostname;
  try { hostname = new URL(targetUrl).hostname.toLowerCase(); } catch { return false; }
  const patterns = noProxy.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);

  return patterns.some((pattern) => {
    if (pattern === "*") return true;
    if (pattern.startsWith(".")) return hostname.endsWith(pattern) || hostname === pattern.slice(1);
    return hostname === pattern || hostname.endsWith(`.${pattern}`);
  });
}

/**
 * Get proxy URL from environment
 */
function getEnvProxyUrl(targetUrl) {
  const noProxy = process.env.NO_PROXY || process.env.no_proxy;
  if (shouldBypassByNoProxy(targetUrl, noProxy)) return null;

  let protocol;
  try { protocol = new URL(targetUrl).protocol; } catch { return null; }

  if (protocol === "https:") {
    return process.env.HTTPS_PROXY || process.env.https_proxy ||
      process.env.ALL_PROXY || process.env.all_proxy;
  }

  return process.env.HTTP_PROXY || process.env.http_proxy ||
    process.env.ALL_PROXY || process.env.all_proxy;
}

/**
 * Normalize proxy URL (allow host:port)
 */
function normalizeProxyUrl(proxyUrl) {
  const normalizedInput = normalizeString(proxyUrl);
  if (!normalizedInput) return null;

  try {

    new URL(normalizedInput);
    return normalizedInput;
  } catch {
    // Allow "127.0.0.1:7890" style values
    return `http://${normalizedInput}`;
  }
}

function resolveConnectionProxyUrl(targetUrl, proxyOptions) {
  const enabled = proxyOptions?.enabled === true || proxyOptions?.connectionProxyEnabled === true;
  if (!enabled) return null;

  const proxyUrlRaw = normalizeString(proxyOptions?.url ?? proxyOptions?.connectionProxyUrl);
  if (!proxyUrlRaw) return null;

  const noProxy = normalizeString(proxyOptions?.noProxy ?? proxyOptions?.connectionNoProxy);
  if (noProxy && shouldBypassByNoProxy(targetUrl, noProxy)) return null;

  return normalizeProxyUrl(proxyUrlRaw);
}

/**
 * Create proxy dispatcher lazily (undici-compatible)
 */
async function getDispatcher(proxyUrl) {
  const normalized = normalizeProxyUrl(proxyUrl);
  if (!normalized) return null;

  if (!proxyDispatchers.has(normalized)) {
    // Evict oldest entry if max size reached
    if (proxyDispatchers.size >= MEMORY_CONFIG.proxyDispatchersMaxSize) {
      proxyDispatchers.delete(proxyDispatchers.keys().next().value);
    }
    const { ProxyAgent } = await import("undici");
    proxyDispatchers.set(normalized, new ProxyAgent({ uri: normalized }));
  }

  return proxyDispatchers.get(normalized);
}

/**
 * Create HTTPS request with manual socket connection (bypass DNS)
 */
async function createBypassRequest(parsedUrl, realIP, options) {
  const httpsModule = await import("https");
  const netModule = await import("net");
  // CJS modules expose exports via .default in ESM dynamic import context
  const https = httpsModule.default ?? httpsModule;
  const net = netModule.default ?? netModule;

  return new Promise((resolve, reject) => {
    const socket = new net.Socket();

    socket.connect(HTTPS_PORT, realIP, () => {
      const reqOptions = {
        socket,
        // SNI + cert hostname are validated against the hostname the caller
        // asked for, not the IP we connected to. This keeps the DNS-bypass
        // (avoiding /etc/hosts MITM) while still rejecting on-path attackers
        // that present a different cert. The MITM_BYPASS_HOSTS targets are
        // all public-CA-issued (Google / GitHub / AWS / Cursor) so default
        // verification works without any extra trust store.
        servername: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || "POST",
        headers: {
          ...options.headers,
          Host: parsedUrl.hostname,
        },
      };

      const req = https.request(reqOptions, (res) => {
        const response = {
          ok: res.statusCode >= HTTP_SUCCESS_MIN && res.statusCode < HTTP_SUCCESS_MAX,
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: new Map(Object.entries(res.headers)),
          body: Readable.toWeb(res),
          text: async () => {
            const chunks = [];
            for await (const chunk of res) chunks.push(chunk);
            return Buffer.concat(chunks).toString();
          },
          json: async () => JSON.parse(await response.text()),
        };
        resolve(response);
      });

      req.on("error", reject);
      if (options.body) {
        req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
      }
      req.end();
    });

    socket.on("error", reject);
  });
}

// OpenCode's free-tier gate answers 403 `FreeTierError` when the request
// exits from an IP it has flagged — the transport itself succeeded, so the
// proxy-failure fallback below never sees it and every retry keeps leaving
// through the same flagged proxy. Live measurement (#4983): identical body and
// headers in the same minute — flagged pool egress → 403 FreeTierError,
// direct egress → 200.
const FREE_TIER_ERROR_MARKERS = ["FreeTierError", "FreeUsageLimitError"];
/** Rebuild a response whose body we buffered while inspecting it. */
function bufferedResponse(text, original) {
  const headers = new Headers(original.headers);
  // The body was decoded while reading, so upstream framing no longer applies.
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(text, { status: original.status, statusText: original.statusText, headers });
}

/**
 * After a proxied attempt, replay once on the direct egress when upstream
 * rejected the *proxy's IP* (403 FreeTierError). A body already consumed by
 * the first attempt cannot be resent, and strictProxy keeps its contract of
 * never leaving over another path — both return the rejection as-is.
 */
async function replayFreeTierRejectionDirect(url, options, proxied, proxyUrl) {
  if (proxied.status !== 403 && proxied.status !== 429) return proxied;
  let text;
  try {
    text = await proxied.text();
  } catch {
    return proxied;
  }
  const isFreeTierRejection = FREE_TIER_ERROR_MARKERS.some((m) => text.includes(m));
  if (!isFreeTierRejection) return bufferedResponse(text, proxied);
  if (options?.body && typeof options.body.getReader === "function" && options.body.locked) {
    return bufferedResponse(text, proxied);
  }
  if (proxyUrl) {
    console.warn(`[ProxyFetch] Proxy egress rejected by OpenCode free-tier gate (403 FreeTierError); direct replay skipped to protect main IP: ${targetHost(url)}`);
    return bufferedResponse(text, proxied);
  }
  console.warn(`[ProxyFetch] Proxy egress rejected by the OpenCode free-tier gate (403 FreeTierError); replaying direct: ${targetHost(url)}`);
  try {
    return await originalFetch(url, options);
  } catch (directError) {
    // The direct replay failed outright — surface the original rejection.
    console.warn(`[ProxyFetch] Direct replay failed: ${directError.message}`);
    return bufferedResponse(text, proxied);
  }
}

function targetHost(url) {
  try {
    return new URL(typeof url === "string" ? url : url.toString()).host;
  } catch {
    return String(url);
  }
}

export async function proxyAwareFetch(url, options = {}, proxyOptions = null) {
  const targetUrl = typeof url === "string" ? url : url.toString();

  // Vercel relay: forward request via relay headers
  const vercelRelayUrl = normalizeString(proxyOptions?.vercelRelayUrl);
  if (vercelRelayUrl) {
    const parsed = new URL(targetUrl);
    const baseHeaders = options.headers instanceof Headers
      ? Object.fromEntries(options.headers.entries())
      : { ...(options.headers || {}) };
    const relayHeaders = {
      ...baseHeaders,
      "x-relay-target": `${parsed.protocol}//${parsed.host}`,
      "x-relay-path": `${parsed.pathname}${parsed.search}`,
    };
    const res = await originalFetch(vercelRelayUrl, { ...options, headers: relayHeaders });
    if (proxyOptions?.strictProxy === true) return res;
    return await replayFreeTierRejectionDirect(url, options, res, null);
  }
  const connectionProxyUrl = resolveConnectionProxyUrl(targetUrl, proxyOptions);
  const envProxyUrl = connectionProxyUrl ? null : normalizeProxyUrl(getEnvProxyUrl(targetUrl));
  const proxyUrl = connectionProxyUrl || envProxyUrl;

  // MITM DNS bypass: for known MITM-intercepted hosts, resolve real IP to avoid DNS spoof
  if (shouldBypassMitmDns(targetUrl)) {
    if (proxyUrl) {
      // Proxy resolves DNS externally (not affected by /etc/hosts) - use proxy directly
      try {
        const dispatcher = await getDispatcher(proxyUrl);
        return await originalFetch(url, { ...options, dispatcher });
      } catch (proxyError) {
        if (proxyOptions?.strictProxy === true) {
          throw new Error(`[ProxyFetch] Proxy required but failed (strictProxy=true): ${proxyError.message}`);
        }
        console.warn(`[ProxyFetch] Proxy failed, falling back to direct bypass: ${proxyError.message}`);
      }
    }
    // No proxy - manually resolve real IP to bypass DNS spoof
    try {
      const parsedUrl = new URL(targetUrl);
      const realIP = await resolveRealIP(parsedUrl.hostname);
      if (realIP) return await createBypassRequest(parsedUrl, realIP, options);
    } catch (error) {
      console.warn(`[ProxyFetch] MITM bypass failed: ${error.message}`);
    }
  }

  if (proxyUrl) {
    try {
      const dispatcher = await getDispatcher(proxyUrl);
      const res = await originalFetch(url, { ...options, dispatcher });
      if (res.status === 407) {
        throw new Error("HTTP 407 Proxy Authentication Required (credentials invalid or plan expired)");
      }
      // strictProxy never leaves the configured path — pass the rejection through.
      if (proxyOptions?.strictProxy === true) return res;
      return await replayFreeTierRejectionDirect(url, options, res, proxyUrl);
    } catch (proxyError) {
      // PV-FAILOVER: proxy mati -> coba spare proxy sehat dari pool file
      // (ditulis pv_pool_sync). Tetap TIDAK pernah fallback ke direct (main IP aman).
      try {
        const fsMod = await import("node:fs");
        const poolRaw = fsMod.readFileSync("/home/ubuntu/.aries-router/pv_pool.json", "utf8");
        const spares = (JSON.parse(poolRaw).urls || []).filter(
          (u) => u && u !== proxyUrl && u !== "http://127.0.0.1:8118"
        );
        let lastErr = proxyError;
        for (let i = 0; i < Math.min(2, spares.length); i++) {
          const spare = spares[Math.floor(Math.random() * spares.length)];
          try {
            const d2 = await getDispatcher(spare);
            const res2 = await originalFetch(url, { ...options, dispatcher: d2 });
            if (res2.status === 407) throw new Error("407 on spare");
            console.warn(`[ProxyFetch] PV-FAILOVER: ${proxyUrl} -> ${spare} OK`);
            return await replayFreeTierRejectionDirect(url, options, res2, spare);
          } catch (e2) {
            lastErr = e2;
          }
        }
        // spare terakhir: coba WARP
        try {
          const d3 = await getDispatcher("http://127.0.0.1:8118");
          const res3 = await originalFetch(url, { ...options, dispatcher: d3 });
          console.warn(`[ProxyFetch] PV-FAILOVER: -> WARP OK`);
          return res3;
        } catch (e3) {
          lastErr = e3;
        }
        throw new Error(`[ProxyFetch] Proxy failed + failover exhausted (${lastErr.message}); direct fallback blocked.`);
      } catch (finalErr) {
        throw new Error(`[ProxyFetch] Proxy required but failed (${finalErr.message}); direct fallback blocked to protect main IP.`);
      }
    }
  }

  if (typeof options.directFetch === "function" && options.directFetchProxy) {
    return options.directFetch(url, options);
  }

  // PV-DEFAULT-EGRESS (bawaan wajib aries router):
  // tanpa proxy per-connection -> pakai pool egress sehat (pv_pool.json, rotasi),
  // gagal -> WARP. TIDAK PERNAH direct (main IP terlindungi dari block provider).
  try {
    const fsMod = await import("node:fs");
    const pool = JSON.parse(fsMod.readFileSync("/home/ubuntu/.aries-router/pv_pool.json", "utf8"));
    const urls = (pool.urls || []).filter((u) => u && !u.includes("127.0.0.1"));
    const candidates = ["http://127.0.0.1:8118"]; // WARP duluan (IP bersih, paling reliable)
    if (urls.length) {
      const pick = urls[Math.floor(Date.now() / 1000) % urls.length];
      candidates.push(pick, ...urls.filter((u) => u !== pick).slice(0, 2));
    }
    let lastE = null;
    for (const cand of candidates) {
      try {
        const dispatcher = await getDispatcher(cand);
        return await originalFetch(url, { ...options, dispatcher });
      } catch (e) {
        lastE = e;
      }
    }
    console.warn(`[ProxyFetch] PV-DEFAULT-EGRESS exhausted (${lastE?.message}); fallback direct (guaranteed work).`);
  } catch (e) {
    console.warn(`[ProxyFetch] PV-DEFAULT-EGRESS setup failed (${e?.message}); fallback direct.`);
  }
  // Guaranteed-work: direct sebagai pintu terakhir supaya OpenCode gak pernah mati.
  return originalFetch(url, options);
}

/**
 * Patched global fetch with env-proxy support and MITM DNS bypass
 */
async function patchedFetch(url, options = {}) {
  return proxyAwareFetch(url, options, null);
}

// Idempotency guard - only patch once to avoid wrapping multiple times
if (globalThis.fetch !== patchedFetch) {
  globalThis.fetch = patchedFetch;
}

export default patchedFetch;
