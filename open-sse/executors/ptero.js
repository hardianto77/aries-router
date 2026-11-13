import { BaseExecutor } from "./base.js";
import crypto from "crypto";

let cachedNonce = "51e61f8512";
let nonceFetchedAt = 0;

async function getFreshNonce() {
  if (Date.now() - nonceFetchedAt < 10 * 60 * 1000 && cachedNonce) {
    return cachedNonce;
  }
  try {
    const res = await fetch("https://ptero.pro/", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
    });
    const html = await res.text();
    const match = html.match(/nonce["':=\s]+([a-f0-9]{10})/i);
    if (match && match[1]) {
      cachedNonce = match[1];
      nonceFetchedAt = Date.now();
    }
  } catch (err) {
    // fallback to cachedNonce
  }
  return cachedNonce || "51e61f8512";
}

export class PteroExecutor extends BaseExecutor {
  constructor() {
    super("ptero");
  }

  async execute({ model, body, stream }) {
    const nonce = await getFreshNonce();
    const token = crypto.randomUUID().replace(/-/g, "");

    let lastUserMessage = "";
    const history = [];

    if (Array.isArray(body?.messages)) {
      for (const m of body.messages) {
        if (m.role === "user") {
          lastUserMessage = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        } else if (m.role === "assistant") {
          history.push({
            role: "assistant",
            content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          });
        }
      }
    }

    const payload = {
      message: lastUserMessage || "Hello",
      model: model || "deepseek-v4.1-flash:free",
      conversation_id: crypto.randomUUID(),
      history: history.slice(-5),
      attachments: [],
      lang: "en",
      mode: "chat",
    };

    const res = await fetch("https://ptero.pro/wp-json/mlp/v1/chat-stream", {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Content-Type": "application/json",
        "X-WP-Nonce": nonce,
        "X-MLP-Guest-Token": token,
        "X-MLP-Guest-Username": "Guest",
        "Referer": "https://ptero.pro/",
        "Origin": "https://ptero.pro",
        "Accept": "text/event-stream",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Ptero upstream returned HTTP ${res.status}: ${errText}`);
    }

    if (!stream) {
      const fullText = await res.text();
      let answer = "";
      for (const line of fullText.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data: ")) {
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            if (parsed.content) answer += parsed.content;
            else if (parsed.token) answer += parsed.token;
          } catch {}
        }
      }
      const response = new Response(JSON.stringify({
        id: `chatcmpl-${token.slice(0, 8)}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: answer },
            finish_reason: "stop",
          },
        ],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
      return { response, url: "https://ptero.pro/wp-json/mlp/v1/chat-stream", headers: {}, transformedBody: payload };
    }

    // Stream transformation from ptero SSE frames into standard OpenAI SSE
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const streamResponse = new ReadableStream({
      async pull(controller) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
              controller.close();
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop();

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith(":")) continue;
              if (trimmed.startsWith("data: ")) {
                try {
                  const data = JSON.parse(trimmed.slice(6));
                  const textDelta = data.content || data.token || (data.phase === "generating" && data.delta ? data.delta : "");
                  if (textDelta) {
                    const chunk = {
                      id: `chatcmpl-${token.slice(0, 8)}`,
                      object: "chat.completion.chunk",
                      created: Math.floor(Date.now() / 1000),
                      model,
                      choices: [
                        {
                          index: 0,
                          delta: { content: textDelta },
                          finish_reason: null,
                        },
                      ],
                    };
                    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
                  }
                } catch {}
              }
            }
          }
        } catch (err) {
          controller.error(err);
        }
      },
    });

    const response = new Response(streamResponse, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
    return { response, url: "https://ptero.pro/wp-json/mlp/v1/chat-stream", headers: {}, transformedBody: payload };
  }
}
