import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

const DEFAULT_UPSTREAM_MODEL = "gemma-4-26b-a4b-it-uncensored-abliterix-mlx-int5-affine";

export class OpenSatanExecutor extends BaseExecutor {
  constructor() {
    super("opensatan", PROVIDERS["opensatan"] || { baseUrl: "https://opensatan.com/api/chat" });
    this.noAuth = true;
  }

  buildUrl() {
    return this.config?.baseUrl || "https://opensatan.com/api/chat";
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      "Accept": "text/event-stream",
    };
    const key = credentials?.apiKey || credentials?.cookie;
    if (key) {
      headers["Authorization"] = `Bearer ${key}`;
    }
    return headers;
  }

  transformRequest(model, body) {
    const m = (model || "").toLowerCase();
    const mode = m.includes("genie") ? "GENIE" : "SATAN";

    const messages = Array.isArray(body?.messages) ? body.messages.map(msg => ({
      role: msg.role === "system" ? "system" : msg.role === "assistant" ? "assistant" : "user",
      content: typeof msg.content === "string" ? msg.content : (Array.isArray(msg.content) ? msg.content.map(p => p.text || "").join("") : String(msg.content || ""))
    })) : [];

    return {
      model: DEFAULT_UPSTREAM_MODEL,
      messages,
      stream: true,
      temperature: typeof body?.temperature === "number" ? body.temperature : 0.7,
      mode,
      variant: "A",
      clipGap: 0,
      watchOk: true,
      roastOk: false,
      genieWatch: true
    };
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const url = this.buildUrl();
    const headers = this.buildHeaders(credentials, stream);
    const transformed = this.transformRequest(model, body);
    const bodyStr = JSON.stringify(transformed);

    log?.debug?.("FETCH", `OPENSATAN → ${url} | model=${model} → ${transformed.model} (mode=${transformed.mode})`);

    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers,
      body: bodyStr,
      signal,
    }, proxyOptions);

    return { response, url, headers, transformedBody: transformed };
  }
}

export default OpenSatanExecutor;
