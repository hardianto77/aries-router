import { NextResponse } from "next/server";
import {
  getPromptInjections,
  getPromptInjectionById,
  createPromptInjection,
  updatePromptInjection,
  deletePromptInjection,
  reorderPromptInjections,
  isRuleMatching,
  interpolateVariables,
  executeInjection,
  extractUserText,
} from "@/lib/db/repos/promptInjectionRepo.js";

// GET /api/prompt-injection - list all rules
export async function GET() {
  try {
    const rules = await getPromptInjections();
    return NextResponse.json({ rules });
  } catch (error) {
    console.error("Error fetching prompt injections:", error);
    return NextResponse.json({ error: "Failed to fetch prompt injections" }, { status: 500 });
  }
}

// POST /api/prompt-injection - create rule or test dry-run
export async function POST(request) {
  try {
    const body = await request.json();

    // Dry-run simulation mode
    if (body.action === "test") {
      const { rule, sampleBody, context } = body;
      const testBody = JSON.parse(JSON.stringify(sampleBody || {
        messages: [{ role: "user", content: "Hello world" }]
      }));
      const testContext = context || { modelStr: "gpt-4o" };
      const userText = testContext.userText !== undefined ? testContext.userText : extractUserText(testBody);

      const matches = await isRuleMatching(rule, { ...testContext, userText });
      let promptText = "";
      if (matches && rule?.content) {
        promptText = interpolateVariables(rule.content, testContext);
        executeInjection(testBody, rule.position, promptText);
      }

      return NextResponse.json({
        matches,
        promptText,
        resultBody: testBody,
      });
    }

    // Standard rule creation
    const name = String(body.name || "").trim();
    if (!name) {
      return NextResponse.json({ error: "Rule name is required." }, { status: 400 });
    }

    const content = String(body.content || "").trim();
    if (!content) {
      return NextResponse.json({ error: "Prompt content cannot be empty." }, { status: 400 });
    }

    const rule = await createPromptInjection({
      name,
      description: body.description,
      enabled: body.enabled !== false,
      targetType: body.targetType || "models",
      targetCombos: body.targetCombos || [],
      targetModels: body.targetModels || [],
      targetKeys: body.targetKeys || [],
      matchCondition: body.matchCondition || { type: "always", pattern: "", caseSensitive: false },
      position: body.position || "system_prepend",
      content: body.content,
      priority: body.priority,
    });

    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    console.error("Error creating prompt injection:", error);
    return NextResponse.json({ error: "Failed to create prompt injection" }, { status: 500 });
  }
}

// PUT /api/prompt-injection - update rule or reorder
export async function PUT(request) {
  try {
    const body = await request.json();

    // Reorder action
    if (body.action === "reorder" && Array.isArray(body.orderedIds)) {
      await reorderPromptInjections(body.orderedIds);
      const rules = await getPromptInjections();
      return NextResponse.json({ success: true, rules });
    }

    const id = body.id;
    if (!id) {
      return NextResponse.json({ error: "Rule ID is required." }, { status: 400 });
    }

    const existing = await getPromptInjectionById(id);
    if (!existing) {
      return NextResponse.json({ error: "Rule not found." }, { status: 404 });
    }

    if (body.name !== undefined && !String(body.name).trim()) {
      return NextResponse.json({ error: "Rule name cannot be empty." }, { status: 400 });
    }

    if (body.content !== undefined && !String(body.content).trim()) {
      return NextResponse.json({ error: "Prompt content cannot be empty." }, { status: 400 });
    }

    const updated = await updatePromptInjection(id, body);
    return NextResponse.json({ rule: updated });
  } catch (error) {
    console.error("Error updating prompt injection:", error);
    return NextResponse.json({ error: "Failed to update prompt injection" }, { status: 500 });
  }
}

// DELETE /api/prompt-injection - delete rule
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "Missing rule id" }, { status: 400 });
    }

    const success = await deletePromptInjection(id);
    if (!success) {
      return NextResponse.json({ error: "Rule not found or could not be deleted" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting prompt injection:", error);
    return NextResponse.json({ error: "Failed to delete prompt injection" }, { status: 500 });
  }
}
