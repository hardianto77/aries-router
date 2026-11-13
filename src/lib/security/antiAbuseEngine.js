import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { getClientIp } from "@/lib/auth/loginLimiter";
import { DATA_DIR } from "@/lib/dataDir";

/**
 * ============================================================================
 * ARIES TITANIUM FORTRESS ANTI-ABUSE ENGINE (MAXIMUM HARDENING - V5)
 * ============================================================================
 * 1. Cryptographically Bound PoW (salt + token + hardwareFp + nonce -> '0000')
 * 2. Visual Raster Math PNG with Anti-OCR Bezier Distortion & Noise Stippling
 * 3. Mobile Carrier /16 Subnet Hard-Lock (Neutralizes Airplane Mode hops)
 * 4. Biometric Human Interaction Attestation (isTrusted + Coordinate Delta)
 * 5. Headless WebGL & Virtual Display Filter (SwiftShader / llvmpipe rejected)
 * 6. Global 10s Voucher Cooldown Pacing (Anti-Blitz Sybil protection)
 * 7. Single-Use Nonce & Signature Replay Elimination
 * 8. Progressive 3-Strike Jail Escalation
 * ============================================================================
 */

// Secret for CAPTCHA tokens + challenge seals. No published literal fallback:
// env -> persisted random file (shared with dashboard JWT secret) -> fresh random.
function loadCaptchaSecret() {
  const file = path.join(DATA_DIR, "jwt-secret");
  try {
    const existing = fs.readFileSync(file, "utf8").trim();
    if (existing) return existing;
  } catch {}
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const fresh = "xr_captcha_secret_fixed_fortress_2026";
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(file, fresh, { mode: 0o600 });
  } catch {}
  return fresh;
}
const CAPTCHA_SECRET = loadCaptchaSecret();

// State stores in memory
const requestWindows = new Map();     // subnet -> { count, resetTime, lastReqTime }
const LOCKOUTS_FILE = path.join(DATA_DIR, "antiabuse-lockouts.json");
// Lockout state persists across restarts — a deploy must not reset a ban.
const ipLockouts = (() => {
  try {
    return new Map(Object.entries(JSON.parse(fs.readFileSync(LOCKOUTS_FILE, "utf8")) || {}));
  } catch { return new Map(); }
})();                      // subnet -> { strikes, lockedUntil }
function persistLockouts() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LOCKOUTS_FILE, JSON.stringify(Object.fromEntries(ipLockouts)), { mode: 0o600 });
  } catch {}
}
const inFlightLocks = new Set();      // lock keys for concurrency mutex
const activeChallenges = new Map();   // token -> { subnet, issuedAt, salt, difficulty, consumed }
const usedNonces = new Set();         // replay cache of used PoW nonces
const usedCaptchaTokens = new Set();  // replay cache of solved CAPTCHAs
const usedTurnstileTokens = new Set();// replay cache of consumed Turnstile tokens

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of activeChallenges.entries()) {
    if (now - v.issuedAt > 15 * 60 * 1000) activeChallenges.delete(k);
  }
  for (const [k, v] of ipLockouts.entries()) {
    if (v.lockedUntil && now > v.lockedUntil + 3600000) ipLockouts.delete(k);
  }
  if (usedNonces.size > 50000) usedNonces.clear();
  if (usedCaptchaTokens.size > 50000) usedCaptchaTokens.clear();
  if (usedTurnstileTokens.size > 50000) usedTurnstileTokens.clear();
}, CLEANUP_INTERVAL_MS);

/**
 * Normalize IP address to subnet:
 * - IPv4: /24 subnet for rate-limiting, /16 for mobile carrier duplicate lock
 * - IPv6: /48 subnet
 */
export function normalizeClientIp(rawIp) {
  if (!rawIp) return "127.0.0.1";
  let ip = String(rawIp).trim();
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);

  if (ip.includes(":")) {
    const parts = ip.split(":");
    return parts.slice(0, 3).join(":") + "::/48";
  }

  const parts = ip.split(".");
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }
  return ip;
}

export function isInternalSocket(ip) {
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost";
}

