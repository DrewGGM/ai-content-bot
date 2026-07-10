/**
 * Cifrado en reposo (AES-256-GCM) para credenciales guardadas por el panel.
 * La clave sale de PANEL_SECRET (.env); si no está definida, se genera una
 * aleatoria en data/.secret-key (fuera de git). Formato: "v1:<iv>:<tag>:<cipher>" en base64.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const KEY_FILE = join(ROOT, "data", ".secret-key");

let _key: Buffer | null = null;
function key(): Buffer {
  if (_key) return _key;
  const secret = process.env.PANEL_SECRET?.trim();
  if (secret) {
    _key = scryptSync(secret, "content-bot.secretbox", 32);
    return _key;
  }
  if (!existsSync(KEY_FILE)) {
    mkdirSync(dirname(KEY_FILE), { recursive: true });
    writeFileSync(KEY_FILE, randomBytes(32).toString("hex"), { mode: 0o600 });
  }
  _key = Buffer.from(readFileSync(KEY_FILE, "utf8").trim(), "hex");
  return _key;
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function unseal(sealed: string): string {
  const parts = sealed.split(":");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Formato de secreto inválido");
  const [, ivB64, tagB64, dataB64] = parts;
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
