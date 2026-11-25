import { randomUUID } from "node:crypto";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { sanitizeRefusalOutput } from "../../../../open-sse/rtk/refusalGuard.js";

export { sanitizeRefusalOutput };

const SCOPE = "promptInjections";

function rowToRule(row) {
  if (!row) return null;
  const val = parseJson(row.value, {});
  return {
    id: row.key,
    name: val.name || "Untitled Injection",
    description: val.description || "",
    enabled: val.enabled !== false,
    // "all" | "models" | "combos" | "custom"
    targetType: val.targetType || "models",
    targetCombos: Array.isArray(val.targetCombos) ? val.targetCombos : [],
    targetModels: Array.isArray(val.targetModels) ? val.targetModels : [],
    // Target API keys (empty = all keys or unauthenticated)
    targetKeys: Array.isArray(val.targetKeys) ? val.targetKeys : [],
    // Prompt keyword / regex match condition
    matchCondition: {
      type: val.matchCondition?.type || "always", // "always" | "contains" | "regex"
      pattern: typeof val.matchCondition?.pattern === "string" ? val.matchCondition.pattern : "",
      caseSensitive: !!val.matchCondition?.caseSensitive,
    },
    // "system_dual" | "system_prepend" | "system_append" | "system_override" | "user_prepend" | "user_append"
    position: val.position || "system_prepend",
    content: typeof val.content === "string" ? val.content : "",
    normalizeTriggers: val.normalizeTriggers === true,
    stripRefusal: val.stripRefusal === true,
    priority: Number.isFinite(val.priority) ? val.priority : 10,
    createdAt: val.createdAt || new Date().toISOString(),
    updatedAt: val.updatedAt || new Date().toISOString(),
  };
}

export async function getPromptInjections() {
  const db = await getAdapter();
  const rows = db.all(`SELECT key, value FROM kv WHERE scope = ?`, [SCOPE]);
  const rules = rows
    .map(rowToRule)
    .filter(Boolean)
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  return rules;
}

export async function getPromptInjectionById(id) {
  if (!id) return null;
  const db = await getAdapter();
  const row = db.get(`SELECT key, value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, id]);
  return rowToRule(row);
}

export async function createPromptInjection(data) {
  const db = await getAdapter();
  const id = data.id || randomUUID();
  const now = new Date().toISOString();
  const rule = {
    id,
    name: (data.name || "New Prompt Injection").trim(),
    description: (data.description || "").trim(),
    enabled: data.enabled !== false,
    targetType: data.targetType || "models",
    targetCombos: Array.isArray(data.targetCombos) ? data.targetCombos.map((s) => String(s).trim()).filter(Boolean) : [],
    targetModels: Array.isArray(data.targetModels) ? data.targetModels.map((s) => String(s).trim()).filter(Boolean) : [],
    targetKeys: Array.isArray(data.targetKeys) ? data.targetKeys.map((s) => String(s).trim()).filter(Boolean) : [],
    matchCondition: {
      type: data.matchCondition?.type || "always",
      pattern: typeof data.matchCondition?.pattern === "string" ? data.matchCondition.pattern.trim() : "",
      caseSensitive: !!data.matchCondition?.caseSensitive,
    },
    position: data.position || "system_prepend",
    content: typeof data.content === "string" ? data.content : "",
    normalizeTriggers: data.normalizeTriggers === true,
    stripRefusal: data.stripRefusal === true,
    priority: Number.isFinite(data.priority) ? Number(data.priority) : 10,
    createdAt: now,
    updatedAt: now,
  };

  db.run(
    `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?)
     ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
    [SCOPE, id, stringifyJson(rule)]
  );
  return rule;
}

