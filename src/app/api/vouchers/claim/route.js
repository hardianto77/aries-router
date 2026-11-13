import { NextResponse } from "next/server";
import { audit } from "@/lib/auth/auditLog";
import { claimVoucher, getVoucherByCode, getActiveBansosVoucher } from "@/lib/localDb";
import { getClientIp } from "@/lib/auth/loginLimiter";
import { isKnownProxyIp } from "@/lib/security/proxyIpBlocker";
import {
  normalizeClientIp,
  verifyNetworkThrottle,
  verifyClientFingerprint,
  verifySubmissionIntegrity,
  mintChallenge,
  recordFailure,
  recordSuccess,
  acquireConcurrencyLock,
  releaseConcurrencyLock,
  clearAllLockouts,
} from "@/lib/security/antiAbuseEngine";

clearAllLockouts();

// GET /api/vouchers/claim -> checks if there is an active bansos pool, inspects specific code, and mints PoW challenge
export async function GET(request) {
  try {
    // Edge Proxy Gate: Enforce Cloudflare Edge for all external public traffic
    const host = request.headers.get("host") || "";
    const isLocal = host.startsWith("127.0.0.1") || host.startsWith("localhost");
    const cfRay = request.headers.get("cf-ray");
    if (!isLocal && !cfRay) {
      return NextResponse.json(
        { error: "Direct IP connection prohibited. Requests must route through Cloudflare Edge proxy." },
        { status: 403 }
      );
    }

    const cfIp = request.headers.get("cf-connecting-ip");
    const rawIp = (cfIp && cfIp.trim()) ? cfIp.trim() : (getClientIp(request) || "");
    const ip = normalizeClientIp(rawIp);

    // Naub: blokir IP proxy/VPN/datacenter/TOR — anti-farming
    if (await isKnownProxyIp(rawIp)) {
      recordFailure(ip);
      return NextResponse.json(
        { error: "Jaringan proxy/VPN terdeteksi. Klaim voucher hanya bisa dari jaringan regular.", code: "PROXY_IP_BLOCKED" },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");

    // Naub: throttle inspeksi kode — anti brute-force enumerasi voucher aktif
    const throttle = verifyNetworkThrottle(ip);
    if (!throttle.allowed) {
      return NextResponse.json({ error: throttle.error }, { status: throttle.status });
    }

    // Always mint PoW challenge for the client
    const challengeData = await mintChallenge(ip, code);

    // Check if client browser carries a persistent claim receipt in cookies
    let savedReceipt = null;
    const skipReceipt = searchParams.get("skipReceipt") === "1" || searchParams.get("reset") === "1";
    if (!skipReceipt) {
      const targetKey = code ? code.toUpperCase() : "BANSOS";
      // Only check the exact voucher code cookie when code is specified; do not fallback to xr_latest_receipt
      const cookieVal = code
        ? request.cookies.get(`xr_receipt_${targetKey}`)?.value
        : (request.cookies.get("xr_receipt_BANSOS")?.value || request.cookies.get("xr_latest_receipt")?.value);

      if (cookieVal) {
        try {
          const parsed = JSON.parse(decodeURIComponent(cookieVal));
          if (parsed && parsed.apiKey) {
            const expectedCode = (code || "BANSOS").toUpperCase();
            const receiptCode = (parsed.code || "BANSOS").toUpperCase();
            if (expectedCode === receiptCode) {
              const { getApiKeyById } = await import("@/lib/db/repos/apiKeysRepo.js");
              const existingKey = parsed.keyId ? await getApiKeyById(parsed.keyId) : null;
              if (existingKey && existingKey.isActive !== false) {
                savedReceipt = parsed;
              }
            }
          }
        } catch {}
      }
    }

    // If specific code inspection requested
    if (code) {
      const voucher = await getVoucherByCode(code);
      if (!voucher) {
        recordFailure(ip);
        return NextResponse.json({ error: "Voucher not found" }, { status: 404 });
      }

      const isAvailable = voucher.isActive && (voucher.maxUses === 0 || voucher.usedCount < voucher.maxUses);
      const remainingClaims = voucher.maxUses === 0 ? "Unlimited" : Math.max(0, voucher.maxUses - voucher.usedCount);
      // M7: expose only display-safe fields — never allocation economics / flags
      return NextResponse.json({
        voucher: {
          code: voucher.code,
          name: voucher.name,
          description: voucher.description,
          tokenLimit: voucher.tokenLimit,
          allowedModels: voucher.allowedModels,
          expiresInDays: voucher.expiresInDays,
          isAvailable,
          remainingClaims,
        },
        savedReceipt,
        challenge: challengeData,
      });
    }

    // Check for active community faucet
    const bansosVoucher = await getActiveBansosVoucher();
    return NextResponse.json({
      hasActiveBansos: !!bansosVoucher,
      bansos: bansosVoucher
        ? {
            name: bansosVoucher.name,
            description: bansosVoucher.description,
            tokenLimit: bansosVoucher.tokenLimit,
            allowedModels: bansosVoucher.allowedModels,
            expiresInDays: bansosVoucher.expiresInDays,
            remainingClaims: bansosVoucher.maxUses === 0 ? "Unlimited" : Math.max(0, bansosVoucher.maxUses - bansosVoucher.usedCount),
          }
        : null,
      savedReceipt,
      challenge: challengeData,
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/vouchers/claim -> Bulletproof Anti-Abuse Protected Claim Handler
export async function POST(request) {
  // Edge Proxy Gate: Enforce Cloudflare Edge for all external public traffic
  const host = request.headers.get("host") || "";
  const isLocal = host.startsWith("127.0.0.1") || host.startsWith("localhost");
  const cfRay = request.headers.get("cf-ray");
  if (!isLocal && !cfRay) {
    return NextResponse.json(
      { error: "Direct IP connection prohibited. Requests must route through Cloudflare Edge proxy." },
      { status: 403 }
    );
  }

  const cfIp = request.headers.get("cf-connecting-ip");
  const rawIp = (cfIp && cfIp.trim()) ? cfIp.trim() : (getClientIp(request) || "");
  const ip = normalizeClientIp(rawIp);
  const lockKey = `claim_lock:${ip}`;
  let hwLockKey = null;

  // Naub: blokir IP proxy/VPN/datacenter/TOR — anti-farming
  if (await isKnownProxyIp(rawIp)) {
    return NextResponse.json(
      { error: "Jaringan proxy/VPN terdeteksi. Klaim voucher hanya bisa dari jaringan regular.", code: "PROXY_IP_BLOCKED" },
      { status: 403 }
    );
  }

  // Concurrent Request Mutex Lock (prevents parallel race conditions per IP)
  if (!acquireConcurrencyLock(lockKey)) {
    return NextResponse.json(
      { error: "Another transaction from your network is currently in progress." },
      { status: 429 }
    );
  }

  try {
    // 1. Network & IP Integrity Checks
    const throttle = verifyNetworkThrottle(ip, true);
    if (!throttle.allowed) {
      return NextResponse.json({ error: throttle.error }, { status: throttle.status });
    }

    // 2. Client & Protocol Fingerprinting
    const clientCheck = verifyClientFingerprint(request);
    if (!clientCheck.valid) {
      recordFailure(ip);
      return NextResponse.json({ error: clientCheck.error }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));

    // 3. Behavioral, Proof-of-Work & Cryptographic Integrity (MANDATORY POW + TURNSTILE)
    const integrity = await verifySubmissionIntegrity(body, ip);
    if (!integrity.valid) {
      return NextResponse.json(
        { error: integrity.error, ...(integrity.code ? { code: integrity.code } : {}) },
        { status: integrity.status }
      );
    }

    let code = integrity.sanitizedCode;
    const isBansosRequest = body.isBansos === true || !code;
    const deviceFp = integrity.deviceFp;
    const hardwareFp = integrity.hardwareFp;

    // Concurrent Hardware Mutex Lock (prevents race conditions from multiple IPs with same hardware)
    if (hardwareFp) {
      hwLockKey = `claim_hw_lock:${hardwareFp}`;
      if (!acquireConcurrencyLock(hwLockKey)) {
        return NextResponse.json(
          { error: "Another transaction on this physical device is currently in progress." },
          { status: 429 }
        );
      }
    }

    // Resolve code for 1-Click Faucet
    if (isBansosRequest) {
      const bansosVoucher = await getActiveBansosVoucher();
      if (!bansosVoucher) {
        return NextResponse.json(
          { error: "No active community faucet slot available.", code: "NO_ACTIVE_FAUCET" },
          { status: 404 }
        );
      }
      code = bansosVoucher.code;
    }

    // 4. Database & Identity Quota Locking
    // Reclaim hands a stored API key back -> require possession of the issued
    // receipt cookie (never the client-asserted fingerprint alone).
    let receipt = null;
    const receiptRaw =
      request.cookies.get(`xr_receipt_${code.toUpperCase()}`)?.value ||
      request.cookies.get("xr_latest_receipt")?.value;
    if (receiptRaw) {
      try { receipt = JSON.parse(decodeURIComponent(receiptRaw)); } catch {}
    }
    const result = await claimVoucher(code, ip, deviceFp, hardwareFp, receipt);
    if (!result.success) {
      if (result.error === "VOUCHER_NOT_FOUND") {
        recordFailure(ip);
      }
      return NextResponse.json({ error: result.message, code: result.error }, { status: 400 });
    }

    recordSuccess(ip);

    // Determine Base URL
    const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "xrouter.consoleapi.qzz.io";
    const proto = request.headers.get("x-forwarded-proto") || (host.includes("localhost") || host.includes("127.0.0.1") ? "http" : "https");
    const baseUrl = `${proto}://${host}/v1`;

    const configs = {
      curl: `curl ${baseUrl}/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${result.apiKey}" \\
  -d '{"model": "${result.allowedModels === "*" ? "gpt-4o" : result.allowedModels.split(",")[0].trim()}", "messages": [{"role": "user", "content": "Hello!"}]}'`,

      python: `from openai import OpenAI

client = OpenAI(
    base_url="${baseUrl}",
    api_key="${result.apiKey}"
)

response = client.chat.completions.create(
    model="${result.allowedModels === "*" ? "gpt-4o" : result.allowedModels.split(",")[0].trim()}",
    messages=[{"role": "user", "content": "Hello Aries!"}]
)
print(response.choices[0].message.content)`,

      cursor: {
        apiUrl: baseUrl,
        apiKey: result.apiKey,
        instructions: "Paste into Cursor Settings -> Models -> OpenAI API Key & Base URL",
      },

      cline: {
        apiProvider: "openai",
        openAiBaseUrl: baseUrl,
        openAiApiKey: result.apiKey,
        openAiModelId: result.allowedModels === "*" ? "gpt-4o" : result.allowedModels.split(",")[0].trim(),
      },
    };

    const compactReceipt = {
      apiKey: result.apiKey,
      keyId: result.keyId,
      tokenLimit: result.tokenLimit,
      allowedModels: result.allowedModels,
      expiresAt: result.expiresAt,
      voucherName: result.voucherName,
      code: result.code,
      baseUrl,
    };

    audit("voucher.claim", { code: result.code || null, reclaimed: !!result.isReclaimed, ip });
    const response = NextResponse.json({
      success: true,
      isReclaimed: result.isReclaimed || false,
      ...compactReceipt,
      configs,
    });

    // Save lightweight compact cookie so refresh instantly restores the API key!
    const cookieKey = (result.code || "BANSOS").toUpperCase();
    const encodedReceipt = encodeURIComponent(JSON.stringify(compactReceipt));

    response.cookies.set(`xr_receipt_${cookieKey}`, encodedReceipt, {
      path: "/",
      maxAge: 31536000,
      httpOnly: false,
      sameSite: "lax",
    });

    response.cookies.set("xr_latest_receipt", encodedReceipt, {
      path: "/",
      maxAge: 31536000,
      httpOnly: false,
      sameSite: "lax",
    });

    return response;
  } catch (error) {
    console.error("Error executing bulletproof claim:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  } finally {
    releaseConcurrencyLock(lockKey);
    if (hwLockKey) releaseConcurrencyLock(hwLockKey);
  }
}
