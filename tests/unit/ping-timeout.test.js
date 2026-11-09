import { describe, expect, it } from "vitest";
import {
  WEB_COOKIE_PROVIDERS,
  SLOW_FALLBACK_PROVIDERS,
  probeTimeoutMs,
  PROBE_TIMEOUT_MS,
  WEB_COOKIE_PROBE_TIMEOUT_MS,
  SLOW_FALLBACK_PROBE_TIMEOUT_MS,
} from "../../src/app/api/models/test/probeBudget.js";

describe("model probe budget", () => {
  it("treats every Aries web-cookie provider as slow-probing", () => {
    for (const provider of ["gemini-web", "kimi-web", "deepseek-web", "xiaomi-mimo"]) {
      expect(WEB_COOKIE_PROVIDERS.has(provider)).toBe(true);
    }
  });

  it("keeps REST providers out of the slow set", () => {
    for (const provider of ["openai", "anthropic", "gemini", "opencode-zen"]) {
      expect(WEB_COOKIE_PROVIDERS.has(provider)).toBe(false);
    }
  });

  it("gives web-cookie probes 90s and REST probes 15s", () => {
    for (const model of [
      "gemini-web/gemini-3.6-flash",
      "kimi-web/kimi-k2",
      "deepseek-web/deepseek-v3",
      "xiaomi-mimo/mimo-v2.5-pro",
    ]) {
      expect(probeTimeoutMs(model)).toBe(WEB_COOKIE_PROBE_TIMEOUT_MS);
    }
    expect(probeTimeoutMs("openai/gpt-4o")).toBe(PROBE_TIMEOUT_MS);
    expect(WEB_COOKIE_PROBE_TIMEOUT_MS).toBeGreaterThan(PROBE_TIMEOUT_MS);
  });

  it("gives slow-fallback free-tier probes 120s so rotation can finish", () => {
    for (const provider of ["opencode", "opencode-v2", "opencode-go", "opencode-zen"]) {
      expect(SLOW_FALLBACK_PROVIDERS.has(provider)).toBe(true);
      expect(probeTimeoutMs(`${provider}/some-model`)).toBe(SLOW_FALLBACK_PROBE_TIMEOUT_MS);
    }
    expect(SLOW_FALLBACK_PROBE_TIMEOUT_MS).toBeGreaterThan(WEB_COOKIE_PROBE_TIMEOUT_MS);
  });

  it("resolves provider aliases before picking the budget", () => {
    expect(probeTimeoutMs("oc/beam-free")).toBe(SLOW_FALLBACK_PROBE_TIMEOUT_MS);
    expect(probeTimeoutMs("oc2/beam-free")).toBe(SLOW_FALLBACK_PROBE_TIMEOUT_MS);
    expect(probeTimeoutMs("ocg/some-model")).toBe(SLOW_FALLBACK_PROBE_TIMEOUT_MS);
    expect(probeTimeoutMs("openai/gpt-4o")).toBe(PROBE_TIMEOUT_MS);
  });
});
