import { describe, expect, it } from "vitest";
import {
  getModelBatchDelta,
  isModelValueSelected,
  parseAllowedModelsList,
  updateAllowedModelsList,
} from "@/shared/utils/modelSelection.js";

describe("allowed model selection matching", () => {
  it("matches, deduplicates, and removes model ids case-insensitively like the server", () => {
    const current = "OpenAI/GPT-4o, provider/other";
    const selected = parseAllowedModelsList(current);

    expect(isModelValueSelected("openai/gpt-4O", selected)).toBe(true);
    expect(updateAllowedModelsList(current, ["OPENAI/gpt-4o"], "add")).toBe(current);
    expect(updateAllowedModelsList(current, ["openai/gpt-4O"], "remove"))
      .toBe("provider/other");
    expect(getModelBatchDelta(
      [{ value: "openai/gpt-4o" }],
      ["OpenAI/GPT-4o"],
      "add"
    )).toEqual([]);
  });

  it("turns an unrestricted wildcard into an explicit restriction when a model is chosen", () => {
    expect(updateAllowedModelsList("*", ["provider/model"], "add"))
      .toBe("provider/model");
  });
});
