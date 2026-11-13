import { NextResponse } from "next/server";
import { listJailedIps, jailIp, unjailIp, isIpJailed } from "@/lib/security/ipJail";
import { recordSecurityEvent } from "@/lib/db/repos/securityLogRepo.js";

export const dynamic = "force-dynamic";

// GET /api/security/jail - List all currently jailed IPs
export async function GET() {
  try {
    const list = listJailedIps();
    return NextResponse.json({
      success: true,
      count: list.length,
      jailed: list,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/security/jail - Manually jail an IP
export async function POST(request) {
  try {
    const body = await request.json();
    const { ip, reason = "Manual administrator ban", durationMinutes = 30 } = body || {};

    if (!ip || !ip.trim()) {
      return NextResponse.json({ error: "IP address is required" }, { status: 400 });
    }

    const durationMs = Math.max(1, Number(durationMinutes) || 30) * 60 * 1000;
    jailIp(ip.trim(), reason.trim(), durationMs);

    return NextResponse.json({
      success: true,
      message: `IP ${ip.trim()} successfully jailed for ${durationMinutes} minutes`,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/security/jail - Unjail / unban an IP
export async function DELETE(request) {
  try {
    const url = new URL(request.url);
    const ip = url.searchParams.get("ip");

    if (!ip || !ip.trim()) {
      return NextResponse.json({ error: "IP address is required" }, { status: 400 });
    }

    const unjailed = unjailIp(ip.trim());

    if (unjailed) {
      await recordSecurityEvent({
        type: "ip.unjailed",
        severity: "info",
        ip: ip.trim(),
        actor: "admin",
        method: "SECURITY",
        path: "/api/security/jail",
        status: 200,
        detail: "Administrator manually released IP from jail",
      }).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      unjailed,
      message: unjailed ? `IP ${ip.trim()} released from jail` : `IP ${ip.trim()} was not jailed`,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
