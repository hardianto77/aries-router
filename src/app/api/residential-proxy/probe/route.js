import { NextResponse } from "next/server";
import { getProxyPools, getProxyPoolById } from "@/models";
import {
  globalResidentialPool,
  normalizeProxyInput,
} from "@/lib/network/residentialProxyEngine.js";
import {
  RESIDENTIAL_GATEWAY_ID,
  loadSyncedResidentialState,
  persistResidentialProbeResult,
  ensureResidentialGatewayPool,
  runWithConcurrency,
  isManagedResidentialRecord,
} from "@/lib/network/residentialDbSync.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode = String(body?.mode || (body?.nodeId ? "single" : "all"));
    const targetUrl = String(body?.targetUrl || "https://api.ipify.org?format=json").trim();

    const { config } = await loadSyncedResidentialState();

    if (mode === "auto-hedge") {
      const t0 = Date.now();
      const res = await globalResidentialPool.hedgeFetch(
        targetUrl,
        {
          method: targetUrl.includes("api.ipify.org") ? "GET" : "HEAD",
          headers: { "User-Agent": "Aries-Residential-Probe/2.0" },
        },
        { timeoutMs: config.requestTimeoutMs }
      );
      const latencyMs = Date.now() - t0;
      let payloadIp = null;
      if (targetUrl.includes("api.ipify.org")) {
        const txt = await res.text().catch(() => "");
        try { payloadIp = JSON.parse(txt)?.ip || null; } catch {}
      }
      const meta = res._residentialMeta || {};
      const state = await loadSyncedResidentialState();
      return NextResponse.json({
        success: true,
        mode: "auto-hedge",
        ok: res.ok,
        httpStatus: res.status,
        latencyMs,
        egressIp: payloadIp || meta.egressIp || null,
        isp: meta.isp || null,
        countryCode: meta.countryCode || null,
        node: meta.node || null,
        hedgeWon: Boolean(meta.hedgeWon),
        ipType: "residential",
        isResidential: true,
        state,
      });
    }

    if (mode === "custom-url" || body?.proxyUrl) {
      const normalized = normalizeProxyInput(body.proxyUrl);
      const result = await globalResidentialPool.verifyProxyUrl(normalized, {
        targetUrl,
        timeoutMs: config.probeTimeoutMs,
      });
      return NextResponse.json({ success: true, mode: "custom-url", result });
    }

    if (mode === "single" && body?.nodeId) {
      const existing = await getProxyPoolById(body.nodeId);
      if (!existing) return NextResponse.json({ error: "Node not found" }, { status: 404 });
      const result = await globalResidentialPool.verifyProxyUrl(existing.proxyUrl, {
        targetUrl,
        timeoutMs: config.probeTimeoutMs,
      });
      const updated = await persistResidentialProbeResult(result, existing, config);
      const state = await loadSyncedResidentialState();
      await ensureResidentialGatewayPool(state.metrics.healthyResidentialCount);
      return NextResponse.json({
        success: true,
        mode: "single",
        result,
        node: updated,
        state: await loadSyncedResidentialState(),
      });
    }

    // Probe all managed residential nodes concurrently
    const allPools = await getProxyPools();
    const targets = allPools.filter(
      (p) => isManagedResidentialRecord(p) && p.id !== RESIDENTIAL_GATEWAY_ID && p.proxyUrl && !p.proxyUrl.startsWith("residential://")
    );

    const results = await runWithConcurrency(targets, 10, async (pool) => {
      const res = await globalResidentialPool.verifyProxyUrl(pool.proxyUrl, {
        targetUrl: "https://api.ipify.org?format=json",
        timeoutMs: config.probeTimeoutMs,
      });
      await persistResidentialProbeResult(res, pool, config);
      return res;
    });

    const state = await loadSyncedResidentialState();
    await ensureResidentialGatewayPool(state.metrics.healthyResidentialCount);

    return NextResponse.json({
      success: true,
      mode: "all",
      probed: results.length,
      healthyResidential: results.filter((r) => r.ok && r.isResidential).length,
      datacenterBlocked: results.filter((r) => r.ok && r.ipType === "datacenter").length,
      failed: results.filter((r) => !r.ok).length,
      state: await loadSyncedResidentialState(),
    });
  } catch (error) {
    console.error("[residential-proxy probe POST]", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Residential probe failed" },
      { status: 500 }
    );
  }
}
