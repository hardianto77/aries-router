import { NextResponse } from "next/server";
import { getConnectionConfig, setConnectionConfig } from "@/lib/db/repos/connectionRepo";
import { getSettings } from "@/lib/localDb";
import { APP_CONFIG } from "@/shared/constants/config";

function maskToken(token) {
  if (!token || typeof token !== "string") return "";
  if (token.length <= 10) return "••••••••••";
  return token.slice(0, 4) + "••••••••" + token.slice(-4);
}

export async function GET() {
  try {
    const config = await getConnectionConfig();
    const settings = await getSettings();

    const publicBaseUrl =
      process.env.PUBLIC_BASE_URL ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      process.env.BASE_URL ||
      "";

    return NextResponse.json({
      success: true,
      data: {
        telegram: {
          ...config.telegram,
          botTokenMasked: maskToken(config.telegram.botToken),
          hasToken: Boolean(config.telegram.botToken),
        },
        system: {
          name: APP_CONFIG.name,
          version: APP_CONFIG.version,
          publicBaseUrl,
          uptime: process.uptime(),
        },
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const action = body.action || "save";

    const currentConfig = await getConnectionConfig();

    if (action === "test") {
      const token = body.botToken?.trim() || currentConfig.telegram.botToken;
      if (!token) {
        return NextResponse.json(
          { success: false, error: "Bot token is required for testing" },
          { status: 400 }
        );
      }

      const res = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
        signal: AbortSignal.timeout(10000),
      });

      const data = await res.json();
      if (!data.ok) {
        return NextResponse.json(
          {
            success: false,
            error: data.description || "Failed to authenticate bot token with Telegram",
          },
          { status: 400 }
        );
      }

      const botInfo = {
        id: data.result.id,
        username: data.result.username,
        first_name: data.result.first_name,
        can_join_groups: data.result.can_join_groups,
      };

      await setConnectionConfig({
        telegram: {
          botInfo,
          status: "connected",
          lastTestedAt: new Date().toISOString(),
          lastError: null,
        },
      });

      return NextResponse.json({
        success: true,
        message: `Connected successfully to @${botInfo.username}`,
        botInfo,
      });
    }

    if (action === "set_webhook") {
      const token = currentConfig.telegram.botToken;
      const webhookUrl = body.webhookUrl?.trim();
      if (!token) {
        return NextResponse.json(
          { success: false, error: "Bot token is not configured" },
          { status: 400 }
        );
      }

      if (!webhookUrl) {
        // Delete webhook
        const delRes = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
          signal: AbortSignal.timeout(10000),
        });
        const delData = await delRes.json();
        return NextResponse.json({ success: delData.ok, data: delData });
      }

      const setRes = await fetch(
        `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`,
        { signal: AbortSignal.timeout(10000) }
      );
      const setData = await setRes.json();
      return NextResponse.json({ success: setData.ok, data: setData });
    }

    // Default: Save configuration
    const telegramPatch = {};
    if (typeof body.enabled === "boolean") telegramPatch.enabled = body.enabled;
    if (typeof body.userId === "string") telegramPatch.userId = body.userId.trim();
    if (typeof body.webhookUrl === "string") telegramPatch.webhookUrl = body.webhookUrl.trim();
    if (typeof body.autoWebhook === "boolean") telegramPatch.autoWebhook = body.autoWebhook;

    if (typeof body.botToken === "string") {
      const rawToken = body.botToken.trim();
      // If user typed a new token or cleared it
      if (rawToken && !rawToken.includes("••••")) {
        telegramPatch.botToken = rawToken;
      } else if (rawToken === "") {
        telegramPatch.botToken = "";
        telegramPatch.botInfo = null;
        telegramPatch.status = "idle";
      }
    }

    const updated = await setConnectionConfig({ telegram: telegramPatch });

    return NextResponse.json({
      success: true,
      data: {
        telegram: {
          ...updated.telegram,
          botTokenMasked: maskToken(updated.telegram.botToken),
          hasToken: Boolean(updated.telegram.botToken),
        },
      },
    });
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}
