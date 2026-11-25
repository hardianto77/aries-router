import { NextResponse } from "next/server";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { getProxyPools, getProxyPoolById } from "@/models";
import {
  globalResidentialPool,
  normalizeProxyInput,
  PURE_RESIDENTIAL_GATEWAY_URL,
  isForbiddenNonResidentialUrl,
} from "@/lib/network/residentialProxyEngine.js";
import {
  RESIDENTIAL_GATEWAY_ID,
  RESI_ROTATING_POOL_ID,
  loadSyncedResidentialState,
  persistResidentialProbeResult,
  ensureResidentialGatewayPool,
  deduplicateResidentialPools,
  runWithConcurrency,
  isManagedResidentialRecord,
  reloadGatewayUpstreams,
} from "@/lib/network/residentialDbSync.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode = String(body?.mode || (body?.nodeId ? "single" : "all"));
    const targetUrl = String(body?.targetUrl || "https://api.ipify.org?format=json").trim();

    const { config } = await loadSyncedResidentialState();

    if (mode === "gateway") {
      const t0 = Date.now();
      const dispatcher = new ProxyAgent({
        uri: PURE_RESIDENTIAL_GATEWAY_URL,
        connect: { timeout: 3000 },
        headersTimeout: 10000,
      });
      try {
        let egressIp = null;
        let ipStatus = 200;
        for (const echoUrl of ["https://api.ipify.org?format=json", "https://checkip.amazonaws.com"]) {
          const ipRes = await undiciFetch(echoUrl, {
            dispatcher,
            signal: AbortSignal.timeout(7000),
            headers: { "User-Agent": "Aries-Residential-Probe/4.2" },
          }).catch(() => null);
          if (ipRes?.ok) {
            ipStatus = ipRes.status;
            const raw = await ipRes.text().catch(() => "");
            const m = raw.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
            if (m) {
              egressIp = m[1];
              break;
            }
          }
        }
        if (!egressIp) {
          throw new Error("Pure-Residential Gateway did not return a valid exit IP");
        }
        let targetStatus = ipStatus;
        if (targetUrl && !targetUrl.includes("api.ipify.org")) {
          const tRes = await undiciFetch(targetUrl, {
            method: "HEAD",
            dispatcher,
            signal: AbortSignal.timeout(7000),
          }).catch(() =>
            undiciFetch(targetUrl, {
              method: "GET",
              dispatcher,
              signal: AbortSignal.timeout(7000),
            })
          );
          targetStatus = tRes.status;
        }
        const latencyMs = Date.now() - t0;
        const asnInfo = await globalResidentialPool.validator.inspect(egressIp);
        const state = await loadSyncedResidentialState();
        return NextResponse.json({
          success: true,
          mode: "gateway",
          ok: true,
          httpStatus: targetStatus,
          latencyMs,
          egressIp,
          node: "127.0.0.1:20188 (Pure-Residential Rotating Gateway)",
          hedgeWon: false,
          ...asnInfo,
          state,
        });
      } finally {
        try { await dispatcher.close?.(); } catch {}
      }
    }

    if (mode === "auto-hedge") {
      const t0 = Date.now();
      const res = await globalResidentialPool.hedgeFetch(
        targetUrl,
        {
          method: targetUrl.includes("api.ipify.org") ? "GET" : "HEAD",
          headers: { "User-Agent": "Aries-Residential-Probe/4.2" },
        },
        { timeoutMs: config.requestTimeoutMs }
      );
      const latencyMs = Date.now() - t0;
      let payloadIp = null;
      if (targetUrl.includes("api.ipify.org")) {
        const txt = await res.text().catch(() => "");
        const m = txt.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
        if (m) payloadIp = m[1];
      }
      const meta = res._residentialMeta || {};
      const egressIp = payloadIp || meta.egressIp || null;
      const asnInfo = egressIp ? await globalResidentialPool.validator.inspect(egressIp) : null;
      const state = await loadSyncedResidentialState();
      return NextResponse.json({
        success: true,
        mode: "auto-hedge",
        ok: res.ok,
        httpStatus: res.status,
        latencyMs,
        egressIp,
        isp: asnInfo?.isp || meta.isp || null,
        asn: asnInfo?.asn || null,
        countryCode: asnInfo?.countryCode || meta.countryCode || null,
        city: asnInfo?.city || null,
        node: meta.node || null,
        hedgeWon: Boolean(meta.hedgeWon),
        networkClass: asnInfo?.networkClass || "residential",
        ipType: asnInfo?.ipType || "residential",
        isResidential: asnInfo ? asnInfo.isResidential : true,
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
      await reloadGatewayUpstreams();
      return NextResponse.json({
        success: true,
        mode: "single",
        result,
        node: updated,
        state: await loadSyncedResidentialState(),
      });
    }

    await deduplicateResidentialPools();
    const allPools = await getProxyPools();
    const targets = allPools.filter(
      (p) =>
        isManagedResidentialRecord(p) &&
        p.id !== RESIDENTIAL_GATEWAY_ID &&
        p.id !== RESI_ROTATING_POOL_ID &&
        p.proxyUrl &&
        !p.proxyUrl.startsWith("residential://") &&
        !isForbiddenNonResidentialUrl(p.proxyUrl)
    );

    const results = await runWithConcurrency(targets, 12, async (pool) => {
      const res = await globalResidentialPool.verifyProxyUrl(pool.proxyUrl, {
        targetUrl: "https://api.ipify.org?format=json",
        timeoutMs: config.probeTimeoutMs,
      });
      await persistResidentialProbeResult(res, pool, config);
      return res;
    });

    const state = await loadSyncedResidentialState();
    await ensureResidentialGatewayPool(state.metrics.healthyResidentialCount);
    await reloadGatewayUpstreams();

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
