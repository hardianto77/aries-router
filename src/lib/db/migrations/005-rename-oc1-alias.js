// Legacy alias rename: OpenCode Free used to be addressed as `oc1`; the
// registry now publishes `oc` as its primary alias. Models and aliases the
// user had already added under the old alias keep pointing at `oc1`, so they
// stop matching the provider group and surface as an orphan "Custom Models"
// bucket in the model picker. Rewrite the stored alias in place so the rows
// land under the OpenCode Free group again.
//
// Idempotent: a database already on `oc` has nothing to match and no-ops.
const LEGACY_ALIAS = "oc1";
const CURRENT_ALIAS = "oc";

export default {
  version: 5,
  name: "rename opencode oc1 alias to oc",
  up(db) {
    // customModels: key = `${providerAlias}|${id}|${type}`, value = JSON with providerAlias
    const rows = db
      .all(`SELECT rowid, key, value FROM kv WHERE scope = 'customModels'`)
      .filter((row) => String(row.key || "").startsWith(`${LEGACY_ALIAS}|`));
    for (const row of rows) {
      const nextKey = `${CURRENT_ALIAS}${String(row.key).slice(LEGACY_ALIAS.length)}`;
      const destination = db.all(
        `SELECT rowid FROM kv WHERE scope = 'customModels' AND key = ?`,
        [nextKey]
      );
      // Keep both definitions on collision instead of overwriting the current
      // alias row or deleting the legacy user's model.
      if (destination.length > 0) {
        console.warn("[DB][migrate] kept legacy custom model on alias collision");
        continue;
      }

      let nextValue = row.value;
      try {
        const parsed = JSON.parse(row.value);
        if (parsed && parsed.providerAlias === LEGACY_ALIAS) {
          parsed.providerAlias = CURRENT_ALIAS;
          nextValue = JSON.stringify(parsed);
        }
      } catch {
        // Preserve the original serialized value if an old custom-model row is
        // malformed; the alias key can still be updated without data loss.
      }
      db.run(`UPDATE kv SET key = ?, value = ? WHERE rowid = ?`, [nextKey, nextValue, row.rowid]);
    }

    // modelAliases: key = alias name, value = `${providerAlias}/${modelId}`
    const aliases = db
      .all(`SELECT rowid, key, value FROM kv WHERE scope = 'modelAliases'`)
      .filter((row) => String(row.value || "").startsWith(`${LEGACY_ALIAS}/`));
    for (const row of aliases) {
      const nextValue = `${CURRENT_ALIAS}${String(row.value).slice(LEGACY_ALIAS.length)}`;
      db.run(`UPDATE kv SET value = ? WHERE rowid = ?`, [nextValue, row.rowid]);
    }
  },
};
