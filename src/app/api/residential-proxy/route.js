import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import { getProxyPools, getProxyPoolById, updateProxyPool } from "@/models";
import {
  globalResidentialPool,
  parseProxyBatchText,
  isForbiddenNonResidentialUrl,
} from "@/lib/network/residentialProxyEngine.js";
import {
  RESIDENTIAL_GATEWAY_ID,
  RESI_ROTATING_POOL_ID,
  loadSyncedResidentialState,
  persistResidentialProbeResult,
  ensureResidentialGatewayPool,
  deduplicateResidentialPools,
  collectVpsCandidateUrls,
  runWithConcurrency,
  saveResidentialConfig,
  isManagedResidentialRecord,
  healDeadAndNonResidentialConnections,
  reloadGatewayUpstreams,
  deleteProxyPools,
} from "@/lib/network/residentialDbSync.js";

const runExec = promisify(execFile);
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    const state = await loadSyncedResidentialState();
    return NextResponse.json({ ...state, responseMs: Date.now() - started });
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
    return NextResponse.json({ success: true, config, state, metrics: state.metrics });
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
      if (nextActive && (pool.ipType === "datacenter" || isForbiddenNonResidentialUrl(pool.proxyUrl))) {
        return NextResponse.json(
          { error: "Datacenter and WARP proxies cannot be enabled in the Pure-Residential pool." },
          { status: 400 }
        );
      }
      const updated = await updateProxyPool(id, { isActive: nextActive });
      await reloadGatewayUpstreams();
      const state = await loadSyncedResidentialState();
      return NextResponse.json({ success: true, node: updated, state });
    }

    if (action === "heal-connections") {
      const result = await healDeadAndNonResidentialConnections({
        provider: body?.provider ? String(body.provider).trim() : null,
        resetProxyErrors: body?.resetProxyErrors !== false,
      });
      const state = await loadSyncedResidentialState();
      return NextResponse.json({
        success: true,
        action,
        ...result,
        message: `Checked ${result.checkedCount} proxied connection(s); injected Fresh Residential egress into ${result.healedCount} connection(s).`,
        state,
      });
    }

    if (action === "restart-gateway") {
      await runExec("sudo", ["systemctl", "restart", "residential-engine.service"], { timeout: 20000 });
      await new Promise((r) => setTimeout(r, 2500));
      const state = await loadSyncedResidentialState();
      return NextResponse.json({
        success: true,
        action,
        message: `Pure-Residential Gateway restarted (${state.gateway?.alive || 0} alive residential upstreams).`,
        state,
      });
    }

    if (action === "deduplicate") {
      const removedCount = await deduplicateResidentialPools();
      await reloadGatewayUpstreams();
      const state = await loadSyncedResidentialState();
      return NextResponse.json({
        success: true,
        action,
        removedCount,
        message: removedCount > 0 ? `Removed ${removedCount} duplicate proxy record(s).` : "No duplicate proxy records found.",
        state,
      });
    }

    const { config } = await loadSyncedResidentialState();
    const allPools = await getProxyPools();
    const byUrl = new Map(allPools.map((p) => [p.proxyUrl, p]));

    if (action === "scan-sources") {
      const scriptPath = "/opt/aries-router/scripts/refresh_fresh_residential.py";
      if (fs.existsSync(scriptPath)) {
        const { stdout } = await runExec("/usr/bin/python3", [scriptPath], { timeout: 120000 });
        const lines = stdout.trim().split(/\r?\n/);
        let scriptResult = {};
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const parsed = JSON.parse(lines[i]);
            if (parsed && typeof parsed === "object" && "verifiedResidential" in parsed) {
              scriptResult = parsed;
              break;
            }
          } catch {}
        }
        const state = await loadSyncedResidentialState();
        return NextResponse.json({
          success: true,
          action,
          scanned: scriptResult.candidates || 0,
          addedResidential: scriptResult.upsertedResidential || 0,
          updatedResidential: scriptResult.verifiedResidential || 0,
          rejectedDatacenter: scriptResult.datacenterBlocked || 0,
          deactivatedDead: scriptResult.deactivatedDead || 0,
          healedConnections: scriptResult.healedConnections || 0,
          failedProbe: Math.max(0, (scriptResult.candidates || 0) - (scriptResult.alive || 0)),
          message: `Verified ${scriptResult.verifiedResidential || 0} pure-residential node(s), blocked ${scriptResult.datacenterBlocked || 0} datacenter/WARP, deactivated ${scriptResult.deactivatedDead || 0} dead, healed ${scriptResult.healedConnections || 0} connection(s).`,
          state,
        });
      }
    }

    let candidates = [];
    let invalid = [];

    if (action === "scan-sources") {
      const fileUrls = collectVpsCandidateUrls(150);
      const dbHttpUrls = allPools
        .filter((p) => p.proxyUrl && !p.proxyUrl.startsWith("residential://") && !isForbiddenNonResidentialUrl(p.proxyUrl))
        .map((p) => p.proxyUrl);
      candidates = [...new Set([...fileUrls, ...dbHttpUrls])].slice(0, 150);
      if (candidates.length === 0) {
        return NextResponse.json({
          success: true,
          addedResidential: 0,
          updatedResidential: 0,
          rejectedDatacenter: 0,
          failedProbe: 0,
          results: [],
          message: "No local residential proxy source files found on host.",
          state: await loadSyncedResidentialState(),
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
        timeoutMs: Math.min(config.probeTimeoutMs || 4200, 6000),
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
        if (res.ipType === "datacenter") {
          rejectedDatacenter++;
          summaryRows.push({
            maskedUrl: res.maskedUrl,
            status: "datacenter_blocked",
            reason: res.reason || res.error,
            latencyMs: res.latencyMs,
          });
          continue;
        }
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
        networkClass: res.networkClass,
        latencyMs: res.latencyMs,
      });
    }

    const state = await loadSyncedResidentialState();
    await ensureResidentialGatewayPool(state.metrics.healthyResidentialCount);
    await reloadGatewayUpstreams();
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

    if (mode === "duplicates") {
      const removedCount = await deduplicateResidentialPools();
      await reloadGatewayUpstreams();
      return NextResponse.json({
        success: true,
        removedCount,
        state: await loadSyncedResidentialState(),
      });
    }

    const allPools = await getProxyPools();
    let targetIds = [];

    if (id) {
      if (id === RESIDENTIAL_GATEWAY_ID || id === RESI_ROTATING_POOL_ID) {
        return NextResponse.json({ error: "Cannot delete core residential gateway pool" }, { status: 400 });
      }
      targetIds = [id];
    } else if (mode === "datacenter") {
      targetIds = allPools
        .filter(
          (p) =>
            p.id !== RESIDENTIAL_GATEWAY_ID &&
            p.id !== RESI_ROTATING_POOL_ID &&
            (p.ipType === "datacenter" || p.testStatus === "datacenter_blocked")
        )
        .map((p) => p.id);
    } else if (mode === "dead") {
      targetIds = allPools
        .filter(
          (p) =>
            p.id !== RESIDENTIAL_GATEWAY_ID &&
            p.id !== RESI_ROTATING_POOL_ID &&
            isManagedResidentialRecord(p) &&
            (p.testStatus === "error" || p.isActive === false)
        )
        .map((p) => p.id);
    } else {
      return NextResponse.json({ error: "Specify id or mode=datacenter|dead|duplicates" }, { status: 400 });
    }

    const removed = await deleteProxyPools(targetIds);
    const state = await loadSyncedResidentialState();
    await ensureResidentialGatewayPool(state.metrics.healthyResidentialCount);
    await reloadGatewayUpstreams();

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
