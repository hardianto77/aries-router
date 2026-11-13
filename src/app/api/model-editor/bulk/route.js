import { NextResponse } from "next/server";
import { getStudioModel, setStudioModel } from "@/lib/db/repos/modelEditorRepo.js";

export const dynamic = "force-dynamic";

const MAX_MODELS = 200;
const MODEL_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const BULK_FIELDS = new Set(["inputMultiplier", "outputMultiplier", "contextWindow"]);

function normalizeNames(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return { error: "Select at least one model" };
  }
  if (value.length > MAX_MODELS) {
    return { error: `Select at most ${MAX_MODELS} models at once` };
  }
  if (value.some((name) => typeof name !== "string" || !name.trim())) {
    return { error: "Every selected model must have a valid name" };
  }

  const names = value.map((name) => name.trim());
  if (names.some((name) => !MODEL_NAME_RE.test(name))) {
    return { error: "Every selected model must have a valid name" };
  }
  if (new Set(names).size !== names.length) {
    return { error: "The selected models must be unique" };
  }
  return { names };
}

function normalizePatch(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { error: "No changes given" };
  }

  const patch = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!BULK_FIELDS.has(key)) {
      return { error: "Only inputMultiplier, outputMultiplier, and contextWindow can be changed in bulk" };
    }
    if ((typeof raw !== "number" && typeof raw !== "string") || (typeof raw === "string" && !raw.trim())) {
      return { error: `${key} must be a number of 0 or more` };
    }

    const number = Number(raw);
    if (!Number.isFinite(number) || number < 0) {
      return { error: `${key} must be a number of 0 or more` };
    }
    if (key === "contextWindow" && !Number.isSafeInteger(number)) {
      return { error: "contextWindow must be a non-negative safe integer" };
    }
    patch[key] = number;
  }

  if (Object.keys(patch).length === 0) return { error: "No changes given" };
  return { patch };
}

// The existing dashboard guard protects /api/model-editor and applies the
// manageModels permission to write methods, including this nested route.
export async function PATCH(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 });
  }

  const parsedNames = normalizeNames(body.names);
  if (parsedNames.error) return NextResponse.json({ error: parsedNames.error }, { status: 400 });
  const parsedPatch = normalizePatch(body.patch);
  if (parsedPatch.error) return NextResponse.json({ error: parsedPatch.error }, { status: 400 });

  const updated = [];
  const missing = [];
  const failed = [];

  for (const name of parsedNames.names) {
    let existing;
    try {
      existing = await getStudioModel(name);
    } catch {
      failed.push({ name, error: "lookup failed" });
      continue;
    }
    if (!existing) {
      missing.push(name);
      continue;
    }

    const pick = (key, fallback) =>
      Object.hasOwn(parsedPatch.patch, key) ? parsedPatch.patch[key] : fallback;
    try {
      await setStudioModel({
        callName: existing.callName,
        displayName: existing.displayName,
        ownedBy: existing.ownedBy,
        targetModel: existing.targetModel,
        targetLabel: existing.targetLabel,
        contextWindow: pick("contextWindow", existing.contextWindow),
        systemPrompt: existing.systemPrompt,
        inputMultiplier: pick("inputMultiplier", existing.inputMultiplier),
        outputMultiplier: pick("outputMultiplier", existing.outputMultiplier),
        antiProbe: existing.antiProbe,
      });
      updated.push(name);
    } catch {
      failed.push({ name, error: "update failed" });
    }
  }

  return NextResponse.json({
    updated,
    missing,
    failed,
    applied: parsedPatch.patch,
  });
}
