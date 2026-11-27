import { ANTIGRAVITY_IDE_BASE_URL, ANTIGRAVITY_IDE_USER_AGENT, ANTIGRAVITY_OAUTH_CLIENT } from "../shared.js";

export default {
  id: "antigravity",
  priority: 20,
  alias: "ag",
  uiAlias: "ag",
  display: {
    name: "Antigravity",
    icon: "rocket_launch",
    color: "#F59E0B",
    website: "https://antigravity.google",
    notice: {
      signupUrl: "https://antigravity.google",
    },
    deprecated: true,
    deprecationNotice: "RISK_NOTICE",
  },
  category: "oauth",
  serviceKinds: ["llm", "image", "webSearch"],
  transport: {
    baseUrls: [
      ANTIGRAVITY_IDE_BASE_URL,
    ],
    format: "antigravity",
    // Argon high-reasoning prefill can exceed the global 360s budget on large contexts.
    stallTimeoutMs: 600000,
    headers: {
      "User-Agent": ANTIGRAVITY_IDE_USER_AGENT,
    },
    retry: {
      "429": {
        attempts: 3,
      },
      "500": {
        attempts: 3,
      },
      "503": {
        attempts: 3,
      },
    },
    usage: {
      quotaApiUrl: `${ANTIGRAVITY_IDE_BASE_URL}/v1internal:fetchAvailableModels`,
      quotaSummaryApiUrl: `${ANTIGRAVITY_IDE_BASE_URL}/v1internal:retrieveUserQuotaSummary`,
      loadProjectApiUrl: "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
      tokenUrl: "https://oauth2.googleapis.com/token",
    },
    clientId: process.env.ANTIGRAVITY_OAUTH_CLIENT_ID || ANTIGRAVITY_OAUTH_CLIENT.clientId,
    clientSecret: process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET || ANTIGRAVITY_OAUTH_CLIENT.clientSecret,
  },
  models: [
    // Account ground truth: `agy models` on every connected account returns
    // exactly these ids. Nothing else is served, and the ACP executor passes
    // the registry `id` straight through, so id == upstream id here.
    { id: "gemini-4-hydrogen-xhigh", name: "Gemini 4 Hydrogen (XHigh)", upstreamModelId: "gemini-4-hydrogen-xhigh" },
    { id: "gemini-4-hydrogen-high", name: "Gemini 4 Hydrogen (High)", upstreamModelId: "gemini-4-hydrogen-high" },
    { id: "gemini-4-hydrogen-medium", name: "Gemini 4 Hydrogen (Medium)", upstreamModelId: "gemini-4-hydrogen-medium" },
    { id: "gemini-4-hydrogen-low", name: "Gemini 4 Hydrogen (Low)", upstreamModelId: "gemini-4-hydrogen-low" },
    { id: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)", upstreamModelId: "gemini-3.8-flash-high" },
    { id: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium)", upstreamModelId: "gemini-3.8-flash-medium" },
    { id: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)", upstreamModelId: "gemini-3.8-flash-low" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)", upstreamModelId: "claude-sonnet-4-6" },
    { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)", upstreamModelId: "claude-opus-4-6-thinking" },
    { id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)", upstreamModelId: "gpt-oss-120b-medium" },
  ],
  oauth: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://www.googleapis.com/oauth2/v1/userinfo",
    scopes: [
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/cclog",
      "https://www.googleapis.com/auth/experimentsandconfigs",
    ],
    apiEndpoint: "https://daily-cloudcode-pa.googleapis.com",
    apiVersion: "v1internal",
    loadCodeAssistEndpoint: "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
    onboardUserEndpoint: "https://cloudcode-pa.googleapis.com/v1internal:onboardUser",
    loadCodeAssistUserAgent: ANTIGRAVITY_IDE_USER_AGENT,
    refreshLeadMs: 300000,
  },
  searchViaChat: {
    defaultModel: "gemini-2.5-flash",
    endpoint: `${ANTIGRAVITY_IDE_BASE_URL}/v1internal:generateContent`,
    freeTier: "Free - Google Search grounding through an Antigravity OAuth account.",
  },
  features: {
    usage: true,
  },
};
