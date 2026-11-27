import { NextResponse } from "next/server";
import { createProxyPool, getProxyPools, getProviderConnections, updateProviderConnection, updateProxyPool, deleteProxyPools } from "@/models";
import {
  classifyAsnStrict,
  distributeHarvestedFairlyToProviders,
  fetchFeedCandidates,
  lookupAsnBatch,
  probeProxyStrict,
  pruneAndVerifyHarvestedPools,
  runWithConcurrency,
  subnet24,
  syncHarvestedToResidentialFiles,
  tcpPrecheck,
} from "@/lib/network/pureResidentialHarvester.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    let body = {};
    try { body = await request.json(); } catch {}
    const targetCount = Math.max(1, Math.min(Number(body.count) || 10, 80));
    const maxScan = Math.max(100, Math.min(Number(body.maxScan) || 1500, 10000));
    const strictNoProxyFlag = body.strictNoProxyFlag !== false;
    const runId = new Date().toISOString();

    const pruneStats = body.prune === true
      ? await pruneAndVerifyHarvestedPools({
          getProxyPools,
          updateProxyPool,
          deleteProxyPools,
          getProviderConnections,
          strictNoProxyFlag,
        })
      : { checked: 0, kept: 0, deleted: 0 };

    const existingPools = await getProxyPools();
    const existingUrls = new Set(existingPools.map((p) => p.proxyUrl?.toLowerCase().trim()).filter(Boolean));
    const existingIngress = new Set(existingPools.map((p) => p.ingressIp).filter(Boolean));
    const existingEgress = new Set(existingPools.map((p) => p.egressIp).filter(Boolean));
    const subnetCounts = new Map();
    for (const p of existingPools) {
      const sub = subnet24(p.egressIp);
      if (sub) subnetCounts.set(sub, (subnetCounts.get(sub) || 0) + 1);
    }

    const candidates = await fetchFeedCandidates(maxScan);
    const unadded = candidates.filter((u) => !existingUrls.has(u.toLowerCase()));
    const probePassed = [];
    const probeLimit = Math.max(targetCount * 4, 30);

    const scanDeadline = Date.now() + 28000;
    await runWithConcurrency(
      unadded.slice(0, 600),
      60,
      async (proxyUrl) => {
        if (probePassed.length >= probeLimit || Date.now() >= scanDeadline) return;
        if (!(await tcpPrecheck(proxyUrl, 700))) return;
        if (Date.now() >= scanDeadline) return;
        const res = await probeProxyStrict(proxyUrl, 1800);
        if (res.ok) probePassed.push(res);
      },
      () => probePassed.length >= probeLimit || Date.now() >= scanDeadline
    );

    const ips = Array.from(new Set(probePassed.flatMap((r) => [r.ingressIp, r.egressIp]).filter(Boolean)));
    const asnMap = ips.length ? await lookupAsnBatch(ips) : {};
    probePassed.sort((a, b) => a.latencyMs - b.latencyMs || a.jitterMs - b.jitterMs);

    const added = [];
    let datacenterBlocked = 0;

    for (const r of probePassed) {
      if (added.length >= targetCount) break;
      const inV = classifyAsnStrict(asnMap[r.ingressIp], { strictNoProxyFlag });
      const egV = classifyAsnStrict(asnMap[r.egressIp], { strictNoProxyFlag });
      if (!inV.ok || !egV.ok) {
        datacenterBlocked++;
        continue;
      }
      if (existingIngress.has(r.ingressIp) || existingEgress.has(r.egressIp)) continue;
      const sub = subnet24(r.egressIp);
      if (sub && (subnetCounts.get(sub) || 0) >= 2) continue;

      existingIngress.add(r.ingressIp);
      existingEgress.add(r.egressIp);
      if (sub) subnetCounts.set(sub, (subnetCounts.get(sub) || 0) + 1);

      const egInfo = asnMap[r.egressIp] || {};
      const pool = await createProxyPool({
        name: `Resi-${r.egressIp} (${egInfo.countryCode || "XX"})`,
        proxyUrl: r.proxyUrl,
        type: r.protocol === "socks5" ? "socks5" : "http",
        isActive: true,
        strictProxy: false,
        noProxy: "127.0.0.1,localhost,",
        ingressIp: r.ingressIp,
        egressIp: r.egressIp,
        country: egInfo.country || null,
        countryCode: egInfo.countryCode || "XX",
        city: egInfo.city || null,
        isp: (egInfo.isp || "Residential").slice(0, 28),
        asn: egInfo.as || null,
        networkClass: egV.networkClass,
        ipType: "residential",
        isResidential: true,
        proxyFlagged: egV.proxyFlagged || inV.proxyFlagged,
        latencyMs: r.latencyMs,
        jitterMs: r.jitterMs,
        stabilityPct: 100,
        testStatus: "active",
        lastError: null,
        lastTestedAt: new Date().toISOString(),
        harvestedBy: "proxy-harvest",
        harvestRunId: runId,
      });
      added.push(pool);
    }

    syncHarvestedToResidentialFiles(await getProxyPools());
    const distStats = await distributeHarvestedFairlyToProviders({
      getProxyPools,
      getProviderConnections,
      updateProviderConnection,
    }).catch(() => null);
    if (global._ariesHarvesterState && added.length > 0) {
      global._ariesHarvesterState.currentRunId = runId;
      global._ariesHarvesterState.lastRunAt = runId;
      global._ariesHarvesterState.lastAdded = added.length;
      global._ariesHarvesterState.lastMessage = `Added ${added.length} pure-residential proxies from Proxy Pools (${distStats ? `${distStats.providersCovered} providers synced` : "synced"}).`;
    }

    return NextResponse.json({
      success: true,
      addedCount: added.length,
      testedCount: unadded.length,
      datacenterBlocked,
      prunedDead: pruneStats.deleted,
      runId,
      distributed: distStats,
      pools: added,
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Harvest failed" }, { status: 500 });
  }
}
