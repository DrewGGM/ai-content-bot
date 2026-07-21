/** Convierte el alignment por carácter de ElevenLabs en subtítulos (.srt y .ass). */
import type { Alignment } from "../providers/elevenlabs.js";
import { loadBrandConfig, hexToAssBGR } from "./brandConfig.js";

// Lectura perezosa: el panel puede editar config/brand.json en caliente.
const OUTLINE = () => hexToAssBGR(loadBrandConfig().colors.primary); // borde de subtítulos = color primario
const CTA_COLOR = () => hexToAssBGR(loadBrandConfig().colors.accent); // texto del CTA = color de acento

interface W { text: string; start: number; end: number }
/** Bloque de subtítulo: el texto ya unido + las palabras sueltas (para el karaoke). */
interface Block extends W { words: W[] }

/** Reconstruye las palabras con sus tiempos a partir del alignment por carácter. */
function splitWords(a: Alignment): W[] {
  const { characters: chars, character_start_times_seconds: starts, character_end_times_seconds: ends } = a;
  const words: W[] = [];
  let cur = "";
  let curStart = starts[0] ?? 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c === " " || c === "\n") {
      if (cur.trim()) words.push({ text: cur.trim(), start: curStart, end: ends[i - 1] ?? starts[i] });
      cur = "";
      curStart = starts[i + 1] ?? ends[i];
    } else {
      if (!cur) curStart = starts[i];
      cur += c;
    }
  }
  if (cur.trim()) words.push({ text: cur.trim(), start: curStart, end: ends[ends.length - 1] });
  return words;
}

/** Agrupa las palabras en bloques de `maxWords`, conservando cada palabra con su tiempo. */
function blocksOf(a: Alignment, maxWords: number): Block[] {
  const words = splitWords(a);
  const out: Block[] = [];
  for (let i = 0; i < words.length; i += maxWords) {
    const g = words.slice(i, i + maxWords);
    out.push({ text: g.map((w) => w.text).join(" "), start: g[0].start, end: g[g.length - 1].end, words: g });
  }
  return out;
}

/** Reconstruye palabras con tiempos y las agrupa en bloques de `maxWords`. */
function groupWords(a: Alignment, maxWords: number): W[] {
  return blocksOf(a, maxWords).map(({ text, start, end }) => ({ text, start, end }));
}

function srtTime(t: number): string {
  const ms = Math.floor((t % 1) * 1000);
  const s = Math.floor(t) % 60, m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600);
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(h)}:${p(m)}:${p(s)},${p(ms, 3)}`;
}

export function alignmentToSrt(a: Alignment, maxWords = 4): string {
  return groupWords(a, maxWords)
    .map((b, i) => `${i + 1}\n${srtTime(b.start)} --> ${srtTime(b.end)}\n${b.text.toUpperCase()}\n`)
    .join("\n");
}

function assTime(t: number): string {
  const cs = Math.floor((t % 1) * 100);
  const s = Math.floor(t) % 60, m = Math.floor(t / 60) % 60, h = Math.floor(t / 3600);
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${h}:${p(m)}:${p(s)}.${p(cs)}`;
}

/**
 * Convierte un bloque en eventos KARAOKE: un evento por palabra, en el que la palabra que
 * suena en ese instante se pinta con el color de acento y se agranda un poco.
 * Es el estilo de subtítulo de TikTok/Reels y sube mucho la retención frente al texto plano
 * (el ojo tiene algo que seguir en cada momento).
 */
function karaokeEvents(b: Block, style: string, layer = 0): string[] {
  const accent = CTA_COLOR().replace(/^&H00/, "&H");
  return b.words.map((w, i) => {
    const text = b.words
      .map((x, j) => {
        const t = x.text.toUpperCase();
        return j === i ? `{\\c${accent}&\\fscx112\\fscy112}${t}{\\r${style}}` : t;
      })
      .join(" ");
    // La última palabra del bloque se estira hasta el fin del bloque para no dejar huecos.
    const end = i === b.words.length - 1 ? b.end : b.words[i + 1].start;
    return `Dialogue: ${layer},${assTime(w.start)},${assTime(Math.max(end, w.start + 0.05))},${style},,0,0,0,,${text}`;
  });
}

