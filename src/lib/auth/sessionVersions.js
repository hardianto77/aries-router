// Durable session-version store. Survives restarts, zero DB migration risk —
// single JSON file under DATA_DIR (the deployment is a single Node process).
//
// Every dashboard JWT carries `sv` = the subject's version at mint time.
// Bumping the version invalidates ALL outstanding tokens for that subject on
// the next verify, which is what a password change / key disable must do.
// A token without `sv` (minted before this mechanism existed) never matches
// and is rejected — a deliberate forced re-login on deploy.
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir";

const VERSIONS_FILE = path.join(DATA_DIR, "session-versions.json");

function load() {
  try {
    return JSON.parse(fs.readFileSync(VERSIONS_FILE, "utf8")) || {};
  } catch {
    return {};
  }
}

function save(map) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(VERSIONS_FILE, JSON.stringify(map), { mode: 0o600 });
  } catch {}
}

export function sessionSubject(payload) {
  if (!payload) return null;
  if (payload.keyId) return `k:${payload.keyId}`;
  if (payload.role) return `a:${payload.role}`;
  return null;
}

export function getVersion(subject) {
  if (!subject) return 0;
  return Number(load()[subject] || 0);
}

export function bumpVersion(subject) {
  if (!subject) return;
  const map = load();
  map[subject] = Number(map[subject] || 0) + 1;
  save(map);
}
