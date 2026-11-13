import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requiredPermissionsForApiPath } from "@/lib/auth/permissionPaths.js";

let tempDir;
const originalDataDir = process.env.DATA_DIR;
const originalJwtSecret = process.env.JWT_SECRET;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aries-model-editor-bulk-"));
  process.env.DATA_DIR = tempDir;
  process.env.JWT_SECRET = "test-jwt-secret-for-model-editor-bulk";
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try {
    global._dbAdapter?.instance?.close?.();
  } catch {
    // The adapter may already be closed by the test.
  }
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = originalJwtSecret;
});

async function patch(body) {
  const { PATCH } = await import("@/app/api/model-editor/bulk/route.js");
  const response = await PATCH(new Request("http://localhost/api/model-editor/bulk", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }));
  return { status: response.status, data: await response.json() };
}

async function seed() {
  const { setStudioModel } = await import("@/lib/db/repos/modelEditorRepo.js");
  await setStudioModel({
    callName: "m1",
    displayName: "Model One",
    ownedBy: "test-owner",
    targetModel: "openai/gpt-4o",
    targetLabel: "GPT-4o",
    contextWindow: 1000,
    systemPrompt: "keep this prompt",
    inputMultiplier: 2,
    antiProbe: true,
  });
  await setStudioModel({
    callName: "m2",
    targetModel: "openai/gpt-4o-mini",
    contextWindow: 2000,
  });
}

describe("model-editor bulk edit", () => {
  it("updates selected fields and preserves the other model fields", async () => {
    await seed();
    const { status, data } = await patch({
      names: ["m1", "m2"],
      patch: { outputMultiplier: 3, contextWindow: 5000 },
    });

    expect(status).toBe(200);
    expect(data).toEqual({
      updated: ["m1", "m2"],
      missing: [],
      failed: [],
      applied: { outputMultiplier: 3, contextWindow: 5000 },
    });

    const { getStudioModel } = await import("@/lib/db/repos/modelEditorRepo.js");
    const m1 = await getStudioModel("m1");
    expect(m1.outputMultiplier).toBe(3);
    expect(m1.inputMultiplier).toBe(2);
    expect(m1.contextWindow).toBe(5000);
    expect(m1.targetModel).toBe("openai/gpt-4o");
    expect(m1.targetLabel).toBe("GPT-4o");
    expect(m1.systemPrompt).toBe("keep this prompt");
    expect(m1.antiProbe).toBe(true);

    const m2 = await getStudioModel("m2");
    expect(m2.outputMultiplier).toBe(3);
    expect(m2.contextWindow).toBe(5000);
    expect(m2.targetModel).toBe("openai/gpt-4o-mini");
  });

  it("clears a multiplier when the value is zero", async () => {
    await seed();
    const { status, data } = await patch({ names: ["m1"], patch: { inputMultiplier: 0 } });

    expect(status).toBe(200);
    expect(data.updated).toEqual(["m1"]);
    const { getStudioModel } = await import("@/lib/db/repos/modelEditorRepo.js");
    expect((await getStudioModel("m1")).inputMultiplier).toBeUndefined();
  });

  it("rejects non-whitelisted fields and leaves stored models unchanged", async () => {
    await seed();
    const { status, data } = await patch({ names: ["m1"], patch: { targetModel: "anthropic/claude" } });

    expect(status).toBe(400);
    expect(data.error).toMatch(/Only .* can be changed in bulk/);
    const { getStudioModel } = await import("@/lib/db/repos/modelEditorRepo.js");
    expect((await getStudioModel("m1")).targetModel).toBe("openai/gpt-4o");
  });

  it("rejects empty, duplicate, invalid, or oversized selections before writing", async () => {
    await seed();
    const cases = [
      { names: [], patch: { outputMultiplier: 2 } },
      { names: ["m1", "m1"], patch: { outputMultiplier: 2 } },
      { names: ["bad/name"], patch: { outputMultiplier: 2 } },
      { names: Array.from({ length: 201 }, (_, i) => `m${i}`), patch: { outputMultiplier: 2 } },
    ];

    for (const body of cases) {
      const { status } = await patch(body);
      expect(status).toBe(400);
    }
    const { getStudioModel } = await import("@/lib/db/repos/modelEditorRepo.js");
    expect((await getStudioModel("m1")).outputMultiplier).toBeUndefined();
  });

  it("rejects invalid numeric values and fractional context windows", async () => {
    await seed();
    for (const value of [-1, null, true, "", "not-a-number"]) {
      const { status } = await patch({ names: ["m1"], patch: { inputMultiplier: value } });
      expect(status).toBe(400);
    }
    const fractional = await patch({ names: ["m1"], patch: { contextWindow: 1.5 } });
    expect(fractional.status).toBe(400);

    const { getStudioModel } = await import("@/lib/db/repos/modelEditorRepo.js");
    expect((await getStudioModel("m1")).inputMultiplier).toBe(2);
  });

  it("reports missing models separately while updating existing selections", async () => {
    await seed();
    const { status, data } = await patch({
      names: ["m1", "ghost"],
      patch: { contextWindow: "5000" },
    });

    expect(status).toBe(200);
    expect(data.updated).toEqual(["m1"]);
    expect(data.missing).toEqual(["ghost"]);
    expect(data.failed).toEqual([]);
    const { getStudioModel } = await import("@/lib/db/repos/modelEditorRepo.js");
    expect((await getStudioModel("m1")).contextWindow).toBe(5000);
  });

  it("uses the existing manageModels permission for this nested PATCH route", async () => {
    expect(requiredPermissionsForApiPath("/api/model-editor/bulk", "PATCH")).toEqual(["manageModels"]);

    const { createDashboardAuthToken } = await import("@/lib/auth/dashboardSession.js");
    const { proxy } = await import("@/dashboardGuard.js");
    const request = (token) => new NextRequest("http://localhost/api/model-editor/bulk", {
      method: "PATCH",
      headers: { cookie: `auth_token=${token}` },
    });

    const deniedToken = await createDashboardAuthToken({
      role: "apikey",
      permissions: { manageModels: false },
    });
    const denied = await proxy(request(deniedToken));
    expect(denied.status).toBe(403);

    const allowedToken = await createDashboardAuthToken({
      role: "apikey",
      permissions: { manageModels: true },
    });
    const allowed = await proxy(request(allowedToken));
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get("x-middleware-next")).toBe("1");
  });
});