/**
 * Genera un .ass con resolución 1080x1920 y subtítulos KARAOKE en la zona segura
 * (Alignment 2 = abajo-centro, MarginV alto para no quedar bajo la UI de la app).
 * Blanco con borde de marca; la palabra activa se resalta en el color de acento.
 */
export function alignmentToAss(a: Alignment, maxWords = 4): string {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,68,&H00FFFFFF,&H000000FF,${OUTLINE()},&H96000000,-1,0,0,0,100,100,0,0,1,6,3,2,90,90,420,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = blocksOf(a, maxWords).flatMap((b) => karaokeEvents(b, "Default")).join("\n");
  return header + lines + "\n";
}

/**
 * Capa overlay completa para un reel b-roll: TITULAR (arriba, fade-in),
 * SUBTÍTULOS (sincronizados, abajo) y CTA (final). Resolución 1080x1920.
 * El video animado va debajo; esta capa siempre queda nítida.
 */
export function buildReelOverlayAss(opts: {
  headline: string;
  alignment?: Alignment; // si falta, no se generan subtítulos (ej. UGC con audio propio)
  cta: string;
  durationSec: number;
  maxWords?: number;
  kinetic?: boolean; // titular con entrada animada (scale-in) para motion-graphics
}): string {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Headline,Arial,80,&H00FFFFFF,&H000000FF,${OUTLINE()},&H96000000,-1,0,0,0,100,100,1,0,1,7,4,8,80,80,260,1
Style: Sub,Arial,68,&H00FFFFFF,&H000000FF,${OUTLINE()},&H96000000,-1,0,0,0,100,100,0,0,1,6,3,2,110,110,420,1
Style: Cta,Arial,60,${CTA_COLOR()},&H000000FF,&H00201010,&H96000000,-1,0,0,0,100,100,2,0,1,6,3,2,90,90,430,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const dur = opts.durationSec;
  const end = assTime(dur);
  const headline = (opts.headline || "").replace(/\r?\n/g, "\\N").toUpperCase();

  const events: string[] = [];
  const ctaStart = Math.max(0, dur - 2.6);

  // Titular: entra con scale-in y SE RETIRA a mitad del reel. Antes se quedaba fijo hasta el
  // final y competía con los subtítulos todo el video; el gancho ya cumplió su función en los
  // primeros segundos, que es donde se decide si te quedas.
  if (headline.trim()) {
    const hEnd = Math.min(ctaStart, Math.max(2.8, dur * 0.42));
    const fx = opts.kinetic
      ? `{\\fad(250,420)\\fscx84\\fscy84\\t(0,420,\\fscx100\\fscy100)}`
      : `{\\fad(280,420)\\fscx94\\fscy94\\t(0,520,\\fscx100\\fscy100)}`;
    events.push(`Dialogue: 1,${assTime(0.2)},${assTime(hEnd)},Headline,,0,0,0,,${fx}${headline}`);
  }
  // Subtítulos KARAOKE sincronizados (si hay alineación): la palabra que suena se resalta.
  if (opts.alignment) {
    for (const b of blocksOf(opts.alignment, opts.maxWords ?? 4)) {
      events.push(...karaokeEvents(b, "Sub", 0));
    }
  }
  // CTA en los últimos ~2.5s, con entrada por escala (pop) en vez de un fade plano.
  if (opts.cta?.trim()) {
    events.push(
      `Dialogue: 2,${assTime(ctaStart)},${end},Cta,,0,0,0,,{\\fad(260,0)\\fscx86\\fscy86\\t(0,380,\\fscx104\\fscy104)\\t(380,560,\\fscx100\\fscy100)}${opts.cta.toUpperCase()}`
    );
  }
  return header + events.join("\n") + "\n";
}