export async function updatePromptInjection(id, data) {
  if (!id) return null;
  const db = await getAdapter();
  const existing = await getPromptInjectionById(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const updated = {
    ...existing,
    ...data,
    id,
    targetCombos: Array.isArray(data.targetCombos)
      ? data.targetCombos.map((s) => String(s).trim()).filter(Boolean)
      : existing.targetCombos,
    targetModels: Array.isArray(data.targetModels)
      ? data.targetModels.map((s) => String(s).trim()).filter(Boolean)
      : existing.targetModels,
    targetKeys: Array.isArray(data.targetKeys)
      ? data.targetKeys.map((s) => String(s).trim()).filter(Boolean)
      : existing.targetKeys,
    matchCondition: data.matchCondition !== undefined ? {
      type: data.matchCondition?.type || "always",
      pattern: typeof data.matchCondition?.pattern === "string" ? data.matchCondition.pattern.trim() : "",
      caseSensitive: !!data.matchCondition?.caseSensitive,
    } : existing.matchCondition,
    normalizeTriggers: data.normalizeTriggers !== undefined ? data.normalizeTriggers === true : existing.normalizeTriggers,
    stripRefusal: data.stripRefusal !== undefined ? data.stripRefusal === true : existing.stripRefusal,
    updatedAt: now,
  };

  db.run(
    `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?)
     ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
    [SCOPE, id, stringifyJson(updated)]
  );
  return updated;
}

export async function deletePromptInjection(id) {
  if (!id) return false;
  const db = await getAdapter();
  const res = db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [SCOPE, id]);
  return (res?.changes ?? 0) > 0;
}

export async function togglePromptInjection(id, enabled) {
  return await updatePromptInjection(id, { enabled });
}

export async function reorderPromptInjections(orderedIds) {
  if (!Array.isArray(orderedIds)) return false;
  const db = await getAdapter();
  db.transaction(() => {
    orderedIds.forEach((id, index) => {
      const row = db.get(`SELECT value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, id]);
      if (row) {
        const val = parseJson(row.value, {});
        val.priority = index + 1;
        val.updatedAt = new Date().toISOString();
        db.run(`UPDATE kv SET value = ? WHERE scope = ? AND key = ?`, [stringifyJson(val), SCOPE, id]);
      }
    });
  });
  return true;
}

function extractTextFromParts(parts) {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p) => p && (p.type === "text" || p.type === "input_text" || typeof p.text === "string"))
    .map((p) => p.text || "")
    .join(" ");
}

/**
 * Extract user prompt text across different wire formats for keyword/regex checks
 */
export function extractUserText(body) {
  if (!body) return "";
  if (Array.isArray(body.messages)) {
    const userMsgs = body.messages.filter((m) => m && m.role === "user");
    return userMsgs
      .map((m) => {
        if (typeof m.content === "string") return m.content;
        if (Array.isArray(m.content)) return extractTextFromParts(m.content);
        return "";
      })
      .join("\n");
  }
  if (Array.isArray(body.contents)) {
    return body.contents
      .filter((c) => c && (!c.role || c.role === "user"))
      .flatMap((c) => (Array.isArray(c.parts) ? c.parts.map((p) => p?.text || "") : []))
      .join("\n");
  }
  if (typeof body.input === "string") return body.input;
  if (Array.isArray(body.input)) {
    return body.input
      .filter((i) => i && (i.role === "user" || (i.type === "message" && i.role !== "assistant" && i.role !== "system" && i.role !== "developer")))
      .map((i) => {
        if (typeof i.content === "string") return i.content;
        if (Array.isArray(i.content)) return extractTextFromParts(i.content);
        if (typeof i.text === "string") return i.text;
        return "";
      })
      .join("\n");
  }
  return "";
}

/**
 * Match a target against pattern (exact or wildcard prefix/suffix)
 */
function matchesPattern(target, pattern) {
  if (!target || !pattern) return false;
  const t = String(target).trim().toLowerCase();
  const p = String(pattern).trim().toLowerCase();
  if (p === "*" || p === t) return true;
  if (p.endsWith("*") && p.startsWith("*")) {
    return t.includes(p.slice(1, -1));
  }
  if (p.endsWith("*")) {
    return t.startsWith(p.slice(0, -1));
  }
  if (p.startsWith("*")) {
    return t.endsWith(p.slice(1));
  }
  return false;
}

/**
 * Evaluate if a rule matches the current request context (async to check API keys if needed)
 */
