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
    const action = String(body?.action || "bind"); // "bind" | "unbind"
    const distribution = String(body?.distribution || "auto-hedge"); // "auto-hedge" | "one-to-one"

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

    if (healthyNodes.length === 0) {
      return NextResponse.json(
        { error: "No verified Fresh Residential proxy nodes available. Import or scan residential proxies first." },
        { status: 400 }
      );
    }

    await ensureResidentialGatewayPool(healthyNodes.length);

    let updatedCount = 0;
    for (let i = 0; i < connections.length; i++) {
      const conn = connections[i];
      const psd = conn.providerSpecificData || {};
      const node = healthyNodes[i % healthyNodes.length];
      const poolId = distribution === "one-to-one" ? node.id : RESIDENTIAL_GATEWAY_ID;

      const patch = {
        providerSpecificData: {
          ...psd,
          proxyPoolId: poolId,
          connectionProxyEnabled: true,
          connectionProxyUrl: distribution === "one-to-one" ? (psd.connectionProxyUrl || "") : "residential://auto",
        },
      };

      // Clear prior 502/proxy transport failure lock if requested so provider recovers immediately
      if (body?.resetProxyErrors && typeof conn.lastError === "string" && /502|proxy|timeout|tunnel/i.test(conn.lastError)) {
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
