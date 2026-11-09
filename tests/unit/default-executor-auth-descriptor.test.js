import { describe, expect, it } from "vitest";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

describe("DefaultExecutor direct transport auth descriptors", () => {
  it.each([
    ["claude-web", { accessToken: "sessionKey=claude-cookie" }, "Cookie", "sessionKey=claude-cookie"],
    ["yuanbao-web", { apiKey: "session=yuanbao-cookie" }, "Cookie", "session=yuanbao-cookie"],
    ["zai-web", { apiKey: "zai-session-token" }, "Authorization", "Bearer zai-session-token"],
  ])("applies the declared header for %s", (provider, credentials, header, expected) => {
    const actual = new DefaultExecutor(provider).buildHeaders(credentials, true);
    expect(actual[header]).toBe(expected);
  });

  it("does not emit an empty cookie header when credentials are missing", () => {
    const actual = new DefaultExecutor("claude-web").buildHeaders({}, true);
    expect(actual.Cookie).toBeUndefined();
  });

  it("preserves split API-key auth behavior", () => {
    const actual = new DefaultExecutor("openai").buildHeaders({ apiKey: "test-key" }, true);
    expect(actual.Authorization).toBe("Bearer test-key");
  });
});
