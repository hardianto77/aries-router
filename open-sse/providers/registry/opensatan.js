export default {
  id: "opensatan",
  priority: 155,
  alias: "opensatan",
  aliases: ["satan", "bsmeter"],
  uiAlias: "opensatan",
  category: "free",
  hasFree: true,
  noAuth: true,
  display: {
    name: "OpenSatan (Abliterated Uncensored)",
    icon: "local_fire_department",
    color: "#E53E3E",
    textIcon: "SATAN",
    website: "https://opensatan.com",
    notice: {
      apiKeyUrl: "https://opensatan.com",
    },
  },
  authType: "none",
  authModes: ["none"],
  transport: {
    baseUrl: "https://opensatan.com/api/chat",
    format: "openai",
  },
  models: [
    { id: "opensatan/satan", name: "OpenSatan (Satan Mode - Uncensored)", contextLength: 131072 },
    { id: "opensatan/genie", name: "OpenSatan (Genie Mode - Cosmic Wisdom)", contextLength: 131072 },
    { id: "gemma-4-26b-a4b-it-uncensored-abliterix-mlx-int5-affine", name: "Gemma 4 26B Abliterix Uncensored", contextLength: 131072 },
  ],
  passthroughModels: true,
};
