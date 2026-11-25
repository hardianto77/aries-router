"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, Badge } from "@/shared/components";

/**
 * Residential Fresh Proxy — dashboard module (English).
 * Pure residential rotating egress with auto-injection on death.
 * Datacenter/WARP shown as safety-net fallback only.
 */

const RESIDENTIAL_RE = /^45\.148\./;

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
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
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
      setToast({ ok: d.success !== false, msg: d.message || d.error || (d.egressIp ? `Egress IP: ${d.egressIp}` : "Done") });
      await load();
    } catch (e) {
      setToast({ ok: false, msg: String(e).slice(0, 120) });
    } finally {
      setBusy(null);
    }
  };

  const gw = status?.gateway || {};
  const resiNodes = (gw.nodes || []).filter(n => n.kind === "residential");
  const fallbackNodes = (gw.nodes || []).filter(n => n.kind !== "residential");
  const egress = status?.currentEgress || {};

  const badge = (alive) => (
    <Badge variant={alive ? "success" : "error"} size="sm">{alive ? "Alive" : "Dead"}</Badge>
  );

  return (
    <div className="flex flex-col gap-6 p-4 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-emerald-500">wifi_proxy</span>
            Residential Fresh Proxy
          </h1>
          <p className="text-xs text-text-muted mt-1">
            Rotating pure residential IPs. Dead proxies are auto-injected with a fresh residential IP — never datacenter, never a dead IP twice.
          </p>
        </div>
        <Button size="sm" variant="outline" icon="refresh" onClick={load} disabled={loading}>
          {loading ? "Loading..." : "Refresh Status"}
        </Button>
      </div>

      {toast && (
        <div className={`rounded-lg px-3 py-2 text-sm border ${toast.ok ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600" : "border-red-500/30 bg-red-500/10 text-red-600"}`}>
          {toast.msg}
        </div>
      )}

      {/* Live egress card */}
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <p className="text-xs text-text-muted">Current Egress IP</p>
            <p className="text-lg font-mono font-semibold">
              {egress.ip || "—"}
              {egress.isResidential === true && (
                <Badge variant="success" className="ml-2">Residential</Badge>
              )}
              {egress.isResidential === false && (
                <Badge variant="warning" className="ml-2">Safety-net fallback</Badge>
              )}
            </p>
          </div>
          <div>
            <p className="text-xs text-text-muted">Gateway</p>
            <p className="text-sm font-medium flex items-center gap-2">
              {gw.listening ? badge(true) : badge(false)}
              <span className="text-text-muted text-xs">{gw.engine || "not reachable"}</span>
            </p>
          </div>
          <div>
            <p className="text-xs text-text-muted">Upstream Pool</p>
            <p className="text-sm font-medium">{gw.alive ?? 0} alive / {gw.upstreams ?? 0} total</p>
          </div>
          <div>
            <p className="text-xs text-text-muted">API Latency</p>
            <p className="text-sm font-medium">{status?.responseMs ?? "—"} ms</p>
          </div>
        </div>
      </Card>

      {/* Actions */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Button
          icon="autorenew"
          onClick={() => act("refresh")}
          disabled={!!busy}
          className="justify-center bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/30 hover:bg-sky-500/20"
        >
          {busy === "refresh" ? "Injecting fresh IPs..." : "Inject Fresh Residential IPs"}
        </Button>
        <Button
          icon="bolt"
          onClick={() => act("probe")}
          disabled={!!busy}
          className="justify-center bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20"
        >
          {busy === "probe" ? "Probing..." : "Probe Egress Now"}
        </Button>
        <Button
          icon="restart_alt"
          onClick={() => act("restart")}
          disabled={!!busy}
          className="justify-center bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/30 hover:bg-violet-500/20"
        >
          {busy === "restart" ? "Restarting..." : "Restart Gateway"}
        </Button>
      </div>

      {/* Residential nodes */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px] text-emerald-500">home_work</span>
          Residential Nodes ({resiNodes.length})
        </h2>
        {resiNodes.length === 0 ? (
          <p className="text-xs text-text-muted py-3 text-center border border-dashed border-border rounded-lg">
            No residential nodes loaded. Click "Inject Fresh Residential IPs" to populate.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {resiNodes.map((n, i) => (
              <li key={i} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
                <span className="font-mono text-xs">{n.host}:{n.port}</span>
                <span className="flex items-center gap-3">
                  <span className="text-xs text-text-muted">{n.latency < 999 ? `${Math.round(n.latency)} ms` : "untested"}</span>
                  <span className="text-xs text-text-muted">ok {n.ok} / fail {n.fails}</span>
                  {badge(n.alive)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Safety-net (collapsed by design, last resort only) */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px] text-amber-500">shield</span>
          Safety-Net Fallback (only when ALL residential nodes die) ({fallbackNodes.length})
        </h2>
        <ul className="flex flex-col gap-2">
          {fallbackNodes.map((n, i) => (
            <li key={i} className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-sm">
              <span className="font-mono text-xs">{n.host}:{n.port}</span>
              <span className="flex items-center gap-3">
                <span className="text-xs text-text-muted">{n.kind}</span>
                {badge(n.alive)}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-text-muted mt-2">
          Requests always try residential first. These are used only if every residential node fails, so traffic never blackholes.
        </p>
      </Card>

      {/* Auto-injection info */}
      <Card className="p-4 bg-surface-2">
        <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <span className="material-symbols-outlined text-[16px] text-sky-500">medical_services</span>
          Automatic Injection (no manual action needed)
        </h2>
        <ul className="text-xs text-text-muted flex flex-col gap-1 list-disc pl-4">
          <li>Any request through a dead proxy is retried instantly through the rotating residential gateway with a fresh IP.</li>
          <li>Health watchdog (every 5 min) restarts the gateway and refreshes the pool if the egress dies.</li>
          <li>Fresh pool sync (every 15 min) rotates residential sessions and verifies each one with a live IP probe.</li>
          <li>Failed nodes quarantine for 15 s max — no request ever waits on a dead IP.</li>
        </ul>
      </Card>
    </div>
  );
}
