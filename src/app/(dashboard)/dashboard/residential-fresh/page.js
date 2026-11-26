"use client";

import { useState, useEffect, useCallback } from "react";
import { PageShell, Card, Button, Badge, CardSkeleton } from "@/shared/components";

/**
 * Residential Fresh Proxy Manager — pure non-datacenter residential IP pool
 * with direct 1-on-1 per-provider injection (proxyPoolId = null, zero group pools),
 * instant dead/timeout/rate-limit proxy eviction, and dual-hedge failover (:20188).
 */
export default function ResidentialFreshPage() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/residential-fresh", { cache: "no-store" });
      const d = await r.json();
      setStatus(d.success ? d : null);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      load();
    }, 15000);
    return () => clearInterval(timer);
  }, [load]);

  const act = async (action) => {
    setBusy(action);
    setToast(null);
    try {
      const r = await fetch("/api/residential-fresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const d = await r.json();
      const msg =
        d.message ||
        d.error ||
        (d.egressIp
          ? `Egress IP: ${d.egressIp}${d.countryCode ? ` (${d.countryCode})` : ""}${d.isp ? ` · ${d.isp}` : ""}${d.latencyMs ? ` · ${d.latencyMs}ms` : ""}`
          : "Done");
      setToast({ ok: d.success !== false && r.ok, msg });
      await load();
    } catch (e) {
      setToast({ ok: false, msg: String(e?.message || e).slice(0, 140) });
    } finally {
      setBusy(null);
    }
  };

  if (loading && !status) {
    return (
      <PageShell width="reading">
        <CardSkeleton />
        <CardSkeleton />
      </PageShell>
    );
  }

  const gw = status?.gateway || {};
  const nodes = Array.isArray(gw.nodes) ? gw.nodes.filter((n) => n.alive && !n.datacenterBlocked) : [];
  const bindings = Array.isArray(status?.providerBindings) ? status.providerBindings : [];
  const egress = status?.currentEgress || {};

  const statusBadge = (alive, labelOk = "Alive", labelBad = "Offline") => (
    <Badge variant={alive ? "success" : "error"} size="sm" dot>
      {alive ? labelOk : labelBad}
    </Badge>
  );

  return (
    <PageShell width="reading">
      {/* Compact Status Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
          {statusBadge(Boolean(gw.listening))}
          <span>Pure-Residential Manager · Direct Per-Provider Injection</span>
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-text-main border border-border-subtle">
            127.0.0.1:20188
          </code>
          {status?.directConnections > 0 && (
            <span>
              · {status.directConnections} direct connection(s) across {status.coveredProviders}/{status.totalActiveProviders} providers
            </span>
          )}
        </div>
        <Button size="sm" variant="outline" icon="refresh" onClick={load} loading={loading} className="self-start sm:self-auto">
          Refresh Status
        </Button>
      </div>

      {toast && (
        <div
          className={`rounded-[var(--r-control)] px-3.5 py-2.5 text-xs sm:text-sm border ${
            toast.ok
              ? "border-success/30 bg-success/10 text-success"
              : "border-danger/30 bg-danger/10 text-danger"
          }`}
        >
          {toast.msg}
        </div>
      )}

      {/* Live Egress & Injection Summary Card */}
      <Card padding="md">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-text-muted">Current Egress IP</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <code className="text-base sm:text-lg font-mono font-semibold text-text-main">
                {egress.ip || "—"}
              </code>
              {egress.isResidential === true && (
                <Badge variant="success" size="sm">
                  {egress.networkClass === "mobile"
                    ? "Mobile ISP"
                    : egress.networkClass === "education"
                      ? "Campus ISP"
                      : "Residential"}
                </Badge>
              )}
              {egress.isResidential === false && (
                <Badge variant="error" size="sm">Non-Residential</Badge>
              )}
            </div>
            {(egress.isp || egress.countryCode) && (
              <p className="mt-1 truncate text-[11px] text-text-muted" title={`${egress.isp || ""} ${egress.asn || ""}`}>
                {egress.countryCode ? `${egress.countryCode} · ` : ""}{egress.isp || ""}
              </p>
            )}
          </div>

          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-text-muted">Gateway & Guard</p>
            <div className="mt-1.5 flex items-center gap-2">
              {statusBadge(Boolean(gw.listening))}
              <span className="text-xs font-mono text-text-main truncate">
                {gw.listening ? ":20188" : "Not reachable"}
              </span>
            </div>
            <p className="mt-1 truncate text-[11px] text-text-muted" title={gw.engine || ""}>
              {gw.engine || "Pure-Residential Gateway"}
            </p>
          </div>

          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-text-muted">Verified Residential Pool</p>
            <p className="mt-1.5 text-sm font-semibold text-text-main">
              {gw.alive ?? 0} alive / {gw.upstreams ?? 0} active
            </p>
            <p className="mt-1 text-[11px] text-text-muted">
              {gw.datacenterBlocked ?? 0} DC blocked · {gw.deadEvicted ?? 0} dead evicted · 0 group pool
            </p>
          </div>

          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-text-muted">Provider Coverage</p>
            <p className="mt-1.5 text-sm font-semibold font-mono text-text-main">
              {status?.coveredProviders ?? 0} / {status?.totalActiveProviders ?? 0} providers
            </p>
            <p className="mt-1 text-[11px] text-text-muted">
              {status?.uniqueEndpointsUsed ?? 0} unique IPs · {status?.deadOrErroredConnections ?? 0} dead/error · {status?.responseMs ?? "—"} ms
            </p>
          </div>
        </div>
      </Card>

      {/* 3 Simple Actions */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Button
          fullWidth
          icon="autorenew"
          variant="secondary"
          loading={busy === "refresh"}
          disabled={!!busy}
          onClick={() => act("refresh")}
        >
          {busy === "refresh" ? "Harvesting & Injecting..." : "Inject Fresh Residential IPs"}
        </Button>
        <Button
          fullWidth
          icon="bolt"
          loading={busy === "probe"}
          disabled={!!busy}
          onClick={() => act("probe")}
        >
          {busy === "probe" ? "Probing Egress..." : "Probe Egress Now"}
        </Button>
        <Button
          fullWidth
          icon="restart_alt"
          variant="outline"
          loading={busy === "restart"}
          disabled={!!busy}
          onClick={() => act("restart")}
        >
          {busy === "restart" ? "Restarting..." : "Restart Gateway"}
        </Button>
      </div>

      {/* Direct Per-Provider Residential Injection Status */}
      <Card
        title={`Direct Provider Bindings (${bindings.length})`}
        subtitle="Each active provider receives a dedicated pure-residential endpoint directly (proxyPoolId = null) — dead, timed-out, or rate-limited proxies are replaced automatically"
        icon="hub"
      >
        {bindings.length === 0 ? (
          <p className="text-xs text-text-muted py-6 text-center border border-dashed border-border-subtle rounded-[var(--r-control)]">
            No active external provider connections found.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {bindings.map((b) => (
              <li
                key={b.provider}
                className="flex items-center justify-between gap-3 rounded-[var(--r-control)] border border-border-subtle bg-surface-2/40 px-3 py-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-semibold text-text-main truncate">{b.provider}</span>
                    {b.countryCode && <Badge variant="info" size="sm">{b.countryCode}</Badge>}
                    <span className="text-[11px] text-text-muted">({b.activeConnections})</span>
                  </div>
                  <div className="truncate font-mono text-[11px] text-text-muted mt-0.5" title={b.maskedProxyUrl || ""}>
                    {b.egressIp ? `${b.egressIp} · ` : ""}{b.maskedProxyUrl || "Unbound"}
                  </div>
                  {b.isp && (
                    <div className="truncate text-[10px] text-text-muted">{b.isp}</div>
                  )}
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1">
                  {statusBadge(Boolean(b.healthy), "Injected", "Needs Heal")}
                  {b.latencyMs ? (
                    <span className="font-mono text-[10px] text-text-muted">{Math.round(b.latencyMs)} ms</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Verified Live Residential Nodes */}
      <Card
        title={`Verified Pure-Residential Nodes (${nodes.length})`}
        subtitle="3-stage verified (HTTPS TLS IP echo + HTTP 204 reachability <= 2800ms + multi-provider non-datacenter ASN guard) — dead & datacenter nodes are deleted immediately"
        icon="home_work"
      >
        {nodes.length === 0 ? (
          <p className="text-xs text-text-muted py-6 text-center border border-dashed border-border-subtle rounded-[var(--r-control)]">
            No live residential nodes loaded. Click &ldquo;Inject Fresh Residential IPs&rdquo; to populate.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {nodes.map((n, i) => (
              <li
                key={`${n.host}:${n.port}:${i}`}
                className="flex flex-col gap-2 rounded-[var(--r-control)] border border-border-subtle bg-surface-2/40 px-3.5 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="font-mono text-xs font-medium text-text-main truncate">
                      {n.protocol || "http"}://{n.host}:{n.port}
                    </code>
                    {n.countryCode && <Badge variant="info" size="sm">{n.countryCode}</Badge>}
                    {n.networkClass === "mobile" && <Badge variant="primary" size="sm">Mobile</Badge>}
                    {n.networkClass === "education" && <Badge variant="default" size="sm">Campus</Badge>}
                    {n.networkClass === "residential" && <Badge variant="success" size="sm">Residential</Badge>}
                  </div>
                  <div className="truncate text-[11px] text-text-muted mt-0.5">
                    {n.egressIp ? `${n.egressIp} · ` : ""}{n.isp || "Verified ISP"}
                  </div>
                </div>
                <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                  <span className="font-mono text-xs text-text-main">
                    {n.latencyMs && n.latencyMs < 9999 ? `${Math.round(n.latencyMs)} ms` : "—"}
                  </span>
                  <span className="text-xs text-text-muted">
                    ok {n.ok ?? 0} / fail {n.fails ?? 0}
                  </span>
                  {statusBadge(Boolean(n.alive))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Direct Auto-Injection Info */}
      <Card
        title="Zero-Datacenter & Dead-Proxy Auto-Injection Policy"
        icon="medical_services"
      >
        <ul className="text-xs text-text-muted flex flex-col gap-1.5 list-disc pl-4">
          <li>Every verified proxy must pass 2/2 HTTPS TLS checks (real IP echo + global HTTP 204 reachability under 2800 ms) and multi-provider ASN validation (<code className="font-mono text-text-main">ip-api.com</code> + <code className="font-mono text-text-main">ipwho.is</code> + <code className="font-mono text-text-main">ipinfo.io</code>).</li>
          <li>Cloud, datacenter, hosting, VPN, Tor, WARP, and transparent proxies are strictly blocked and deleted immediately from pool files and database.</li>
          <li>Dead, timed-out, or rate-limited (402/407/429/502/504/524) proxies are quarantined instantly at runtime, failed over via 550 ms dual-hedge, and replaced directly on each provider connection (<code className="font-mono text-text-main">proxyPoolId = null</code>).</li>
          <li>Every 20 s gateway probe and 5 min watchdog verify live egress health and auto-heal any degraded provider connection.</li>
        </ul>
      </Card>
    </PageShell>
  );
}
