import { NextResponse } from "next/server";
import { createProviderConnection } from "@/models";
import crypto from "node:crypto";
import fs from "node:fs";

const DEFAULT_FB_KEY = Buffer.from(
  "QUl6YVN5QVRaelg1RncySGpSMzRWeEIzVVFXVG1sanByQTV1WHFF",
  "base64"
).toString("utf-8");

function getFbKey() {
  return (process.env.ADCODE_FB_KEY || "").trim() || DEFAULT_FB_KEY;
}

function formatFirebaseError(code, message) {
  if (!message) return "Terjadi kesalahan saat otentikasi ADCode.";
  const msg = String(message).toUpperCase();
  if (msg.includes("API KEY NOT VALID") || msg.includes("API_KEY_INVALID")) {
    return "Konfigurasi server Firebase Web Key tidak valid. Hubungi administrator.";
  }
  if (msg.includes("EMAIL_NOT_FOUND")) {
    return "Email tidak ditemukan. Silakan buat akun baru di tab Daftar.";
  }
  if (msg.includes("INVALID_PASSWORD") || msg.includes("INVALID_LOGIN_CREDENTIALS")) {
    return "Password salah atau kredensial tidak valid.";
  }
  if (msg.includes("EMAIL_EXISTS")) {
    return "Email sudah terdaftar. Silakan gunakan menu Login.";
  }
  if (msg.includes("OPERATION_NOT_ALLOWED")) {
    return "Metode login email/password belum diaktifkan di project Firebase ini.";
  }
  if (msg.includes("TOO_MANY_ATTEMPTS_TRY_LATER")) {
    return "Terlalu banyak percobaan gagal. Silakan tunggu beberapa saat.";
  }
  if (msg.includes("WEAK_PASSWORD")) {
    return "Password terlalu lemah. Minimal 6 karakter.";
  }
  if (msg.includes("INVALID_EMAIL")) {
    return "Format email tidak valid.";
  }
  if (msg.includes("INVALID_REFRESH_TOKEN")) {
    return "Refresh token tidak valid atau sudah kadaluarsa.";
  }
  return message;
}

/**
 * ADCode Authentication Endpoint
 * POST /api/oauth/adcode
 * Actions: "login", "register", "token"
 */
export async function POST(request) {
  try {
    const fbKey = getFbKey();
    if (!fbKey) {
      return NextResponse.json(
        { error: "Server belum dikonfigurasi dengan ADCODE_FB_KEY di /etc/xrouter/adcode.env" },
        { status: 500 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const action = body.action || "login";

    if (action === "login") {
      const email = String(body.email || "").trim();
      const password = String(body.password || "").trim();

      if (!email || !password) {
        return NextResponse.json(
          { error: "Email dan password wajib diisi." },
          { status: 400 }
        );
      }

      const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${fbKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, returnSecureToken: true }),
        }
      );

      const data = await res.json();
      if (!res.ok || !data.refreshToken) {
        const errMsg = formatFirebaseError(res.status, data.error?.message);
        return NextResponse.json({ error: errMsg }, { status: res.status >= 400 ? res.status : 400 });
      }

      const connection = await createProviderConnection({
        provider: "adcode",
        authType: "oauth",
        name: `ADCode (${data.email || email})`,
        email: data.email || email,
        apiKey: data.refreshToken,
        providerSpecificData: {
          refreshToken: data.refreshToken,
          idToken: data.idToken,
          localId: data.localId,
          email: data.email || email,
          method: "password_login",
          connectedAt: new Date().toISOString(),
        },
        testStatus: "active",
        isActive: true,
      });

      return NextResponse.json({
        success: true,
        connection: {
          id: connection.id,
          name: connection.name,
          email: connection.email,
        },
      });
    }

    if (action === "register") {
      const email = String(body.email || "").trim();
      const password = String(body.password || "").trim();

      if (!email || !password) {
        return NextResponse.json(
          { error: "Email dan password wajib diisi." },
          { status: 400 }
        );
      }

      if (password.length < 6) {
        return NextResponse.json(
          { error: "Password minimal 6 karakter." },
          { status: 400 }
        );
      }

      const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${fbKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, returnSecureToken: true }),
        }
      );

      const data = await res.json();
      if (!res.ok || !data.refreshToken) {
        const errMsg = formatFirebaseError(res.status, data.error?.message);
        return NextResponse.json({ error: errMsg }, { status: res.status >= 400 ? res.status : 400 });
      }

      // Automatically trigger email verification so user receives verification link in inbox
      let verificationSent = false;
      try {
        if (data.idToken) {
          const oobRes = await fetch(
            `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${fbKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ requestType: "VERIFY_EMAIL", idToken: data.idToken }),
            }
          );
          verificationSent = oobRes.ok;
        }
      } catch (oobErr) {
        console.warn("[ADCode Auth] sendOobCode error:", oobErr.message);
      }

      const connection = await createProviderConnection({
        provider: "adcode",
        authType: "oauth",
        name: `ADCode (${data.email || email})`,
        email: data.email || email,
        apiKey: data.refreshToken,
        providerSpecificData: {
          refreshToken: data.refreshToken,
          idToken: data.idToken,
          localId: data.localId,
          email: data.email || email,
          method: "password_register",
          verificationSent,
          connectedAt: new Date().toISOString(),
        },
        testStatus: "active",
        isActive: true,
      });

      return NextResponse.json({
        success: true,
        verificationSent,
        message: verificationSent
          ? "Akun berhasil dibuat! Link verifikasi telah dikirim ke email Anda. Buka email dan klik link tersebut agar kuota model AI aktif."
          : "Akun berhasil dibuat dan terkoneksi.",
        connection: {
          id: connection.id,
          name: connection.name,
          email: connection.email,
        },
      });
    }

    if (action === "token") {
      const token = String(body.token || "").trim();
      if (!token) {
        return NextResponse.json({ error: "Token wajib diisi." }, { status: 400 });
      }

      // If it's a refresh token, verify against securetoken API
      let verifiedEmail = "Imported Token";
      if (!token.startsWith("eyJ")) {
        const verifyRes = await fetch(
          `https://securetoken.googleapis.com/v1/token?key=${fbKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(token)}`,
          }
        );
        const verifyData = await verifyRes.json();
        if (!verifyRes.ok || !verifyData.id_token) {
          const errMsg = formatFirebaseError(verifyRes.status, verifyData.error?.message);
          return NextResponse.json({ error: errMsg }, { status: 400 });
        }
        if (verifyData.user_id) {
          verifiedEmail = `User ${verifyData.user_id.slice(0, 8)}`;
        }
      }

      const connection = await createProviderConnection({
        provider: "adcode",
        authType: "oauth",
        name: `ADCode (${verifiedEmail})`,
        email: verifiedEmail,
        apiKey: token,
        providerSpecificData: {
          refreshToken: token,
          method: "token_import",
          connectedAt: new Date().toISOString(),
        },
        testStatus: "active",
        isActive: true,
      });

      return NextResponse.json({
        success: true,
        connection: {
          id: connection.id,
          name: connection.name,
          email: connection.email,
        },
      });
    }

    return NextResponse.json({ error: "Action tidak dikenal." }, { status: 400 });
  } catch (error) {
    console.error("[ADCode Auth] Unexpected error:", error);
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 });
  }
}
