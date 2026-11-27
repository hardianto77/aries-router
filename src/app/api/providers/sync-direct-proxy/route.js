import { NextResponse } from "next/server";
import { getProxyPools, getProviderConnections, updateProviderConnection } from "@/models";
import { distributeHarvestedFairlyToProviders, syncHarvestedToResidentialFiles } from "@/lib/network/pureResidentialHarvester.js";
import { executeDirectProxySync } from "@/lib/network/directProxySyncEngine";

export const dynamic = "force-dynamic";

/**
 * POST /api/providers/sync-direct-proxy
 *
 * Terintegrasi langsung dengan Proxy Harvest:
 * - Memakai pool Pure-Residential terverifikasi dari Proxy Harvest (`proxyPools` + `residential_fresh_pool.json`)
 * - Distribusi adil 1-on-1 langsung ke setiap koneksi provider (`proxyPoolId = null`, 0 group pool)
 */
export async function POST(request) {
  try {
    let body = {};
    try {
      body = await request.json();
    } catch {}

    const pools = await getProxyPools().catch(() => []);
    const verifiedResi = pools.filter(
      (p) => p?.isActive !== false && p?.isResidential === true && p?.ipType !== "datacenter" && p?.proxyFlagged !== true
    );

    if (verifiedResi.length > 0 && !body.forcePythonSync) {
      syncHarvestedToResidentialFiles(pools);
      const distStats = await distributeHarvestedFairlyToProviders({
        getProxyPools,
        getProviderConnections,
        updateProviderConnection,
      });
      return NextResponse.json({
        success: true,
        source: "proxy-harvest",
        ...distStats,
        message: `Distributed ${distStats.distinctProxiesUsed} Proxy Harvest IPs across ${distStats.providersCovered} providers (${distStats.totalExternalConnections} connections, 0 group pools).`,
      });
    }

    const provider = body.provider ? String(body.provider).trim() : "";
    const rotateWarp = body.rotateWarp !== false;
    const allRotate = body.allRotate === true;
    const result = await executeDirectProxySync({ provider, rotateWarp, allRotate });

    if (result && result.success) {
      return NextResponse.json(result);
    }

    return NextResponse.json(
      { success: false, error: result?.error || "Sinkronisasi gagal dieksekusi", details: result },
      { status: 500 }
    );
  } catch (error) {
    console.error("[sync-direct-proxy] route error:", error);
    return NextResponse.json(
      { success: false, error: String(error.message || error).slice(0, 500) },
      { status: 500 }
    );
  }
}