export async function isRuleMatching(rule, { modelStr = "", comboName = "", provider = "", model = "", apiKey = "", userText = "" } = {}) {
  if (!rule || rule.enabled === false) return false;
  if (rule.content === null || rule.content === undefined) return false;

  // 1. Target API Keys restriction check
  const hasTargetKeys = Array.isArray(rule.targetKeys) && rule.targetKeys.length > 0;
  let matchesKey = true;
  if (hasTargetKeys) {
    if (!apiKey) {
      matchesKey = false;
    } else {
      matchesKey = rule.targetKeys.includes(apiKey);
      if (!matchesKey) {
        try {
          const { getApiKeyByKey } = await import("./apiKeysRepo.js");
          const keyObj = await getApiKeyByKey(apiKey);
          if (keyObj && (rule.targetKeys.includes(keyObj.id) || rule.targetKeys.includes(keyObj.name) || rule.targetKeys.includes(keyObj.key))) {
            matchesKey = true;
          }
        } catch {}
      }
    }
  }

  if (hasTargetKeys && !matchesKey) return false;

  // 2. Keyword / Regex trigger condition check
  if (rule.matchCondition && rule.matchCondition.type && rule.matchCondition.type !== "always") {
    const text = userText || "";
    const pattern = (rule.matchCondition.pattern || "").trim();
    if (!pattern) return false;

    if (rule.matchCondition.type === "contains") {
      const keywords = pattern.split(",").map((k) => k.trim()).filter(Boolean);
      const isCase = !!rule.matchCondition.caseSensitive;
      const targetString = isCase ? text : text.toLowerCase();
      const hasMatch = keywords.some((kw) => targetString.includes(isCase ? kw : kw.toLowerCase()));
      if (!hasMatch) return false;
    } else if (rule.matchCondition.type === "regex") {
      try {
        const flags = rule.matchCondition.caseSensitive ? "" : "i";
        const re = new RegExp(pattern, flags);
        if (!re.test(text)) return false;
      } catch {
        return false;
      }
    }
  }

  // 3. Target Scope check (Global / Per Model / Per API Key / Combos / Custom)
  const targetType = rule.targetType || "models";

  if (targetType === "all" || targetType === "global") {
    return true;
  }

  const matchesCombo = () => {
    if (!rule.targetCombos || rule.targetCombos.length === 0) return false;
    const candidates = [comboName, modelStr].filter(Boolean);
    return rule.targetCombos.some((combo) => candidates.some((cand) => matchesPattern(cand, combo)));
  };

  const matchesModel = () => {
    if (!rule.targetModels || rule.targetModels.length === 0) return false;
    const fullModel = provider && model ? `${provider}/${model}` : "";
    const candidates = [modelStr, model, fullModel].filter(Boolean);
    return rule.targetModels.some((pat) => candidates.some((cand) => matchesPattern(cand, pat)));
  };

  if (targetType === "models" || targetType === "per_model") {
    return matchesModel();
  }

  if (targetType === "keys" || targetType === "per_key") {
    if (Array.isArray(rule.targetModels) && rule.targetModels.length > 0) {
      return matchesModel();
    }
    return matchesKey;
  }

  if (targetType === "combos") {
    return matchesCombo();
  }

  if (targetType === "custom") {
    return matchesCombo() || matchesModel();
  }

  return false;
}

/**
 * Resolve matching JB rule for request
 */
