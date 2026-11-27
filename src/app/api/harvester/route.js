import { NextResponse } from "next/server";
import { createProxyPool, createProxyPools, getProxyPools, getProviderConnections, updateProviderConnection, updateProxyPool, deleteProxyPools } from "@/models";
import {
  HARVEST_FEEDS,
  classifyAsnStrict,
  distributeHarvestedFairlyToProviders,
  fetchFeedCandidates,
  isHarvestManagedPool,
  lookupAsnBatch,
  probeProxyStrict,
  pruneAndVerifyHarvestedPools,
  runWithConcurrency,
  subnet24,
  syncHarvestedToResidentialFiles,
  tcpPrecheck,
} from "@/lib/network/pureResidentialHarvester.js";
import { maskProxyUrl } from "@/lib/network/residentialProxyEngine.js";

export const dynamic = "force-dynamic";

if (!global._ariesHarvesterState) {
  global._ariesHarvesterState = {
    running: false,
    _inCycle: false,
    loopIntervalMinutes: 0,
    targetCount: 15,
    maxCandidates: 10000,
    strictNoProxyFlag: true,
    customFeeds: [],
    timer: null,
    currentRunId: null,
    lastRunAt: null,
    lastAdded: 0,
    lastTested: 0,
    lastDatacenterBlocked: 0,
    lastDeadOrRateLimited: 0,
    lastPruned: 0,
    lastMessage: "Idle — Ready to harvest pure-residential IPs",
    history: [],
  };
}

const state = global._ariesHarvesterState;

