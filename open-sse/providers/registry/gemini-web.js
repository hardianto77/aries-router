export default {
  id: "gemini-web",
  priority: 141,
  alias: "gemini-web",
  aliases: [
    "gweb",
    "gemini-cookie",
  ],
  uiAlias: "gweb",
  display: {
    name: "Gemini Web",
    icon: "bolt",
    color: "#1C7DFF",
    textIcon: "GW",
    website: "https://gemini.google.com",
    notice: {
      apiKeyUrl: "https://gemini.google.com",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Wajib salin __Secure-1PSID dan __Secure-1PSIDTS (format: __Secure-1PSID=...; __Secure-1PSIDTS=...). Ambil di gemini.google.com -> F12 -> Application -> Storage -> Cookies. (Tips: Gunakan Firefox agar sesi awet dan tidak terikat hardware/DBSC Chrome).",
  transport: {
    baseUrl: "https://gemini.google.com/app",
    format: "gemini-web",
    authType: "cookie",
  },
  models: [
    { id: "gemini-4-argon", name: "Gemini 4 Argon (1M ctx)", contextLength: 1048576 },
    { id: "gemini-3.1-pro", name: "Gemini 3.1 Pro (1M ctx)", contextLength: 1048576 },
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview (1M ctx)", contextLength: 1048576 },
    { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash (1M ctx)", contextLength: 1048576 },
    { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite (1M ctx)", contextLength: 1048576 },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro (1M ctx)", contextLength: 1048576 },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash (1M ctx)", contextLength: 1048576 },
    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite (1M ctx)", contextLength: 1048576 },
  ],
  passthroughModels: true,
};