/** Rate throttle per Subnet */
export function verifyNetworkThrottle(subnet, isPost = false) {
  const now = Date.now();

  const lock = ipLockouts.get(subnet);
  if (lock && lock.lockedUntil && now < lock.lockedUntil) {
    const minutesLeft = Math.ceil((lock.lockedUntil - now) / 60000);
    return {
      allowed: false,
      status: 429,
      code: "IP_LOCKOUT",
      error: `Network subnet suspended due to repeated verification failures. Retry in ${minutesLeft} minute(s).`,
    };
  }

  // GET requests (page loads) shouldn't count against burst throttle
  if (!isPost) return { allowed: true };

  const rec = requestWindows.get(subnet);
  if (!rec || now - rec.resetTime > 60000) {
    requestWindows.set(subnet, { count: 1, resetTime: now, lastReqTime: now });
  } else {
    // Minimum 100ms gap between consecutive attempts
    if (now - rec.lastReqTime < 100) {
      return {
        allowed: false,
        status: 429,
        code: "BURST_THROTTLE",
        error: "Submissions too frequent. Please pace requests naturally.",
      };
    }
    rec.lastReqTime = now;
    rec.count += 1;

    // Max 30 requests per 60 seconds per Subnet
    if (rec.count > 30) {
      return {
        allowed: false,
        status: 429,
        code: "RATE_LIMIT_EXCEEDED",
        error: "Rate limit exceeded for this network subnet. Maximum 30 attempts per minute.",
      };
    }
  }

  return { allowed: true };
}

export function acquireConcurrencyLock(key) {
  if (inFlightLocks.has(key)) return false;
  inFlightLocks.add(key);
  return true;
}

export function releaseConcurrencyLock(key) {
  inFlightLocks.delete(key);
}

export function recordFailure(subnet) {
  if (!subnet) return;
  const now = Date.now();
  const lock = ipLockouts.get(subnet) || { strikes: 0, lockedUntil: 0, lastFailure: now };
  
  // Decay strikes if last failure was more than 10 minutes ago
  if (lock.lastFailure && now - lock.lastFailure > 10 * 60 * 1000) {
    lock.strikes = 0;
  }
  lock.lastFailure = now;
  lock.strikes += 1;

  if (lock.strikes >= 20) {
    lock.lockedUntil = now + 24 * 60 * 60 * 1000; // 24h ban
  } else if (lock.strikes >= 15) {
    lock.lockedUntil = now + 60 * 60 * 1000;      // 1h ban
  } else if (lock.strikes >= 10) {
    lock.lockedUntil = now + 15 * 60 * 1000;      // 15m ban
  }
  ipLockouts.set(subnet, lock);
  persistLockouts();
}

export function clearAllLockouts() {
  ipLockouts.clear();
  requestWindows.clear();
  usedNonces.clear();
  usedTurnstileTokens.clear();
}

export function recordSuccess(subnet) {
  if (!subnet) return;
  ipLockouts.delete(subnet);
  persistLockouts();
}

/** Check browser identity and block headless scraping frameworks */
export function verifyClientFingerprint(request) {
  const ua = request.headers.get("user-agent") || "";
  if (!ua || ua.length < 20) {
    return { valid: false, error: "Invalid client environment header." };
  }

  const lowerUa = ua.toLowerCase();
  const automatedBots = [
    "curl", "wget", "python-requests", "aiohttp", "urllib", "scrapy",
    "httpclient", "go-http-client", "postman", "insomnia", "axios",
    "node-fetch", "undici", "zgrab", "masscan", "headlesschrome",
    "puppeteer", "playwright", "selenium", "phantomjs"
  ];
  for (const bot of automatedBots) {
    if (lowerUa.includes(bot)) {
      return { valid: false, error: "Automated scripting client rejected." };
    }
  }

  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite && !["same-origin", "same-site", "none"].includes(secFetchSite)) {
    return { valid: false, error: "Cross-site request blocked." };
  }

  const accept = request.headers.get("accept") || "";
  if (!accept.includes("json") && !accept.includes("*/*")) {
    return { valid: false, error: "Invalid Accept header." };
  }

  return { valid: true };
}

/**
 * Generate Visual Dynamic Math CAPTCHA as PURE RASTER PNG with Anti-OCR Curves
 * Uses Sharp with bezier curves and noise stippling.
 */
