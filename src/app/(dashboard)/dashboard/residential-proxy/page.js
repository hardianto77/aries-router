"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  PageShell,
  TableScroll,
  Card,
  Button,
  Badge,
  Input,
  Select,
  Toggle,
  SegmentedControl,
  Modal,
  ConfirmModal,
  CardSkeleton,
} from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";

const STRATEGY_OPTIONS = [
  { value: "hedge-race", label: "Speculative Hedge Race (Zero-Timeout)" },
  { value: "lowest-latency", label: "Lowest Latency Residential" },
  { value: "round-robin", label: "Round-Robin Fresh IP" },
  { value: "sticky-session", label: "Sticky Session Pinning" },
];

const FILTER_TABS = [
  { value: "all", label: "All Nodes" },
  { value: "residential", label: "Residential" },
  { value: "datacenter", label: "Datacenter Blocked" },
  { value: "offline", label: "Offline / Quarantined" },
];

const TEST_PRESETS = [
  { value: "https://api.ipify.org?format=json", label: "IP & ASN Check (api.ipify.org)" },
  { value: "https://api.z.ai", label: "Z.ai / GLM Upstream (api.z.ai)" },
  { value: "https://generativelanguage.googleapis.com", label: "Google Gemini API" },
  { value: "https://api.openai.com", label: "OpenAI API" },
];

function getNodeStatusBadge(node) {
  if (node.ipType === "datacenter") {
    return <Badge variant="error" icon="block">Datacenter Blocked</Badge>;
  }
  if (node.quarantined) {
    return <Badge variant="warning" icon="schedule">Quarantined</Badge>;
  }
  if (!node.isActive) {
    return <Badge variant="default" icon="pause_circle">Disabled</Badge>;
  }
  if (node.isResidential && node.alive) {
    return <Badge variant="success" icon="verified">Fresh Residential</Badge>;
  }
  if (node.lastError) {
    return <Badge variant="error" icon="error">Offline</Badge>;
  }
  return <Badge variant="info" icon="help">Unverified</Badge>;
}

function getHealthBarColor(score) {
  if (score >= 75) return "bg-success";
  if (score >= 45) return "bg-warning";
  return "bg-danger";
}

