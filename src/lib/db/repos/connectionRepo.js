import crypto from "node:crypto";
import { machineIdSync } from "node-machine-id";
import { makeKv } from "../helpers/kvStore.js";

const kv = makeKv("connection");

const ENCRYPT_ALGO = "aes-256-gcm";
const ENCRYPT_SALT = "xrouter-connection-token-salt";

function deriveKey() {
  try {
    return crypto.createHash("sha256").update(machineIdSync() + ENCRYPT_SALT).digest();
  } catch {
    return crypto.createHash("sha256").update(ENCRYPT_SALT).digest();
  }
}

export function encryptSecret(plaintext) {
  if (typeof plaintext !== "string" || !plaintext) return plaintext;
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ENCRYPT_ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptSecret(stored) {
  if (typeof stored !== "string" || !stored) return "";
  const parts = stored.split(":");
  if (parts.length !== 3) return stored; // unencrypted / plaintext legacy
  const [ivHex, tagHex, dataHex] = parts;
  try {
    const key = deriveKey();
    const decipher = crypto.createDecipheriv(ENCRYPT_ALGO, key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return decipher.update(Buffer.from(dataHex, "hex")) + decipher.final("utf8");
  } catch {
    return "";
  }
}

const DEFAULT_CONNECTION_CONFIG = {
  telegram: {
    enabled: false,
    botToken: "",
    userId: "",
    webhookUrl: "",
    autoWebhook: true,
    botInfo: null, // { id, username, first_name }
    status: "idle", // idle | connected | error
    lastError: null,
    lastTestedAt: null,
  },
};

export async function getConnectionConfig() {
  const stored = await kv.get("config", {});
  const tgStored = stored.telegram || {};
  return {
    telegram: {
      ...DEFAULT_CONNECTION_CONFIG.telegram,
      ...tgStored,
      botToken: decryptSecret(tgStored.botToken || ""),
    },
  };
}

export async function setConnectionConfig(patch = {}) {
  const current = await getConnectionConfig();
  const next = {
    telegram: {
      ...current.telegram,
      ...(patch.telegram || {}),
    },
  };

  const toStore = {
    telegram: {
      ...next.telegram,
    },
  };

  if (typeof patch.telegram?.botToken === "string") {
    const raw = patch.telegram.botToken.trim();
    toStore.telegram.botToken = raw ? encryptSecret(raw) : "";
  } else {
    toStore.telegram.botToken = next.telegram.botToken ? encryptSecret(next.telegram.botToken) : "";
  }

  await kv.set("config", toStore);
  return getConnectionConfig();
}
