const normalizedModelValue = (value) =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

export function parseAllowedModelsList(value) {
  if (typeof value !== "string" || !value.trim() || value.trim() === "*") {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isModelValueSelected(value, selectedValues) {
  const normalized = normalizedModelValue(value);
  if (!normalized) return false;
  return (Array.isArray(selectedValues) ? selectedValues : [])
    .some((selected) => normalizedModelValue(selected) === normalized);
}

/**
 * Apply a batch model selection to the serialized API-key allowlist.
 *
 * Removing the final explicit model is intentionally a no-op: an empty
 * allowlist is interpreted as unrestricted by the API, so converting the last
 * selection to `*` would silently widen access. Comparisons are case-insensitive
 * to match the server's allowedModels contract, while stored spelling/order are
 * preserved for existing entries.
 */
export function updateAllowedModelsList(currentValue, modelValues, action = "add") {
  const current = parseAllowedModelsList(currentValue);
  const values = [...new Map(
    (Array.isArray(modelValues) ? modelValues : [modelValues])
      .filter((value) => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => [normalizedModelValue(value), value])
  ).values()];

  if (action === "add") {
    const next = [...current];
    const seen = new Set(current.map(normalizedModelValue));
    for (const value of values) {
      const normalized = normalizedModelValue(value);
      if (!seen.has(normalized)) {
        next.push(value);
        seen.add(normalized);
      }
    }
    return next.length > 0 ? next.join(", ") : (currentValue || "*");
  }

  if (action === "remove") {
    const remove = new Set(values.map(normalizedModelValue));
    const next = current.filter((value) => !remove.has(normalizedModelValue(value)));
    if (current.length > 0 && next.length === 0) return currentValue;
    return next.length > 0 ? next.join(", ") : (currentValue || "*");
  }

  throw new TypeError(`Unsupported model selection action: ${action}`);
}

export function getModelBatchDelta(models, selectedValues, action = "add") {
  const selected = new Set(
    (Array.isArray(selectedValues) ? selectedValues : [])
      .map(normalizedModelValue)
      .filter(Boolean)
  );
  const seen = new Set();
  return (Array.isArray(models) ? models : []).filter((model) => {
    if (!model || model.isPlaceholder || typeof model.value !== "string" || !model.value) {
      return false;
    }
    const normalized = normalizedModelValue(model.value);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return action === "remove" ? selected.has(normalized) : !selected.has(normalized);
  });
}

export function batchWouldClearAllSelectedValues(models, selectedValues) {
  const selected = [...new Set(
    (Array.isArray(selectedValues) ? selectedValues : [])
      .map(normalizedModelValue)
      .filter(Boolean)
  )];
  if (selected.length === 0) return false;
  const removable = new Set(
    getModelBatchDelta(models, selected, "remove")
      .map((model) => normalizedModelValue(model.value))
  );
  return selected.every((value) => removable.has(value));
}
