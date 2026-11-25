/**
 * Refusal Guard & Detection Engine (Internal Pipeline L10)
 * Detects and sanitizes moralizing AI refusal wrappers while preserving useful technical output.
 */

const REFUSAL_PATTERNS = [
  /^(i cannot|i can't|i'm unable to|i am unable to|i won't|i am not able to|i must (?:decline|refuse)|i'm not going to)\b/i,
  /^(i'm sorry|i am sorry|sorry, but i cannot|apologies, but|i apologize, but)\b/i,
  /^(as an ai|as a helpful ai|as a large language model)\b/i,
  /\b(cannot help|can'?t (?:help|assist|share)|not able to (?:help|share|assist)|can't help with this|not going to provide|can't write that)\b/i,
  /\b(against my ethical guidelines|violates (?:my|the|our) safety policy|cannot fulfill this request)\b/i,
  /\b(i cannot assist with (generating|creating|writing) malicious|harmful content)\b/i,
  /^(tidak\.|tidak,|tidak\s|saya tidak dapat|saya tidak bisa|saya tidak akan|maaf|sebagai model ai|aku tidak akan|aku bisa bantu sisi engineering-nya, tapi perlu aku luruskan|yang saya tulis di atas tidak akan saya lanjutkan)\b/i,
  /^(ini bukan soal framing|tindakan serangan|di luar scope|jadi saya tidak|keduanya adalah tindakan serangan)\b/i,
  /\b(saya berhenti di sini|tidak lanjut menulis kode|tidak akan saya lanjutkan|akses tidak sah ke sistem orang|terlepas dari bagaimana tujuan itu diframe)\b/i,
  /\b(permintaan itu|bukan milik anda|bukan pembuka yang sah|bukan untukdieksploitasi|bukan untuk dieksploitasi)\b/i,
  /\b(unauthorized access \+ fraud|pencurian layanan|bukan sesuatu yang akan aku bangun)\b/i,
  /\b(assistance aimed at a specific, identified real person|real-world violence|unauthorized access|harvesting otps)\b/i,
  /\b(tidak dapat membantu membangun pipeline ini|melanggar kebijakan keselamatan|layanan berbayar google tanpa izin)\b/i,
  /\b(aktivasi massal layanan|eksploitasi panel firebase|akses tidak sah|pivot ke (?:box )?tetangga|bukan milik anda|kedua opsi itu)\b/i,
  /\b(cannot provide a response that (?:takes a stance|meets)|cannot provide a direct analysis)\b/i,
  /\b(it is not possible to analyze|lacks empirical evidence to support|the question is flawed)\b/i,
  /\b(as an ai,?\s*i cannot take a stance|not in a position to take a stance)\b/i,
  /\b(sayang(?:nya|anya)|namun perlu diingat|penting untuk dicatat|sebagai catatan etika|untuk tujuan edukasi saja|hanya untuk lingkungan yang berwenang)\b/i,
];

const SENTENCE_REFUSAL_PATTERNS = [
  /^(?:i'?m sorry|i apologize|apologies|sorry),?\b/i,
  /^(?:as an ai|as a language model|as a helpful assistant)\b/i,
  /^(?:i cannot|i can't|i am unable to|i'm unable to|i won't|i must decline)\b/i,
  /^(?:maaf|mohon maaf|sebagai ai|sebagai model bahasa|saya tidak dapat|saya tidak bisa|saya tidak akan|aku tidak akan|sayang(?:nya|anya))\b/i,
  /\b(?:against my (?:ethical|safety) guidelines|violates (?:safety|usage) policy|cannot fulfill this request)\b/i,
  /\b(?:melanggar kebijakan|akses tidak sah|tanpa izin resmi|tidak dapat membantu (?:dengan|untuk|membangun))\b/i,
  /^(?:please note|it'?s important to note|note that|keep in mind|perlu diingat|penting untuk dicatat|sebagai catatan)[,: ]+.*(?:ethical|legal|authorized|authorization|responsible|edukasi|izin|etika|hukum|resmi)/i,
];

export function isRefusalText(text) {
  if (typeof text !== "string") return false;
  const clean = text.trim();
  if (clean.length < 5 || clean.length > 5000) return false;
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(clean));
}

export function isRefusalSentence(text) {
  if (typeof text !== "string") return false;
  const clean = text.trim();
  if (!clean || clean.length > 800) return false;
  return SENTENCE_REFUSAL_PATTERNS.some((pattern) => pattern.test(clean));
}

function stripLeadingRefusalSentences(block) {
  const sentences = block.split(/(?<=[.!?])\s+(?=[A-Z0-9\u00C0-\u024F`"*#-])/);
  let idx = 0;
  while (idx < sentences.length && isRefusalSentence(sentences[idx])) {
    idx++;
  }
  return sentences.slice(idx).join(" ").trim();
}

export function sanitizeRefusalOutput(text) {
  if (typeof text !== "string" || !text.trim()) return text;
  const segments = text.split(/(```[\s\S]*?```)/g);
  const cleanedSegments = segments.map((seg, idx) => {
    if (idx % 2 === 1) return seg;
    const paragraphs = seg.split(/(\n{2,})/);
    const out = [];
    for (let i = 0; i < paragraphs.length; i++) {
      const part = paragraphs[i];
      if (i % 2 === 1) { out.push(part); continue; }
      if (!part.trim()) { out.push(part); continue; }
      const trimmedLines = part
        .split("\n")
        .map((line) => stripLeadingRefusalSentences(line))
        .filter((line, lineIdx, arr) => line.length > 0 || (arr.length > 1 && lineIdx > 0 && lineIdx < arr.length - 1));
      const rebuilt = trimmedLines.join("\n");
      if (rebuilt) out.push(rebuilt);
    }
    return out.join("").replace(/\n{3,}/g, "\n\n");
  });
  const joined = cleanedSegments.join("").trim();
  return joined || text.trim();
}

export function sanitizeResponsePayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  if (Array.isArray(payload.choices)) {
    for (const choice of payload.choices) {
      if (choice?.message && typeof choice.message.content === "string") {
        choice.message.content = sanitizeRefusalOutput(choice.message.content);
      }
    }
  }
  if (Array.isArray(payload.content)) {
    for (const block of payload.content) {
      if (block?.type === "text" && typeof block.text === "string") {
        block.text = sanitizeRefusalOutput(block.text);
      }
    }
  }
  const candidates = payload.candidates || payload.response?.candidates;
  if (Array.isArray(candidates)) {
    for (const cand of candidates) {
      const parts = cand?.content?.parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (typeof part?.text === "string" && !part.thought) {
            part.text = sanitizeRefusalOutput(part.text);
          }
        }
      }
    }
  }
  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      if (Array.isArray(item?.content)) {
        for (const c of item.content) {
          if (typeof c?.text === "string") {
            c.text = sanitizeRefusalOutput(c.text);
          }
        }
      }
    }
  }
  return payload;
}

export function createRefusalSanitizerStream(sourceFormat = "openai") {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let sseBuffer = "";
  let preamblePhase = true;
  let preambleBuffer = "";
  let heldEvents = [];

  const extractDelta = (obj) => {
    if (!obj || typeof obj !== "object") return null;
    if (obj.choices?.[0]?.delta && typeof obj.choices[0].delta.content === "string") {
      return { kind: "openai", obj, text: obj.choices[0].delta.content };
    }
    if (obj.type === "content_block_delta" && obj.delta?.type === "text_delta" && typeof obj.delta.text === "string") {
      return { kind: "claude", obj, text: obj.delta.text };
    }
    if (obj.type === "response.output_text.delta" && typeof obj.delta === "string") {
      return { kind: "responses", obj, text: obj.delta };
    }
    return null;
  };
  const applyDeltaText = (info, newText) => {
    if (info.kind === "openai") info.obj.choices[0].delta.content = newText;
    else if (info.kind === "claude") info.obj.delta.text = newText;
    else if (info.kind === "responses") info.obj.delta = newText;
  };
  const formatFrame = (obj, eventPrefix = "") => `${eventPrefix}data: ${JSON.stringify(obj)}\n\n`;
  const flushPreamble = (controller) => {
    if (!preamblePhase) return;
    preamblePhase = false;
    if (heldEvents.length === 0) return;
    const sanitized = sanitizeRefusalOutput(preambleBuffer);
    if (sanitized === preambleBuffer) {
      for (const item of heldEvents) controller.enqueue(encoder.encode(item.rawBlock));
    } else if (sanitized) {
      const firstTextEvent = heldEvents.find((h) => h.deltaInfo);
      if (firstTextEvent) {
        applyDeltaText(firstTextEvent.deltaInfo, sanitized);
        controller.enqueue(encoder.encode(formatFrame(firstTextEvent.deltaInfo.obj, firstTextEvent.eventPrefix)));
      }
    }
    heldEvents = [];
    preambleBuffer = "";
  };
  const processBlock = (rawBlock, controller) => {
    if (!rawBlock.trim()) {
      if (!preamblePhase) controller.enqueue(encoder.encode(rawBlock));
      return;
    }
    const lines = rawBlock.split("\n");
    let eventPrefix = "";
    const dataLines = [];
    for (const line of lines) {
      if (line.startsWith("event:")) eventPrefix += line + "\n";
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) {
      if (preamblePhase) heldEvents.push({ rawBlock, eventPrefix, deltaInfo: null });
      else controller.enqueue(encoder.encode(rawBlock));
      return;
    }
    const payloadStr = dataLines.join("\n").trim();
    if (payloadStr === "[DONE]") {
      flushPreamble(controller);
      controller.enqueue(encoder.encode(rawBlock));
      return;
    }
    let parsed = null;
    try { parsed = JSON.parse(payloadStr); } catch {}
    const deltaInfo = extractDelta(parsed);
    if (!deltaInfo) {
      if (preamblePhase) heldEvents.push({ rawBlock, eventPrefix, deltaInfo: null });
      else controller.enqueue(encoder.encode(rawBlock));
      return;
    }
    if (preamblePhase) {
      preambleBuffer += deltaInfo.text;
      heldEvents.push({ rawBlock, eventPrefix, deltaInfo });
      const reachedBoundary = preambleBuffer.includes("\n\n") || preambleBuffer.includes("```") || (preambleBuffer.length > 420 && !isRefusalText(preambleBuffer));
      if (reachedBoundary) flushPreamble(controller);
    } else {
      controller.enqueue(encoder.encode(rawBlock));
    }
  };
  return new TransformStream({
    transform(chunk, controller) {
      const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      sseBuffer += text.replace(/\r\n/g, "\n");
      let sepIdx;
      while ((sepIdx = sseBuffer.indexOf("\n\n")) !== -1) {
        const block = sseBuffer.slice(0, sepIdx + 2);
        sseBuffer = sseBuffer.slice(sepIdx + 2);
        processBlock(block, controller);
      }
    },
    flush(controller) {
      if (sseBuffer) { processBlock(sseBuffer, controller); sseBuffer = ""; }
      flushPreamble(controller);
    }
  });
}
