import { ProxyAgent, Socks5ProxyAgent, fetch as undiciFetch } from "undici";

const DEFAULT_TEST_URL = "https://1.1.1.1/cdn-cgi/trace";
const DEFAULT_TIMEOUT_MS = 6000;

function getErrorMessage(err) {
  if (!err) return "Unknown error";
  const base = err?.message || String(err);
  const causeCode = err?.cause?.code || err?.code;
  const causeMessage = err?.cause?.message;

  if (causeMessage && causeMessage !== base) {
    return causeCode ? `${base}: ${causeMessage} (${causeCode})` : `${base}: ${causeMessage}`;
  }

  if (causeCode && !base.includes(causeCode)) {
    return `${base} (${causeCode})`;
  }

  return base;
}

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function createAgentForProxy(normalizedProxyUrl) {
  const parsed = new URL(normalizedProxyUrl);
  if (parsed.protocol === "socks5:" || parsed.protocol === "socks5h:") {
    const cleanUrl = normalizedProxyUrl.replace(/^socks5h:/i, "socks5:");
    return new Socks5ProxyAgent(cleanUrl);
  }
  return new ProxyAgent({ uri: normalizedProxyUrl });
}

export async function testProxyUrl({ proxyUrl, testUrl, timeoutMs } = {}) {
  const normalizedProxyUrl = normalizeString(proxyUrl);
  if (!normalizedProxyUrl) {
    return { ok: false, status: 400, error: "proxyUrl is required" };
  }

  const normalizedTestUrl = normalizeString(testUrl) || DEFAULT_TEST_URL;
  const timeoutMsRaw = Number(timeoutMs);
  const normalizedTimeoutMs =
    Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
      ? Math.min(timeoutMsRaw, 30000)
      : DEFAULT_TIMEOUT_MS;

  let dispatcher;

  try {
    try {
      dispatcher = createAgentForProxy(normalizedProxyUrl);
    } catch (err) {
      return {
        ok: false,
        status: 400,
        error: `Invalid proxy URL: ${err?.message || String(err)}`,
      };
    }

    const controller = new AbortController();
    const startedAt = Date.now();
    const timer = setTimeout(() => controller.abort(), normalizedTimeoutMs);

    try {
      const res = await undiciFetch(normalizedTestUrl, {
        method: normalizedTestUrl.includes("/cdn-cgi/trace") || normalizedTestUrl.includes("generate_204") ? "GET" : "HEAD",
        dispatcher,
        signal: controller.signal,
        headers: {
          "User-Agent": "Aries-Router",
        },
      });

      return {
        ok: res.ok || res.status === 204,
        status: res.status,
        statusText: res.statusText,
        url: normalizedTestUrl,
        elapsedMs: Date.now() - startedAt,
        latencyMs: Date.now() - startedAt,
      };
    } catch (err) {
      const message =
        err?.name === "AbortError"
          ? "Proxy test timed out"
          : getErrorMessage(err);
      return { ok: false, status: 500, error: message };
    } finally {
      clearTimeout(timer);
    }
  } finally {
    try {
      Promise.resolve(dispatcher?.destroy?.()).catch(() => {});
    } catch {}
  }
}