export default function ResidentialProxyPage() {
  const notify = useNotificationStore();

  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [nodes, setNodes] = useState([]);
  const [gatewayPool, setGatewayPool] = useState(null);
  const [providers, setProviders] = useState([]);

  const [savingConfig, setSavingConfig] = useState(false);
  const [probingAll, setProbingAll] = useState(false);
  const [scanningSources, setScanningSources] = useState(false);
  const [probingNodeId, setProbingNodeId] = useState(null);
  const [purgingMode, setPurgingMode] = useState(null);

  // Filters
  const [filterTab, setFilterTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [countryFilter, setCountryFilter] = useState("all");

  // Live probe tester
  const [probeTargetNode, setProbeTargetNode] = useState("auto-hedge");
  const [probeTargetUrl, setProbeTargetUrl] = useState("https://api.ipify.org?format=json");
  const [customTestUrl, setCustomTestUrl] = useState("");
  const [runningLiveTest, setRunningLiveTest] = useState(false);
  const [liveTestResult, setLiveTestResult] = useState(null);

  // Provider bind state
  const [selectedProvider, setSelectedProvider] = useState("glm");
  const [bindDistribution, setBindDistribution] = useState("auto-hedge");
  const [resetProxyErrors, setResetProxyErrors] = useState(true);
  const [bindingProvider, setBindingProvider] = useState(false);

  // Import modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState(null);

  // Confirm modal
  const [confirmState, setConfirmState] = useState(null);

  const fetchState = useCallback(async (silent = false) => {
    try {
      const res = await fetch("/api/residential-proxy", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load residential proxy data");
      setConfig(data.config || null);
      setMetrics(data.metrics || null);
      setNodes(Array.isArray(data.nodes) ? data.nodes : []);
      setGatewayPool(data.gatewayPool || null);
      setProviders(Array.isArray(data.providers) ? data.providers : []);
      if (Array.isArray(data.providers) && data.providers.length > 0) {
        setSelectedProvider((prev) =>
          data.providers.some((p) => p.provider === prev) ? prev : data.providers[0].provider
        );
      }
    } catch (err) {
      if (!silent) notify.error(err.message || "Failed to load residential proxy state");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  const applyReturnedState = (state) => {
    if (!state) return;
    if (state.config) setConfig(state.config);
    if (state.metrics) setMetrics(state.metrics);
    if (Array.isArray(state.nodes)) setNodes(state.nodes);
    if (state.gatewayPool !== undefined) setGatewayPool(state.gatewayPool);
    if (Array.isArray(state.providers)) setProviders(state.providers);
  };

  const handleSaveConfig = async () => {
    if (!config) return;
    setSavingConfig(true);
    try {
      const res = await fetch("/api/residential-proxy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save policy");
      setConfig(data.config);
      if (data.metrics) setMetrics(data.metrics);
      notify.success("Residential proxy policy updated");
    } catch (err) {
      notify.error(err.message);
    } finally {
      setSavingConfig(false);
    }
  };

  const handleProbeAll = async () => {
    setProbingAll(true);
    try {
      const res = await fetch("/api/residential-proxy/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "all" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification sweep failed");
      applyReturnedState(data.state);
      notify.success(
        `Verified ${data.probed} node(s): ${data.healthyResidential} Residential, ${data.datacenterBlocked} Datacenter blocked, ${data.failed} Failed`
      );
    } catch (err) {
      notify.error(err.message);
    } finally {
      setProbingAll(false);
    }
  };

  const handleScanSources = async () => {
    setScanningSources(true);
    try {
      const res = await fetch("/api/residential-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "scan-sources", recordBlocked: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Source scan failed");
      applyReturnedState(data.state);
      notify.success(
        `Scanned ${data.scanned || 0} candidate(s): +${data.addedResidential || 0} new residential, ${data.updatedResidential || 0} refreshed, ${data.rejectedDatacenter || 0} datacenter rejected`
      );
    } catch (err) {
      notify.error(err.message);
    } finally {
      setScanningSources(false);
    }
  };

  const handleImportSubmit = async () => {
    if (!importText.trim()) return;
    setImporting(true);
    setImportReport(null);
    try {
      const res = await fetch("/api/residential-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "import", proxies: importText, recordBlocked: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setImportReport(data);
      applyReturnedState(data.state);
      notify.success(
        `Imported ${data.addedResidential} verified residential (${data.rejectedDatacenter} datacenter blocked, ${data.failedProbe} failed)`
      );
    } catch (err) {
      notify.error(err.message);
    } finally {
      setImporting(false);
    }
  };

  const handleProbeSingle = async (nodeId) => {
    setProbingNodeId(nodeId);
    try {
      const res = await fetch("/api/residential-proxy/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "single", nodeId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Probe failed");
      applyReturnedState(data.state);
      const r = data.result;
      if (r?.ok && r.isResidential) {
        notify.success(`Verified Fresh Residential: ${r.egressIp} (${r.isp}, ${r.latencyMs}ms)`);
      } else if (r?.ipType === "datacenter") {
        notify.warning(`Blocked Datacenter IP: ${r.egressIp} (${r.isp || r.reason})`);
      } else {
        notify.error(`Probe failed: ${r?.error || "Unreachable"}`);
      }
    } catch (err) {
      notify.error(err.message);
    } finally {
      setProbingNodeId(null);
    }
  };

  const handleToggleNode = async (node) => {
    try {
      const res = await fetch("/api/residential-proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggle", id: node.id, isActive: !node.isActive }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to toggle node");
      applyReturnedState(data.state);
    } catch (err) {
      notify.error(err.message);
    }
  };

  const handleDeleteNode = (node) => {
    setConfirmState({
      title: "Delete Proxy Node",
      message: `Remove "${node.name}" (${node.maskedUrl}) from the residential pool?`,
      onConfirm: async () => {
        setConfirmState(null);
        try {
          const res = await fetch(`/api/residential-proxy?id=${encodeURIComponent(node.id)}`, { method: "DELETE" });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Delete failed");
          applyReturnedState(data.state);
          notify.success("Proxy node removed");
        } catch (err) {
          notify.error(err.message);
        }
      },
    });
  };

  const handlePurge = (mode) => {
    const label = mode === "datacenter" ? "all Datacenter-flagged nodes" : "all offline/disabled nodes";
    setConfirmState({
      title: mode === "datacenter" ? "Purge Datacenter Proxies" : "Purge Offline Proxies",
      message: `Permanently delete ${label}? Verified Fresh Residential nodes will not be affected.`,
      onConfirm: async () => {
        setConfirmState(null);
        setPurgingMode(mode);
        try {
          const res = await fetch(`/api/residential-proxy?mode=${mode}`, { method: "DELETE" });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Purge failed");
          applyReturnedState(data.state);
          notify.success(`Removed ${data.removedCount} node(s)`);
        } catch (err) {
          notify.error(err.message);
        } finally {
          setPurgingMode(null);
        }
      },
    });
  };

  const handleLiveTest = async () => {
    const targetUrl = probeTargetUrl === "__custom__" ? customTestUrl.trim() : probeTargetUrl;
    if (!targetUrl) {
      notify.warning("Enter a valid target URL");
      return;
    }
    setRunningLiveTest(true);
    setLiveTestResult(null);
    try {
      const payload =
        probeTargetNode === "auto-hedge"
          ? { mode: "auto-hedge", targetUrl }
          : { mode: "single", nodeId: probeTargetNode, targetUrl };
      const res = await fetch("/api/residential-proxy/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Live test failed");
      if (data.state) applyReturnedState(data.state);
      const r = data.mode === "auto-hedge" ? data : data.result;
      setLiveTestResult({ ...r, targetUrl, mode: data.mode });
    } catch (err) {
      setLiveTestResult({ ok: false, error: err.message, targetUrl });
    } finally {
      setRunningLiveTest(false);
    }
  };

  const handleBindProvider = async (action = "bind") => {
    if (!selectedProvider) return;
    setBindingProvider(true);
    try {
      const res = await fetch("/api/residential-proxy/bind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          provider: selectedProvider,
          distribution: bindDistribution,
          resetProxyErrors,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Binding failed");
      applyReturnedState(data.state);
      notify.success(
        action === "unbind"
          ? `Unbound residential proxies from ${selectedProvider} (${data.updatedCount} connections)`
          : `Bound ${data.updatedCount} "${selectedProvider}" connection(s) using ${bindDistribution} (${data.residentialPoolNodes} residential nodes)`
      );
    } catch (err) {
      notify.error(err.message);
    } finally {
      setBindingProvider(false);
    }
  };

  const countries = useMemo(() => {
    const set = new Set();
    nodes.forEach((n) => {
      if (n.countryCode && n.countryCode !== "UN") set.add(n.countryCode);
    });
    return [{ value: "all", label: "All Countries" }, ...Array.from(set).sort().map((c) => ({ value: c, label: c }))];
  }, [nodes]);

  const filteredNodes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return nodes.filter((n) => {
      if (filterTab === "residential" && !(n.isResidential && n.ipType === "residential")) return false;
      if (filterTab === "datacenter" && n.ipType !== "datacenter") return false;
      if (filterTab === "offline" && (n.alive && !n.quarantined && n.isActive)) return false;
      if (countryFilter !== "all" && n.countryCode !== countryFilter) return false;
      if (q) {
        const hay = `${n.name || ""} ${n.maskedUrl || ""} ${n.egressIp || ""} ${n.isp || ""} ${n.asn || ""} ${n.country || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [nodes, filterTab, countryFilter, searchQuery]);

  if (loading) {
    return (
      <PageShell width="content">
        <CardSkeleton />
        <CardSkeleton />
      </PageShell>
    );
  }

  const verifiedCount = metrics?.verifiedResidentialCount ?? 0;
  const healthyCount = metrics?.healthyResidentialCount ?? 0;
  const dcBlockedCount = metrics?.datacenterBlockedCount ?? 0;
  const avgLatency = metrics?.avgLatencyMs ?? 0;
  const p95Latency = metrics?.p95LatencyMs ?? 0;
  const hedgeWins = metrics?.hedgeWins ?? 0;
  const timeoutsPrevented = metrics?.timeoutsPrevented ?? 0;
  const healthPct = verifiedCount > 0 ? Math.round((healthyCount / verifiedCount) * 100) : 0;

  return (
    <PageShell width="content">
      {/* Top Responsive Action Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={healthyCount > 0 ? "success" : "warning"} dot>
            {healthyCount > 0 ? `${healthyCount} Fresh Residential Ready` : "No Verified Residential Online"}
          </Badge>
          {config?.strictResidentialOnly && (
            <Badge variant="info" icon="shield">Strict Anti-Datacenter Active</Badge>
          )}
          {config?.hedgeEnabled && (
            <Badge variant="primary" icon="bolt">Dual-Hedge Zero-Timeout ({config.hedgeDelayMs}ms)</Badge>
          )}
        </div>

        <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <Button
            size="sm"
            variant="secondary"
            icon="radar"
            loading={scanningSources}
            onClick={handleScanSources}
            disabled={probingAll}
          >
            Scan Host Sources
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon="health_and_safety"
            loading={probingAll}
            onClick={handleProbeAll}
            disabled={scanningSources || nodes.length === 0}
          >
            Verify All Nodes
          </Button>
          <Button
            size="sm"
            icon="upload"
            onClick={() => {
              setImportReport(null);
              setShowImportModal(true);
            }}
          >
            Import Residential Proxies
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card padding="sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-muted">Verified Residential</span>
            <span className="material-symbols-outlined text-[18px] text-success">home_work</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-text-main">{healthyCount}</span>
            <span className="text-xs text-text-muted">/ {verifiedCount} verified</span>
          </div>
          <p className="mt-1 text-[11px] text-text-muted">Non-datacenter ISP/Broadband egress</p>
        </Card>

        <Card padding="sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-muted">Datacenter Blocked</span>
            <span className="material-symbols-outlined text-[18px] text-danger">gpp_bad</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-text-main">{dcBlockedCount}</span>
            <span className="text-xs text-text-muted">ASN rejected</span>
          </div>
          <p className="mt-1 text-[11px] text-text-muted">AWS, GCP, Azure, OVH, Vultr blocked</p>
        </Card>

        <Card padding="sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-muted">Avg / P95 Latency</span>
            <span className="material-symbols-outlined text-[18px] text-primary">speed</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-text-main">{avgLatency}ms</span>
            <span className="text-xs text-text-muted">P95: {p95Latency}ms</span>
          </div>
          <p className="mt-1 text-[11px] text-text-muted">Bounded HTTPS CONNECT timing</p>
        </Card>

        <Card padding="sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-muted">Zero-Timeout Guard</span>
            <span className="material-symbols-outlined text-[18px] text-brand-500">bolt</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-text-main">{hedgeWins}</span>
            <span className="text-xs text-text-muted">hedge wins</span>
          </div>
          <p className="mt-1 text-[11px] text-text-muted">{timeoutsPrevented} slow stalls prevented</p>
        </Card>

        <Card padding="sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-text-muted">Pool Health</span>
            <span className="material-symbols-outlined text-[18px] text-info">monitoring</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-text-main">{healthPct}%</span>
            <span className="text-xs text-text-muted">{metrics?.quarantinedCount || 0} quarantined</span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div className={`h-full transition-all ${getHealthBarColor(healthPct)}`} style={{ width: `${healthPct}%` }} />
          </div>
        </Card>
      </div>

      {/* Policy & Live Test Bench */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card
          title="Zero-Timeout & Anti-Datacenter Policy"
          subtitle="Enforce strict residential ASN verification and speculative hedging deadlines"
          icon="tune"
        >
          {config && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface-2/40 p-3">
                <Toggle
                  checked={config.strictResidentialOnly}
                  onChange={(val) => setConfig((prev) => ({ ...prev, strictResidentialOnly: val }))}
                  label="Strict Residential Only (Block Datacenter ASNs)"
                  description="Automatically reject hosting, cloud, VPN, and datacenter egress IPs during verification and routing."
                />
                <Toggle
                  checked={config.hedgeEnabled}
                  onChange={(val) => setConfig((prev) => ({ ...prev, hedgeEnabled: val }))}
                  label="Speculative Dual-Hedge Racing"
                  description="Launch a secondary verified residential node if the primary node stalls past Hedge Delay."
                />
              </div>

              <Select
                label="Rotation & Selection Strategy"
                value={config.rotationStrategy}
                options={STRATEGY_OPTIONS}
                onChange={(e) => setConfig((prev) => ({ ...prev, rotationStrategy: e.target.value }))}
              />

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  label="Hedge Trigger Delay (ms)"
                  type="number"
                  min={300}
                  max={3500}
                  value={config.hedgeDelayMs}
                  onChange={(e) => setConfig((prev) => ({ ...prev, hedgeDelayMs: Number(e.target.value) }))}
                  hint="Default 900ms — eliminates tail latency"
                />
                <Input
                  label="Connect Timeout Ceiling (ms)"
                  type="number"
                  min={800}
                  max={5000}
                  value={config.connectTimeoutMs}
                  onChange={(e) => setConfig((prev) => ({ ...prev, connectTimeoutMs: Number(e.target.value) }))}
                  hint="Max TCP/TLS handshake wait"
                />
                <Input
                  label="Headers Timeout Ceiling (ms)"
                  type="number"
                  min={1500}
                  max={12000}
                  value={config.headersTimeoutMs}
                  onChange={(e) => setConfig((prev) => ({ ...prev, headersTimeoutMs: Number(e.target.value) }))}
                  hint="Max wait for upstream response headers"
                />
                <Input
                  label="Auto-Quarantine Duration (sec)"
                  type="number"
                  min={15}
                  max={600}
                  value={config.quarantineDurationSec}
                  onChange={(e) => setConfig((prev) => ({ ...prev, quarantineDurationSec: Number(e.target.value) }))}
                  hint="Cooldown after consecutive errors"
                />
              </div>

              <div className="flex justify-end">
                <Button icon="save" loading={savingConfig} onClick={handleSaveConfig}>
                  Save Engine Policy
                </Button>
              </div>
            </div>
          )}
        </Card>

        <Card
          title="Live Residential Egress & Leak Test"
          subtitle="Verify real exit IP, ISP/ASN classification, and dual-hedge latency in real time"
          icon="science"
        >
          <div className="flex flex-col gap-4">
            <Select
              label="Test Route"
              value={probeTargetNode}
              options={[
                { value: "auto-hedge", label: "Auto-Hedge Pool (Fastest Fresh Residential Race)" },
                ...nodes
                  .filter((n) => n.id)
                  .map((n) => ({
                    value: n.id,
                    label: `${n.name} (${n.egressIp || n.maskedUrl})`,
                  })),
              ]}
              onChange={(e) => setProbeTargetNode(e.target.value)}
            />

            <Select
              label="Target Endpoint"
              value={probeTargetUrl}
              options={[...TEST_PRESETS, { value: "__custom__", label: "Custom HTTPS URL..." }]}
              onChange={(e) => setProbeTargetUrl(e.target.value)}
            />

            {probeTargetUrl === "__custom__" && (
              <Input
                label="Custom Target URL"
                placeholder="https://api.anthropic.com"
                value={customTestUrl}
                onChange={(e) => setCustomTestUrl(e.target.value)}
              />
            )}

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-text-muted">
                Probes use real HTTPS CONNECT tunneling with bounded timeouts.
              </span>
              <Button icon="play_arrow" loading={runningLiveTest} onClick={handleLiveTest}>
                Run Live Test
              </Button>
            </div>

            {liveTestResult && (
              <div
                className={`rounded-lg border p-3 text-xs ${
                  liveTestResult.ok && liveTestResult.isResidential
                    ? "border-success/30 bg-success/5"
                    : liveTestResult.ipType === "datacenter"
                      ? "border-warning/30 bg-warning/5"
                      : "border-danger/30 bg-danger/5"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-medium text-text-main">
                    <span className="material-symbols-outlined text-[16px]">
                      {liveTestResult.ok ? "check_circle" : "error"}
                    </span>
                    <span>
                      {liveTestResult.ok
                        ? `HTTP ${liveTestResult.httpStatus || 200} · ${liveTestResult.latencyMs}ms`
                        : `Failed · ${liveTestResult.error}`}
                    </span>
                  </div>
                  {liveTestResult.ipType && (
                    <Badge
                      variant={
                        liveTestResult.ipType === "residential"
                          ? "success"
                          : liveTestResult.ipType === "datacenter"
                            ? "error"
                            : "warning"
                      }
                      size="sm"
                    >
                      {liveTestResult.ipType === "residential"
                        ? "Fresh Residential"
                        : liveTestResult.ipType === "datacenter"
                          ? "Datacenter Blocked"
                          : "Unverified"}
                    </Badge>
                  )}
                </div>

                {liveTestResult.ok && (
                  <div className="mt-2 grid grid-cols-1 gap-1.5 text-text-muted sm:grid-cols-2">
                    <div>Exit IP: <code className="font-mono text-text-main">{liveTestResult.egressIp || "N/A"}</code></div>
                    <div>Country: <span className="text-text-main">{liveTestResult.countryCode || "-"} {liveTestResult.city ? `(${liveTestResult.city})` : ""}</span></div>
                    <div className="sm:col-span-2">ISP / ASN: <span className="text-text-main">{liveTestResult.isp || "-"} {liveTestResult.asn ? `· ${liveTestResult.asn}` : ""}</span></div>
                    {liveTestResult.node && (
                      <div className="sm:col-span-2">
                        Node: <code className="font-mono text-text-main">{liveTestResult.node}</code>
                        {liveTestResult.hedgeWon && <Badge variant="primary" size="sm" className="ml-2">Won via Speculative Hedge</Badge>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Provider Residential Binding Card */}
      <Card
        title="Bind Fresh Residential Proxies to AI Providers"
        subtitle="Route provider accounts through verified non-datacenter IPs without modifying credentials"
        icon="hub"
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4 md:items-end">
          <Select
            label="Target Provider"
            value={selectedProvider}
            options={
              providers.length > 0
                ? providers.map((p) => ({
                    value: p.provider,
                    label: `${p.provider} (${p.activeConnections} active · ${p.residentialBoundCount} resi)`,
                  }))
                : [{ value: "glm", label: "glm" }]
            }
            onChange={(e) => setSelectedProvider(e.target.value)}
          />

          <Select
            label="Binding Mode"
            value={bindDistribution}
            options={[
              { value: "auto-hedge", label: "Auto-Hedge Gateway (Zero-Timeout Race)" },
              { value: "one-to-one", label: "1-on-1 Dedicated Residential IP Rotation" },
            ]}
            onChange={(e) => setBindDistribution(e.target.value)}
          />

          <div className="flex items-center pb-2">
            <Toggle
              size="sm"
              checked={resetProxyErrors}
              onChange={setResetProxyErrors}
              label="Clear prior 502/timeout locks"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              icon="link"
              loading={bindingProvider}
              onClick={() => handleBindProvider("bind")}
              disabled={healthyCount === 0}
            >
              Bind Provider
            </Button>
            <Button
              variant="outline"
              icon="link_off"
              disabled={bindingProvider}
              onClick={() => handleBindProvider("unbind")}
            >
              Unbind
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text-muted">
          <span>Gateway Pool:</span>
          <Badge variant={gatewayPool?.isActive ? "success" : "default"} size="sm">
            {gatewayPool?.name || "Fresh Residential Auto-Hedge Gateway"} ({gatewayPool?.boundConnectionCount || 0} bound)
          </Badge>
          {providers.filter((p) => p.residentialBoundCount > 0).map((p) => (
            <Badge key={p.provider} variant="info" size="sm">
              {p.provider}: {p.residentialBoundCount}/{p.activeConnections}
            </Badge>
          ))}
        </div>
      </Card>

      {/* Residential Proxy Inventory */}
      <Card
        title="Residential Proxy Node Inventory"
        subtitle={`Showing ${filteredNodes.length} of ${nodes.length} tracked nodes`}
        icon="dns"
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              size="xs"
              variant="outline"
              icon="delete_sweep"
              loading={purgingMode === "datacenter"}
              onClick={() => handlePurge("datacenter")}
              disabled={dcBlockedCount === 0}
            >
              Purge Datacenter
            </Button>
            <Button
              size="xs"
              variant="outline"
              icon="cleaning_services"
              loading={purgingMode === "dead"}
              onClick={() => handlePurge("dead")}
            >
              Purge Offline
            </Button>
          </div>
        }
      >
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <SegmentedControl
            size="sm"
            options={FILTER_TABS}
            value={filterTab}
            onChange={setFilterTab}
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:flex lg:items-center">
            <Input
              placeholder="Search IP, ISP, ASN, host..."
              icon="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="lg:w-64"
            />
            <Select
              value={countryFilter}
              options={countries}
              onChange={(e) => setCountryFilter(e.target.value)}
              className="lg:w-40"
            />
          </div>
        </div>

        {filteredNodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border-subtle py-10 text-center">
            <span className="material-symbols-outlined text-4xl text-text-muted">home_work</span>
            <p className="mt-2 text-sm font-medium text-text-main">No matching residential proxy nodes</p>
            <p className="mt-1 max-w-md text-xs text-text-muted">
              Click &ldquo;Scan Host Sources&rdquo; to verify residential proxies already present on the server, or import your residential proxy list. Datacenter IPs are automatically filtered out.
            </p>
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block">
              <TableScroll minWidth="min-w-[820px]">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border-subtle text-text-muted">
                      <th className="py-2.5 pr-3 font-medium">Node / Endpoint</th>
                      <th className="py-2.5 px-3 font-medium">Exit IP &amp; Geo</th>
                      <th className="py-2.5 px-3 font-medium">ISP / ASN Verification</th>
                      <th className="py-2.5 px-3 font-medium">Status</th>
                      <th className="py-2.5 px-3 font-medium">Latency &amp; Health</th>
                      <th className="py-2.5 pl-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle/60">
                    {filteredNodes.map((node) => (
                      <tr key={node.id || node.maskedUrl} className="hover:bg-surface-2/40">
                        <td className="py-3 pr-3">
                          <div className="font-medium text-text-main">{node.name}</div>
                          <code className="font-mono text-[11px] text-text-muted">{node.maskedUrl}</code>
                        </td>
                        <td className="py-3 px-3">
                          <div className="font-mono text-text-main">{node.egressIp || "Unprobed"}</div>
                          <div className="text-[11px] text-text-muted">
                            {node.countryCode && node.countryCode !== "UN" ? `${node.countryCode}${node.city ? ` · ${node.city}` : ""}` : "Unknown Geo"}
                          </div>
                        </td>
                        <td className="py-3 px-3 max-w-[240px]">
                          <div className="truncate font-medium text-text-main" title={node.isp || ""}>
                            {node.isp || "Pending ASN lookup"}
                          </div>
                          <div className="truncate text-[11px] text-text-muted" title={node.asn || node.lastError || ""}>
                            {node.asn || node.lastError || "No ASN record"}
                          </div>
                        </td>
                        <td className="py-3 px-3">{getNodeStatusBadge(node)}</td>
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-text-main">{node.avgLatencyMs}ms</span>
                            <span className="text-text-muted">({node.healthScore}%)</span>
                          </div>
                          <div className="mt-1 h-1 w-24 overflow-hidden rounded-full bg-surface-2">
                            <div
                              className={`h-full ${getHealthBarColor(node.healthScore)}`}
                              style={{ width: `${node.healthScore}%` }}
                            />
                          </div>
                          <div className="mt-0.5 text-[10px] text-text-muted">
                            OK: {node.successCount} · Fail: {node.failureCount}
                          </div>
                        </td>
                        <td className="py-3 pl-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <Toggle
                              size="sm"
                              checked={node.isActive}
                              onChange={() => handleToggleNode(node)}
                            />
                            <Button
                              size="xs"
                              variant="ghost"
                              icon="science"
                              loading={probingNodeId === node.id}
                              onClick={() => handleProbeSingle(node.id)}
                            >
                              Probe
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              icon="delete"
                              onClick={() => handleDeleteNode(node)}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </div>

            {/* Mobile Card Stack */}
            <div className="flex flex-col gap-3 md:hidden">
              {filteredNodes.map((node) => (
                <div
                  key={node.id || node.maskedUrl}
                  className="rounded-lg border border-border-subtle bg-surface-2/30 p-3 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-text-main">{node.name}</div>
                      <code className="block truncate font-mono text-[11px] text-text-muted">{node.maskedUrl}</code>
                    </div>
                    {getNodeStatusBadge(node)}
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-text-muted">Exit IP: </span>
                      <code className="font-mono text-text-main">{node.egressIp || "N/A"}</code>
                    </div>
                    <div>
                      <span className="text-text-muted">Latency: </span>
                      <span className="font-mono text-text-main">{node.avgLatencyMs}ms ({node.healthScore}%)</span>
                    </div>
                    <div className="col-span-2 truncate">
                      <span className="text-text-muted">ISP: </span>
                      <span className="text-text-main">{node.isp || "Pending"} {node.countryCode ? `(${node.countryCode})` : ""}</span>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-border-subtle/50 pt-2">
                    <Toggle size="sm" checked={node.isActive} onChange={() => handleToggleNode(node)} label={node.isActive ? "Active" : "Paused"} />
                    <div className="flex items-center gap-1">
                      <Button size="xs" variant="secondary" icon="science" loading={probingNodeId === node.id} onClick={() => handleProbeSingle(node.id)}>
                        Probe
                      </Button>
                      <Button size="xs" variant="ghost" icon="delete" onClick={() => handleDeleteNode(node)} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* Batch Import Modal */}
      <Modal
        isOpen={showImportModal}
        title="Import & Verify Residential Proxies"
        onClose={() => !importing && setShowImportModal(false)}
        size="lg"
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-info/20 bg-info/5 p-3 text-xs text-text-muted">
            Every proxy is tested in real time over <strong className="text-text-main">HTTPS CONNECT</strong> and checked against ISP/ASN databases. Cloud &amp; Datacenter IPs (AWS, Azure, GCP, DigitalOcean, OVH, Hetzner, Vultr, etc.) are automatically blocked when Strict Residential mode is enabled.
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-text-main">
              Proxy List (One per line)
            </label>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={"http://user:pass@res-us.example.com:8080\nsocks5://user:pass@175.29.133.8:5433\n175.29.135.7:5433:user:pass"}
              className="min-h-[160px] w-full rounded-lg border border-border-subtle bg-surface-2 px-3 py-2 font-mono text-xs text-text-main focus:border-brand-500/50 focus:outline-none"
            />
            <p className="mt-1 text-[11px] text-text-muted">
              Supported formats: http://user:pass@host:port, socks5://user:pass@host:port, host:port:user:pass, host:port
            </p>
          </div>

          {importReport && (
            <div className="max-h-48 overflow-y-auto rounded-lg border border-border-subtle bg-surface-2/40 p-3 text-xs">
              <div className="mb-2 font-medium text-text-main">
                Verification Summary: {importReport.addedResidential} Added · {importReport.updatedResidential} Updated · {importReport.rejectedDatacenter} Datacenter Blocked · {importReport.failedProbe} Failed
              </div>
              <div className="flex flex-col gap-1">
                {(importReport.results || []).map((r, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-2 text-[11px]">
                    <code className="truncate font-mono text-text-main">{r.maskedUrl}</code>
                    <span className="shrink-0 text-text-muted">
                      {r.status === "residential_verified"
                        ? `OK · ${r.egressIp} (${r.isp})`
                        : r.status === "datacenter_blocked"
                          ? `Blocked DC · ${r.egressIp} (${r.isp || r.reason})`
                          : `Failed · ${r.error}`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Button
              fullWidth
              icon="verified_user"
              loading={importing}
              disabled={!importText.trim()}
              onClick={handleImportSubmit}
            >
              {importing ? "Verifying ASN & Latency..." : "Verify & Import"}
            </Button>
            <Button
              fullWidth
              variant="ghost"
              disabled={importing}
              onClick={() => setShowImportModal(false)}
            >
              Close
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmModal
        isOpen={!!confirmState}
        title={confirmState?.title || "Confirm"}
        message={confirmState?.message || ""}
        onConfirm={confirmState?.onConfirm}
        onCancel={() => setConfirmState(null)}
      />
    </PageShell>
  );
}
