// Hoplite AI — OAuth 2.1 (Authorization Code + PKCE) against the Hoplite
// auth server, with Dynamic Client Registration (RFC 7591) so no client_id /
// client_secret has to be shipped in the repo.
//
// Endpoints (discovered from the protected-resource metadata of the MCP
// server, https://api.hoplite.sh/mcp):
//   issuer          https://api.hoplite.sh/api/auth
//   authorize       https://api.hoplite.sh/api/auth/oauth2/authorize
//   token           https://api.hoplite.sh/api/auth/oauth2/token
//   register (DCR)  https://api.hoplite.sh/api/auth/oauth2/register
//   userinfo        https://api.hoplite.sh/api/auth/oauth2/userinfo
//
// The MCP endpoint itself rejects anything but a real OAuth access token or a
// Hoplite API key ("hop_..."), so a successful token exchange is what makes
// the provider usable — there is no separate "connect" step.
//
// client_id is public (token_endpoint_auth_method: none) and derived from the
// redirect URI, so it can be registered on the fly and cached in-process.

import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir.js";

const HOPLITE_AUTH_BASE = "https://api.hoplite.sh/api/auth";
const HOPLITE_REGISTER_URL = `${HOPLITE_AUTH_BASE}/oauth2/register`;
const HOPLITE_AUTHORIZE_URL = `${HOPLITE_AUTH_BASE}/oauth2/authorize`;
const HOPLITE_TOKEN_URL = `${HOPLITE_AUTH_BASE}/oauth2/token`;
const HOPLITE_USERINFO_URL = `${HOPLITE_AUTH_BASE}/oauth2/userinfo`;

// Scopes the MCP surface actually needs: read projects, create/read threads,
// and api:read/api:write for the account endpoints. offline_access is what
// makes the refresh_token grant available.
const HOPLITE_SCOPE = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "api:read",
  "api:write",
  "project:read",
  "thread:create",
  "thread:read",
  "thread:update",
].join(" ");

// Registered clients, keyed by redirect URI. The registration response is
// public (no secret), so caching it only saves a round trip — but the cache
// MUST survive a restart, otherwise an in-flight authorization code would be
// exchanged with a freshly registered client_id and rejected.
const clientCache = new Map();
const CLIENT_TTL_MS = 24 * 60 * 60 * 1000;
const CLIENT_STORE_FILE = path.join(DATA_DIR, "hoplite-oauth-clients.json");

function readClientStore() {
  try {
    return JSON.parse(fs.readFileSync(CLIENT_STORE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeClientStore(store) {
  try {
    fs.mkdirSync(path.dirname(CLIENT_STORE_FILE), { recursive: true });
    fs.writeFileSync(CLIENT_STORE_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
  } catch {
    // Non-fatal: the in-memory cache still serves this process.
  }
}

function loadCachedClient(redirectUri) {
  const hit = clientCache.get(redirectUri);
  if (hit && Date.now() - hit.at < CLIENT_TTL_MS) return hit.clientId;
  const persisted = readClientStore()[redirectUri];
  if (persisted?.clientId && Date.now() - (persisted.at || 0) < CLIENT_TTL_MS) {
    clientCache.set(redirectUri, { clientId: persisted.clientId, at: persisted.at });
    return persisted.clientId;
  }
  return null;
}

function persistClient(redirectUri, clientId) {
  const at = Date.now();
  clientCache.set(redirectUri, { clientId, at });
  const store = readClientStore();
  store[redirectUri] = { clientId, at };
  // Drop stale entries so the file cannot grow without bound.
  for (const [k, v] of Object.entries(store)) {
    if (!v?.at || Date.now() - v.at > CLIENT_TTL_MS) delete store[k];
  }
  writeClientStore(store);
}

/**
 * Register (or reuse) a public OAuth client for the given redirect URI.
 * Falls back to a deterministic client_id when DCR is unavailable so the flow
 * can still be attempted rather than failing outright.
 */
async function ensureClient(redirectUri) {
  const cached = loadCachedClient(redirectUri);
  if (cached) return cached;

  let clientId = "";
  try {
    const res = await fetch(HOPLITE_REGISTER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "Aries",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data?.client_id) clientId = String(data.client_id);
    }
  } catch {
    // DCR unreachable — fall through to the deterministic fallback below.
  }

  if (!clientId) {
    // Deterministic public client id derived from the redirect URI. Only
    // useful if the auth server has a matching pre-registered client; kept
    // so the failure surfaces as "invalid client" (clear) rather than a
    // missing-parameter crash.
    clientId = `xr-${Buffer.from(redirectUri).toString("base64url").slice(0, 24)}`;
  }

  persistClient(redirectUri, clientId);
  return clientId;
}

// Token refresh lives in open-sse/services/tokenRefresh/providers.js
// (refreshHopliteToken) so the background refresher and the request path
// share one code path. It is wired through REFRESH_HANDLERS there.

const hoplite = {
  config: {
    defaultBaseUrl: HOPLITE_AUTH_BASE,
    authorizeUrlPath: "/oauth2/authorize",
    tokenUrlPath: "/oauth2/token",
    userInfoUrlPath: "/oauth2/userinfo",
    scope: HOPLITE_SCOPE,
    codeChallengeMethod: "S256",
  },
  flowType: "authorization_code_pkce",

  // The client_id is only known after DCR, so the URL is built lazily in
  // buildAuthUrl (which is async-safe here because the caller awaits it).
  buildAuthUrl: async (config, redirectUri, state, codeChallenge) => {
    const clientId = await ensureClient(redirectUri);
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      state,
      scope: config.scope,
      code_challenge: codeChallenge,
      code_challenge_method: config.codeChallengeMethod,
    });
    return `${HOPLITE_AUTHORIZE_URL}?${params.toString()}`;
  },

  exchangeToken: async (config, code, redirectUri, codeVerifier) => {
    const clientId = await ensureClient(redirectUri);
    const body = new URLSearchParams({
      client_id: clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });
    const res = await fetch(HOPLITE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: body.toString(),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`Hoplite token exchange failed (${res.status}): ${await res.text()}`);
    const tokens = await res.json();

    // Identity for the connection label. userinfo needs the fresh token; a
    // failure here is non-fatal (the token is what actually matters).
    let user = {};
    try {
      const userRes = await fetch(HOPLITE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
        signal: AbortSignal.timeout(12000),
      });
      if (userRes.ok) user = await userRes.json().catch(() => ({}));
    } catch {
      // keep empty identity
    }

    return { ...tokens, _user: user, _clientId: clientId };
  },

  mapTokens: (tokens) => ({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || null,
    expiresIn: tokens.expires_in,
    scope: tokens.scope,
    email: tokens._user?.email || tokens._user?.preferred_username || null,
    displayName:
      tokens._user?.name ||
      tokens._user?.email ||
      tokens._user?.preferred_username ||
      "Hoplite AI",
    providerSpecificData: {
      authMethod: "oauth",
      clientId: tokens._clientId,
      baseUrl: "https://api.hoplite.sh/mcp",
      subject: tokens._user?.sub || null,
      name: tokens._user?.name || "",
    },
  }),
};

export default hoplite;
