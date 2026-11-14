"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button, Input, Toggle, Badge } from "@/shared/components";
import { useNotificationStore } from "@/store/notificationStore";
import { cn } from "@/shared/utils/cn";

export default function ConnectionPageClient() {
  const addNotification = useNotificationStore((state) => state.addNotification);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showToken, setShowToken] = useState(false);

  // Form state
  const [enabled, setEnabled] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [userId, setUserId] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [autoWebhook, setAutoWebhook] = useState(true);
  const [botInfo, setBotInfo] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("idle");
  const [lastTestedAt, setLastTestedAt] = useState(null);
  const [publicBaseUrl, setPublicBaseUrl] = useState("");

  // Simulation console for @zphyrinee bot commands
  const [simCommand, setSimCommand] = useState("/status");
  const [simRunning, setSimRunning] = useState(false);
  const [simOutput, setSimOutput] = useState(null);

  const fetchConfig = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/connection");
      const json = await res.json();
      if (json.success && json.data) {
        const tg = json.data.telegram || {};
        setEnabled(tg.enabled || false);
        setBotToken(tg.botTokenMasked || "");
        setUserId(tg.userId || "");
        setWebhookUrl(tg.webhookUrl || "");
        setAutoWebhook(tg.autoWebhook !== false);
        setBotInfo(tg.botInfo || null);
        setConnectionStatus(tg.status || "idle");
        setLastTestedAt(tg.lastTestedAt || null);

        const hostOrigin = typeof window !== "undefined" ? window.location.origin : "";
        setPublicBaseUrl(json.data.system?.publicBaseUrl || hostOrigin);
      }
    } catch (err) {
      addNotification({
        type: "error",
        title: "Connection Error",
        message: err.message || "Failed to load connection settings",
      });
    } finally {
      setLoading(false);
    }
  }, [addNotification]);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const handleSave = async (e) => {
    e?.preventDefault();
    try {
      setSaving(true);
      const res = await fetch("/api/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          enabled,
          botToken,
          userId,
          webhookUrl,
          autoWebhook,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Failed to save connection settings");
      }

      addNotification({
        type: "success",
        title: "Settings Saved",
        message: "Pengaturan koneksi Telegram Bot berhasil disimpan.",
      });

      await fetchConfig();
    } catch (err) {
      addNotification({
        type: "error",
        title: "Save Failed",
        message: err.message,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    try {
      setTesting(true);
      const res = await fetch("/api/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test",
          botToken,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || "Test connection failed");
      }

      setBotInfo(json.botInfo);
      setConnectionStatus("connected");
      setLastTestedAt(new Date().toISOString());

      addNotification({
        type: "success",
        title: "Connection Verified",
        message: `Berhasil terhubung ke bot @${json.botInfo?.username} (${json.botInfo?.first_name || "Bot"})`,
      });
    } catch (err) {
      setConnectionStatus("error");
      addNotification({
        type: "error",
        title: "Connection Failed",
        message: err.message,
      });
    } finally {
      setTesting(false);
    }
  };

  const handleSimulateCommand = async () => {
    try {
      setSimRunning(true);
      setSimOutput(null);

      const res = await fetch("/api/connection/telegram/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: simCommand,
          userId,
          token: botToken,
        }),
      });

      const json = await res.json();
      setSimOutput(json.text || JSON.stringify(json, null, 2));
    } catch (err) {
      setSimOutput(`Error: ${err.message}`);
    } finally {
      setSimRunning(false);
    }
  };

  const derivedWebhook = webhookUrl || (publicBaseUrl ? `${publicBaseUrl}/api/connection/telegram/webhook` : "");

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6 max-w-5xl mx-auto w-full">
      {/* Hero Header */}
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 sm:p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg border border-brand-500/30 bg-brand-500/10 text-primary shadow-xs">
              <span className="material-symbols-outlined text-[24px]">hub</span>
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <h1 className="text-base font-bold text-text-main tracking-tight sm:text-lg">
                  Connection
                </h1>
                <span className={cn(
                  "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border",
                  enabled && connectionStatus === "connected"
                    ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                    : enabled
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                    : "bg-surface-2 border-border text-text-muted"
                )}>
                  <span className={cn(
                    "size-1.5 rounded-full",
                    enabled && connectionStatus === "connected" ? "bg-emerald-400 animate-pulse" : "bg-text-subtle"
                  )} />
                  {enabled && connectionStatus === "connected" ? "BOT ACTIVE" : enabled ? "CONFIGURED" : "DISABLED"}
                </span>
              </div>
              <p className="text-xs text-text-muted">
                Integrasi kontrol eksternal Aries via Telegram Bot dan automated pipeline.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              icon="refresh"
              onClick={fetchConfig}
              loading={loading}
              title="Refresh status"
            >
              Refresh
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon="save"
              onClick={handleSave}
              loading={saving}
              title="Save settings"
            >
              Save Changes
            </Button>
          </div>
        </div>
      </div>

      {/* Main Telegram Configuration Card */}
      <Card className="flex flex-col gap-5 p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg border border-border bg-surface-2 text-primary">
              <span className="material-symbols-outlined text-[20px]">smart_toy</span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-text-main">
                Telegram Bot Controller
              </span>
              <span className="text-xs text-text-muted">
                Hubungkan bot Telegram untuk full control Aries (status, metrics, provider, proxy pool).
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-text-muted">Aktifkan Bot:</span>
            <Toggle checked={enabled} onChange={() => setEnabled(!enabled)} />
          </div>
        </div>

        {/* Input Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-main flex items-center justify-between">
              <span>Telegram Bot Token</span>
              <button
                type="button"
                onClick={() => setShowToken(!showToken)}
                className="text-[11px] text-text-muted hover:text-text-main transition-colors flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">
                  {showToken ? "visibility_off" : "visibility"}
                </span>
                {showToken ? "Hide" : "Show"}
              </button>
            </label>
            <Input
              type={showToken ? "text" : "password"}
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="e.g. 7123456789:AAHk1234567890abcdef (dari @BotFather)"
              className="font-mono text-xs"
            />
            <span className="text-[11px] text-text-muted">
              Dapatkan bot token gratis dengan membuat bot baru di Telegram melalui <strong>@BotFather</strong>.
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-text-main">
              Admin User ID / Chat ID
            </label>
            <Input
              type="text"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              placeholder="e.g. 7515997355 (ID Telegram kamu)"
              className="font-mono text-xs"
            />
            <span className="text-[11px] text-text-muted">
              Hanya User ID Telegram ini yang memiliki otoritas menjalankan perintah full control.
            </span>
          </div>
        </div>

        {/* Webhook Endpoint Info */}
        <div className="flex flex-col gap-1.5 pt-2 border-t border-border/60">
          <label className="text-xs font-medium text-text-main">
            Webhook Endpoint (Auto-configured)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={derivedWebhook}
              className="w-full rounded-[6px] border border-border bg-surface-2 px-3 py-1.5 font-mono text-xs text-text-muted select-all focus:outline-none"
            />
          </div>
          <span className="text-[11px] text-text-muted">
            Telegram akan mengirimkan update pesan ke webhook ini secara otomatis saat webhook terdaftar.
          </span>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border">
          <div className="flex items-center gap-2">
            {botInfo && (
              <div className="flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-400 font-mono">
                <span className="material-symbols-outlined text-[15px]">check_circle</span>
                <span>@{botInfo.username} (ID: {botInfo.id})</span>
              </div>
            )}
            {lastTestedAt && !botInfo && (
              <span className="text-[11px] font-mono text-text-muted">
                Last checked: {new Date(lastTestedAt).toLocaleTimeString()}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              icon="wifi_find"
              onClick={handleTest}
              loading={testing}
              disabled={!botToken}
            >
              Test Connection
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              icon="save"
              onClick={handleSave}
              loading={saving}
            >
              Save Configuration
            </Button>
          </div>
        </div>
      </Card>

      {/* Developer & Bot Engine Specification (@zphyrinee integration) */}
      <Card className="flex flex-col gap-4 p-4 sm:p-6 bg-surface-2/40">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-[6px] border border-border bg-surface text-primary">
            <span className="material-symbols-outlined text-[18px]">terminal</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-semibold text-text-main">
              Bot Engine & Control API Spec (@zphyrinee Integration)
            </span>
            <span className="text-[11px] text-text-muted">
              Spesifikasi endpoint dan perintah siap pakai untuk bot Telegram eksternal.
            </span>
          </div>
        </div>

        {/* Command Reference Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-xs font-mono">
          <div className="rounded-[6px] border border-border bg-surface p-2.5">
            <div className="font-bold text-primary">/status</div>
            <div className="text-[11px] text-text-muted font-sans mt-0.5">
              Cek real-time metrics, RAM, uptime, dan active connections.
            </div>
          </div>
          <div className="rounded-[6px] border border-border bg-surface p-2.5">
            <div className="font-bold text-primary">/providers</div>
            <div className="text-[11px] text-text-muted font-sans mt-0.5">
              Daftar seluruh provider terhubung dan status aktif.
            </div>
          </div>
          <div className="rounded-[6px] border border-border bg-surface p-2.5">
            <div className="font-bold text-primary">/pools</div>
            <div className="text-[11px] text-text-muted font-sans mt-0.5">
              Lihat jumlah proxy pool hidup vs mati/timeout.
            </div>
          </div>
          <div className="rounded-[6px] border border-border bg-surface p-2.5">
            <div className="font-bold text-primary">/prune</div>
            <div className="text-[11px] text-text-muted font-sans mt-0.5">
              Bersihkan proxy mati dari pool secara instan.
            </div>
          </div>
          <div className="rounded-[6px] border border-border bg-surface p-2.5">
            <div className="font-bold text-primary">/ping</div>
            <div className="text-[11px] text-text-muted font-sans mt-0.5">
              Cek responsivitas gateway router.
            </div>
          </div>
          <div className="rounded-[6px] border border-border bg-surface p-2.5">
            <div className="font-bold text-primary">/help</div>
            <div className="text-[11px] text-text-muted font-sans mt-0.5">
              Tampilkan dokumentasi dan daftar perintah bot.
            </div>
          </div>
        </div>

        {/* Live Command Simulation Console */}
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 mt-1">
          <span className="text-xs font-medium text-text-main flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[15px] text-primary">play_arrow</span>
            Uji Coba Perintah Bot Langsung (Simulasi Output)
          </span>

          <div className="flex items-center gap-2">
            <select
              value={simCommand}
              onChange={(e) => setSimCommand(e.target.value)}
              className="rounded-[6px] border border-border bg-surface-2 px-2.5 py-1.5 font-mono text-xs text-text-main focus:border-primary focus:outline-none"
            >
              <option value="/status">/status</option>
              <option value="/providers">/providers</option>
              <option value="/pools">/pools</option>
              <option value="/prune">/prune</option>
              <option value="/ping">/ping</option>
              <option value="/help">/help</option>
            </select>
            <Button
              size="sm"
              variant="outline"
              icon="send"
              onClick={handleSimulateCommand}
              loading={simRunning}
            >
              Jalankan
            </Button>
          </div>

          {simOutput && (
            <div className="mt-2 rounded-[6px] border border-border-subtle bg-surface-2 p-3 font-mono text-xs text-text-main whitespace-pre-wrap">
              {simOutput}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
