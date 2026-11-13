import { describe, expect, it } from "vitest";
import { formatOpencodeCliPrompt } from "../../open-sse/utils/opencodeCliRunner.js";

describe("OpenCode CLI prompt formatting", () => {
  it("extracts user text from Responses API input items", () => {
    const prompt = formatOpencodeCliPrompt({
      input: [{
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hi" }],
      }],
    });

    expect(prompt).toBe("hi");
  });

  it("returns an empty prompt when there is no conversational input", () => {
    expect(formatOpencodeCliPrompt({ input: [] })).toBe("");
    expect(formatOpencodeCliPrompt({ messages: [{ role: "system", content: "rules" }] })).toBe("");
  });
});
