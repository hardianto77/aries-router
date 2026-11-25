import { NextResponse } from "next/server";
import { getProviderConnections, updateProviderConnection } from "@/models";
import {
  RESIDENTIAL_GATEWAY_ID,
  loadSyncedResidentialState,
  ensureResidentialGatewayPool,
} from "@/lib/network/residentialDbSync.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const provider = String(body?.provider || "").trim();
    const action = String(body?.action || "bind");
    const distribution = String(body?.distribution || "auto-hedge");

    if (!provider) {
      return NextResponse.json({ error: "Target provider is required" }, { status: 400 });
    }

    const allConnections = await getProviderConnections();
    const connections = allConnections.filter((c) => c.provider === provider && c.isActive !== false);
    if (connections.length === 0) {
      return NextResponse.json({ error: `No active connections found for provider "${provider}"` }, { status: 404 });
    }

    if (action === "unbind") {
      let updatedCount = 0;
      for (const conn of connections) {
        const psd = conn.providerSpecificData || {};
        await updateProviderConnection(conn.id, {
          providerSpecificData: {
            ...psd,
            proxyPoolId: null,
            connectionProxyEnabled: false,
            connectionProxyUrl: "",
          },
        });
        updatedCount++;
      }
      return NextResponse.json({
        success: true,
        action: "unbind",
        provider,
        updatedCount,
        state: await loadSyncedResidentialState(),
      });
    }

    const state = await loadSyncedResidentialState();
    const healthyNodes = state.nodes.filter((n) => n.isActive && n.alive && n.isResidential && n.ipType === "residential");

    const gatewayAlive = state.gateway?.alive || 0;
    if (healthyNodes.length === 0 && gatewayAlive === 0) {
      return NextResponse.json(
        { error: "No verified Fresh Residential proxy nodes available. Import or scan residential proxies first." },
        { status: 400 }
      );
    }
    if (distribution === "one-to-one" && healthyNodes.length === 0) {
      return NextResponse.json(
        { error: "1-on-1 rotation requires verified residential nodes in inventory. Scan host sources first." },
        { status: 400 }
      );
    }

    await ensureResidentialGatewayPool(Math.max(healthyNodes.length, gatewayAlive));

    let updatedCount = 0;
    for (let i = 0; i < connections.length; i++) {
      const conn = connections[i];
      const psd = conn.providerSpecificData || {};
      const node = healthyNodes.length > 0 ? healthyNodes[i % healthyNodes.length] : null;
      const poolId = distribution === "one-to-one" && node ? node.id : RESIDENTIAL_GATEWAY_ID;

      const patch = {
        providerSpecificData: {
          ...psd,
          proxyPoolId: null,
          connectionProxyEnabled: true,
          connectionProxyUrl: "http://127.0.0.1:20188",
        },
      };

      if (body?.resetProxyErrors && typeof conn.lastError === "string" && /502|504|524|407|proxy|timeout|tunnel/i.test(conn.lastError)) {
        patch.testStatus = "active";
        patch.lastError = null;
      }

      await updateProviderConnection(conn.id, patch);
      updatedCount++;
    }

    return NextResponse.json({
      success: true,
      action: "bind",
      provider,
      distribution,
      updatedCount,
      residentialPoolNodes: healthyNodes.length,
      state: await loadSyncedResidentialState(),
    });
  } catch (error) {
    console.error("[residential-proxy bind POST]", error);
    return NextResponse.json(
      { error: error?.message || "Failed to bind residential proxies to provider" },
      { status: 500 }
    );
  }
}
