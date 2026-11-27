"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge, Button, Card, CardSkeleton, Modal, PageShell, Toggle } from "@/shared/components";
import { cn } from "@/shared/utils/cn";

const LOOP_OPTIONS = [
  { value: 0, label: "Manual (Once)" },
  { value: 2, label: "Every 2m (Fast)" },
  { value: 5, label: "Every 5m" },
  { value: 15, label: "Every 15m" },
  { value: 30, label: "Every 30m" },
  { value: 60, label: "Every 1h" },
];

async function safeReadJson(res) {
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch {
    const trimmed = text.trim();
    const msg = trimmed.startsWith("<")
      ? `Server/Gateway returned HTTP ${res.status} (HTML) instead of JSON. Please retry.`
      : (trimmed.slice(0, 140) || `HTTP ${res.status}`);
    return { ok: false, status: res.status, data: { error: msg } };
  }
}

function formatTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "—";
  }
}

export default function AutoHarvesterPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState(15);
  const [maxScan, setMaxScan] = useState(15000);
  const [loop, setLoop] = useState(0);
  const [strictNoProxyFlag, setStrictNoProxyFlag] = useState(true);
  const [customFeedsText, setCustomFeedsText] = useState("");
  const [showFeedsModal, setShowFeedsModal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pruning, setPruning] = useState(false);
  const [distributing, setDistributing] = useState(false);
  const [toast, setToast] = useState(null);
  const pollRef = useRef(null);
  const feedsInitializedRef = useRef(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/harvester", { cache: "no-store" });
      const parsed = await safeReadJson(res);
      if (parsed.ok) {
        const data = parsed.data;
        setStatus(data);
        if (!feedsInitializedRef.current && Array.isArray(data.customFeeds) && data.customFeeds.length > 0) {
          feedsInitializedRef.current = true;
          setCustomFeedsText(data.customFeeds.join("\n"));
        }
      }
    } catch {}
    finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    const intervalMs = status?.running ? 2500 : 12000;
    pollRef.current = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      loadStatus();
    }, intervalMs);
    return () => clearInterval(pollRef.current);
  }, [status?.running, loadStatus]);

  const sendAction = async (payload, setLoader, fallbackMsg) => {
    setLoader(true);
    setToast(null);
    try {
      const res = await fetch("/api/harvester", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const { ok, data } = await safeReadJson(res);
      setToast({ ok: ok && data.success !== false, msg: data.message || data.error || fallbackMsg });
      await loadStatus();
    } catch (e) {
      setToast({ ok: false, msg: e?.message || fallbackMsg });
    } finally {
      setLoader(false);
    }
  };

  const startHarvest = () => {
    const customFeeds = customFeedsText.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.startsWith("http"));
    return sendAction(
      {
        action: "start",
        target: Number(target) || 15,
        maxCandidates: Number(maxScan) || 15000,
        loopMinutes: Number(loop) || 0,
        strictNoProxyFlag,
        customFeeds,
      },
      setBusy,
      "Harvester started"
    );
  };

  const stopHarvest = () => sendAction({ action: "stop" }, setBusy, "Stopped");
  const pruneAndReverify = () => sendAction({ action: "prune", strictNoProxyFlag }, setPruning, "Prune started");
  const distributeFairly = () => sendAction({ action: "distribute" }, setDistributing, "Distributed fairly");

  const deleteOne = async (id) => {
    try {
      await fetch(`/api/proxy-pools/${encodeURIComponent(id)}`, { method: "DELETE" });
      await loadStatus();
    } catch {}
  };

  if (loading && !status) {
    return (
      <PageShell width="wide">
        <div className="flex flex-col gap-4">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </PageShell>
    );
  }

  const running = Boolean(status?.running);
  const pools = Array.isArray(status?.harvestedPools) ? status.harvestedPools : [];
  const lastAdded = status?.lastAdded ?? 0;
  const lastTested = status?.lastTested ?? 0;
  const targetCount = status?.targetCount ?? target;

  return (
    <PageShell width="wide">
      <div className="grid grid-cols-1 items-start gap-4 sm:gap-6 lg:grid-cols-[minmax(18rem,0.85fr)_minmax(0,1.65fr)]">
        {/* Header Bar (9Router flow) */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:col-span-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold sm:text-2xl">Proxy Harvest</h1>
              <Badge variant={running ? "success" : "neutral"} size="sm" dot>
                {running ? "Harvesting" : "Idle"}
              </Badge>
            </div>
            <p className="text-xs text-text-muted mt-0.5">
              Autonomous 9Router discovery with strict 3/3 TLS + Dual-ASN pure-residential gate and fair 1-on-1 provider binding.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" icon="balance" onClick={distributeFairly} loading={distributing} disabled={running}>
              Distribute to Providers
            </Button>
            <Button size="sm" variant="outline" icon="cleaning_services" onClick={pruneAndReverify} loading={pruning} disabled={running}>
              Prune &amp; Re-Verify
            </Button>
            <Link href="/dashboard/proxy-pools">
              <Button size="sm" variant="secondary" icon="route">
                View in Pools ({status?.totalPoolsCount ?? pools.length})
              </Button>
            </Link>
          </div>
        </div>

        {toast && (
          <div className={cn(
            "lg:col-span-2 rounded-[var(--r-control)] px-3.5 py-2.5 text-xs sm:text-sm border",
            toast.ok ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger"
          )}>
            {toast.msg}
          </div>
        )}

        {/* Left Column: Harvester Worker Controller + Metrics (9Router 2-column layout) */}
        <div className="flex min-w-0 flex-col gap-4 sm:gap-6 lg:col-start-1 lg:row-start-2">
          <Card className="p-4 sm:p-5 flex flex-col gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className={cn(
                "flex size-10 shrink-0 items-center justify-center rounded-lg border",
                running
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                  : "border-border bg-surface-2 text-text-muted"
              )}>
                <span className={cn("material-symbols-outlined text-[22px]", running && "animate-spin")}>
                  {running ? "sync" : "travel_explore"}
                </span>
              </div>
              <div className="min-w-0 flex flex-col">
                <span className="text-sm font-semibold text-text-main">Harvester Worker</span>
                <span className="text-xs text-text-muted truncate mt-0.5">
                  {status?.lastMessage || "Ready to discover fresh pure-residential proxies"}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-2.5 py-1.5">
                <label className="text-text-muted font-mono">Target:</label>
                <input
                  type="number"
                  min="1"
                  max="200"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  disabled={running}
                  className="w-16 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-center font-mono text-xs text-text-main disabled:opacity-40"
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border bg-surface px-2.5 py-1.5">
                <label className="text-text-muted font-mono">Max Scan:</label>
                <input
                  type="number"
                  min="50"
                  max="45000"
                  step="500"
                  value={maxScan}
                  onChange={(e) => setMaxScan(e.target.value)}
                  disabled={running}
                  className="w-20 rounded border border-border bg-surface-2 px-1.5 py-0.5 text-center font-mono text-xs text-text-main disabled:opacity-40"
                />
              </div>
              <div className="col-span-2 flex items-center justify-between rounded-lg border border-border bg-surface px-2.5 py-1.5">
                <label className="text-text-muted font-mono">Schedule:</label>
                <select
                  value={loop}
                  onChange={(e) => setLoop(Number(e.target.value))}
                  disabled={running}
                  className="rounded border border-border bg-surface-2 px-2 py-0.5 font-mono text-xs text-text-main disabled:opacity-40"
                >
                  {LOOP_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 text-xs pt-1 border-t border-border/40">
              <span className="text-text-muted">Block Proxy-Flagged IPs (Anti-429)</span>
              <Toggle checked={strictNoProxyFlag} onChange={setStrictNoProxyFlag} disabled={running} />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/50">
              <Button
                size="sm"
                variant="secondary"
                icon="dynamic_feed"
                onClick={() => setShowFeedsModal(true)}
              >
                Custom Feeds{status?.customFeeds?.length ? ` (${status.customFeeds.length})` : ""}
              </Button>
              {running ? (
                <Button size="sm" variant="danger" icon="stop" onClick={stopHarvest} loading={busy}>
                  Stop
                </Button>
              ) : (
                <Button size="sm" icon="play_circle" onClick={startHarvest} loading={busy}>
                  Start
                </Button>
              )}
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-3">
            <Card className="p-3">
              <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted">Fresh Batch</span>
              <div className="text-lg font-semibold mt-1 tabular-nums text-emerald-500">
                {pools.length} <span className="text-xs font-normal text-text-muted">/ {targetCount}</span>
              </div>
            </Card>
            <Card className="p-3">
              <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted">Cycle Tested</span>
              <div className="text-lg font-semibold mt-1 tabular-nums text-text-main">
                {lastTested} <span className="text-xs font-normal text-text-muted">cands</span>
              </div>
            </Card>
            <Card className="p-3">
              <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted">DC / Flag Blocked</span>
              <div className="text-lg font-semibold mt-1 tabular-nums text-amber-500">
                {status?.lastDatacenterBlocked ?? 0}
              </div>
            </Card>
            <Card className="p-3">
              <span className="text-[11px] font-medium uppercase tracking-wider text-text-muted">Avg Latency</span>
              <div className="text-lg font-semibold mt-1 tabular-nums text-text-main">
                {status?.avgLatencyMs ? `${status.avgLatencyMs}ms` : "—"}
              </div>
            </Card>
          </div>
        </div>

        {/* Right Column: Fresh Harvested Proxies + Cycle History (9Router layout) */}
        <div className="flex min-w-0 flex-col gap-4 sm:gap-6 lg:col-start-2 lg:row-start-2">
          <Card className="overflow-hidden" padding="none">
            <div className="border-b border-border p-3 sm:px-4 sm:py-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Verified Pure-Residential Pool · Fresh Batch
                </span>
                <Badge variant="default" className="font-mono text-[10px]">
                  {pools.length}
                </Badge>
              </div>
              <span className="text-[11px] text-text-muted">
                +{lastAdded} synced to Proxy Pools · Total {status?.totalPoolsCount ?? pools.length} · 3/3 TLS
              </span>
            </div>

            {pools.length === 0 ? (
              <div className="p-8 text-center text-xs text-text-muted">
                {running
                  ? "Scanning feeds for brand-new pure-residential proxies..."
                  : <>No fresh proxies yet. Click <span className="font-semibold text-text-main">Start</span> to run a fresh discovery cycle.</>}
              </div>
            ) : (
              <div className="divide-y divide-border/50 max-h-[28rem] overflow-y-auto">
                {pools.map((p) => (
                  <div key={p.id} className="flex flex-col gap-2 px-3 py-2.5 sm:px-4 sm:flex-row sm:items-center sm:justify-between hover:bg-surface-2/40 transition-colors">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="size-2 rounded-full bg-emerald-500 shrink-0" />
                        <code className="font-mono text-xs font-medium text-text-main truncate">{p.proxyUrl}</code>
                        <Badge variant="success" size="sm">
                          {p.networkClass === "mobile" ? "Mobile ISP" : "Residential"}
                        </Badge>
                        {p.countryCode && (
                          <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-text-main">
                            {p.countryCode}
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate text-[11px] text-text-muted">
                        Egress: <span className="font-mono">{p.egressIp || "—"}</span> · {p.isp || "Unknown ISP"} {p.asn ? `(${p.asn})` : ""}
                      </p>
                    </div>
                    <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 font-mono text-xs">
                      <span className="text-text-main tabular-nums">{p.latencyMs ? `${p.latencyMs}ms` : "—"}</span>
                      {p.jitterMs != null && (
                        <span className="text-text-muted text-[11px] tabular-nums">&plusmn;{p.jitterMs}ms</span>
                      )}
                      <span className="text-text-muted text-[11px] tabular-nums">{formatTime(p.lastTestedAt)}</span>
                      <Badge variant="neutral" size="sm">100%</Badge>
                      <button
                        onClick={() => deleteOne(p.id)}
                        className="rounded p-1 text-text-muted hover:bg-danger/10 hover:text-danger transition-colors"
                        title="Delete proxy"
                      >
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {status?.history?.length > 0 && (
            <Card className="p-4">
              <div className="text-xs font-semibold uppercase tracking-wider text-text-muted mb-3">
                Recent Harvest Runs
              </div>
              <div className="divide-y divide-border/40 font-mono text-xs">
                {status.history.map((h, i) => (
                  <div key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="text-text-muted tabular-nums">{formatTime(h.at)}</span>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-emerald-500 font-medium tabular-nums">+{h.added} live</span>
                      <span className="text-text-muted">/</span>
                      <span className="text-text-muted tabular-nums">{h.tested} tested</span>
                      <span className="text-amber-500 tabular-nums">· {h.datacenterBlocked ?? 0} DC blocked</span>
                      <span className="text-text-muted tabular-nums">· {h.pruned ?? 0} old replaced</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>

      <Modal
        isOpen={showFeedsModal}
        onClose={() => setShowFeedsModal(false)}
        title="Custom Proxy Feeds"
        size="md"
        footer={<Button onClick={() => setShowFeedsModal(false)}>Done</Button>}
      >
        <div className="flex flex-col gap-3 text-xs">
          <p className="text-sm font-semibold text-text-main">Custom Feed URLs</p>
          <p className="text-text-muted leading-relaxed">
            Add your own raw HTTP or HTTPS proxy list URLs (one URL per line). Every candidate still passes 3/3 HTTPS TLS checks + dual-ASN pure-residential verification.
          </p>
          <textarea
            value={customFeedsText}
            onChange={(e) => setCustomFeedsText(e.target.value)}
            placeholder={"https://example.com/proxies.txt\nhttps://raw.githubusercontent.com/user/repo/main/http.txt"}
            rows={6}
            className="w-full rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs text-text-main focus:border-primary focus:outline-none resize-none"
          />
        </div>
      </Modal>
    </PageShell>
  );
}
