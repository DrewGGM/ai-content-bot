/**
 * Biblioteca de música de fondo (assets/music/): pistas LIBRES que el equipo sube desde el
 * panel (YouTube Audio Library, Pixabay Music, etc. — sin costo de API). La IA elige la
 * pista más adecuada al tema de la pieza por el NOMBRE del archivo (usa nombres descriptivos:
 * "energetico-tech.mp3", "calmado-acustico.mp3"). Opcional: assets/music/library.json con
 * descripciones {"archivo.mp3": "descripción"} para afinar la elección.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { askLLMJson } from "../providers/llm.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MUSIC_DIR = join(ROOT, "assets", "music");
const NAME_RE = /^[a-z0-9._ -]+\.(mp3|wav|m4a|ogg|aac)$/i;
const MAX_BYTES = 15 * 1024 * 1024;

export interface MusicTrack {
  name: string;
  bytes: number;
  desc?: string;
}

function descriptions(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(join(MUSIC_DIR, "library.json"), "utf8"));
  } catch {
    return {};
  }
}

export function listMusic(): MusicTrack[] {
  let names: string[] = [];
  try {
    names = readdirSync(MUSIC_DIR);
  } catch {
    return [];
  }
  const desc = descriptions();
  return names
    .filter((n) => NAME_RE.test(n))
    .sort()
    .map((name) => ({ name, bytes: statSync(join(MUSIC_DIR, name)).size, desc: desc[name] }));
}

export function musicAvailable(): boolean {
  return listMusic().length > 0;
}

function validName(name: string): string {
  if (!NAME_RE.test(name) || name !== basename(name)) throw new Error("Nombre inválido (mp3/wav/m4a/ogg/aac)");
  return name;
}

export function saveMusic(name: string, dataBase64: string): void {
  const n = validName(name);
  const buf = Buffer.from(dataBase64, "base64");
  if (!buf.length) throw new Error("Archivo vacío");
  if (buf.length > MAX_BYTES) throw new Error("Archivo demasiado grande (máx 15 MB)");
  mkdirSync(MUSIC_DIR, { recursive: true });
  writeFileSync(join(MUSIC_DIR, n), buf);
}

export function deleteMusic(name: string): void {
  const n = validName(name);
  unlinkSync(join(MUSIC_DIR, n));
}

export function musicPath(name: string): string {
  const n = validName(name);
  const p = join(MUSIC_DIR, n);
  if (!existsSync(p)) throw new Error("La pista no existe");
  return p;
}

// ---------- Descarga automática de música LIBRE (CC0, sin copyright) ----------
// Openverse (api.openverse.org): agregador de bibliotecas libres (Freesound, Jamendo,
// Wikimedia…) con API pública SIN key. Se filtra license=cc0 (dominio público efectivo:
// sin copyright ni atribución obligatoria). Lo descargado se cachea en assets/music/ con
// sus créditos en credits.json y queda disponible para piezas futuras.

async function fetchJson(url: string, timeoutMs = 20_000): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "User-Agent": "content-bot/1.0" }, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function saveCredit(file: string, credit: { title: string; creator: string; license: string; source: string }): void {
  const path = join(MUSIC_DIR, "credits.json");
  let all: Record<string, any> = {};
  try { all = JSON.parse(readFileSync(path, "utf8")); } catch { /* primero */ }
  all[file] = credit;
  writeFileSync(path, JSON.stringify(all, null, 2));
}

// Títulos que claramente NO son música de fondo (Openverse mezcla efectos, voces, fauna…).
const NOT_MUSIC_RE = /\b(bird|speech|spoken|voice|talking|ringtone|sfx|sound effect|noise|alarm|notification|footstep|scream|crowd|applause)\b/i;