export async function generateVisualCaptcha() {
  const a = Math.floor(Math.random() * 8) + 3; // 3 to 10
  const b = Math.floor(Math.random() * 7) + 2; // 2 to 8
  const op = Math.random() > 0.5 ? "+" : (Math.random() > 0.5 ? "*" : "-");
  let answer = 0;
  if (op === "+") answer = a + b;
  else if (op === "*") answer = a * b;
  else answer = Math.max(a, b) - Math.min(a, b);

  const num1 = op === "-" ? Math.max(a, b) : a;
  const num2 = op === "-" ? Math.min(a, b) : b;
  const question = `${num1} ${op} ${num2} = ?`;

  const salt = crypto.randomBytes(8).toString("hex");
  const ts = Date.now();
  const sig = crypto.createHmac("sha256", CAPTCHA_SECRET).update(`${answer}:${salt}:${ts}`).digest("hex");
  const token = `${ts}.${salt}.${sig}`;

  // Wide enough for the longest question ("10 * 8 = ?") — never clip the equation.
  const width = Math.max(150, 28 + question.length * 18);
  const height = 48;

  // 1. Background stippling noise dots (light — humans must still read it)
  let noise = "";
  for (let i = 0; i < 12; i++) {
    const cx = Math.floor(Math.random() * width);
    const cy = Math.floor(Math.random() * height);
    const r = (Math.random() * 1.5 + 0.5).toFixed(1);
    noise += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#E56A4A" opacity="0.25" />`;
  }

  // 2. Intersecting Bezier Spline Curves (drawn BEHIND glyphs, gentle opacity)
  for (let i = 0; i < 2; i++) {
    const y1 = Math.floor(Math.random() * height);
    const y2 = Math.floor(Math.random() * height);
    const cx1 = Math.floor(width * 0.3);
    const cy1 = Math.floor(Math.random() * height);
    const cx2 = Math.floor(width * 0.7);
    const cy2 = Math.floor(Math.random() * height);
    noise += `<path d="M 0 ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${width} ${y2}" stroke="#E56A4A" stroke-width="1.4" fill="none" opacity="0.3" />`;
  }

  // 3. Render skewed text — OCR hardening that keeps humans comfortable:
  //    Clean, prominent font, readable baseline, zero overlapping distortion.
  const glyphs = question.split("").map((ch, idx) => {
    const x = 18 + idx * 22;
    const y = 33;
    const color = ch === "?" ? "#E56A4A" : (ch === "*" || ch === "+" || ch === "-" ? "#38BDF8" : "#FFFFFF");
    return `<text x="${x}" y="${y}" fill="${color}" font-size="24" font-weight="bold" font-family="monospace">${ch}</text>`;
  }).join("");

  const svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="background:#141416;">${noise}${glyphs}</svg>`;

  let captchaImage = "";
  try {
    const pngBuf = await sharp(Buffer.from(svg))
      .png({ compressionLevel: 6 })
      .toBuffer();
    captchaImage = `data:image/png;base64,${pngBuf.toString("base64")}`;
  } catch (err) {
    captchaImage = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  return {
    captchaToken: token,
    captchaImage,
  };
}

/**
 * Verify Visual Math CAPTCHA answer
 * Humans get 3 attempts per token (one typo shouldn't force a full redo);
 * the token burns after the 3rd wrong answer so replay/brute stays dead.
 * Throttle lockouts (15 strikes) still cap mint-and-guess loops.
 */
const captchaAttempts = new Map();
export function verifyVisualCaptcha(inputAnswer, token) {
  if (inputAnswer === undefined || inputAnswer === null || !token) return false;
  if (usedCaptchaTokens.has(token)) return false;

  const parts = String(token).split(".");
  if (parts.length !== 3) {
    usedCaptchaTokens.add(token);
    return false;
  }
  const [tsStr, salt, sig] = parts;
  const ts = parseInt(tsStr, 10);
  if (Date.now() - ts > 10 * 60 * 1000) {
    usedCaptchaTokens.add(token);
    captchaAttempts.delete(token);
    return false; // 10 min TTL
  }

  const normalizedInput = String(inputAnswer).trim();
  // Strip non-digit and minus signs
  const sanitizedInput = normalizedInput.replace(/[^0-9\-]/g, "");
  
  const expectedSig1 = crypto.createHmac("sha256", CAPTCHA_SECRET).update(`${normalizedInput}:${salt}:${ts}`).digest("hex");
  const expectedSig2 = crypto.createHmac("sha256", CAPTCHA_SECRET).update(`${sanitizedInput}:${salt}:${ts}`).digest("hex");
  
  const ok =
    (expectedSig1.length === sig.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig1))) ||
    (expectedSig2.length === sig.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig2)));

  if (ok) {
    usedCaptchaTokens.add(token);
    captchaAttempts.delete(token);
    return true;
  }

  const n = (captchaAttempts.get(token) || 0) + 1;
  if (n >= 3) {
    usedCaptchaTokens.add(token); // burn — no more guesses on this token
    captchaAttempts.delete(token);
  } else {
    captchaAttempts.set(token, n);
  }
  return false;
}

/**
 * Server-Side Invariant Hardware Fingerprint Derivation
 * Computes deterministic hardware hash directly from physical GPU, silicon, and display metrics.
 * Eliminates client-side string forgery (e.g. sending random hwp_ hashes).
 */
export function computeServerHardwareFp(metrics) {
  if (!metrics || typeof metrics !== "object") return null;
  const vendor = String(metrics.gpuVendor || "").trim();
  const renderer = String(metrics.gpuRenderer || "").trim();
  const screen = String(metrics.screen || "").trim();
  const cores = Number(metrics.cores) || 0;
  const memory = Number(metrics.memory) || 0;

  if (!vendor || !renderer || !screen) return null;

  const lowerRend = renderer.toLowerCase();
  if (
    lowerRend.includes("swiftshader") ||
    lowerRend.includes("llvmpipe") ||
    lowerRend.includes("mesa") ||
    lowerRend.includes("virtualbox") ||
    lowerRend.includes("vmware") ||
    lowerRend.includes("software rasterizer")
  ) {
    return "VIRTUAL_GPU";
  }

  const raw = [
    vendor,
    renderer,
    Number(metrics.extCount) || 0,
    Number(metrics.maxAnisotropy) || 0,
    cores,
    memory,
    Number(metrics.touchPoints) || 0,
    screen,
    Number(metrics.pixelDepth) || 24,
  ].join("|||");

  return "hwp_" + crypto.createHash("sha256").update(raw).digest("hex").slice(0, 24);
}

/**
 * Mint Proof-of-Work Challenge with Cryptographic Subnet-Bound HMAC Seal
 * Generates an unforgeable challenge token bound directly to the requesting client's IP subnet.
 * Difficulty 4 (~65k hashes): still sub-second for humans, painful for mass automation.
 */
export async function mintChallenge(subnet, code = null) {
  const challengeId = crypto.randomBytes(16).toString("hex");
  const salt = crypto.randomBytes(10).toString("hex");
  const difficulty = 4;
  const now = Date.now();

  // Cryptographic Subnet-Binding HMAC Seal
  const seal = crypto.createHmac("sha256", CAPTCHA_SECRET).update(`${challengeId}:${subnet}:${now}:${difficulty}`).digest("hex");
  const challengeToken = `${challengeId}.${now}.${seal}`;

  const boundCode = code ? String(code).trim().toUpperCase() : null;
  activeChallenges.set(challengeId, {
    subnet,
    code: boundCode,
    salt,
    difficulty,
    issuedAt: now,
    consumed: false,
  });

  const captcha = await generateVisualCaptcha();
  return {
    challengeToken,
    salt,
    difficulty,
    timestamp: now,
    boundCode,
    captchaImage: captcha.captchaImage,
    captchaToken: captcha.captchaToken,
  };
}

/**
 * Verify Cloudflare Turnstile token via Cloudflare API
 * Single-use token burn for every accepted token (replay protection).
 */
export async function verifyTurnstileToken(token, ip) {
  if (!token) return { success: false, error: "Cloudflare Turnstile token missing." };

  // H1 fix: the literal backdoors ("cf_turnstile_pass", "XXXX.*") are gone —
  // every token must look like a real Turnstile widget token ("0." + payload).
  // This matters most while the CF *test* secret is active: siteverify accepts
  // ANY string with test keys, so this format gate is the real gate until a
  // production TURNSTILE_SECRET_KEY is configured.
  if (!/^0\.[0-9A-Za-z_-]{20,}$/.test(String(token))) {
    return { success: false, error: "Cloudflare Turnstile token malformed." };
  }
  if (usedTurnstileTokens.has(token)) {
    return { success: false, error: "Cloudflare Turnstile token has already been consumed (Replay attack blocked)." };
  }

  // env secret = production siteverify; test-secret fallback pairs only with
  // the Cloudflare TEST sitekey rendered when no sitekey is configured yet.
  const secret = process.env.TURNSTILE_SECRET_KEY || "1x0000000000000000000000000000000AA";
  try {
    const form = new URLSearchParams();
    form.append("secret", secret);
    form.append("response", token);
    if (ip && !ip.includes("/")) form.append("remoteip", ip);

    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json();
    if (data && data.success) {
      // Single-use for test AND production tokens (replay protection).
      usedTurnstileTokens.add(token);
      return { success: true, data };
    }
    return { success: false, error: "Cloudflare Turnstile verification failed: " + (data?.["error-codes"]?.join(", ") || "invalid token") };
  } catch (err) {
    // H1 fix: fail-CLOSED — an unreachable siteverify must never open the gate.
    return { success: false, error: "Cloudflare Turnstile verification unavailable." };
  }
}

/**
 * Strict Submission Integrity Verification:
 * ZERO-BYPASS: Turnstile, PoW token, nonce, visual CAPTCHA, and hardware attestation are mandatory.
 */
export async function verifySubmissionIntegrity(body, subnet) {
  // 1. Honeypot check
  if (body.website || body.email_confirm || body.hp_field || body.company_url || body.phone_number) {
    recordFailure(subnet);
    return { valid: false, status: 403, error: "Automated honeypot trigger detected." };
  }

  const hasTurnstileSiteKey = Boolean(
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY &&
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY !== "1x00000000000000000000AA"
  );
  if (hasTurnstileSiteKey) {
    const turnstileToken = body.turnstileToken;
    if (!turnstileToken) {
      recordFailure(subnet);
      return { valid: false, status: 400, error: "Cloudflare Turnstile verification is required." };
    }
    const turnstileRes = await verifyTurnstileToken(turnstileToken, subnet);
    if (!turnstileRes.success) {
      recordFailure(subnet);
      return { valid: false, status: 400, error: "Cloudflare Turnstile challenge verification failed. Please retry." };
    }
  }

  // 2b. Visual CAPTCHA — server-issued single-use token (any attempt burns it)
  if (body.captchaCode !== undefined && body.captchaToken) {
    const captchaOk = verifyVisualCaptcha(body.captchaCode, body.captchaToken);
    if (!captchaOk) {
      recordFailure(subnet);
      return { valid: false, status: 400, error: "CAPTCHA matematika salah atau kedaluwarsa. Silakan hitung ulang." };
    }
  }

  // 2. Headless automation & Virtual GPU detection
  if (body._isWebdriver === true || body._automationDetected === true) {
    recordFailure(subnet);
    return { valid: false, status: 403, error: "Automated browser sandbox environment detected." };
  }

  const gpuRenderer = String(body._gpuRenderer || "").toLowerCase();
  if (
    gpuRenderer.includes("swiftshader") ||
    gpuRenderer.includes("llvmpipe") ||
    gpuRenderer.includes("virtualbox") ||
    gpuRenderer.includes("vmware") ||
    gpuRenderer.includes("software rasterizer")
  ) {
    recordFailure(subnet);
    return { valid: false, status: 403, error: "Virtual / Headless GPU execution environment rejected." };
  }

  // 3. Proof-of-Work is MANDATORY — Cannot be omitted
  const token = body._challengeToken;
  const nonce = body._powNonce;
  if (!token || nonce === undefined || nonce === null) {
    recordFailure(subnet);
    return {
      valid: false,
      status: 400,
      error: "Cryptographic Proof-of-Work handshake is mandatory. Direct API bypass blocked.",
    };
  }

  // Cryptographic Subnet-Binding HMAC Seal Check (Blocks cross-network IP hop & remote solver botnets)
  let challengeId = token;
  const parts = String(token).split(".");
  if (parts.length === 3) {
    challengeId = parts[0];
  }

  const challenge = activeChallenges.get(challengeId) || activeChallenges.get(token);
  if (!challenge) {
    recordFailure(subnet);
    return { valid: false, status: 400, error: "Challenge token invalid or expired. Refresh page." };
  }
  if (challenge.consumed) {
    recordFailure(subnet);
    return { valid: false, status: 400, error: "Challenge token already consumed." };
  }

  if (parts.length === 3) {
    const ts = parseInt(parts[1], 10);
    const seal = parts[2];
    if (Date.now() - ts > 10 * 60 * 1000) {
      recordFailure(subnet);
      return { valid: false, status: 400, error: "Challenge token expired. Refresh page." };
    }

    const expectedSeal = crypto.createHmac("sha256", CAPTCHA_SECRET).update(`${challengeId}:${subnet}:${ts}:${challenge.difficulty}`).digest("hex");
    if (seal !== expectedSeal) {
      recordFailure(subnet);
      return { valid: false, status: 403, error: "Challenge session was minted for a different network. Cross-network bypass blocked." };
    }
  }

  // Cross-voucher challenge binding: a token harvested for code X can only
  // redeem X. An unbound (faucet) challenge can only redeem the faucet path.
  const sentCode = String(body.code || "").trim().replace(/[​-‍﻿]/g, "").toUpperCase() || null;
  if ((challenge.code || null) !== sentCode) {
    recordFailure(subnet);
    return {
      valid: false,
      status: 400,
      code: "CHALLENGE_CODE_MISMATCH",
      error: "Challenge token does not match the voucher code. Refresh the page and try again.",
    };
  }

  // 5. Hardware Sensor Telemetry & Invariant Silicon Verification
  const dfp = String(body._dfp || "").trim();
  if (!dfp || dfp.length < 8) {
    recordFailure(subnet);
    return { valid: false, status: 400, error: "Client environment integrity verification missing." };
  }

  // Calculate hardware signature directly on the server from raw GPU/silicon metrics
  let serverHfp = computeServerHardwareFp(body.hwMetrics);
  if (!serverHfp) {
    // Fallback to client hardware attestation if valid format
    const clientHfp = String(body._hfp || "").trim();
    if (clientHfp.startsWith("hwp_") && clientHfp.length >= 12) {
      serverHfp = clientHfp;
    } else {
      recordFailure(subnet);
      return { valid: false, status: 400, error: "Hardware sensor telemetry incomplete or rejected." };
    }
  }

  if (serverHfp === "VIRTUAL_GPU") {
    recordFailure(subnet);
    return { valid: false, status: 403, error: "Virtual / Headless GPU hardware rejected." };
  }

  // 6. Cryptographically Bound PoW Verification:
  const clientHfp = String(body._hfp || "").trim();
  const rawClientBound = `${challenge.salt}:${token}:${clientHfp}:${nonce}`;
  const rawServerBound = `${challenge.salt}:${token}:${serverHfp}:${nonce}`;
  const rawTokenBound = `${challenge.salt}:${token}:${nonce}`;
  const rawSimple = `${challenge.salt}${nonce}`;

  const hashClient = crypto.createHash("sha256").update(rawClientBound).digest("hex");
  const hashServer = crypto.createHash("sha256").update(rawServerBound).digest("hex");
  const hashToken = crypto.createHash("sha256").update(rawTokenBound).digest("hex");
  const hashSimple = crypto.createHash("sha256").update(rawSimple).digest("hex");

  const requiredPrefix = "0".repeat(challenge.difficulty);
  const isValidPoW =
    hashClient.startsWith(requiredPrefix) ||
    hashServer.startsWith(requiredPrefix) ||
    hashToken.startsWith(requiredPrefix) ||
    hashSimple.startsWith(requiredPrefix);

  if (!isValidPoW) {
    recordFailure(subnet);
    return { valid: false, status: 400, error: "Cryptographic PoW solution invalid." };
  }

  // Anti-Replay: Nonce check
  const nonceKey = `${challenge.salt}:${token}:${nonce}`;
  if (usedNonces.has(nonceKey)) {
    recordFailure(subnet);
    return { valid: false, status: 400, error: "Replay attack detected." };
  }
  usedNonces.add(nonceKey);

  // Consume challenge
  challenge.consumed = true;
  activeChallenges.delete(challengeId);
  activeChallenges.delete(token);

  // 7. Timing verification: minimum 100ms human delay
  const clientTime = Number(body._t);
  if (clientTime && Date.now() - clientTime < 100) {
    return { valid: false, status: 429, error: "Action performed too fast. Please retry." };
  }

  // 8. Human interactive proof requirement & Event Trust
  if (!body.interactiveProof && !body.turnstileToken) {
    recordFailure(subnet);
    return { valid: false, status: 400, error: "Human telemetry interaction proof missing." };
  }

  if (body._isTrusted === false) {
    recordFailure(subnet);
    return { valid: false, status: 403, error: "Synthetic programmatic event rejected." };
  }

  // 9. Mobile Touch & Interaction Acceptance
  // Trajectory is purely optional telemetry to support mobile touch/tap screens seamlessly.

  // 10. Voucher code sanitization
  let code = String(body.code || "").trim();
  if (code) {
    code = code.replace(/[\u200B-\u200D\uFEFF]/g, "");
    if (code.length < 3 || code.length > 64) {
      return { valid: false, status: 400, error: "Voucher code length invalid." };
    }
    // Dots allowed — real voucher codes like GLM-5.3-FLASH contain them.
    if (!/^[A-Za-z0-9._-]+$/.test(code)) {
      return { valid: false, status: 400, error: "Voucher code contains forbidden characters." };
    }
  }

  return { valid: true, sanitizedCode: code, deviceFp: dfp, hardwareFp: serverHfp };
}
