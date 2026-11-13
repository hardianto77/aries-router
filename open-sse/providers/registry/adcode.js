// Metadata only: this module is imported into client bundles, so it must stay
// free of node builtins and of anything that describes the upstream wire
// protocol. The real endpoint, client headers, user agent and Firebase web key
// live in the encrypted recipe module (open-sse/recipe/adcodeRecipe.js) and are
// consumed by the executor, which builds the request URL itself.
export default {
  id: "adcode",
  priority: 158,
  alias: "adc",
  aliases: ["adcode", "tagflow"],
  uiAlias: "adc",
  category: "free",
  hasFree: true,
  noAuth: false,
  display: {
    name: "ADCode Tagflow",
    icon: "auto_awesome",
    color: "#6366F1",
    textIcon: "ADC",
    website: "https://adcode.bluethenics.com",
  },
  authType: "oauth",
  hasOAuth: true,
  authModes: ["oauth"],
  authHint: "Connect with your ADCode account (email and password)",
  transport: {
    format: "openai",
    forceStream: true,
  },
  models: [
    {
      id: "heabsy-glm53-flash-unc",
      name: "GLM 5.3 Flash Uncensored",
      contextLength: 131072,
      tools: true,
    },
    {
      id: "heabsy-qwen38",
      name: "Qwen 3.8 27B",
      contextLength: 131072,
      tools: true,
    },
    {
      id: "heabsy-mimo-v26-flash",
      name: "MiMo v2.6 Flash",
      contextLength: 131072,
      tools: true,
    },
    {
      id: "tagflow-code-27b",
      name: "Tagflow Code 27B",
      contextLength: 262144,
      tools: true,
    },
  ],
  passthroughModels: true,
};
