/**
 * Ptero AI Provider Definition
 * Free anonymous AI chat proxy from ptero.pro.
 * Generates an ephemeral 32-hex guest token per session.
 */
export default {
  id: "ptero",
  name: "Ptero AI",
  type: "ptero",
  category: "free",
  noAuth: true,
  description: "Free anonymous AI gateway via ptero.pro with dynamic nonce fetching",
  supportedFormats: ["openai"],
  authModes: ["none"],
  models: [
    { id: "deepseek-v4.1-flash:free", name: "DeepSeek V4.1 Flash (Free)", capabilities: { tools: false, reasoning: true } },
    { id: "ling-3.0-flash:free", name: "Ling 3.0 Flash (Free)", capabilities: { tools: false, reasoning: false } },
    { id: "glm-5.3-flash", name: "GLM 5.3 Flash", capabilities: { tools: false, reasoning: false } },
    { id: "mistral-nemo:minirouter", name: "Mistral Nemo 12B", capabilities: { tools: false, reasoning: false } },
    { id: "gpt-oss-20b", name: "GPT-OSS 20B", capabilities: { tools: false, reasoning: false } },
    { id: "apodex-1.1-mini:free", name: "Apodex 1.1 Mini (Free)", capabilities: { tools: false, reasoning: false } },
  ],
};
