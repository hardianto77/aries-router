import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

export class KiloGatewayExecutor extends BaseExecutor {
  constructor() {
    super("kilo-gateway", PROVIDERS["kilo-gateway"]);
  }

  buildUrl() {
    return this.config?.baseUrl || "https://api.kilo.ai/api/gateway/chat/completions";
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      "Accept": stream ? "text/event-stream" : "application/json",
    };
    const key = credentials?.apiKey || credentials?.accessToken;
    if (key) {
      headers["Authorization"] = `Bearer ${key}`;
    }
    return headers;
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const url = this.buildUrl();
    const headers = this.buildHeaders(credentials, stream);
    const bodyStr = JSON.stringify(body);

    log?.debug?.("FETCH", `KILO-GATEWAY → ${url} | model=${model} | auth=${credentials?.apiKey ? "key" : "free"}`);

    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: bodyStr,
      signal,
    }, proxyOptions);

    return { response, url, headers, transformedBody: body };
  }
}

export default KiloGatewayExecutor;
