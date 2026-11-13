import { NextResponse } from "next/server";
import { getSettings } from "@/lib/localDb";

export const dynamic = "force-dynamic";

/**
 * GET /api/settings/env
 * Read sanitized environment and runtime security variables
 */
export async function GET() {
  try {
    const jwtSecret = process.env.JWT_SECRET || "";
    const machineSalt = process.env.MACHINE_ID_SALT || "";
    const apiKeySecret = process.env.API_KEY_SECRET || "";
    const port = process.env.PORT || "20128";
    const dataDir = process.env.DATA_DIR || "/var/lib/xrouter";
    const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

    return NextResponse.json({
      port,
      baseUrl,
      dataDir,
      jwtSecretSet: Boolean(jwtSecret),
      jwtSecretLength: jwtSecret.length,
      jwtSecretMasked: jwtSecret ? `${jwtSecret.slice(0, 4)}••••••••${jwtSecret.slice(-4)}` : "Not Set",
      machineSaltSet: Boolean(machineSalt),
      machineSaltMasked: machineSalt ? `${machineSalt.slice(0, 3)}••••••••` : "Not Set",
      apiKeySecretSet: Boolean(apiKeySecret),
      apiKeySecretMasked: apiKeySecret ? `${apiKeySecret.slice(0, 3)}••••••••` : "Not Set",
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
