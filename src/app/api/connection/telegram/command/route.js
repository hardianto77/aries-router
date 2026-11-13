import { NextResponse } from "next/server";
import { getConnectionConfig } from "@/lib/db/repos/connectionRepo";
import { getProviderConnections, getProxyPools, getSettings } from "@/lib/localDb";
import { APP_CONFIG } from "@/shared/constants/config";
import { deleteProxyPools } from "@/models";

export const dynamic = "force-dynamic";

function formatUptime(seconds) {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

/**
 * Command dispatcher for Telegram Bot / external controllers
 * Supports both JSON response and pre-formatted Telegram Markdown text.
 */
export async function POST(request) {
  try {
    const config = await getConnectionConfig();
    const tgConfig = config.telegram || {};

    const authHeader = request.headers.get("authorization");
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    const body = await request.json().catch(() => ({}));
    const requestToken = body.token || bearerToken;
    const requestUserId = body.userId ? String(body.userId).trim() : null;

    // Security Verification:
    // If telegram bot integration is configured, require either matching bot token or matching userId
    if (tgConfig.botToken) {
      const tokenMatches = requestToken && requestToken === tgConfig.botToken;
      const userMatches = tgConfig.userId && requestUserId === String(tgConfig.userId).trim();

      // If caller provides neither a valid token nor an authorized userId, reject!
      if (!tokenMatches && !userMatches) {
        return NextResponse.json(
          { error: "Unauthorized: Invalid token or user ID" },
          { status: 401 }
        );
      }
    }

    const rawCommand = (body.command || body.text || "/status").trim();
    const parts = rawCommand.split(/\s+/);
    const cmd = parts[0].toLowerCase().replace(/^[/!]/, "");
    const args = parts.slice(1);

    switch (cmd) {
      case "start":
      case "help": {
        const text = `⚡ *Aries Bot Controller*
v${APP_CONFIG.version} · Control Panel

*Available Commands:*
• \`/status\` - Live system health, uptime & metrics
• \`/providers\` - List active providers & connections
• \`/pools\` - Check proxy pool health
• \`/prune\` - Delete dead proxies from pools
• \`/ping\` - Heartbeat probe
• \`/help\` - Show this command list

_Authorized for User ID: ${tgConfig.userId || "Any"}_`;

        return NextResponse.json({
          success: true,
          command: cmd,
          text,
        });
      }

      case "ping": {
        return NextResponse.json({
          success: true,
          command: "ping",
          text: `🏓 Pong! Aries is active (Uptime: ${formatUptime(process.uptime())})`,
        });
      }

      case "status": {
        const [connections, pools, settings] = await Promise.all([
          getProviderConnections().catch(() => []),
          getProxyPools().catch(() => []),
          getSettings().catch(() => ({})),
        ]);

        const activeConns = connections.filter((c) => c.isActive !== false);
        const livePools = pools.filter((p) => p.isActive !== false && p.testStatus !== "error");
        const memoryMb = (process.memoryUsage().rss / (1024 * 1024)).toFixed(1);

        const text = `📊 *Aries System Telemetry*
• *Version:* \`v${APP_CONFIG.version}\`
• *Uptime:* ${formatUptime(process.uptime())}
• *Memory:* ${memoryMb} MB RSS
• *Active Connections:* ${activeConns.length} / ${connections.length}
• *Proxy Pools:* ${livePools.length} live (${pools.length} total)
• *Cache Affinity:* ${settings.cacheAffinityEnabled !== false ? "ON" : "OFF"}
• *Model Bypass:* ${settings.kernelEnabled ? "ON" : "OFF"}`;

        return NextResponse.json({
          success: true,
          command: "status",
          data: {
            version: APP_CONFIG.version,
            uptime: process.uptime(),
            uptimeFormatted: formatUptime(process.uptime()),
            memoryMb: Number(memoryMb),
            connections: { active: activeConns.length, total: connections.length },
            proxyPools: { live: livePools.length, total: pools.length },
          },
          text,
        });
      }

      case "providers": {
        const connections = await getProviderConnections().catch(() => []);
        if (connections.length === 0) {
          return NextResponse.json({
            success: true,
            command: "providers",
            text: "ℹ️ No provider connections found in Aries.",
          });
        }

        const byProvider = {};
        for (const c of connections) {
          byProvider[c.provider] = byProvider[c.provider] || { active: 0, total: 0 };
          byProvider[c.provider].total++;
          if (c.isActive !== false) byProvider[c.provider].active++;
        }

        const lines = Object.entries(byProvider).map(
          ([p, counts]) => `• \`${p}\`: ${counts.active}/${counts.total} active`
        );

        const text = `🔌 *Active Provider Matrix*\n${lines.join("\n")}`;
        return NextResponse.json({
          success: true,
          command: "providers",
          data: byProvider,
          text,
        });
      }

      case "pools": {
        const pools = await getProxyPools().catch(() => []);
        const live = pools.filter((p) => p.isActive !== false && p.testStatus !== "error");
        const dead = pools.filter((p) => p.testStatus === "error");

        const text = `🌐 *Proxy Pool Status*
• *Total Proxies:* ${pools.length}
• *Live Proxies:* ${live.length}
• *Dead / Failed:* ${dead.length}

_Gunakan \`/prune\` untuk membersihkan proxy mati._`;

        return NextResponse.json({
          success: true,
          command: "pools",
          data: { total: pools.length, live: live.length, dead: dead.length },
          text,
        });
      }

      case "prune": {
        const [pools, connections] = await Promise.all([
          getProxyPools(),
          getProviderConnections(),
        ]);

        const boundIds = new Set(
          connections.map((c) => c?.providerSpecificData?.proxyPoolId).filter(Boolean)
        );

        const deadPools = pools.filter(
          (p) => !boundIds.has(p.id) && (p.testStatus === "error" || p.isActive === false)
        );

        if (deadPools.length === 0) {
          return NextResponse.json({
            success: true,
            command: "prune",
            deletedCount: 0,
            text: "✅ Pool bersih! Tidak ada proxy mati yang perlu di-prune.",
          });
        }

        const deadIds = deadPools.map((p) => p.id);
        const removed = await deleteProxyPools(deadIds);

        const text = `🧹 *Pruning Selesai!*\nBerhasil menghapus *${removed.length}* proxy mati dari pool.`;
        return NextResponse.json({
          success: true,
          command: "prune",
          deletedCount: removed.length,
          text,
        });
      }

      default: {
        return NextResponse.json({
          success: false,
          error: `Unknown command: /${cmd}`,
          text: `❓ Perintah tidak dikenal: \`/${cmd}\`\nKetik \`/help\` untuk melihat daftar perintah.`,
        });
      }
    }
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
