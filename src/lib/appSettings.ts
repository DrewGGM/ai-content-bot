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
  type: "enum" | "text" | "number" | "bool";
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
    key: "MAX_HASHTAGS",
    label: "Máximo de hashtags por pieza",
    type: "number",
    options: [],
    default: "5",
    help: "Límite de hashtags en el caption. Instagram TOPA en 5 por publicación desde diciembre de 2025 (y su recomendación es usar pocos y específicos); poner más no da alcance. 0 = sin límite (los que decida la IA).",
  },
  {
    key: "AI_EDIT_CONTEXT",
    label: "Dejar que la IA corrija el contexto de la empresa",
    type: "bool",
    options: [],
    default: "false",
    help: "Si lo activas, cuando rechaces una pieza por un DATO INCORRECTO la IA podrá corregir ese dato en los archivos de knowledge/ y config/ que tú subiste. Guarda una copia .bak de cada archivo antes de tocarlo y queda registrado en Actividad. Desactivado, la IA solo aprende reglas de estilo y NUNCA modifica tu contexto.",
    group: "Aprendizaje",
  },
  {
    key: "TEXT_QA",
    label: "QA de texto (revisar la voz de marca del copy)",
    type: "bool",
    options: [],
    default: "true",
    help: "Antes de encolar, la IA revisa el caption contra la voz de marca y las reglas aprendidas y lo pule si hace falta (tono, promesas infladas, tecnicismos, hook flojo). Es barato (una llamada de copy) y no toca el visual. Desactívalo si prefieres el copy tal cual sale.",
    group: "Aprendizaje",
  },
  {
    key: "AB_HOOKS",
    label: "Generar variantes de hook (A/B)",
    type: "bool",
    options: [],
    default: "true",
    help: "Con cada pieza, la IA propone 2-3 captions alternativos con distinto gancho. En el panel eliges el mejor con un clic (reversible). Es barato (una llamada de copy) y no toca el visual.",
    group: "Aprendizaje",
  },
  {
    key: "INSIGHTS_MIN_AGE_HOURS",
    label: "Horas antes de medir el rendimiento de un post",
    type: "number",
    options: [],
    default: "48",
    help: "Tras publicar, el bot espera estas horas antes de jalar las métricas orgánicas (alcance, guardados, compartidos) de Instagram/Facebook. Deja que el post madure. Esas métricas alimentan al planner: replica lo que funcionó y evita lo que no.",
    group: "Aprendizaje",
  },
  {
    key: "TIKTOK_PRIVACY",
    label: "Privacidad al publicar en TikTok",
    type: "enum",
    options: ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "SELF_ONLY"],
    default: "PUBLIC_TO_EVERYONE",
    help: "Visibilidad del post en TikTok. OJO: si tu app aún NO está auditada por TikTok (modo sandbox), la API SOLO permite SELF_ONLY (privado); usa PUBLIC_TO_EVERYONE cuando tu app esté aprobada.",
    group: "Publicación",
  },
  {
    key: "ASSET_STORE",
    label: "Dónde se guardan los archivos generados",
    type: "enum",
    options: ["local", "s3"],
    default: "local",
    help: "local = en el disco del servidor (assets/output/). s3 = Cloudflare R2 o cualquier S3 (necesario para PUBLICAR en redes, porque Meta debe poder descargar el archivo). Rellena abajo el bucket y las llaves antes de cambiar a s3.",
    group: "Almacenamiento (R2 / S3)",
  },
  {
    key: "S3_BUCKET",
    label: "Bucket",
    type: "text",
    options: [],
    default: "",
    help: "Nombre del bucket de R2/S3 donde se suben imágenes y videos.",
    group: "Almacenamiento (R2 / S3)",
  },
  {
    key: "S3_ENDPOINT",
    label: "Endpoint",
    type: "text",
    options: [],
    default: "",
    help: "En Cloudflare R2: https://<ID_DE_CUENTA>.r2.cloudflarestorage.com (lo ves en R2 → Manage API tokens).",
    group: "Almacenamiento (R2 / S3)",
  },
  {
    key: "S3_REGION",
    label: "Región",
    type: "text",
    options: [],
    default: "auto",
    help: "En R2 déjalo en auto. En AWS S3 pon la región real (ej. us-east-1).",
    group: "Almacenamiento (R2 / S3)",
  },
  {
    key: "S3_PUBLIC_BASE",
    label: "URL pública del bucket (opcional)",
    type: "text",
    options: [],
    default: "",
    help: "Solo si el bucket es público (dominio de R2 o tu CDN). Si lo dejas vacío el bucket queda PRIVADO y el panel sirve los archivos por proxy autenticado — es lo recomendado.",
    group: "Almacenamiento (R2 / S3)",
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
  if (def.type === "bool") {
    v = String(value) === "true" || String(value) === "1" ? "true" : "false";
  } else if (def.type === "enum") {
    v = String(value).toLowerCase().trim();
    if (!def.options.includes(v)) throw new Error(`Valor inválido (opciones: ${def.options.join(", ")})`);
  } else if (def.type === "number") {
    v = String(value).trim();
    if (v !== "" && !/^\d+(\.\d+)?$/.test(v)) throw new Error("Debe ser un número (≥ 0)");
  } else {
    v = String(value).trim().slice(0, 200);
  }
  // Cambiar a s3 sin configurar el bucket dejaría el bot roto (cada generación fallaría al
  // subir): se valida ANTES de guardar y el panel muestra qué falta.
  if (key === "ASSET_STORE" && v === "s3") {
    const missing = ["S3_BUCKET", "S3_ENDPOINT", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter(
      (k) => !process.env[k]?.trim() && !readStore()[k]
    );
    if (missing.length) throw new Error(`Antes de activar S3/R2 configura: ${missing.join(", ")}`);
  }
  const store = readStore();
  if (v === "" && def.type !== "enum") delete store[key]; else store[key] = v;
  writeStore(store);
  if (v === "" && def.type !== "enum") delete process.env[key]; else process.env[key] = v;
  appliedByPanel.add(key);
}

/**
 * ¿La IA tiene permiso para corregir los archivos de contexto de la empresa?
 * Desactivado por defecto: el contexto lo escribe el humano y la IA solo aprende reglas.
 */
export function aiMayEditContext(): boolean {
  return (process.env.AI_EDIT_CONTEXT ?? "false").toLowerCase() === "true";
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
