import { getAdapter } from "../driver.js";
import { makeKv } from "../helpers/kvStore.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function extractUserText(body) {
  try {
    const msgs = body?.messages || [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m?.role === "user") {
        if (typeof m.content === "string") return m.content;
        if (Array.isArray(m.content)) {
          const t = m.content.filter((c) => c?.type === "text").map((c) => c.text).join("\n");
          if (t) return t;
        }
      }
    }
  } catch {}
  return "";
}
function executeInjection(injection, body) {
  try {
    const text = injection?.text || "";
    if (!text) return body;
    const msgs = body?.messages || [];
    if (injection.position === "user" || !msgs.length) {
      msgs.push({ role: "user", content: text });
    } else if (injection.position === "prepend") {
      const first = msgs[0];
      if (typeof first?.content === "string") first.content = text + "\n" + first.content;
      else msgs.unshift({ role: "system", content: text });
    } else {
      const idx = msgs.findIndex((m) => m.role === "system");
      if (idx === -1) msgs.unshift({ role: "system", content: text });
      else if (typeof msgs[idx].content === "string") msgs[idx].content += "\n" + text;
      else msgs.splice(idx + 1, 0, { role: "system", content: text });
    }
    body.messages = msgs;
  } catch {}
  return body;
}
export async function applyPromptInjectionsToBody(body) {
  try {
    const raw = await promptKv.get("rules");
    const rules = raw ? parseJson(raw) : [];
    const active = (Array.isArray(rules) ? rules : []).filter((r) => r?.enabled !== false);
    for (const inj of active) executeInjection(inj, body);
  } catch {}
  return body;
}
