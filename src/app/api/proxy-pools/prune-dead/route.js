import { NextResponse } from "next/server";
import { getProxyPools, deleteProxyPools, getProviderConnections } from "@/models";

export const dynamic = "force-dynamic";

/**
 * DELETE /api/proxy-pools/prune-dead
 * Deletes all unbound proxy pools that have failed (testStatus === "error" or inactive)
 */
export async function DELETE(request) {
  try {
    const [pools, connections] = await Promise.all([
      getProxyPools(),
      getProviderConnections(),
    ]);

    // Track proxyPoolIds that are currently bound to active connections
    const boundIds = new Set(
      connections
        .map((c) => c?.providerSpecificData?.proxyPoolId)
        .filter(Boolean)
    );

    // Find dead/failed pools that are NOT bound to any connection
    const deadPools = pools.filter(
      (p) => !boundIds.has(p.id) && (p.testStatus === "error" || p.isActive === false)
    );

    if (deadPools.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No dead proxies to prune",
        deletedCount: 0,
      });
    }

    const deadIds = deadPools.map((p) => p.id);
    const removed = await deleteProxyPools(deadIds);

    return NextResponse.json({
      success: true,
      message: `Pruned ${removed.length} dead proxy pool(s)`,
      deletedCount: removed.length,
    });
  } catch (error) {
    console.error("Error pruning dead proxies:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to prune dead proxies" },
      { status: 500 }
    );
  }
}
