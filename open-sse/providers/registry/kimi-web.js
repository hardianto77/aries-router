export default {
  id: "kimi-web",
  priority: 142,
  alias: "kimi-web",
  aliases: [
    "kweb",
    "kimi-cookie",
  ],
  uiAlias: "kweb",
  display: {
    name: "Kimi Web",
    icon: "bolt",
    color: "#1AB69D",
    textIcon: "KW",
    website: "https://www.kimi.ai",
    notice: {
      apiKeyUrl: "https://www.kimi.ai",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste access_token dari www.kimi.ai (Buka www.kimi.ai -> F12 -> Application -> Local Storage -> https://www.kimi.ai -> cari key 'access_token' -> copy nilainya)",
  transport: {
    baseUrl: "https://www.kimi.ai",
    format: "kimi-web",
    authType: "cookie",
  },
  models: [
    { id: "k3", name: "Kimi K3" },
    { id: "k2d6", name: "Kimi K2.6" },
  ],
  passthroughModels: true,
};
