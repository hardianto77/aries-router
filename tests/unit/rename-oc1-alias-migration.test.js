import { afterEach, describe, expect, it, vi } from "vitest";
import migration from "@/lib/db/migrations/005-rename-oc1-alias.js";

afterEach(() => vi.restoreAllMocks());

function makeDb() {
  const rows = {
    customModels: [
      { rowid: 1, key: "oc1|same-model|llm", value: '{"providerAlias":"oc1","name":"Legacy"}' },
      { rowid: 2, key: "oc1|new-model|llm", value: '{"providerAlias":"oc1","name":"New"}' },
      { rowid: 3, key: "oc|same-model|llm", value: '{"providerAlias":"oc","name":"Current"}' },
    ],
    modelAliases: [
      { rowid: 4, key: "my-model", value: "oc1/model-a" },
    ],
  };
  const calls = [];

  return {
    calls,
    all(sql, params = []) {
      if (sql.includes("scope = 'customModels' AND key = ?")) {
        return rows.customModels.filter((row) => row.key === params[0]);
      }
      if (sql.includes("scope = 'customModels'")) return rows.customModels;
      if (sql.includes("scope = 'modelAliases'")) return rows.modelAliases;
      throw new Error(`Unexpected query: ${sql}`);
    },
    run(sql, params = []) {
      calls.push({ sql, params });
    },
  };
}

describe("rename oc1 alias migration", () => {
  it("keeps a legacy custom model when its current-alias destination already exists", () => {
    const db = makeDb();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    migration.up(db);

    expect(warn).toHaveBeenCalledWith("[DB][migrate] kept legacy custom model on alias collision");
    expect(db.calls.some(({ params }) => params.includes(1))).toBe(false);
    expect(db.calls.some(({ sql }) => /DELETE|INSERT OR REPLACE/i.test(sql))).toBe(false);
  });

  it("propagates database errors so the migration runner can roll back instead of stamping success", () => {
    const db = {
      all() {
        throw new Error("database read failed");
      },
    };
    expect(() => migration.up(db)).toThrow("database read failed");
  });

  it("renames non-colliding custom models and model aliases in place", () => {
    const db = makeDb();
    vi.spyOn(console, "warn").mockImplementation(() => {});

    migration.up(db);

    expect(db.calls).toContainEqual({
      sql: "UPDATE kv SET key = ?, value = ? WHERE rowid = ?",
      params: ["oc|new-model|llm", '{"providerAlias":"oc","name":"New"}', 2],
    });
    expect(db.calls).toContainEqual({
      sql: "UPDATE kv SET value = ? WHERE rowid = ?",
      params: ["oc/model-a", 4],
    });
  });
});
