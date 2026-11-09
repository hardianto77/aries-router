import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { stripEmoji } from "../../src/shared/utils/plainText.js";

const root = resolve(__dirname, "../..");
const src = resolve(root, "src");

// Log viewers translate upstream log lines; they must recognise emoji level tags
// from older log files, so they keep the literals next to the matcher.
const ALLOWED_EMOJI_FILES = new Set([
  "app/(dashboard)/dashboard/logs/LogsClient.js",
  "app/(dashboard)/dashboard/console-log/ConsoleLogClient.js",
]);

// These exact strings predate this integration. Keep the guard useful for new UI
// copy without turning unrelated legacy text cleanup into part of the upgrade.
const LEGACY_ALLOWED_LINES = new Map([
  [
    "app/(dashboard)/dashboard/model-bypass/page.js",
    new Set([
      "🔒 Core Kernel di-encode dan dilindungi secara native in-memory sehingga tidak dapat diubah-ubah atau dirusak oleh klien luar.",
      "🛡️ Custom prompt Anda otomatis dilapisi 4 Kernel Fondasi inti di atas sehingga 10x lebih kuat menembus guardrails.",
    ]),
  ],
  ["app/(dashboard)/dashboard/prompt-injection/page.js", new Set(["⚡ {tpl.name}"])],
]);

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(js|jsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("no new built-in emoji in the UI surface", () => {
  it("uses styled icons instead of emoji glyphs in pages and shared components", () => {
    const offenders = [];
    for (const base of ["app", "shared/components"]) {
      for (const file of walk(join(src, base))) {
        const rel = relative(src, file).split("\\").join("/");
        // API routes and service code are not UI; their Telegram/log text is
        // intentionally allowed to contain emoji literals.
        if (rel.startsWith("app/api/")) continue;
        if (ALLOWED_EMOJI_FILES.has(rel)) continue;
        const allowedLines = LEGACY_ALLOWED_LINES.get(rel) || new Set();
        const lines = readFileSync(file, "utf8").split("\n");
        lines.forEach((line, i) => {
          const text = line.trim();
          if (EMOJI.test(line) && !allowedLines.has(text)) offenders.push(`${rel}:${i + 1}: ${text}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  it("renders locale codes as badges, not flag emoji", () => {
    const locales = readFileSync(resolve(src, "shared/constants/locales.js"), "utf8");
    expect(locales).not.toMatch(/\u{1F1E6}/u);
    expect(locales).toContain("LOCALE_TAGS");
  });
});

describe("stripEmoji", () => {
  it("drops emoji from log text and keeps readable spacing", () => {
    expect(stripEmoji("🟢 [INFO] listening on 20128")).toBe("[INFO] listening on 20128");
    expect(stripEmoji("done ✅ in 12ms")).toBe("done in 12ms");
    expect(stripEmoji("⚡ 1024 cached")).toBe("1024 cached");
  });

  it("keeps plain text and typographic arrows intact", () => {
    expect(stripEmoji("provider → model")).toBe("provider → model");
    expect(stripEmoji("no glyphs here")).toBe("no glyphs here");
    expect(stripEmoji("")).toBe("");
    expect(stripEmoji(null)).toBe(null);
  });
});
