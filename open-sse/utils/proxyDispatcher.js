import dns from "node:dns";
import { isIP } from "node:net";
import { TLS_ECDH_CURVE } from "../config/tlsConfig.js";

const LOCAL_DNS_TIMEOUT_MS = 5000;

function dnsModeError() {
  return Object.assign(new Error("Invalid proxy DNS mode: use dns=local or dns=remote on a SOCKS5 URL"), {
    code: "ERR_PROXY_DNS_MODE",
  });
}

async function lookupLocal(hostname) {
  let timer;
  try {
    return await Promise.race([
      dns.promises.lookup(hostname),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error("Local proxy DNS lookup timed out"), {
          code: "ETIMEDOUT",
        })), LOCAL_DNS_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Create an Undici dispatcher for HTTP/HTTPS or SOCKS5/SOCKS5H proxies.
 * Keeps TCP/CONNECT timeout tight (3.5s) for fast dead-proxy failover while
 * allowing realistic headersTimeout (45s) for slow-thinking LLM responses.
 */
export async function createProxyDispatcher(options) {
  const url = new URL(options.uri);
  const modes = url.searchParams.getAll("dns");
  const socks5 = url.protocol === "socks5:" || url.protocol === "socks5h:";
  if (modes.length && (!socks5 || modes.length !== 1 || !["local", "remote"].includes(modes[0]))) {
    throw dnsModeError();
  }
  const { ProxyAgent, Socks5ProxyAgent } = await import("undici");
  const agentOptions = {
    ...options,
    connect: { timeout: 3500, ecdhCurve: TLS_ECDH_CURVE, ...(options.connect || {}) },
    requestTls: { ecdhCurve: TLS_ECDH_CURVE, ...(options.requestTls || {}) },
    headersTimeout: options.headersTimeout || 45000,
    maxHeaderSize: 64 * 1024,
  };
  if (!socks5) return new ProxyAgent(agentOptions);

  if (modes[0] !== "local") {
    if (url.protocol === "socks5h:") url.protocol = "socks5:";
    return new Socks5ProxyAgent(url, agentOptions);
  }

  class LocalDnsSocksProxyAgent extends Socks5ProxyAgent {
    async createSocks5Connection(hostname, port) {
      const host = hostname.replace(/^\[|\]$/g, "");
      const target = isIP(host) ? host : (await lookupLocal(host)).address;
      return super.createSocks5Connection(target, port);
    }
  }
  url.searchParams.delete("dns");
  if (url.protocol === "socks5h:") url.protocol = "socks5:";
  return new LocalDnsSocksProxyAgent(url, agentOptions);
}
