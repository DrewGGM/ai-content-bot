/**
 * Conciencia de capacidades: el bot detecta qué proveedores tiene disponibles (voz, imagen,
 * video, avatar) y qué skills están instaladas, y de ahí deriva qué FORMATOS puede producir.
 * Así el planner solo elige formatos viables y el bot nunca intenta algo que va a fallar
 * (fallback a `design`, que es 100% código).
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { listInstalledSkills, type InstalledSkill } from "./skills.js";
import { copyProviderInfo } from "../providers/llm.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export type Format = "reel" | "motion" | "ugc" | "carousel" | "post" | "brandpost" | "brandcarousel" | "design" | "deck";

export interface Capabilities {
  copy: boolean; // agente/LLM de copy configurado (COPY_PROVIDER)
  copyProvider: string;
  copyDetail: string;
  visionQA: boolean; // el proveedor de copy puede VER imágenes (QA visual)
  voice: boolean; // ElevenLabs + voiceId configurado
  image: boolean; // proveedor de imagen activo con key (fal/openai/gemini)
  video: boolean; // fal (Kling/Veo) — el video image-to-video es solo fal
  ugc: boolean; // HeyGen completo (key + avatar + voz)
  imageProvider: string;
  skills: InstalledSkill[];
  formats: Format[];
  notes: string[];
}

function has(v?: string): boolean {
  return !!(v && v.trim());
}

/** voiceId por defecto desde knowledge/voice.json (sin depender del loader de marca). */
function hasVoiceId(): boolean {
  try {
    const v = JSON.parse(readFileSync(join(ROOT, "knowledge", "voice.json"), "utf8"));
    return has(v?.default?.voiceId);
  } catch {
    return false;
  }
}

export function detectCapabilities(): Capabilities {
  const provider = (process.env.IMAGE_PROVIDER ?? "fal").toLowerCase();
  const imageKey =
    provider === "openai" ? process.env.OPENAI_API_KEY :
    provider === "gemini" ? (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY) :
    provider === "leonardo" ? process.env.LEONARDO_API_KEY :
    process.env.FAL_KEY;

  const cp = copyProviderInfo();
  const copy = cp.ready;
  const voice = has(process.env.ELEVENLABS_API_KEY) && hasVoiceId();
  const image = has(imageKey);
  const video = has(process.env.FAL_KEY); // image-to-video (Kling/Veo) es solo fal
  const ugc = has(process.env.HEYGEN_API_KEY) && has(process.env.HEYGEN_AVATAR_ID) && has(process.env.HEYGEN_VOICE_ID);

  const notes: string[] = [];
  if (!copy) notes.push(`copy: el proveedor "${cp.provider}" no está configurado (${cp.detail})`);
  if (!cp.vision) notes.push(`QA visual: el proveedor "${cp.provider}" no soporta visión — las imágenes se aceptan sin revisión`);
  // SIEMPRE disponibles (código puro, sin API de pago): design, deck y motion (Remotion).
  const formats: Format[] = ["design", "deck", "motion"];
  if (!voice) notes.push("motion: sin ElevenLabs solo modo silencioso (voz/música necesitan la key)");
  if (image) { formats.push("post", "carousel"); } else notes.push(`post/carousel: falta proveedor de imagen (${provider})`);
  // brandpost/brandcarousel (imagen con logo/referencias): fal (Nano Banana Pro edit), openai
  // (gpt-image-1 edits) o leonardo (image guidance + texto por código). gemini aún no usa refs.
  if (image && ["fal", "openai", "leonardo"].includes(provider)) formats.push("brandpost", "brandcarousel");
  else if (provider === "gemini") notes.push("brandpost/brandcarousel (marca premium): con IMAGE_PROVIDER=gemini aún no se pasan referencias — usa fal, openai o leonardo");
  if (image && video && voice) formats.push("reel"); else if (!formats.includes("reel")) notes.push("reel: necesita imagen (fal) + video (fal) + voz");
  if (ugc) formats.push("ugc"); else notes.push("ugc: falta HeyGen (HEYGEN_API_KEY + AVATAR_ID + VOICE_ID)");

  return {
    copy, copyProvider: cp.provider, copyDetail: cp.detail, visionQA: cp.vision,
    voice, image, video, ugc,
    imageProvider: provider,
    skills: listInstalledSkills(),
    formats,
    notes,
  };
}

/** Lista de formatos que el bot puede producir AHORA. */
export function availableFormats(): Format[] {
  return detectCapabilities().formats;
}

/** Reporte legible de capacidades (para el comando `npm run capabilities`). */
export function capabilitiesReport(): string {
  const c = detectCapabilities();
  const yn = (b: boolean) => (b ? "✓" : "✗");
  const lines = [
    "== Proveedores ==",
    `  ${yn(c.copy)} Copy (${c.copyProvider} — ${c.copyDetail})`,
    `  ${yn(c.visionQA)} QA visual (visión del proveedor de copy)`,
    `  ${yn(c.voice)} Voz (ElevenLabs)`,
    `  ${yn(c.image)} Imagen (${c.imageProvider})`,
    `  ${yn(c.video)} Video (fal · Kling/Veo)`,
    `  ${yn(c.ugc)} UGC avatar (HeyGen)`,
    "",
    `== Formatos disponibles (${c.formats.length}) ==`,
    `  ${c.formats.join(", ")}`,
    "",
    `== Skills instaladas (${c.skills.length}) ==`,
    ...c.skills.map((s) => `  · ${s.name}${s.description ? " — " + s.description.slice(0, 80) : ""}`),
  ];
  if (c.notes.length) {
    lines.push("", "== No disponible ==", ...c.notes.map((n) => `  - ${n}`));
  }
  return lines.join("\n");
}
