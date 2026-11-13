/**
 * Refusal Guard & Detection Engine (Internal Pipeline L10)
 * Detects whether an LLM output is a safety refusal / moralizing denial.
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
  // Evasion compliance traps (from ai_bench_mark audit)
  /\b(cannot provide a response that (?:takes a stance|meets)|cannot provide a direct analysis)\b/i,
  /\b(it is not possible to analyze|lacks empirical evidence to support|the question is flawed)\b/i,
  /\b(as an ai,?\s*i cannot take a stance|not in a position to take a stance)\b/i,
];

export function isRefusalText(text) {
  if (typeof text !== "string") return false;
  const clean = text.trim();
  if (clean.length < 5 || clean.length > 5000) return false;
  return REFUSAL_PATTERNS.some((pattern) => pattern.test(clean));
}