async function executeHarvestCycle(target = 15, maxScan = 10000, customFeeds = [], strictNoProxyFlag = true) {
  if (state._inCycle) return;
  state._inCycle = true;
  const runId = new Date().toISOString();
  state.currentRunId = runId;
  state.lastRunAt = runId;
  state.lastAdded = 0;
  state.lastTested = 0;
  state.lastDatacenterBlocked = 0;
  state.lastDeadOrRateLimited = 0;
  state.lastPruned = 0;
  state.lastMessage = `Pruning dead/DC & harvesting fresh pure-residential proxies toward target ${target}...`;

  let rollbackSnapshot = [];
  let addedCount = 0;

  try {
    const [existingPools, conns] = await Promise.all([
      getProxyPools(),
      getProviderConnections().catch(() => []),
    ]);
    const boundIds = new Set(
      (conns || []).filter((c) => c?.isActive !== false).map((c) => c?.providerSpecificData?.proxyPoolId).filter(Boolean)
    );

    const unhealthyManaged = existingPools.filter(
      (p) =>
        isHarvestManagedPool(p) &&
        !boundIds.has(p.id) &&
        (p.isActive === false ||
          p.testStatus === "error" ||
          p.testStatus === "dead" ||
          p.testStatus === "retired" ||
          p.ipType === "datacenter" ||
          (strictNoProxyFlag && p.proxyFlagged === true))
    );
    rollbackSnapshot = [];
    const previousUrls = new Set(
      existingPools.map((p) => p.proxyUrl?.toLowerCase().trim()).filter(Boolean)
    );

    if (unhealthyManaged.length > 0) {
      await deleteProxyPools(unhealthyManaged.map((p) => p.id));
      state.lastPruned = unhealthyManaged.length;
    }

    const unhealthySet = new Set(unhealthyManaged.map((p) => p.id));
    const remainingBound = existingPools.filter((p) => !unhealthySet.has(p.id));
    const existingIngress = new Set(remainingBound.map((p) => p.ingressIp).filter(Boolean));
    const existingEgress = new Set(remainingBound.map((p) => p.egressIp).filter(Boolean));
    const subnetCounts = new Map();
    for (const p of remainingBound) {
      const sub = subnet24(p.egressIp);
      if (sub) subnetCounts.set(sub, (subnetCounts.get(sub) || 0) + 1);
    }

    const effectiveMaxScan = Math.max(maxScan, 45000);
    const candidates = await fetchFeedCandidates(effectiveMaxScan, customFeeds, {
      excludeUrls: previousUrls,
      includeLocalSeeds: true,
      includePreviousPoolFile: false,
    });
    const unadded = candidates.filter((u) => !previousUrls.has(u.toLowerCase()));
    state.lastMessage = `Scanning ${unadded.length} brand-new candidates toward target ${target} (0 old reused)...`;

    let scannedCount = 0;
    const addedItems = [];
    const WAVE_SIZE = 1000;
    const CONCURRENCY = 220;

    for (let offset = 0; offset < unadded.length && addedCount < target; offset += WAVE_SIZE) {
      if (!state.running && state.loopIntervalMinutes === 0) break;
      const chunk = unadded.slice(offset, offset + WAVE_SIZE);
      const needed = target - addedCount;
      const tlsTargetForWave = Math.max(needed * 8, 45);
      const wavePassed = [];

      await runWithConcurrency(
        chunk,
        CONCURRENCY,
        async (proxyUrl) => {
          if (!state.running && state.loopIntervalMinutes === 0) return;
          if (wavePassed.length >= tlsTargetForWave) return;

          scannedCount++;
          state.lastTested = scannedCount;
          const tcpOk = await tcpPrecheck(proxyUrl);
          if (!tcpOk) {
            state.lastDeadOrRateLimited++;
            if (scannedCount % 50 === 0) {
              state.lastMessage = `Scanning ${scannedCount}/${unadded.length} new candidates · ${addedCount}/${target} fresh verified...`;
            }
            return;
          }

          const res = await probeProxyStrict(proxyUrl);
          if (!res.ok) {
            state.lastDeadOrRateLimited++;
            return;
          }
          wavePassed.push(res);
        },
        () => wavePassed.length >= tlsTargetForWave || (!state.running && state.loopIntervalMinutes === 0)
      );

      if (wavePassed.length === 0) {
        state.lastMessage = `Checked ${scannedCount}/${unadded.length} new candidates · ${addedCount}/${target} fresh verified...`;
        continue;
      }

      state.lastMessage = `Dual-ASN verifying ${wavePassed.length} TLS proxies (${addedCount}/${target} fresh added)...`;
      const ips = Array.from(new Set(wavePassed.flatMap((r) => [r.ingressIp, r.egressIp]).filter(Boolean)));
      const asnMap = ips.length ? await lookupAsnBatch(ips) : {};
      wavePassed.sort((a, b) => a.latencyMs - b.latencyMs || a.jitterMs - b.jitterMs);

      for (const r of wavePassed) {
        if (addedCount >= target) break;

        const inVerdict = classifyAsnStrict(asnMap[r.ingressIp], { strictNoProxyFlag });
        const egVerdict = classifyAsnStrict(asnMap[r.egressIp], { strictNoProxyFlag });
        if (!inVerdict.ok || !egVerdict.ok) {
          state.lastDatacenterBlocked++;
          continue;
        }

        if (existingIngress.has(r.ingressIp) || existingEgress.has(r.egressIp)) {
          continue;
        }
        const sub = subnet24(r.egressIp);
        if (sub && (subnetCounts.get(sub) || 0) >= 2) {
          continue;
        }

        existingIngress.add(r.ingressIp);
        existingEgress.add(r.egressIp);
        if (sub) subnetCounts.set(sub, (subnetCounts.get(sub) || 0) + 1);

        const egInfo = asnMap[r.egressIp] || {};
        const cc = egInfo.countryCode || "XX";
        const ispShort = (egInfo.isp || "Residential").slice(0, 28);
        const name = `Resi-${r.egressIp} (${cc})`;

        await createProxyPool({
          name,
          proxyUrl: r.proxyUrl,
          type: r.protocol === "socks5" ? "socks5" : "http",
          isActive: true,
          strictProxy: false,
          noProxy: "127.0.0.1,localhost,",
          ingressIp: r.ingressIp,
          egressIp: r.egressIp,
          country: egInfo.country || null,
          countryCode: cc,
          city: egInfo.city || null,
          isp: ispShort,
          asn: egInfo.as || null,
          networkClass: egVerdict.networkClass,
          ipType: "residential",
          isResidential: true,
          proxyFlagged: egVerdict.proxyFlagged || inVerdict.proxyFlagged,
          latencyMs: r.latencyMs,
          jitterMs: r.jitterMs,
          stabilityPct: 100,
          testStatus: "active",
          lastError: null,
          lastTestedAt: new Date().toISOString(),
          harvestedBy: "proxy-harvest",
          harvestRunId: runId,
        });

        addedCount++;
        state.lastAdded = addedCount;
        addedItems.push({
          proxyUrl: maskProxyUrl(r.proxyUrl),
          egressIp: r.egressIp,
          cc,
          isp: ispShort,
          latencyMs: r.latencyMs,
          jitterMs: r.jitterMs,
          networkClass: egVerdict.networkClass,
        });
      }

      state.lastAdded = addedCount;
      if (addedCount > 0) {
        const wavePools = await getProxyPools().catch(() => null);
        if (wavePools) syncHarvestedToResidentialFiles(wavePools);
        await distributeHarvestedFairlyToProviders({
          getProxyPools,
          getProviderConnections,
          updateProviderConnection,
        }).catch(() => null);
      }
      state.lastMessage = `Fresh batch: ${addedCount}/${target} pure-residential into Proxy Pools (scanned ${scannedCount}/${unadded.length}, ${state.lastDatacenterBlocked} DC/flagged blocked)...`;
    }

    if (addedCount === 0 && rollbackSnapshot.length > 0) {
      await createProxyPools(rollbackSnapshot);
      state.lastMessage = `No brand-new proxies passed strict verification (${scannedCount} tested); restored ${rollbackSnapshot.length} previous verified proxies.`;
    } else {
      const refreshedPools = await getProxyPools();
      syncHarvestedToResidentialFiles(refreshedPools);
      const distStats = await distributeHarvestedFairlyToProviders({
        getProxyPools,
        getProviderConnections,
        updateProviderConnection,
      }).catch(() => null);

      state.lastAdded = addedCount;
      state.lastTested = scannedCount;
      state.lastMessage = `Done: ${addedCount}/${target} NEW pure-residential added to Proxy Pools (pruned ${state.lastPruned} dead/DC, blocked ${state.lastDatacenterBlocked} DC/flagged, rejected ${state.lastDeadOrRateLimited} dead/429)${distStats ? ` · Distributed to ${distStats.providersCovered} providers` : ""}.`;
      state.history = [
        {
          at: new Date().toISOString(),
          runId,
          added: addedCount,
          target,
          tested: scannedCount,
          datacenterBlocked: state.lastDatacenterBlocked,
          pruned: rollbackSnapshot.length,
          proxies: addedItems.slice(0, 10),
        },
        ...(state.history || []),
      ].slice(0, 12);
    }
  } catch (err) {
    if (addedCount === 0 && rollbackSnapshot.length > 0) {
      await createProxyPools(rollbackSnapshot).catch(() => {});
    }
    state.lastMessage = `Harvest error: ${err.message}`;
  } finally {
    state._inCycle = false;
    if (state.loopIntervalMinutes === 0) {
      state.running = false;
    }
  }
}

