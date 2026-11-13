export default {
  id: "deepseek",
  priority: 23,
  alias: "deepseek",
  aliases: ["dp"],
  uiAlias: "dp",
  display: {
    name: "DeepSeek",
    icon: "psychology",
    color: "#0066FF",
    textIcon: "DP",
    website: "https://platform.deepseek.com",
    notice: {
      apiKeyUrl: "https://platform.deepseek.com/api_keys",
    },
  },
  category: "paid",
  authType: "apiKey",
  authHint: "sk-...",
  quotaEnabled: true,
  quotaKeyPrefix: "deepseek",
  quotaCurrency: "USD",
  quotaUrl: "https://api.deepseek.com/user/balance",
  quotaResponsePath: "balance_infos.0.total_balance",
  quotaHeaders: {
    Authorization: "Bearer {apiKey}",
  },
  transport: {
    baseUrl: "https://api.deepseek.com/v1",
    format: "openai",
  },
  models: [
    { id: "deepseek-reasoner", name: "DeepSeek R1 (Reasoner)" },
    { id: "deepseek-v4", name: "DeepSeek V4" },
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-v4-pro-max", name: "DeepSeek V4 Pro Max", upstreamModelId: "deepseek-v4-pro" },
    { id: "deepseek-v4-pro-none", name: "DeepSeek V4 Pro No Thinking", upstreamModelId: "deepseek-v4-pro" },
    // DeepSeek renamed the served id: the API only accepts "deepseek-flash"
    // and rejects "deepseek-v4.1-flash" with HTTP 400 (#4940).
    { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash", upstreamModelId: "deepseek-flash" },
    { id: "deepseek-v4.1-flash-1017", name: "DeepSeek V4.1 Flash 1017" },
    { id: "deepseek-flash", name: "DeepSeek Flash" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek-v4-flash-vision-exp", name: "DeepSeek V4 Flash Vision (Exp)" },
    { id: "deepseek-chat", name: "DeepSeek V3.2 Chat" },
  ],
};
