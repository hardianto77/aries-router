import { beforeEach, describe, expect, it } from "vitest";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";
import { clearSessionStore } from "../../open-sse/utils/sessionManager.js";
import { translateRequest } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function headers(executor, connectionId, body, rawHeaders = {}) {
  return executor.buildHeaders({
    accessToken: "token",
    connectionId,
    rawHeaders,
  }, true, "https://www.codebuddy.ai/v2/chat/completions", "model", body);
}

beforeEach(() => clearSessionStore());

describe("CodeBuddy Intl conversation metadata", () => {
  it("keeps conversation id stable across turns and rotates per-turn ids", () => {
    const executor = new CodeBuddyIntlExecutor();
    const first = headers(executor, "account-a", { session_id: "Session-ABC", messages: [{ role: "user", content: "one" }] });
    const second = headers(executor, "account-a", { session_id: "Session-ABC", messages: [{ role: "user", content: "two" }] });
    expect(first["X-Conversation-ID"]).toBe(second["X-Conversation-ID"]);
    expect(first["X-Conversation-Request-ID"]).not.toBe(second["X-Conversation-Request-ID"]);
    expect(first["X-Conversation-Message-ID"]).not.toBe(second["X-Conversation-Message-ID"]);
    expect(first["X-Conversation-ID"]).toMatch(UUID_RE);
  });

  it("isolates the same client session across accounts", () => {
    const executor = new CodeBuddyIntlExecutor();
    const body = { session_id: "Session-ABC", messages: [{ role: "user", content: "same" }] };
    expect(headers(executor, "account-a", body)["X-Conversation-ID"])
      .not.toBe(headers(executor, "account-b", body)["X-Conversation-ID"]);
  });

  it("does not merge unidentified conversations on the same account", () => {
    const executor = new CodeBuddyIntlExecutor();
    const body = { messages: [{ role: "assistant", content: "x".repeat(80) }, { role: "user", content: "next" }] };
    expect(headers(executor, "account-a", body)["X-Conversation-ID"])
      .not.toBe(headers(executor, "account-a", body)["X-Conversation-ID"]);
  });

  it("keeps explicit header sessions stable when assistant history grows", () => {
    const executor = new CodeBuddyIntlExecutor();
    const first = headers(executor, "account-a", { messages: [{ role: "user", content: "one" }] }, new Headers({ "X-Session-ID": "session-one" }));
    const second = headers(executor, "account-a", { messages: [{ role: "assistant", content: "x".repeat(80) }] }, { "X-Session-ID": "session-one" });
    expect(first["X-Conversation-ID"]).toBe(second["X-Conversation-ID"]);
  });

  it("preserves metadata-only client sessions through Claude translation", () => {
    const executor = new CodeBuddyIntlExecutor();
    const run = (text) => {
      const credentials = { accessToken: "token", connectionId: "account-a", rawHeaders: {} };
      const body = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI, "model", {
        metadata: { user_id: "user_session_12345678-1234-1234-1234-123456789abc" },
        messages: [{ role: "user", content: text }], max_tokens: 10,
      }, true, credentials, "codebuddy-intl", null, [], "account-a");
      return executor.buildHeaders(credentials, true, "https://www.codebuddy.ai/v2/chat/completions", "model", body)["X-Conversation-ID"];
    };
    expect(run("one")).toBe(run("two"));
  });

  it("preserves caller ids and existing header casing", () => {
    const executor = new CodeBuddyIntlExecutor();
    const result = headers(executor, "account-a", { messages: [{ role: "user", content: "x" }] }, {
      "x-conversation-id": "MixedCase-ID",
      "x-conversation-request-id": "Request-ID",
      "x-conversation-message-id": "Message-ID",
    });
    expect(result["x-conversation-id"]).toBe("MixedCase-ID");
    expect(result["x-conversation-request-id"]).toBe("Request-ID");
    expect(result["x-conversation-message-id"]).toBe("Message-ID");
    expect(result["X-Conversation-ID"]).toBeUndefined();
  });

  it("supports Headers input and replaces blank required ids", () => {
    const executor = new CodeBuddyIntlExecutor();
    const result = headers(executor, "account-a", { messages: [{ role: "user", content: "x" }] }, new Headers({
      "x-conversation-id": "Headers-ID",
      "x-conversation-request-id": "   ",
    }));
    expect(result["X-Conversation-ID"]).toBe("Headers-ID");
    expect(result["X-Conversation-Request-ID"]).toMatch(UUID_RE);
    expect(result["X-Conversation-Message-ID"]).toMatch(UUID_RE);
  });

  it("keeps the required system message first", () => {
    const executor = new CodeBuddyIntlExecutor();
    const transformed = executor.transformRequest("model", { messages: [{ role: "user", content: "hi" }] }, true, {});
    expect(transformed.messages[0]).toEqual({ role: "system", content: "You are CodeBuddy Code." });
  });
});