function scheduleNextLoop() {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
  if (state.running && state.loopIntervalMinutes > 0) {
    const ms = state.loopIntervalMinutes * 60 * 1000;
    state.timer = setInterval(() => {
      if (state.running) {
        executeHarvestCycle(state.targetCount, state.maxCandidates, state.customFeeds, state.strictNoProxyFlag);
      }
    }, ms);
    state.timer.unref?.();
  }
}

export async function GET() {
  try {
  const allPools = await getProxyPools().catch(() => []);
  const managedAll = allPools.filter(isHarvestManagedPool);
  const runIds = managedAll
    .map((p) => p.harvestRunId)
    .filter(Boolean)
    .sort()
    .reverse();
  const activeRunId = (state.running && state.currentRunId)
    ? state.currentRunId
    : (state.currentRunId && managedAll.some((p) => p.harvestRunId === state.currentRunId)
        ? state.currentRunId
        : (runIds[0] || null));
  const currentBatch = activeRunId
    ? managedAll.filter((p) => p.harvestRunId === activeRunId)
    : (state.running ? [] : managedAll);

  const harvestedPools = currentBatch
    .sort((a, b) => (a.latencyMs || 9999) - (b.latencyMs || 9999))
    .map((p) => ({
      id: p.id,
      name: p.name,
      proxyUrl: maskProxyUrl(p.proxyUrl),
      type: p.type,
      isActive: p.isActive !== false,
      testStatus: p.testStatus || "unknown",
      egressIp: p.egressIp || null,
      ingressIp: p.ingressIp || null,
      countryCode: p.countryCode || p.loc || null,
      country: p.country || null,
      city: p.city || null,
      isp: p.isp || null,
      asn: p.asn || null,
      networkClass: p.networkClass || "residential",
      isResidential: p.isResidential === true,
      proxyFlagged: Boolean(p.proxyFlagged),
      latencyMs: p.latencyMs || null,
      jitterMs: p.jitterMs ?? null,
      stabilityPct: p.stabilityPct ?? 100,
      lastTestedAt: p.lastTestedAt || null,
    }));

  const latencies = harvestedPools.map((p) => p.latencyMs).filter((n) => Number.isFinite(n));
  const avgLatencyMs = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;

  return NextResponse.json({
    running: state.running,
    targetCount: state.targetCount,
    maxCandidates: state.maxCandidates,
    strictNoProxyFlag: state.strictNoProxyFlag,
    customFeeds: state.customFeeds || [],
    builtInFeedsCount: HARVEST_FEEDS.length,
    loopIntervalMinutes: state.loopIntervalMinutes,
    lastRunAt: state.lastRunAt,
    lastAdded: state.lastAdded,
    lastTested: state.lastTested,
    lastDatacenterBlocked: state.lastDatacenterBlocked,
    lastDeadOrRateLimited: state.lastDeadOrRateLimited,
    lastPruned: state.lastPruned,
    lastMessage: state.lastMessage,
    avgLatencyMs,
    currentRunId: activeRunId,
    totalPoolsCount: allPools.length,
    managedPoolsCount: managedAll.length,
    harvestedCount: harvestedPools.length,
    harvestedPools,
    history: state.history || [],
  });
  } catch (err) {
    return NextResponse.json(
      { error: err?.message || "Failed to load harvester status", running: false, harvestedPools: [] },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    let body = {};
    try { body = await request.json(); } catch {}
    const { action = "start", target = 15, maxCandidates = 10000, loopMinutes = 0, customFeeds = [], strictNoProxyFlag = true } = body;

    if (action === "stop") {
      state.running = false;
      state._inCycle = false;
      state.loopIntervalMinutes = 0;
      if (state.timer) {
        clearInterval(state.timer);
        state.timer = null;
      }
      state.lastMessage = "Harvester stopped by user.";
      return NextResponse.json({ success: true, running: false, message: state.lastMessage });
    }

    if (action === "distribute") {
      const distStats = await distributeHarvestedFairlyToProviders({
        getProxyPools,
        getProviderConnections,
        updateProviderConnection,
      });
      state.lastMessage = `Fairly distributed ${distStats.distinctProxiesUsed} pure-residential proxies across ${distStats.providersCovered} providers (${distStats.totalExternalConnections} connections, 0 group pools).`;
      return NextResponse.json({ success: true, stats: distStats, message: state.lastMessage });
    }

    if (action === "prune") {
      if (state._inCycle) {
        return NextResponse.json({ success: false, error: "Harvest/prune cycle already in progress" }, { status: 409 });
      }
      state._inCycle = true;
      state.running = true;
      state.lastMessage = "Re-verifying 3/3 TLS + dual-ASN and pruning dead/datacenter proxies...";
      (async () => {
        try {
          const stats = await pruneAndVerifyHarvestedPools({
            getProxyPools,
            updateProxyPool,
            deleteProxyPools,
            getProviderConnections,
            strictNoProxyFlag: Boolean(strictNoProxyFlag),
          });
          state.lastPruned = stats.deleted;
          state.lastDatacenterBlocked = stats.datacenterBlocked;
          state.lastDeadOrRateLimited = stats.deadOrRateLimited;
          const distStats = await distributeHarvestedFairlyToProviders({ getProxyPools, getProviderConnections, updateProviderConnection }).catch(() => null);
          state.lastMessage = `Pruned ${stats.deleted} dead/DC/slow proxies · ${stats.kept} pure-residential verified${distStats ? ` · Fairly bound ${distStats.totalExternalConnections} conns across ${distStats.providersCovered} providers` : ""}.`;
        } catch (err) {
          state.lastMessage = `Prune error: ${err?.message || "Failed"}`;
        } finally {
          state._inCycle = false;
          if (state.loopIntervalMinutes === 0) state.running = false;
        }
      })();
      return NextResponse.json({
        success: true,
        running: true,
        message: state.lastMessage,
      });
    }

    const numericTarget = Math.max(1, Math.min(Number(target) || 15, 200));
    const numericMaxScan = Math.max(50, Math.min(Number(maxCandidates) || 10000, 25000));
    const numericLoop = Math.max(0, Number(loopMinutes) || 0);
    const cleanFeeds = Array.isArray(customFeeds)
      ? customFeeds.map((f) => String(f).trim()).filter((f) => f.startsWith("http"))
      : state.customFeeds || [];

    state.targetCount = numericTarget;
    state.maxCandidates = numericMaxScan;
    state.strictNoProxyFlag = strictNoProxyFlag !== false;
    state.customFeeds = cleanFeeds;
    state.loopIntervalMinutes = numericLoop;
    state.running = true;

    scheduleNextLoop();
    executeHarvestCycle(numericTarget, numericMaxScan, cleanFeeds, state.strictNoProxyFlag);

    return NextResponse.json({
      success: true,
      running: true,
      targetCount: numericTarget,
      maxCandidates: numericMaxScan,
      loopIntervalMinutes: numericLoop,
      message: `Pure-Residential Harvest started (target ${numericTarget}, scan ${numericMaxScan}, strict=${state.strictNoProxyFlag}).`,
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Failed to control Proxy Harvest" }, { status: 500 });
  }
}
