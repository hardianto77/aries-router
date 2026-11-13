import { describe, expect, it } from "vitest";
import {
  isRuleMatching,
  interpolateVariables,
  executeInjection,
  extractUserText,
} from "../../src/lib/db/repos/promptInjectionRepo.js";

describe("Prompt Injection - Rule Matching", () => {
  it("matches 'all' targetType unconditionally", async () => {
    const rule = { enabled: true, content: "test", targetType: "all" };
    expect(await isRuleMatching(rule, { modelStr: "gpt-4o" })).toBe(true);
    expect(await isRuleMatching(rule, { comboName: "my-combo" })).toBe(true);
  });

  it("does not match when disabled or empty content", async () => {
    const rule1 = { enabled: false, content: "test", targetType: "all" };
    expect(await isRuleMatching(rule1, { modelStr: "gpt-4o" })).toBe(false);

    const rule2 = { enabled: true, content: "   ", targetType: "all" };
    expect(await isRuleMatching(rule2, { modelStr: "gpt-4o" })).toBe(false);
  });

  it("matches combo targets correctly", async () => {
    const rule = {
      enabled: true,
      content: "test",
      targetType: "combos",
      targetCombos: ["coder-combo", "fallback-pro"],
    };

    expect(await isRuleMatching(rule, { comboName: "coder-combo" })).toBe(true);
    expect(await isRuleMatching(rule, { modelStr: "fallback-pro" })).toBe(true);
    expect(await isRuleMatching(rule, { comboName: "other-combo" })).toBe(false);
  });

  it("matches model targets with exact names and wildcards", async () => {
    const rule = {
      enabled: true,
      content: "test",
      targetType: "models",
      targetModels: ["gpt-4o", "claude-*", "openai/*"],
    };

    expect(await isRuleMatching(rule, { modelStr: "gpt-4o" })).toBe(true);
    expect(await isRuleMatching(rule, { modelStr: "claude-3-7-sonnet" })).toBe(true);
    expect(await isRuleMatching(rule, { provider: "openai", model: "gpt-3.5-turbo" })).toBe(true);
    expect(await isRuleMatching(rule, { modelStr: "deepseek-chat" })).toBe(false);
  });

  it("matches custom targetType (either combo or model)", async () => {
    const rule = {
      enabled: true,
      content: "test",
      targetType: "custom",
      targetCombos: ["dev-combo"],
      targetModels: ["deepseek-v3"],
    };

    expect(await isRuleMatching(rule, { comboName: "dev-combo" })).toBe(true);
    expect(await isRuleMatching(rule, { modelStr: "deepseek-v3" })).toBe(true);
    expect(await isRuleMatching(rule, { modelStr: "other" })).toBe(false);
  });

  it("matches targetKeys when specified", async () => {
    const rule = {
      enabled: true,
      content: "test",
      targetType: "all",
      targetKeys: ["sk-vip-1", "sk-vip-2"],
    };

    expect(await isRuleMatching(rule, { apiKey: "sk-vip-1" })).toBe(true);
    expect(await isRuleMatching(rule, { apiKey: "sk-guest" })).toBe(false);
    expect(await isRuleMatching(rule, { apiKey: "" })).toBe(false);
  });

  it("matches matchCondition (contains & regex)", async () => {
    const keywordRule = {
      enabled: true,
      content: "test",
      targetType: "all",
      matchCondition: {
        type: "contains",
        pattern: "python, js",
        caseSensitive: false,
      },
    };
    expect(await isRuleMatching(keywordRule, { userText: "Write a python script" })).toBe(true);
    expect(await isRuleMatching(keywordRule, { userText: "Write a C++ program" })).toBe(false);

    const regexRule = {
      enabled: true,
      content: "test",
      targetType: "all",
      matchCondition: {
        type: "regex",
        pattern: "^(generate|create)\\b",
        caseSensitive: false,
      },
    };
    expect(await isRuleMatching(regexRule, { userText: "generate a report" })).toBe(true);
    expect(await isRuleMatching(regexRule, { userText: "can you generate a report" })).toBe(false);
  });
});

describe("Prompt Injection - Variable Interpolation", () => {
  it("interpolates {{model}}, {{provider}}, and date/time", () => {
    const tpl = "Model: {{model}}, Provider: {{provider}}, Date: {{date}}";
    const res = interpolateVariables(tpl, { modelStr: "gpt-4o", provider: "openai" });

    expect(res).toContain("Model: gpt-4o");
    expect(res).toContain("Provider: openai");
    expect(res).toMatch(/Date: \d{4}-\d{2}-\d{2}/);
  });
});

describe("Prompt Injection - Execution Mutations", () => {
  it("system_prepend inserts or prepends to system message", () => {
    // OpenAI with existing system
    const body1 = {
      messages: [
        { role: "system", content: "Original system" },
        { role: "user", content: "Hi" },
      ],
    };
    executeInjection(body1, "system_prepend", "Injected Instruction");
    expect(body1.messages[0].content).toBe("Injected Instruction\n\nOriginal system");

    // OpenAI without system
    const body2 = {
      messages: [{ role: "user", content: "Hi" }],
    };
    executeInjection(body2, "system_prepend", "New System");
    expect(body2.messages[0]).toEqual({ role: "system", content: "New System" });

    // Claude format
    const claudeBody = {
      system: "Claude Base System",
      messages: [{ role: "user", content: "Hi" }],
    };
    executeInjection(claudeBody, "system_prepend", "Prefix System");
    expect(claudeBody.system).toBe("Prefix System\n\nClaude Base System");
  });

  it("system_append appends to system message", () => {
    const body = {
      messages: [
        { role: "system", content: "Base system" },
        { role: "user", content: "Hi" },
      ],
    };
    executeInjection(body, "system_append", "Suffix Rule");
    expect(body.messages[0].content).toBe("Base system\n\nSuffix Rule");
  });

  it("system_override completely replaces system message", () => {
    const body = {
      messages: [
        { role: "system", content: "Old system to remove" },
        { role: "user", content: "Question" },
      ],
    };
    executeInjection(body, "system_override", "Replaced System");
    expect(body.messages.length).toBe(2);
    expect(body.messages[0]).toEqual({ role: "system", content: "Replaced System" });
    expect(body.messages[1].role).toBe("user");
  });

  it("user_prepend and user_append modify the latest user prompt", () => {
    const body = {
      messages: [
        { role: "system", content: "System" },
        { role: "user", content: "Question 1" },
        { role: "assistant", content: "Answer 1" },
        { role: "user", content: "Question 2" },
      ],
    };

    executeInjection(body, "user_prepend", "[Prefix]");
    expect(body.messages[3].content).toBe("[Prefix]\n\nQuestion 2");

    executeInjection(body, "user_append", "[Suffix]");
    expect(body.messages[3].content).toBe("[Prefix]\n\nQuestion 2\n\n[Suffix]");
  });

  it("extracts user prompt text correctly", () => {
    const body = {
      messages: [
        { role: "system", content: "You are an assistant." },
        { role: "user", content: "Hello world!" },
      ],
    };
    expect(extractUserText(body)).toBe("Hello world!");
  });
});
