/**
 * Credenciales de EMPRESA configurables desde el panel (solo admin): tokens de redes
 * sociales para publicar y keys de proveedores de medios. Cifradas en reposo con
 * secretBox (data/company-secrets.json), write-only (el panel nunca devuelve valores).
 * Al guardar se aplican a process.env (son de empresa, no por usuario — el perfil
 * por usuario solo cubre el proveedor de copy). Un valor del panel NO pisa una
 * variable ya definida en el .env del servidor: el .env manda.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { seal, unseal } from "./secretBox.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STORE = join(ROOT, "data", "company-secrets.json");

export interface CompanyKeyDef {
  key: string;
  label: string;
  group: string; // para agrupar en el panel
}

// Allowlist estricta: solo estas claves se pueden guardar desde el panel.
export const COMPANY_KEYS: CompanyKeyDef[] = [
  { key: "INSTAGRAM_ACCESS_TOKEN", label: "Access token (Graph API)", group: "Instagram" },
  { key: "INSTAGRAM_BUSINESS_ACCOUNT_ID", label: "Business Account ID", group: "Instagram" },
  { key: "FACEBOOK_PAGE_ID", label: "Page ID", group: "Facebook" },
  { key: "FACEBOOK_PAGE_TOKEN", label: "Page token", group: "Facebook" },
  { key: "LINKEDIN_ACCESS_TOKEN", label: "Access token", group: "LinkedIn" },
  { key: "TIKTOK_CLIENT_KEY", label: "Client key", group: "TikTok" },
  { key: "TIKTOK_CLIENT_SECRET", label: "Client secret", group: "TikTok" },
  { key: "X_API_KEY", label: "API key", group: "X (Twitter)" },
  { key: "X_ACCESS_TOKEN", label: "Access token", group: "X (Twitter)" },
  { key: "FAL_KEY", label: "fal.ai key (imagen/video)", group: "Proveedores de medios" },
  { key: "OPENAI_API_KEY", label: "OpenAI (gpt-image-1)", group: "Proveedores de medios" },
  { key: "LEONARDO_API_KEY", label: "Leonardo.Ai (imagen)", group: "Proveedores de medios" },
  { key: "ELEVENLABS_API_KEY", label: "ElevenLabs (voz/música)", group: "Proveedores de medios" },
  { key: "HEYGEN_API_KEY", label: "HeyGen (avatares)", group: "Proveedores de medios" },
  { key: "META_ADS_TOKEN", label: "Token de Meta Ads (ads_management)", group: "Meta Ads" },
  { key: "S3_ACCESS_KEY_ID", label: "Access Key ID (R2/S3)", group: "Almacenamiento (R2 / S3)" },
  { key: "S3_SECRET_ACCESS_KEY", label: "Secret Access Key (R2/S3)", group: "Almacenamiento (R2 / S3)" },
];

const ALLOWED = new Set(COMPANY_KEYS.map((k) => k.key));

// Claves que el panel puso en process.env (para poder revertir al borrar sin tocar
// variables que venían del .env real del servidor).
const appliedByPanel = new Set<string>();
// Valores del .env del servidor al arrancar (tienen prioridad sobre el panel).
const fromServerEnv = new Set<string>();

function readStore(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(STORE, "utf8"));
  } catch {
    return {};
  }
}

function writeStore(all: Record<string, string>): void {
  mkdirSync(dirname(STORE), { recursive: true });
  writeFileSync(STORE, JSON.stringify(all, null, 2), { mode: 0o600 });
}

/** Estado para el panel: qué claves están configuradas y de dónde salen (sin valores). */
export function listCompanySecrets(): Array<CompanyKeyDef & { set: boolean; source: "panel" | "env" | null }> {
  const store = readStore();
  return COMPANY_KEYS.map((def) => {
    const inStore = !!store[def.key];
    const inEnv = fromServerEnv.has(def.key);
    return { ...def, set: inStore || inEnv, source: inEnv ? "env" : inStore ? "panel" : null };
  });
}

export function setCompanySecret(key: string, value: string): void {
  if (!ALLOWED.has(key)) throw new Error("Clave no permitida");
  const v = value.trim();
  if (!v) throw new Error("Valor vacío");
  if (v.length > 4096) throw new Error("Valor demasiado largo");
  const store = readStore();
  store[key] = seal(v);
  writeStore(store);
  applyCompanySecrets();
}

export function deleteCompanySecret(key: string): void {
  if (!ALLOWED.has(key)) throw new Error("Clave no permitida");
  const store = readStore();
  delete store[key];
  writeStore(store);
  if (appliedByPanel.has(key) && !fromServerEnv.has(key)) {
    delete process.env[key];
    appliedByPanel.delete(key);
  }
}

/**
 * Aplica las credenciales guardadas a process.env. Llamar al arrancar el server
 * (después de cargar .env) y tras cada cambio. El .env del servidor tiene prioridad.
 */
export function applyCompanySecrets(): void {
  if (!fromServerEnv.size) {
    for (const def of COMPANY_KEYS) if (process.env[def.key] && !appliedByPanel.has(def.key)) fromServerEnv.add(def.key);
  }
  const store = readStore();
  for (const [key, sealed] of Object.entries(store)) {
    if (!ALLOWED.has(key) || fromServerEnv.has(key)) continue;
    try {
      process.env[key] = unseal(sealed);
      appliedByPanel.add(key);
    } catch {
      console.warn(`  ⚠ no se pudo descifrar la credencial ${key} (¿cambió PANEL_SECRET?)`);
    }
  }
}

/** Solo existe para pruebas: ¿hay algo guardado? */
export function companySecretsConfigured(): string[] {
  return Object.keys(readStore()).filter((k) => ALLOWED.has(k));
}
