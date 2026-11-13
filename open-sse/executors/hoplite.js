import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

/**
 * HopliteExecutor
 * Bridges OpenAI chat completions to Hoplite MCP JSON-RPC protocol:
 * 1. Initialize MCP session (or reuse token)
 * 2. Resolve or list projects
 * 3. Call `hoplite_create_thread`
 * 4. Adaptively poll `hoplite_get_thread` until ready
 * 5. Stream or return the synthesized assistant completion
 */
export class HopliteExecutor extends BaseExecutor {
  constructor() {
    super("hoplite", PROVIDERS["hoplite"]);
    this.mcpUrl = "https://api.hoplite.sh/mcp";
  }

  buildHeaders(credentials) {
    const token = credentials?.accessToken || credentials?.apiKey || credentials?.token || "";
    return {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
      ...(token ? { "Authorization": `Bearer ${token}` } : {}),
    };
  }

  async mcpCall(method, params, headers, proxyOptions, signal) {
    const payload = {
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    };

    const res = await proxyAwareFetch(this.mcpUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal,
    }, proxyOptions);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Hoplite MCP error (${res.status}): ${errText}`);
    }

    const ct = res.headers.get("content-type") || "";
    if (ct.includes("text/event-stream")) {
      const rawText = await res.text();
      for (const line of rawText.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data:")) {
          try {
            return JSON.parse(trimmed.slice(5).trim());
          } catch {}
        }
      }
      return {};
    }

    return await res.json();
  }

  async callTool(name, args, headers, proxyOptions, signal) {
    const res = await this.mcpCall("tools/call", { name, arguments: args }, headers, proxyOptions, signal);
    return res?.result || {};
  }

  buildPromptFromMessages(messages) {
    if (!Array.isArray(messages)) return "";
    return messages
      .map((m) => {
        const role = m.role?.toUpperCase() || "USER";
        const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        return `[${role}]\n${content}`;
      })
      .join("\n\n");
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const headers = this.buildHeaders(credentials);
    const cleanModel = model.replace(/^hoplite\//, "");

    // Fast path: ping requests
    const lastMsg = body.messages?.[body.messages.length - 1]?.content || "";
    if (typeof lastMsg === "string" && lastMsg.trim().toLowerCase() === "ping") {
      const pingResponse = this.createSyntheticResponse(cleanModel, "pong", stream);
      return { response: pingResponse, url: this.mcpUrl, headers, transformedBody: body };
    }

    const prompt = this.buildPromptFromMessages(body.messages);
    const projectId = credentials?.projectId || credentials?.extra?.projectId || "default";

    log?.debug?.("HOPLITE", `Creating thread on Hoplite MCP | model=${cleanModel} | project=${projectId}`);

    // Call hoplite_create_thread tool
    const threadResult = await this.callTool("hoplite_create_thread", {
      projectId,
      prompt,
      model: cleanModel,
    }, headers, proxyOptions, signal);

    // Extract thread ID
    const resultStr = typeof threadResult === "string" ? threadResult : JSON.stringify(threadResult);
    const threadMatch = resultStr.match(/thread_id["']?\s*[:=]\s*["']?([a-zA-Z0-9_-]+)/i) ||
                        resultStr.match(/"id"\s*:\s*"([a-zA-Z0-9_-]+)"/i);
    const threadId = threadMatch ? threadMatch[1] : null;

    let assistantText = "";

    if (!threadId) {
      // Fallback: If creation directly returned content
      assistantText = threadResult?.content?.[0]?.text || resultStr;
    } else {
      // Adaptive polling schedule: 1s, 1s, 2s, 2s, 3s, 5s...
      const pollDelays = [1000, 1000, 2000, 2000, 3000, 3000, 5000, 5000];
      let status = "queued";
      let pollRes = null;

      for (const delay of pollDelays) {
        if (signal?.aborted) throw new Error("Request aborted");
        await new Promise((r) => setTimeout(r, delay));

        pollRes = await this.callTool("hoplite_get_thread", { threadId }, headers, proxyOptions, signal);
        const pollStr = JSON.stringify(pollRes);
        const statusMatch = pollStr.match(/"status"\s*:\s*"(\w+)"/);
        status = statusMatch ? statusMatch[1] : "unknown";

        if (status === "ready" || status === "failed" || status === "completed") {
          break;
        }
      }

      // Extract assistant message
      assistantText = this.extractAssistantContent(pollRes);
    }

    const syntheticResponse = this.createSyntheticResponse(cleanModel, assistantText, stream);
    return { response: syntheticResponse, url: this.mcpUrl, headers, transformedBody: body };
  }

  extractAssistantContent(data) {
    if (!data) return "No response from Hoplite";
    if (typeof data === "string") return data;

    // Check nested messages
    const msgs = data.messages || data.result?.messages;
    if (Array.isArray(msgs) && msgs.length > 0) {
      const assistantMsgs = msgs.filter((m) => m.role === "assistant");
      if (assistantMsgs.length > 0) {
        const last = assistantMsgs[assistantMsgs.length - 1];
        return typeof last.content === "string" ? last.content : JSON.stringify(last.content);
      }
    }

    if (data.content && Array.isArray(data.content)) {
      return data.content.map((c) => c.text || "").join("\n");
    }

    return JSON.stringify(data);
  }

  createSyntheticResponse(model, text, stream) {
    const id = `chatcmpl-hop-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    if (!stream) {
      const jsonBody = {
        id,
        object: "chat.completion",
        created,
        model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: text },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      };
      return new Response(JSON.stringify(jsonBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Streaming SSE generator
    const encoder = new TextEncoder();
    const sseStream = new ReadableStream({
      start(controller) {
        // Chunk 1: Role
        const chunk1 = {
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk1)}\n\n`));

        // Chunk 2: Finish
        const chunk2 = {
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk2)}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(sseStream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  }
}

export default HopliteExecutor;
