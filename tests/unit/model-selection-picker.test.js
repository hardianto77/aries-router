import { describe, expect, it } from "vitest";
import {
  batchWouldClearAllSelectedValues,
  getModelBatchDelta,
  parseAllowedModelsList,
  updateAllowedModelsList,
} from "@/shared/utils/modelSelection.js";

const makeSelectedModels = (count) =>
  Array.from({ length: count }, (_, index) => `provider/model-${index + 1}`);

describe("model selection helpers", () => {
  it("preserves a 409-model selection while adding and removing only the requested group values", () => {
    const original = makeSelectedModels(409).join(", ");
    const afterAdd = updateAllowedModelsList(original, ["other/model-a", "other/model-b"], "add");
    const added = parseAllowedModelsList(afterAdd);

    expect(added).toHaveLength(411);
    expect(added.slice(0, 409)).toEqual(makeSelectedModels(409));

    const afterRemove = updateAllowedModelsList(afterAdd, ["provider/model-1", "other/model-a"], "remove");
    const remaining = parseAllowedModelsList(afterRemove);
    expect(remaining).toHaveLength(409);
    expect(remaining).toEqual([
      ...makeSelectedModels(409).slice(1),
      "other/model-b",
    ]);
  });

  it("deduplicates a batch without reordering existing selections", () => {
    const next = updateAllowedModelsList("provider/a, provider/b", ["provider/b", "provider/c"], "add");
    expect(parseAllowedModelsList(next)).toEqual(["provider/a", "provider/b", "provider/c"]);
  });

  it("does not turn removal of the final explicit model into unrestricted access", () => {
    expect(updateAllowedModelsList("provider/only-model", ["provider/only-model"], "remove"))
      .toBe("provider/only-model");
    expect(batchWouldClearAllSelectedValues(
      [{ value: "provider/only-model" }],
      ["provider/only-model"]
    )).toBe(true);
  });

  it("computes per-group actions from visible models and excludes placeholders", () => {
    const models = [
      { value: "provider/selected" },
      { value: "provider/new" },
      { value: "provider/edit-model", isPlaceholder: true },
    ];

    expect(getModelBatchDelta(models, ["provider/selected"], "add"))
      .toEqual([{ value: "provider/new" }]);
    expect(getModelBatchDelta(models, ["provider/selected"], "remove"))
      .toEqual([{ value: "provider/selected" }]);
    expect(batchWouldClearAllSelectedValues(models, ["provider/selected", "other/hidden"]))
      .toBe(false);
  });
});
