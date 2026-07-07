/** Aplica el mapa de pronunciación de knowledge/voice.json. */
import { loadBrandContext } from "../knowledge/loader.js";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Reemplaza la marca por su forma fonética para que el TTS la pronuncie bien. */
export function applyPronunciation(text: string): string {
  const { voice } = loadBrandContext();
  const say: Record<string, string> = voice?.pronunciation?.say ?? {};
  // Más largo primero (ej. "MarcaPro" antes que "Marca").
  const keys = Object.keys(say).sort((a, b) => b.length - a.length);
  let out = text;
  for (const k of keys) {
    out = out.replace(new RegExp(escapeRe(k), "gi"), say[k]);
  }
  return out;
}

/** Corrige el texto de subtítulos para que muestre la marca real (no la forma fonética). */
export function fixSubtitleText(text: string): string {
  const { voice } = loadBrandContext();
  const show: Record<string, string> = voice?.pronunciation?.show ?? {};
  let out = text;
  for (const k of Object.keys(show)) {
    out = out.replace(new RegExp(escapeRe(k), "gi"), show[k]);
  }
  return out;
}