/** Busca en Openverse una pista CC0 acorde a la pieza, la descarga y devuelve su ruta. */
async function searchFreeMusic(brief: string): Promise<string | null> {
  try {
    // 1) La IA convierte la pieza en keywords de búsqueda musical (en inglés).
    const kw = await askLLMJson<{ keywords: string }>(
      `Convierte esta pieza de redes sociales en 2-3 KEYWORDS EN INGLÉS para buscar música de fondo libre (género/energía, ej. "upbeat corporate electronic", "calm acoustic ambient").\n\nPIEZA: "${brief.slice(0, 300)}"\n\nDevuelve ÚNICAMENTE JSON: {"keywords": "..."}`
    );
    const q = String(kw.keywords ?? "upbeat corporate").trim().slice(0, 80) || "upbeat corporate";

    // 2) Solo license=cc0 (sin copyright). OJO: NO usar &category=music — ese filtro
    //    devuelve 0 resultados en Openverse. Si la búsqueda completa no da, se degrada
    //    a la primera palabra y a un genérico.
    const queries = [...new Set([q, q.split(/\s+/)[0], "instrumental background"])];
    let candidates: any[] = [];
    for (const query of queries) {
      console.log(`  → buscando música libre (CC0) en Openverse: "${query}"...`);
      const data = await fetchJson(
        `https://api.openverse.org/v1/audio/?q=${encodeURIComponent(query)}&license=cc0&page_size=20`
      );
      candidates = (data.results ?? []).filter((r: any) => {
        const dur = Number(r.duration ?? 0); // ms
        return r.url && dur >= 15_000 && dur <= 360_000 && !NOT_MUSIC_RE.test(String(r.title ?? ""));
      });
      if (candidates.length) break;
    }
    if (!candidates.length) {
      console.warn("  ⚠ Openverse no devolvió pistas CC0 adecuadas para esa búsqueda");
      return null;
    }

    // 2b) La IA elige la pista más "música de fondo" entre los candidatos (por título).
    let chosen = candidates[0];
    if (candidates.length > 1) {
      try {
        const menu = candidates.slice(0, 10).map((r: any, i: number) => `${i}: "${String(r.title ?? "").slice(0, 70)}" (${Math.round(Number(r.duration) / 1000)}s)`).join("\n");
        const pick = await askLLMJson<{ index: number }>(
          `Elige la pista que mejor funcione como MÚSICA DE FONDO instrumental para una pieza de redes sociales ("${brief.slice(0, 200)}"). Evita efectos de sonido, voces o grabaciones que no sean música.\n\n${menu}\n\nDevuelve ÚNICAMENTE JSON: {"index": <número>}`
        );
        const i = Number(pick.index);
        if (Number.isInteger(i) && i >= 0 && i < Math.min(candidates.length, 10)) chosen = candidates[i];
      } catch { /* primera opción */ }
    }

    // 3) Descargar y cachear en la biblioteca (disponible para piezas futuras).
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 60_000);
    let buf: Buffer;
    try {
      const res = await fetch(chosen.url, { headers: { "User-Agent": "content-bot/1.0" }, signal: ctl.signal });
      if (!res.ok) throw new Error(`descarga HTTP ${res.status}`);
      buf = Buffer.from(await res.arrayBuffer());
    } finally {
      clearTimeout(t);
    }
    if (buf.length < 30_000) throw new Error("archivo de audio sospechosamente pequeño");
    const ext = (String(chosen.url).match(/\.(mp3|ogg|wav|m4a)(\?|$)/i)?.[1] ?? "mp3").toLowerCase();
    const safeTitle = String(chosen.title ?? "pista").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-|-$/g, "");
    const file = `auto-${q.replace(/[^a-z0-9]+/gi, "-").slice(0, 30)}-${safeTitle}.${ext}`;
    mkdirSync(MUSIC_DIR, { recursive: true });
    writeFileSync(join(MUSIC_DIR, file), buf);
    saveCredit(file, {
      title: String(chosen.title ?? ""),
      creator: String(chosen.creator ?? ""),
      license: "CC0",
      source: String(chosen.foreign_landing_url ?? chosen.url),
    });
    console.log(`  → música CC0 descargada: ${file} (${(buf.length / 1048576).toFixed(1)} MB)`);
    return join(MUSIC_DIR, file);
  } catch (e: any) {
    console.warn(`  ⚠ búsqueda/descarga de música libre falló: ${e?.message ?? e}`);
    return null;
  }
}

