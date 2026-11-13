// Append-only JSONL audit trail for security-relevant events. Never rewritten,
// so tampering shows up as a torn/absent line. Rotate manually if it grows.
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "@/lib/dataDir";

const AUDIT_FILE = path.join(DATA_DIR, "audit.log");

export function audit(event, detail = {}) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), event, ...detail }) + "\n";
    fs.appendFileSync(AUDIT_FILE, line, { mode: 0o600 });
  } catch {}
}
