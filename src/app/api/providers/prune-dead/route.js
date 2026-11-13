import { NextResponse } from "next/server";
import { pruneDeadProviderConnections } from "@/lib/localDb";
import { recordSecurityEvent } from "@/lib/db/repos/securityLogRepo.js";

export async function POST(request) {
  try {
    let body = {};
    try {
      body = await request.json();
    } catch {
      body = {};
    }

    const includeWeb = body?.includeWeb === true;
    const { count, removed } = await pruneDeadProviderConnections({ includeWeb });

    recordSecurityEvent({
      type: "connections.prune_dead",
      severity: "info",
      ip: request.headers.get("x-forwarded-for") || "local",
      actor: "admin",
      method: "POST",
      path: "/api/providers/prune-dead",
      status: 200,
      detail: JSON.stringify({ count, removedIds: removed.map(r => r.id) }),
      userAgent: request.headers.get("user-agent") || "",
    });

    return NextResponse.json({
      success: true,
      message: `Successfully pruned ${count} dead/exhausted connections`,
      count,
      removed: removed.map(r => ({ id: r.id, name: r.name, provider: r.provider, testStatus: r.testStatus })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to prune dead connections" },
      { status: 500 }
    );
  }
}
