import crypto from "node:crypto";

/**
 * ADCode / Tagflow wire recipe — encrypted at rest.
 *
 * Everything that describes *how* to talk to the upstream gateway (endpoints,
 * client headers, user agent) lives in an AES-256-GCM blob instead of plain
 * source.
 *
 * The Firebase web key is intentionally absent: it is read from ADCODE_FB_KEY
 * at runtime so no copy of it ships in this repo, in an npm tarball, or in a
 * bundled chunk. Without that variable the provider reports a configuration
 * error instead of silently failing.
 *
 * Note: this is obfuscation with integrity checking, not a secret-management
 * boundary — a determined reader of the running process can still recover this
 * plaintext. It exists so the wire format is not copy-pasteable from source.
 */

const SALT = "xrouter-adcode-recipe-v2";
const BLOB =
  "yf1q6a5M4lMEymPnEmiunHGNX+miZppvLNSby+EN+iKCkYV8+ICEK24jo3HYuzPUnXiKOcPOVIZy" +
  "I27pYilNYpy17qczZEbTJBvyN/+hKQNIaqcZ5J6/xAuBhBcAQOe1LPsXGnxoG/gflmhOkNxfeP7y" +
  "SyvQDoeFbeeSWuI/rHTNgjWKezNpc8K0aAK4TPrYpW+QpaRAY5GVupu5MPJdr2yyO/eNW/DzZpHg" +
  "zEcXVGdUKXxfyf82jQPKm1YyLH/A+w2b79i9XxkWbqVCFyNBEPrpKPWD9/8P0MSezwADipzR33m8" +
  "mxCx/S7bDUAnqvPfQti+QIdzF6FsPDe96k/bPsBHoNlJ5wrsgNBu9L1AOAXljMwFgBsFk51JRmP8" +
  "rpWht3GfvUZ5mQo+BMfG4ENRUkR7Cv5MAxzCoQoC/cOD04T7+NZu6NVEWkngmRf9wmj5lmJqB9Ox" +
  "KVHD84ngTQ0NhjLxhOw8712ZdsAXgQ==";

function deriveKey() {
  return crypto.createHash("sha256")
    .update(process.env.ADCODE_RECIPE_KEY || SALT)
    .digest();
}

let cache = null;

export function getRecipe() {
  if (cache) return cache;
  const raw = Buffer.from(BLOB, "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const body = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", deriveKey(), iv);
  decipher.setAuthTag(tag);
  const json = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  cache = JSON.parse(json);
  return cache;
}

export default getRecipe;