/**
 * Descarga una pista desde una URL dada por el usuario (al generar/editar puede pegar el
 * link de una canción libre) y la guarda en la biblioteca. Devuelve la ruta absoluta.
 * La responsabilidad de la licencia es del usuario (queda anotado en credits.json).
 */
export async function downloadMusicFromUrl(url: string): Promise<string> {
  const u = new URL(url); // valida
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("La URL de música debe ser http(s)");
  console.log(`  → descargando música desde URL del usuario: ${u.hostname}...`);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 60_000);
  let buf: Buffer; let ctype = "";
  try {
    const res = await fetch(url, { headers: { "User-Agent": "content-bot/1.0" }, signal: ctl.signal });
    if (!res.ok) throw new Error(`descarga HTTP ${res.status}`);
    ctype = String(res.headers.get("content-type") ?? "");
    buf = Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(t);
  }
  if (buf.length < 30_000) throw new Error("el archivo descargado es demasiado pequeño para ser una pista");
  if (buf.length > MAX_BYTES) throw new Error("la pista supera el máximo de 15 MB");
  const extFromUrl = u.pathname.match(/\.(mp3|ogg|wav|m4a|aac)$/i)?.[1];
  const extFromType = ctype.includes("ogg") ? "ogg" : ctype.includes("wav") ? "wav" : ctype.includes("mp4") || ctype.includes("m4a") ? "m4a" : ctype.includes("aac") ? "aac" : undefined;
  const ext = (extFromUrl ?? extFromType ?? "mp3").toLowerCase();
  const stem = (u.pathname.split("/").pop() ?? "pista").replace(/\.[a-z0-9]+$/i, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40).replace(/^-|-$/g, "") || "pista";
  const file = validName(`url-${stem}.${ext}`);
  mkdirSync(MUSIC_DIR, { recursive: true });
  writeFileSync(join(MUSIC_DIR, file), buf);
  saveCredit(file, { title: stem, creator: "", license: "URL proporcionada por el usuario (verifica la licencia)", source: url });
  console.log(`  → música descargada: ${file} (${(buf.length / 1048576).toFixed(1)} MB)`);
  return join(MUSIC_DIR, file);
}

/**
 * Obtiene la pista de fondo para una pieza:
 *  1º Si la biblioteca (assets/music, incluye lo auto-descargado) tiene pistas → la IA elige.
 *  2º Si está vacía → la IA busca y DESCARGA una pista CC0 (sin copyright) de Openverse.
 * Devuelve ruta absoluta o null.
 */
export async function obtainMusic(brief: string): Promise<string | null> {
  const picked = await pickMusic(brief);
  if (picked) return picked;
  return searchFreeMusic(brief);
}

/**
 * La IA elige la pista más adecuada para la pieza (por nombre + descripción opcional).
 * Devuelve la RUTA ABSOLUTA de la pista, o null si la biblioteca está vacía.
 * Corre con el perfil activo del job (el agente del usuario que generó la pieza).
 */
export async function pickMusic(brief: string): Promise<string | null> {
  const tracks = listMusic();
  if (!tracks.length) return null;
  if (tracks.length === 1) return musicPath(tracks[0].name);

  const list = tracks.map((t) => `- "${t.name}"${t.desc ? ` — ${t.desc}` : ""}`).join("\n");
  try {
    const r = await askLLMJson<{ file: string }>(
      `Eres el editor musical de la marca. Elige la pista de fondo MÁS adecuada para esta pieza de redes sociales.

PIEZA: "${brief.slice(0, 400)}"

PISTAS DISPONIBLES (el nombre describe el estilo):
${list}

Criterio: que el estilo/energía de la pista acompañe el mensaje (energética para anuncios potentes, calmada para educativo/confianza, etc.).
Devuelve ÚNICAMENTE un JSON válido: {"file": "nombre.exacto.del.archivo"}`
    );
    const chosen = tracks.find((t) => t.name === String(r.file ?? "").trim());
    if (chosen) {
      console.log(`  → música elegida por IA: ${chosen.name}`);
      return musicPath(chosen.name);
    }
  } catch (e: any) {
    console.warn(`  ⚠ elección de música falló (${e?.message ?? e}) — uso la primera pista`);
  }
  return musicPath(tracks[0].name);
}
