/**
 * Ajustes NO-secretos configurables desde el panel (ej. IMAGE_PROVIDER: qué proveedor de
 * imagen usar). Se guardan en data/app-settings.json (sin cifrar — no son secretos) y se
 * aplican a process.env al arrancar el server/scheduler y tras cada cambio. El .env del
 * servidor tiene PRIORIDAD: si la variable ya viene del .env, esa manda y el panel la muestra
 * como de solo lectura.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STORE = join(ROOT, "data", "app-settings.json");

export interface AppSettingDef {
  key: string;
  label: string;
  type: "enum" | "text" | "number";
  options: string[]; // solo enum
  default: string;
  help: string;
  group?: string;
}

export const APP_SETTINGS: AppSettingDef[] = [
  {
    key: "IMAGE_PROVIDER",
    label: "Proveedor de imagen",
    type: "enum",
    options: ["fal", "openai", "gemini", "leonardo"],
    default: "fal",
    help: "Con qué servicio se generan las imágenes (posts, carruseles, posts de marca). fal (Nano Banana Pro) es el recomendado.",
  },
  {
    key: "META_AD_ACCOUNT_ID",
    label: "Cuenta publicitaria de Meta (Ad Account ID)",
    type: "text",
    options: [],
    default: "",
    help: "El id de tu cuenta publicitaria SIN el prefijo act_ (ej. 1234567890). Lo ves en Administrador de Anuncios → Configuración.",
    group: "Meta Ads",
  },
  {
    key: "META_PIXEL_ID",
    label: "Píxel de Meta (opcional, para ventas)",
    type: "text",
    options: [],
    default: "",
    help: "Solo si haces campañas de conversión/ventas. Opcional.",
    group: "Meta Ads",
  },
  {
    key: "ADS_MAX_DAILY_BUDGET",
    label: "Tope de gasto diario por conjunto",
    type: "number",
    options: [],
    default: "0",
    help: "Límite de seguridad: el bot NUNCA crea/optimiza un conjunto con presupuesto diario mayor a este (en la moneda de tu cuenta). 0 = sin tope (no recomendado).",
    group: "Meta Ads",
  },
];

const ALLOWED = new Map(APP_SETTINGS.map((s) => [s.key, s]));
// Variables que ya venían del .env del servidor (tienen prioridad sobre el panel).
const fromServerEnv = new Set<string>();
const appliedByPanel = new Set<string>();

function readStore(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(STORE, "utf8"));
  } catch {
    return {};
  }
}

function writeStore(all: Record<string, string>): void {
  mkdirSync(dirname(STORE), { recursive: true });
  writeFileSync(STORE, JSON.stringify(all, null, 2));
}

/** Para el panel: valor actual, opciones y origen de cada ajuste. */
export function listAppSettings(): Array<AppSettingDef & { value: string; source: "env" | "panel" | "default" }> {
  const store = readStore();
  return APP_SETTINGS.map((def) => {
    const envVal = process.env[def.key]?.trim();
    if (fromServerEnv.has(def.key) && envVal) return { ...def, value: envVal, source: "env" };
    if (store[def.key]) return { ...def, value: store[def.key], source: "panel" };
    return { ...def, value: def.default, source: "default" };
  });
}

export function setAppSetting(key: string, value: string): void {
  const def = ALLOWED.get(key);
  if (!def) throw new Error("Ajuste no permitido");
  if (fromServerEnv.has(key)) throw new Error(`"${key}" está fijado en el .env del servidor — cámbialo allí`);
  let v: string;
  if (def.type === "enum") {
    v = String(value).toLowerCase().trim();
    if (!def.options.includes(v)) throw new Error(`Valor inválido (opciones: ${def.options.join(", ")})`);
  } else if (def.type === "number") {
    v = String(value).trim();
    if (v !== "" && !/^\d+(\.\d+)?$/.test(v)) throw new Error("Debe ser un número (≥ 0)");
  } else {
    v = String(value).trim().slice(0, 200);
  }
  const store = readStore();
  if (v === "" && def.type !== "enum") delete store[key]; else store[key] = v;
  writeStore(store);
  if (v === "" && def.type !== "enum") delete process.env[key]; else process.env[key] = v;
  appliedByPanel.add(key);
}

/** Aplica los ajustes guardados a process.env. Llamar al arrancar (tras cargar .env) y en cada cambio. */
export function applyAppSettings(): void {
  // Primera pasada: recuerda qué claves vienen del .env (prioridad).
  if (!fromServerEnv.size && !appliedByPanel.size) {
    for (const def of APP_SETTINGS) if (process.env[def.key]?.trim()) fromServerEnv.add(def.key);
  }
  const store = readStore();
  for (const [key, val] of Object.entries(store)) {
    if (!ALLOWED.has(key) || fromServerEnv.has(key)) continue;
    process.env[key] = val;
    appliedByPanel.add(key);
  }
}
