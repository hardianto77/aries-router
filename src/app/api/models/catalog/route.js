import { NextResponse } from "next/server";
import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { getProviderAlias } from "@/shared/constants/providers";
import { getProviderConnections, getCombos, getCustomModels, getStudioModels, getProviderNodes } from "@/lib/localDb";

export const dynamic = "force-dynamic";

// Custom providers (Bunnybug, Token Harbor, ...) have no static model list in
// PROVIDER_MODELS — pull their live /models once per 5 minutes so the voucher
// picker shows every enabled model (Bb/glm-5.3-flash, ...).
const upstreamModelsCache = new Map();

// Whole-response cache: a rebuild walks every active connection and can trigger
// live /models lookups for each custom provider. Serve the last good payload
// and revalidate in the background so the voucher picker never blocks on
// upstream latency (users saw "Scanning installed models..." hang for 90s+).
let catalogCache = null; // { t, body }
let rebuildInFlight = null;

async function fetchUpstreamModels(providerId, baseUrl, apiKey) {
  const cached = upstreamModelsCache.get(providerId);
  if (cached && Date.now() - cached.t < 5 * 60 * 1000) return cached.models;
  let models = [];
  try {
    const url = `${String(baseUrl).replace(/\/+$/, "")}/models`;
    const res = await fetch(url, {
      headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (res.ok) {
      const body = await res.json();
      const list = Array.isArray(body) ? body : body.data || body.models || [];
      models = list.map((m) => (typeof m === "string" ? m : m?.id)).filter(Boolean);
    }
  } catch {}
  upstreamModelsCache.set(providerId, { t: Date.now(), models });
  return models;
}

/**
 * GET /api/models/catalog
 * Auto-detects ONLY models from providers that are ACTUALLY installed/connected
 * in Aries (plus custom models, combos, and active provider nodes).
 * If a provider has not been configured/connected, its models are NOT returned.
 */
export async function GET() {
  try {
    const now = Date.now();

    // Fresh cache → instant.
    if (catalogCache && now - catalogCache.t < 30000) {
      return NextResponse.json(catalogCache.body);
    }

    // A rebuild is already running → hand back the last good payload now.
    if (rebuildInFlight) {
      if (catalogCache) return NextResponse.json(catalogCache.body);
      await rebuildInFlight;
      return NextResponse.json(catalogCache.body);
    }

    const rebuild = buildCatalog()
      .then((body) => {
        catalogCache = { t: Date.now(), body };
      })
      .finally(() => {
        rebuildInFlight = null;
      });
    rebuildInFlight = rebuild;

    // Stale payload exists → serve it while the rebuild runs in background.
    if (catalogCache) {
      return NextResponse.json(catalogCache.body);
    }

    await rebuild;
    return NextResponse.json(catalogCache.body);
  } catch (error) {
    console.error("Error fetching installed catalog models:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function buildCatalog() {
  const installedModels = [];
  const seen = new Set();

  // 1. Fetch active provider connections from Aries DB
  let connections = [];
  try {
    connections = (await getProviderConnections()) || [];
    connections = connections.filter((c) => c.isActive !== false);
  } catch {
    connections = [];
  }

  // 2. Map models for each connected provider
  const activeProviderMap = new Map();
  for (const conn of connections) {
    if (!activeProviderMap.has(conn.provider)) {
      activeProviderMap.set(conn.provider, conn);
    }
  }

  // 2a. Custom providers with no static list need a live /models lookup.
  //     Gather them first and fetch ALL in parallel — serial awaits here were
  //     what made the catalog hang for 90s+ (one 6s timeout per provider).
  const needLive = [];
  for (const [providerId, conn] of activeProviderMap.entries()) {
    const staticAlias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
    const providerModels = PROVIDER_MODELS[staticAlias] || PROVIDER_MODELS[providerId] || [];
    const enabledModels = conn?.providerSpecificData?.enabledModels;
    const hasExplicitEnabledModels = Array.isArray(enabledModels) && enabledModels.length > 0;
    const modelList = hasExplicitEnabledModels ? enabledModels : providerModels;
    if (!modelList.length && conn?.providerSpecificData?.baseUrl) {
      needLive.push([providerId, conn]);
    }
    
  }

  const liveResults = new Map();
  await Promise.all(
    needLive.map(async ([providerId, conn]) => {
      let token = conn?.apiKey || conn?.token || "";
      if (typeof token === "string" && token.startsWith("{")) {
        try {
          const parsed = JSON.parse(token);
          if (parsed && typeof parsed.token === "string") token = parsed.token;
        } catch {}
      }
      const live = await fetchUpstreamModels(
        providerId,
        conn?.providerSpecificData?.baseUrl || "",
        token
      );
      liveResults.set(providerId, live);
    })
  );

  for (const [providerId, conn] of activeProviderMap.entries()) {
    const staticAlias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
    const outputAlias = (
      conn?.providerSpecificData?.prefix ||
      getProviderAlias(providerId) ||
      staticAlias
    ).trim();

    const providerModels = PROVIDER_MODELS[staticAlias] || PROVIDER_MODELS[providerId] || [];
    const enabledModels = conn?.providerSpecificData?.enabledModels;
    const hasExplicitEnabledModels = Array.isArray(enabledModels) && enabledModels.length > 0;

    let modelList = hasExplicitEnabledModels ? enabledModels : providerModels;

    if (!modelList.length) {
      const live = liveResults.get(providerId) || [];
      modelList = live.map((id) => ({ id }));
      if (!modelList.length && conn?.defaultModel) modelList = [{ id: conn.defaultModel }];
    }

    for (const item of modelList) {
      const rawId = typeof item === "string" ? item : item.id;
      const name = typeof item === "string" ? item : item.name || item.id;
      if (!rawId) continue;

      // Strip prefix if already present in ID
      let cleanId = rawId;
      if (cleanId.startsWith(`${outputAlias}/`)) {
        cleanId = cleanId.slice(outputAlias.length + 1);
      } else if (cleanId.startsWith(`${staticAlias}/`)) {
        cleanId = cleanId.slice(staticAlias.length + 1);
      } else if (cleanId.startsWith(`${providerId}/`)) {
        cleanId = cleanId.slice(providerId.length + 1);
      }

      

      const fullId = `${outputAlias}/${cleanId}`;
      if (!seen.has(fullId)) {
        seen.add(fullId);
        installedModels.push({
          id: fullId,
          name: `${outputAlias}: ${name}`,
          provider: providerId,
          alias: outputAlias,
          category: "installed-provider",
        });
      }
    }
  }

  // 3. Include active Provider Nodes (Custom OpenAI/Anthropic Compatible upstreams)
  try {
    const nodes = (await getProviderNodes()) || [];
    for (const node of nodes) {
      if (node.isActive === false) continue;
      const prefix = node.data?.prefix || node.name || "node";
      const models = node.data?.models || [];
      for (const m of models) {
        const modelId = typeof m === "string" ? m : m.id;
        if (!modelId) continue;
        const fullId = `${prefix}/${modelId}`;
        if (!seen.has(fullId)) {
          seen.add(fullId);
          installedModels.push({
            id: fullId,
            name: `${prefix}: ${modelId}`,
            provider: "node",
            alias: prefix,
            category: "provider-node",
          });
        }
      }
    }
  } catch {}

  // 4. Include user-created Combos
  try {
    const combos = (await getCombos()) || [];
    for (const cb of combos) {
      const id = cb.name;
      if (id && !seen.has(id)) {
        seen.add(id);
        installedModels.push({
          id,
          name: `Combo: ${cb.name}`,
          provider: "combo",
          alias: "combo",
          category: "combo",
        });
      }
    }
  } catch {}

  // 5. Include user-configured Studio / Custom Models
  try {
    const studioModels = (await getStudioModels()) || [];
    for (const s of studioModels) {
      const id = s.callName || s.id;
      if (id && !seen.has(id)) {
        seen.add(id);
        installedModels.push({
          id,
          name: `Custom: ${s.displayName || id}`,
          provider: s.provider || "custom",
          alias: "custom",
          category: "custom-model",
        });
      }
    }
  } catch {}

  try {
    const customModels = (await getCustomModels()) || [];
    for (const c of customModels) {
      const id = c.id;
      if (id && !seen.has(id)) {
        seen.add(id);
        installedModels.push({
          id,
          name: `Custom: ${c.name || id}`,
          provider: c.providerAlias || "custom",
          alias: "custom",
          category: "custom-model",
        });
      }
    }
  } catch {}

  return {
    models: installedModels,
    total: installedModels.length,
    hasInstalledProviders: installedModels.length > 0,
  };
}
