import { getAdapter } from "../driver.js";
import { makeKv } from "../helpers/kvStore.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

function studioKey(providerAlias, modelId) {
  return `${providerAlias}|${modelId}`;
}
export async function getStudioModel(providerAlias, modelId) {
  const raw = await studioKv.get(studioKey(providerAlias, modelId));
  return raw ? parseJson(raw) : null;
}
export async function setStudioModel(providerAlias, modelId, patch) {
  const cur = (await getStudioModel(providerAlias, modelId)) || {};
  await studioKv.set(studioKey(providerAlias, modelId), stringifyJson({ ...cur, ...patch, providerAlias, id: modelId }));
}
export async function deleteStudioModel(providerAlias, modelId) {
  await studioKv.remove(studioKey(providerAlias, modelId));
}
export async function getStudioModels() {
  const all = await studioKv.getAll();
  return Object.values(all || {});
}