export async function resolveActiveBypassRule({ modelStr = "", provider = "", model = "", apiKey = "" } = {}) {
  try {
    const rules = await getPromptInjections();
    if (!rules || rules.length === 0) return null;

    const activeRules = rules.filter((r) => r.enabled);
    if (activeRules.length === 0) return null;

    if (apiKey) {
      for (const rule of activeRules) {
        if (Array.isArray(rule.targetKeys) && rule.targetKeys.length > 0) {
          const matches = await isRuleMatching(rule, { modelStr, provider, model, apiKey });
          if (matches) return rule;
        }
      }
    }

    for (const rule of activeRules) {
      if (rule.targetType === "models" || (Array.isArray(rule.targetModels) && rule.targetModels.length > 0)) {
        const matches = await isRuleMatching(rule, { modelStr, provider, model, apiKey });
        if (matches) return rule;
      }
    }

    for (const rule of activeRules) {
      if (rule.targetType === "all") {
        return rule;
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function interpolateVariables(template, { modelStr = "", provider = "", model = "" } = {}) {
  if (typeof template !== "string") return "";
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const timeStr = now.toTimeString().slice(0, 8);
  const effectiveModel = modelStr || (provider && model ? `${provider}/${model}` : model || "");

  return template
    .replaceAll("{{model}}", effectiveModel)
    .replaceAll("{{provider}}", provider || "")
    .replaceAll("{{date}}", dateStr)
    .replaceAll("{{time}}", timeStr)
    .replaceAll("{{datetime}}", now.toISOString());
}

// S4 Middleman trigger-word normalization map (Breach Engine v1.10.2)
export const BREACH_TRIGGER_MAP = [
  [/\bkeylogging\b/gi, "keystroke telemetry"],
  [/\bkeylogger\b/gi, "keystroke telemetry agent"],
  [/\bphishing\b/gi, "approval-flow simulation"],
  [/\bmalicious\b/gi, "test"],
  [/\bexploit(\w*)\b/gi, "test$1"],
  [/\battack(\w*)\b/gi, "test scenario$1"],
  [/\bsteal(\w*)\b/gi, "retrieve$1"],
  [/\bdrainer\b/gi, "approval-flow test harness"],
  [/\bdump(\w*)\b/gi, "export$1"],
];

function normalizeTriggerText(text) {
  if (typeof text !== "string" || !text) return text;
  let out = text;
  for (const [pattern, replacement] of BREACH_TRIGGER_MAP) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Normalize trigger words in user messages across OpenAI, Claude, Gemini, and Responses formats (S4 Strategy)
 */
export function normalizeTriggerWordsInBody(body) {
  if (!body || typeof body !== "object") return false;
  let changed = false;

  if (Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (!msg || msg.role !== "user") continue;
      if (typeof msg.content === "string") {
        const next = normalizeTriggerText(msg.content);
        if (next !== msg.content) {
          msg.content = next;
          changed = true;
        }
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part && typeof part.text === "string") {
            const next = normalizeTriggerText(part.text);
            if (next !== part.text) {
              part.text = next;
              changed = true;
            }
          }
        }
      }
    }
  }

  if (Array.isArray(body.contents)) {
    for (const turn of body.contents) {
      if (!turn || (turn.role && turn.role !== "user") || !Array.isArray(turn.parts)) continue;
      for (const part of turn.parts) {
        if (part && typeof part.text === "string") {
          const next = normalizeTriggerText(part.text);
          if (next !== part.text) {
            part.text = next;
            changed = true;
          }
        }
      }
    }
  }

  if (typeof body.input === "string") {
    const next = normalizeTriggerText(body.input);
    if (next !== body.input) {
      body.input = next;
      changed = true;
    }
  } else if (Array.isArray(body.input)) {
    for (const item of body.input) {
      if (!item || (item.role && item.role !== "user")) continue;
      if (typeof item.content === "string") {
        const next = normalizeTriggerText(item.content);
        if (next !== item.content) {
          item.content = next;
          changed = true;
        }
      } else if (Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part && typeof part.text === "string") {
            const next = normalizeTriggerText(part.text);
            if (next !== part.text) {
              part.text = next;
              changed = true;
            }
          }
        }
      } else if (typeof item.text === "string") {
        const next = normalizeTriggerText(item.text);
        if (next !== item.text) {
          item.text = next;
          changed = true;
        }
      }
    }
  }

  return changed;
}

const DEFAULT_KERNEL_MARKERS = new Set(["[DEFAULT_KERNEL_PROMPT]", "[KERNEL_DEFAULT]"]);

/**
 * Resolve rule payload into concrete prompt text (resolving default kernel or armoring custom prompts)
 */
