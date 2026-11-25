import { NextResponse } from "next/server";
import { getProxyPools, getProxyPoolById, updateProxyPool } from "@/models";
import {
  globalResidentialPool,
  parseProxyBatchText,
  maskProxyUrl,
} from "@/lib/network/residentialProxyEngine.js";
import {
  RESIDENTIAL_GATEWAY_ID,
  loadSyncedResidentialState,
  persistResidentialProbeResult,
  ensureResidentialGatewayPool,
  collectVpsCandidateUrls,
  runWithConcurrency,
  saveResidentialConfig,
  isManagedResidentialRecord,
  deleteProxyPools,
} from "@/lib/network/residentialDbSync.js";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const state = await loadSyncedResidentialState();
    return NextResponse.json(state);
  } catch (error) {
    console.error("[residential-proxy GET]", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load residential proxy state" },
      { status: 500 }
    );
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const config = await saveResidentialConfig(body?.config || body);
    const state = await loadSyncedResidentialState();
    return NextResponse.json({ success: true, config, metrics: state.metrics });
  } catch (error) {
    console.error("[residential-proxy PUT]", error);
    return NextResponse.json(
      { error: error?.message || "Failed to update residential proxy configuration" },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action || "import");

    if (action === "toggle") {
      const id = String(body?.id || "").trim();
      if (!id) return NextResponse.json({ error: "Node id is required" }, { status: 400 });
      const pool = await getProxyPoolById(id);
      if (!pool) return NextResponse.json({ error: "Proxy node not found" }, { status: 404 });
      const nextActive = body?.isActive !== undefined ? Boolean(body.isActive) : !pool.isActive;
      const updated = await updateProxyPool(id, { isActive: nextActive });
      const state = await loadSyncedResidentialState();
      return NextResponse.json({ success: true, node: updated, state });
    }

    const { config } = await loadSyncedResidentialState();
    const allPools = await getProxyPools();
    const byUrl = new Map(allPools.map((p) => [p.proxyUrl, p]));

    let candidates = [];
    let invalid = [];

    if (action === "scan-sources") {
      const fileUrls = collectVpsCandidateUrls(65);
      const dbHttpUrls = allPools
        .filter((p) => p.proxyUrl && !p.proxyUrl.startsWith("residential://") && !p.proxyUrl.includes("127.0.0.1:20188") && !p.proxyUrl.includes("127.0.0.1:8118"))
        .map((p) => p.proxyUrl);
      candidates = [...new Set([...fileUrls, ...dbHttpUrls])].slice(0, 70);
      if (candidates.length === 0) {
        return NextResponse.json({
          success: true,
          addedResidential: 0,
          updatedResidential: 0,
          rejectedDatacenter: 0,
          failedProbe: 0,
          results: [],
          message: "No local residential proxy source files found on host.",
        });
      }
    } else {
      const parsed = parseProxyBatchText(body?.proxies || "");
      candidates = parsed.valid;
      invalid = parsed.invalid;
      if (candidates.length === 0 && invalid.length > 0) {
        return NextResponse.json(
          { error: `All proxy entries failed syntax validation (${invalid[0].error})`, invalid },
          { status: 400 }
        );
      }
      if (candidates.length === 0) {
        return NextResponse.json({ error: "Please provide at least one proxy URL" }, { status: 400 });
      }
    }

    const saveRejectedAudit = body?.recordBlocked === true || action === "import";

    const probeResults = await runWithConcurrency(candidates, 12, async (proxyUrl) => {
      return await globalResidentialPool.verifyProxyUrl(proxyUrl, {
        timeoutMs: Math.min(config.probeTimeoutMs || 4500, 5000),
      });
    });

    let addedResidential = 0;
    let updatedResidential = 0;
    let rejectedDatacenter = 0;
    let failedProbe = 0;
    const summaryRows = [];

    for (const res of probeResults) {
      const existing = byUrl.get(res.proxyUrl) || null;
      if (!res.ok) {
        failedProbe++;
        if (existing && isManagedResidentialRecord(existing)) {
          await persistResidentialProbeResult(res, existing, config);
        }
        summaryRows.push({
          maskedUrl: res.maskedUrl,
          status: "failed",
          error: res.error,
          latencyMs: res.latencyMs,
        });
        continue;
      }

      if (res.ipType === "datacenter" || (!res.isResidential && config.strictResidentialOnly)) {
        rejectedDatacenter++;
        if (saveRejectedAudit || (existing && isManagedResidentialRecord(existing))) {
          await persistResidentialProbeResult(res, existing, config);
        }
        summaryRows.push({
          maskedUrl: res.maskedUrl,
          status: "datacenter_blocked",
          egressIp: res.egressIp,
          isp: res.isp,
          asn: res.asn,
          countryCode: res.countryCode,
          reason: res.reason,
          latencyMs: res.latencyMs,
        });
        continue;
      }

      await persistResidentialProbeResult(res, existing, config);
      if (existing) updatedResidential++;
      else addedResidential++;

      summaryRows.push({
        maskedUrl: res.maskedUrl,
        status: "residential_verified",
        egressIp: res.egressIp,
        isp: res.isp,
        asn: res.asn,
        countryCode: res.countryCode,
        latencyMs: res.latencyMs,
      });
    }

    const state = await loadSyncedResidentialState();
    await ensureResidentialGatewayPool(state.metrics.healthyResidentialCount);
    const refreshedState = await loadSyncedResidentialState();

    return NextResponse.json({
      success: true,
      action,
      scanned: candidates.length,
      addedResidential,
      updatedResidential,
      rejectedDatacenter,
      failedProbe,
      invalid,
      results: summaryRows,
      state: refreshedState,
    });
  } catch (error) {
    console.error("[residential-proxy POST]", error);
    return NextResponse.json(
      { error: error?.message || "Failed to process residential proxies" },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    const mode = searchParams.get("mode");

    const allPools = await getProxyPools();
    let targetIds = [];

    if (id) {
      targetIds = [id];
    } else if (mode === "datacenter") {
      targetIds = allPools
        .filter((p) => p.id !== RESIDENTIAL_GATEWAY_ID && (p.ipType === "datacenter" || p.testStatus === "datacenter_blocked"))
        .map((p) => p.id);
    } else if (mode === "dead") {
      targetIds = allPools
        .filter((p) => p.id !== RESIDENTIAL_GATEWAY_ID && isManagedResidentialRecord(p) && (p.testStatus === "error" || p.isActive === false))
        .map((p) => p.id);
    } else {
      return NextResponse.json({ error: "Specify id or mode=datacenter|dead" }, { status: 400 });
    }

    const removed = await deleteProxyPools(targetIds);
    const state = await loadSyncedResidentialState();
    await ensureResidentialGatewayPool(state.metrics.healthyResidentialCount);

    return NextResponse.json({
      success: true,
      removedCount: removed.length,
      state: await loadSyncedResidentialState(),
    });
  } catch (error) {
    console.error("[residential-proxy DELETE]", error);
    return NextResponse.json(
      { error: error?.message || "Failed to delete residential proxy node(s)" },
      { status: 500 }
    );
  }
}
