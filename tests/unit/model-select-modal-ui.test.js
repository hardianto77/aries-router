import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The repository's Vitest harness does not transform JSX in .js components;
// Next's production build validates the component syntax and this guards its UI contract.
const componentSource = readFileSync(
  fileURLToPath(new URL("../../src/shared/components/ModelSelectModal.js", import.meta.url)),
  "utf8"
);

describe("ModelSelectModal multi-select UI", () => {
  it("keeps search, persistent selected list, per-provider batch actions, and Done wired", () => {
    expect(componentSource).toContain('aria-label="Search models"');
    expect(componentSource).toContain('aria-label="Selected models"');
    expect(componentSource).toContain("!closeOnSelect && addedModelValues.length > 0");
    expect(componentSource).toContain("Select All ({groupUnadded.length})");
    expect(componentSource).toContain("Deselect All ({groupAdded.length})");
    expect(componentSource).toContain("handleRemoveSelectedValue(value)");
    expect(componentSource).toContain(">\n            Done\n");
  });
});
