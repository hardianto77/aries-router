import { NextResponse } from "next/server";
import { getConnectionConfig } from "@/lib/db/repos/connectionRepo";

export const dynamic = "force-dynamic";

/**
 * Telegram Webhook Handler
 * Receives incoming messages from Telegram, verifies caller identity against configured userId,
 * processes the command via the command engine, and replies back to the user.
 */
export async function POST(request) {
  try {
    const config = await getConnectionConfig();
    const tg = config.telegram || {};

    if (!tg.enabled || !tg.botToken) {
      return NextResponse.json({ ok: false, error: "Telegram bot not enabled" });
    }

    const update = await request.json().catch(() => null);
    if (!update || !update.message) {
      return NextResponse.json({ ok: true, ignored: true });
    }

    const { message } = update;
    const chatId = message.chat?.id;
    const fromId = message.from?.id;
    const text = (message.text || "").trim();

    if (!chatId || !text) {
      return NextResponse.json({ ok: true });
    }

    // Security check: Only allow the configured userId / adminId
    const configuredId = String(tg.userId || "").trim();
    if (configuredId) {
      const isAuthorized =
        String(fromId) === configuredId || String(chatId) === configuredId;

      if (!isAuthorized) {
        // Send unauthorized notice
        await fetch(`https://api.telegram.org/bot${tg.botToken}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: "⛔ *Akses Ditolak*\nAnda tidak memiliki otorisasi untuk mengontrol Aries ini.",
            parse_mode: "Markdown",
          }),
        }).catch(() => {});
        return NextResponse.json({ ok: true, authorized: false });
      }
    }

    // Execute command via internal API or direct dispatch
    const origin =
      process.env.PUBLIC_BASE_URL ||
      process.env.NEXT_PUBLIC_BASE_URL ||
      "http://127.0.0.1:8080";

    const cmdRes = await fetch(`${origin}/api/connection/telegram/command`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tg.botToken}`,
      },
      body: JSON.stringify({
        command: text,
        userId: fromId,
        token: tg.botToken,
      }),
    }).catch(() => null);

    let replyText = "⚠️ Gagal memproses perintah.";
    if (cmdRes && cmdRes.ok) {
      const resData = await cmdRes.json();
      replyText = resData.text || "Perintah dijalankan.";
    }

    // Send response back to Telegram
    await fetch(`https://api.telegram.org/bot${tg.botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: replyText,
        parse_mode: "Markdown",
      }),
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[Telegram Webhook] Error handling update:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
