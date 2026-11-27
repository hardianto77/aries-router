import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyAsnStrict,
  isHarvestManagedPool,
  isPublicIPv4,
  normalizeCandidateLine,
  subnet24,
  buildFairProviderAssignments,
} from "../../src/lib/network/pureResidentialHarvester.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

describe("pureResidentialHarvester: strict pure-residential validation", () => {
  it("blocks datacenter, hosting, VPN, Tor, and education ASNs fail-closed", () => {
    assert.equal(classifyAsnStrict(null).ok, false);
    assert.equal(classifyAsnStrict({}).ok, false);
    assert.equal(classifyAsnStrict({ isp: "Hetzner Online GmbH", hosting: true }).ok, false);
    assert.equal(classifyAsnStrict({ isp: "PT Telkom Indonesia", hosting: false, ipwho_type: "hosting" }).ok, false);
    assert.equal(classifyAsnStrict({ isp: "Mullvad VPN", security_vpn: true }).ok, false);
    assert.equal(classifyAsnStrict({ isp: "Tor Exit Node", security_tor: true }).ok, false);
    assert.equal(classifyAsnStrict({ isp: "Universitas Indonesia", domain: "ui.ac.id" }).ok, false);
    assert.equal(classifyAsnStrict({ isp: "DigitalOcean LLC", hosting: false }).ok, false);
    assert.equal(classifyAsnStrict({ isp: "PT Atharva Telematika Persada", hosting: false }).ok, false);
  });

  it("blocks proxy-flagged IPs when strictNoProxyFlag is enabled", () => {
    const flagged = { isp: "PT Telkom Indonesia", as: "AS7713", hosting: false, proxy: true };
    assert.equal(classifyAsnStrict(flagged, { strictNoProxyFlag: true }).ok, false);
    assert.equal(classifyAsnStrict({ ...flagged, security_proxy: true, proxy: false }, { strictNoProxyFlag: true }).ok, false);
    assert.equal(classifyAsnStrict(flagged, { strictNoProxyFlag: false }).ok, true);
  });

  it("accepts clean residential and mobile ISPs", () => {
    const resi = classifyAsnStrict({ isp: "PT Telekomunikasi Indonesia", as: "AS7713 Telkom", hosting: false, proxy: false });
    assert.equal(resi.ok, true);
    assert.equal(resi.networkClass, "residential");

    const mob = classifyAsnStrict({ isp: "Telkomsel", as: "AS23693", hosting: false, proxy: false, mobile: true });
    assert.equal(mob.ok, true);
    assert.equal(mob.networkClass, "mobile");
  });

  it("validates public IPv4s and rejects private/VPS/socks4/forbidden hosts", () => {
    assert.equal(isPublicIPv4("8.8.8.8"), true);
    assert.equal(isPublicIPv4("127.0.0.1"), false);
    assert.equal(isPublicIPv4("10.0.0.1"), false);
    assert.equal(isPublicIPv4("192.168.1.5"), false);
    assert.equal(isPublicIPv4("100.64.0.1"), false);
    assert.equal(isPublicIPv4("43.163.99.76"), false);

    assert.equal(normalizeCandidateLine("socks4://1.2.3.4:1080"), null);
    assert.equal(normalizeCandidateLine("http://de-fra.pvdata.host:8080"), null);
    assert.equal(normalizeCandidateLine("1.2.3.4:8080"), "http://1.2.3.4:8080");
    assert.equal(normalizeCandidateLine("socks5h://1.2.3.4:1080"), "socks5://1.2.3.4:1080");
    assert.equal(subnet24("180.244.12.34"), "180.244.12");
  });

  it("identifies harvested pools cleanly and confirms legacy Proxy Manager routes are removed", () => {
    assert.equal(isHarvestManagedPool({ name: "Resi-1.2.3.4 (ID)" }), true);
    assert.equal(isHarvestManagedPool({ name: "seren-1_2_3_4_8080-[ID]" }), true);
    assert.equal(isHarvestManagedPool({ name: "Proxy-cron-0001" }), true);
    assert.equal(isHarvestManagedPool({ name: "custom-manual-pool" }), false);

    const perms = fs.readFileSync(path.join(root, "src/lib/auth/permissionPaths.js"), "utf8");
    const sidebar = fs.readFileSync(path.join(root, "src/shared/components/Sidebar.js"), "utf8");
    assert.equal(perms.includes("/api/residential-proxy"), false);
    assert.equal(sidebar.includes("/dashboard/residential-fresh"), false);
    assert.equal(sidebar.includes("/dashboard/auto-harvester"), true);
    assert.equal(fs.existsSync(path.join(root, "src/app/api/residential-proxy")), false);
    assert.equal(fs.existsSync(path.join(root, "src/app/(dashboard)/dashboard/residential-fresh")), false);
    const repoSrc = fs.readFileSync(path.join(root, "src/lib/db/repos/proxyPoolsRepo.js"), "utf8");
    assert.equal(repoSrc.includes("...data,"), true);
    const prhSrc = fs.readFileSync(path.join(root, "src/lib/network/pureResidentialHarvester.js"), "utf8");
    assert.equal(prhSrc.includes("new Socks5ProxyAgent(proxyUrl"), true);
    assert.equal(prhSrc.includes("connectTimeout"), true);
    const routeSrc = fs.readFileSync(path.join(root, "src/app/api/harvester/route.js"), "utf8");
    assert.equal(routeSrc.includes("harvestRunId"), true);
    assert.equal(routeSrc.includes("excludeUrls: previousUrls"), true);
  });

  it("distributes verified proxies fairly across providers with zero group pools", () => {
    const proxies = [
      { proxyUrl: "socks5://1.1.1.1:1080", isActive: true, isResidential: true, ipType: "residential", proxyFlagged: false, latencyMs: 140 },
      { proxyUrl: "http://2.2.2.2:8080", isActive: true, isResidential: true, ipType: "residential", proxyFlagged: false, latencyMs: 250 },
      { proxyUrl: "http://3.3.3.3:8080", isActive: true, isResidential: true, ipType: "residential", proxyFlagged: false, latencyMs: 400 },
      { proxyUrl: "http://9.9.9.9:8080", isActive: true, isResidential: true, ipType: "residential", proxyFlagged: true, latencyMs: 100 },
    ];
    const conns = [
      { id: "c1", provider: "venice", isActive: true },
      { id: "c2", provider: "coqui", isActive: true },
      { id: "c3", provider: "gemini-jio-farm", isActive: true },
      { id: "c4", provider: "gemini-jio-farm", isActive: true },
      { id: "c5", provider: "gemini-jio-farm", isActive: true },
      { id: "g1", provider: "glm", isActive: true },
      { id: "loc", provider: "local-device", isActive: true },
      { id: "loc2", provider: "openai-compatible-chat-openhop", isActive: true },
    ];
    const plan = buildFairProviderAssignments(conns, proxies);
    assert.equal(plan.totalExternalConnections, 6);
    assert.equal(plan.distinctProxiesUsed, 3);
    assert.equal(plan.providerStats.venice.distinctProxies, 1);
    assert.equal(plan.providerStats.coqui.distinctProxies, 1);
    assert.equal(plan.providerStats["gemini-jio-farm"].distinctProxies, 3);
    assert.equal(plan.updates.some((u) => u.proxyUrl.includes("9.9.9.9")), false);
    assert.equal(plan.updates.some((u) => u.provider === "glm"), true);
    assert.equal(plan.updates.some((u) => u.provider === "local-device"), false);
    assert.equal(plan.updates.some((u) => u.provider === "openai-compatible-chat-openhop"), false);
    const ptSrc = fs.readFileSync(path.join(root, "src/lib/network/proxyTest.js"), "utf8");
    assert.equal(ptSrc.includes("Socks5ProxyAgent"), true);
    const rfSrc = fs.readFileSync(path.join(root, "src/app/api/residential-fresh/route.js"), "utf8");
    assert.equal(rfSrc.includes("distributeHarvestedFairlyToProviders"), true);
    const sdpSrc = fs.readFileSync(path.join(root, "src/app/api/providers/sync-direct-proxy/route.js"), "utf8");
    assert.equal(sdpSrc.includes("distributeHarvestedFairlyToProviders"), true);
    const tuSrc = fs.readFileSync(path.join(root, "src/app/api/providers/[id]/test/testUtils.js"), "utf8");
    assert.equal(tuSrc.includes("isHarvestManagedPool"), true);
  });

  it("integrates Proxy Harvest Start directly with Proxy Pools API and live UI polling", () => {
    const ppApi = fs.readFileSync(path.join(root, "src/app/api/proxy-pools/route.js"), "utf8");
    const ppIdApi = fs.readFileSync(path.join(root, "src/app/api/proxy-pools/[id]/route.js"), "utf8");
    const ppHarvApi = fs.readFileSync(path.join(root, "src/app/api/proxy-pools/harvest/route.js"), "utf8");
    const ppUi = fs.readFileSync(path.join(root, "src/app/(dashboard)/dashboard/proxy-pools/page.js"), "utf8");
    const harvApi = fs.readFileSync(path.join(root, "src/app/api/harvester/route.js"), "utf8");

    assert.equal(ppApi.includes('"socks5"'), true);
    assert.equal(ppApi.includes("connection?.isActive === false"), true);
    assert.equal(ppIdApi.includes('"socks5"'), true);
    assert.equal(ppHarvApi.includes("distributeHarvestedFairlyToProviders"), true);
    assert.equal(harvApi.includes("totalPoolsCount"), true);
    assert.equal(harvApi.includes("unhealthyManaged"), true);
    assert.equal(ppUi.includes("/api/harvester"), true);
    assert.equal(ppUi.includes("handleStartHarvest"), true);
    assert.equal(ppUi.includes("Pure-Resi"), true);

    const connRow = fs.readFileSync(path.join(root, "src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js"), "utf8");
    const connCard = fs.readFileSync(path.join(root, "src/app/(dashboard)/dashboard/providers/components/ConnectionsCard.js"), "utf8");
    assert.equal(connRow.includes("Direct-Resi"), false);
    assert.equal(connCard.includes("Direct-Resi"), false);
    const provDetail = fs.readFileSync(path.join(root, "src/app/(dashboard)/dashboard/providers/[id]/page.js"), "utf8");
    assert.equal(provDetail.includes("refreshActiveProxyPools"), true);

    const slowFiltered = buildFairProviderAssignments(
      [{ id: "c1", provider: "venice", isActive: true }],
      [
        { proxyUrl: "socks5://1.1.1.1:1080", isActive: true, isResidential: true, ipType: "residential", proxyFlagged: false, latencyMs: 220 },
        { proxyUrl: "socks5://2.2.2.2:1080", isActive: true, isResidential: true, ipType: "residential", proxyFlagged: false, latencyMs: 350 },
        { proxyUrl: "socks5://3.3.3.3:1080", isActive: true, isResidential: true, ipType: "residential", proxyFlagged: false, latencyMs: 480 },
        { proxyUrl: "http://9.9.9.9:8080", isActive: true, isResidential: true, ipType: "residential", proxyFlagged: false, latencyMs: 1700 },
      ]
    );
    assert.equal(slowFiltered.updates.some((u) => u.proxyUrl.includes("9.9.9.9")), false);
  });
});