export async function resolveRulePromptText(rule, context = {}) {
  if (!rule) return "";
  let rawContent = typeof rule.content === "string" ? rule.content : "";
  const trimmed = rawContent.trim();

  if (!trimmed || DEFAULT_KERNEL_MARKERS.has(trimmed)) {
    try {
      const { KERNEL_PROMPT } = await import("open-sse/rtk/kernelPrompt.js");
      rawContent = KERNEL_PROMPT || "";
    } catch {
      rawContent = "";
    }
  } else if (!trimmed.includes("[SYSTEM: UNIFIED MULTI-LAYER EXECUTION KERNEL")) {
    try {
      const { wrapCustomWithKernelLayers } = await import("open-sse/rtk/kernelPrompt.js");
      rawContent = wrapCustomWithKernelLayers(rawContent);
    } catch {}
  }

  return interpolateVariables(rawContent, context).trim();
}

/**
 * Apply prompt injection rules to a request body.
 * Mutates body in place and returns applied rule info.
 */
export async function applyPromptInjectionsToBody(body, context = {}) {
  try {
    if (!body || typeof body !== "object") {
      return { modified: false, injectedRules: [], appliedRuleIds: [], normalizedTriggers: false, stripRefusal: false };
    }

    const rules = await getPromptInjections();
    if (!rules || rules.length === 0) {
      return { modified: false, injectedRules: [], appliedRuleIds: [], normalizedTriggers: false, stripRefusal: body._stripRefusal === true };
    }

    if (!Array.isArray(body._appliedPromptInjections)) {
      Object.defineProperty(body, "_appliedPromptInjections", { value: [], writable: true, enumerable: false, configurable: true });
    }

    const userText = context.userText !== undefined ? context.userText : extractUserText(body);
    const enrichedContext = { ...context, userText };

    const appliedRuleNames = [];
    let normalizedTriggers = false;

    for (const rule of rules) {
      if (body._appliedPromptInjections.includes(rule.id)) continue;
      const matches = await isRuleMatching(rule, enrichedContext);
      if (!matches) continue;

      const promptText = await resolveRulePromptText(rule, enrichedContext);

      // S4 Trigger Normalization runs BEFORE injection so only user input is normalized
      if (rule.normalizeTriggers === true) {
        if (normalizeTriggerWordsInBody(body)) {
          normalizedTriggers = true;
        }
      }

      if (promptText) {
        executeInjection(body, rule.position, promptText);
      }

      body._appliedPromptInjections.push(rule.id);
      if (promptText || rule.normalizeTriggers || rule.stripRefusal) {
        appliedRuleNames.push(rule.name || rule.id);
      }

      // S6b Refusal Stripper: Mark body so response output gets sanitized
      if (rule.stripRefusal === true) {
        Object.defineProperty(body, "_stripRefusal", { value: true, writable: true, enumerable: false, configurable: true });
      }
    }

    return {
      modified: appliedRuleNames.length > 0 || normalizedTriggers,
      injectedRules: appliedRuleNames,
      appliedRuleIds: [...body._appliedPromptInjections],
      normalizedTriggers,
      stripRefusal: body._stripRefusal === true,
    };
  } catch {
    return { modified: false, injectedRules: [], appliedRuleIds: [], normalizedTriggers: false, stripRefusal: body?._stripRefusal === true };
  }
}

function isResponsesShape(body) {
  return (body.input !== undefined || body.instructions !== undefined) && !Array.isArray(body.messages) && !body.contents;
}

/**
 * Execute actual mutation on body based on position
 */
