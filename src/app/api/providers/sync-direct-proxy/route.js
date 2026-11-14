import { NextResponse } from "next/server";
import { executeDirectProxySync } from "@/lib/network/directProxySyncEngine";

export const dynamic = "force-dynamic";

/**
 * POST /api/providers/sync-direct-proxy
 * 
 * Bundled Router API Endpoint:
 * Sinkronisasi ProxyVault + Residential IP Fresh + WARP Egress Rotation.
 * Terhubung langsung 1-on-1 ke setiap akun provider secara otomatis tanpa group proxy pool.
 * Auto-injeksi pengganti fresh seketika jika ada proxy yang mati.
 */
export async function POST(request) {
  try {
    let body = {};
    try {
      body = await request.json();
    } catch {}

    const provider = body.provider ? String(body.provider).trim() : "";
    const rotateWarp = body.rotateWarp !== false;
    const allRotate = body.allRotate === true;

    const result = await executeDirectProxySync({
      provider,
      rotateWarp,
      allRotate,
    });

    if (result && result.success) {
      return NextResponse.json(result);
    }

    return NextResponse.json(
      {
        success: false,
        error: result?.error || "Sinkronisasi gagal dieksekusi",
        details: result,
      },
      { status: 500 }
    );
  } catch (error) {
    console.error("[sync-direct-proxy] route error:", error);
    return NextResponse.json(
      {
        success: false,
        error: String(error.message || error).slice(0, 500),
      },
      { status: 500 }
    );
  }
}