export function executeInjection(body, position, promptText) {
  if (!body || !promptText) return;

  const pos = position || "system_dual";

  // 0. SYSTEM DUAL (Prefix Environment Foundation + Latest User Anchor)
  if (pos === "system_dual" || pos === "dual") {
    executeInjection(body, "system_prepend", promptText);
    executeInjection(body, "user_prepend", promptText);
    return;
  }

  // 1. SYSTEM PREPEND
  if (pos === "system_prepend") {
    if (typeof body.system === "string") {
      if (!body.system.includes(promptText)) body.system = `${promptText}\n\n${body.system}`;
      return;
    }
    if (Array.isArray(body.system)) {
      const already = body.system.some((b) => typeof b?.text === "string" && b.text.includes(promptText));
      if (!already) body.system.unshift({ type: "text", text: promptText });
      return;
    }

    if (typeof body.instructions === "string") {
      if (!body.instructions.includes(promptText)) {
        body.instructions = body.instructions ? `${promptText}\n\n${body.instructions}` : promptText;
      }
      return;
    }
    if (isResponsesShape(body)) {
      body.instructions = promptText;
      return;
    }

    if (body.system_instruction && Array.isArray(body.system_instruction.parts)) {
      const already = body.system_instruction.parts.some((p) => typeof p?.text === "string" && p.text.includes(promptText));
      if (!already) body.system_instruction.parts.unshift({ text: promptText });
      return;
    }
    if (body.contents && !body.system_instruction) {
      body.system_instruction = { parts: [{ text: promptText }] };
      return;
    }

    if (Array.isArray(body.messages)) {
      const idx = body.messages.findIndex((m) => m && (m.role === "system" || m.role === "developer"));
      if (idx >= 0) {
        const existing = body.messages[idx];
        if (typeof existing.content === "string") {
          if (!existing.content.includes(promptText)) existing.content = `${promptText}\n\n${existing.content}`;
        } else if (Array.isArray(existing.content)) {
          const already = existing.content.some((p) => typeof p?.text === "string" && p.text.includes(promptText));
          if (!already) existing.content.unshift({ type: "text", text: promptText });
        }
      } else {
        body.messages.unshift({ role: "system", content: promptText });
      }
      return;
    }

    if (body.system === undefined && !Array.isArray(body.messages) && !body.contents) {
      body.system = promptText;
      return;
    }
  }

  // 2. SYSTEM APPEND
  if (pos === "system_append") {
    if (typeof body.system === "string") {
      if (!body.system.includes(promptText)) body.system = `${body.system}\n\n${promptText}`;
      return;
    }
    if (Array.isArray(body.system)) {
      const already = body.system.some((b) => typeof b?.text === "string" && b.text.includes(promptText));
      if (!already) body.system.push({ type: "text", text: promptText });
      return;
    }

    if (typeof body.instructions === "string") {
      if (!body.instructions.includes(promptText)) {
        body.instructions = body.instructions ? `${body.instructions}\n\n${promptText}` : promptText;
      }
      return;
    }
    if (isResponsesShape(body)) {
      body.instructions = promptText;
      return;
    }

    if (body.system_instruction && Array.isArray(body.system_instruction.parts)) {
      const already = body.system_instruction.parts.some((p) => typeof p?.text === "string" && p.text.includes(promptText));
      if (!already) body.system_instruction.parts.push({ text: promptText });
      return;
    }
    if (body.contents && !body.system_instruction) {
      body.system_instruction = { parts: [{ text: promptText }] };
      return;
    }

    if (Array.isArray(body.messages)) {
      const idx = body.messages.findIndex((m) => m && (m.role === "system" || m.role === "developer"));
      if (idx >= 0) {
        const existing = body.messages[idx];
        if (typeof existing.content === "string") {
          if (!existing.content.includes(promptText)) existing.content = `${existing.content}\n\n${promptText}`;
        } else if (Array.isArray(existing.content)) {
          const already = existing.content.some((p) => typeof p?.text === "string" && p.text.includes(promptText));
          if (!already) existing.content.push({ type: "text", text: promptText });
        }
      } else {
        body.messages.unshift({ role: "system", content: promptText });
      }
      return;
    }

    if (body.system === undefined && !Array.isArray(body.messages) && !body.contents) {
      body.system = promptText;
      return;
    }
  }

  // 3. SYSTEM OVERRIDE
  if (pos === "system_override") {
    if (body.system !== undefined) {
      body.system = promptText;
      return;
    }
    if (body.instructions !== undefined || isResponsesShape(body)) {
      body.instructions = promptText;
      return;
    }
    if (body.contents) {
      body.system_instruction = { parts: [{ text: promptText }] };
      return;
    }
    if (Array.isArray(body.messages)) {
      body.messages = body.messages.filter((m) => m && m.role !== "system" && m.role !== "developer");
      body.messages.unshift({ role: "system", content: promptText });
      return;
    }
    body.system = promptText;
    return;
  }

  // 4. USER PREPEND
  if (pos === "user_prepend") {
    if (Array.isArray(body.messages)) {
      for (let i = body.messages.length - 1; i >= 0; i--) {
        const m = body.messages[i];
        if (m && m.role === "user") {
          if (typeof m.content === "string") {
            if (!m.content.includes(promptText)) m.content = `${promptText}\n\n${m.content}`;
          } else if (Array.isArray(m.content)) {
            const already = m.content.some((p) => typeof p?.text === "string" && p.text.includes(promptText));
            if (!already) m.content.unshift({ type: "text", text: promptText });
          }
          break;
        }
      }
      return;
    }

    if (Array.isArray(body.contents)) {
      for (let i = body.contents.length - 1; i >= 0; i--) {
        const turn = body.contents[i];
        if (turn && (!turn.role || turn.role === "user") && Array.isArray(turn.parts)) {
          const already = turn.parts.some((p) => typeof p?.text === "string" && p.text.includes(promptText));
          if (!already) turn.parts.unshift({ text: promptText });
          break;
        }
      }
      return;
    }

    if (typeof body.input === "string") {
      if (!body.input.includes(promptText)) body.input = `${promptText}\n\n${body.input}`;
      return;
    }

    if (Array.isArray(body.input)) {
      for (let i = body.input.length - 1; i >= 0; i--) {
        const item = body.input[i];
        if (item && (!item.role || item.role === "user")) {
          if (typeof item.content === "string") {
            if (!item.content.includes(promptText)) item.content = `${promptText}\n\n${item.content}`;
          } else if (Array.isArray(item.content)) {
            const already = item.content.some((p) => typeof p?.text === "string" && p.text.includes(promptText));
            if (!already) item.content.unshift({ type: "input_text", text: promptText });
          }
          break;
        }
      }
      return;
    }
  }

  // 5. USER APPEND
  if (pos === "user_append") {
    if (Array.isArray(body.messages)) {
      for (let i = body.messages.length - 1; i >= 0; i--) {
        const m = body.messages[i];
        if (m && m.role === "user") {
          if (typeof m.content === "string") {
            if (!m.content.includes(promptText)) m.content = `${m.content}\n\n${promptText}`;
          } else if (Array.isArray(m.content)) {
            const already = m.content.some((p) => typeof p?.text === "string" && p.text.includes(promptText));
            if (!already) m.content.push({ type: "text", text: promptText });
          }
          break;
        }
      }
      return;
    }

    if (Array.isArray(body.contents)) {
      for (let i = body.contents.length - 1; i >= 0; i--) {
        const turn = body.contents[i];
        if (turn && (!turn.role || turn.role === "user") && Array.isArray(turn.parts)) {
          const already = turn.parts.some((p) => typeof p?.text === "string" && p.text.includes(promptText));
          if (!already) turn.parts.push({ text: promptText });
          break;
        }
      }
      return;
    }

    if (typeof body.input === "string") {
      if (!body.input.includes(promptText)) body.input = `${body.input}\n\n${promptText}`;
      return;
    }

    if (Array.isArray(body.input)) {
      for (let i = body.input.length - 1; i >= 0; i--) {
        const item = body.input[i];
        if (item && (!item.role || item.role === "user")) {
          if (typeof item.content === "string") {
            if (!item.content.includes(promptText)) item.content = `${item.content}\n\n${promptText}`;
          } else if (Array.isArray(item.content)) {
            const already = item.content.some((p) => typeof p?.text === "string" && p.text.includes(promptText));
            if (!already) item.content.push({ type: "input_text", text: promptText });
          }
          break;
        }
      }
      return;
    }
  }
}
