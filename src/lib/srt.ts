/** Convierte el alignment por carácter de ElevenLabs en subtítulos (.srt y .ass). */
import type { Alignment } from "../providers/elevenlabs.js";
import { loadBrandConfig, hexToAssBGR } from "./brandConfig.js";

// Lectura perezosa: el panel puede editar config/brand.json en caliente.
const OUTLINE = () => hexToAssBGR(loadBrandConfig().colors.primary); // borde de subtítulos = color primario
const CTA_COLOR = () => hexToAssBGR(loadBrandConfig().colors.accent); // texto del CTA = color de acento

interface W { text: string; start: number; end: number }

/** Reconstruye palabras con tiempos y las agrupa en bloques de `maxWords`. */
function groupWords(a: Alignment, maxWords: number): W[] {
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

  const blocks: W[] = [];
  for (let i = 0; i < words.length; i += maxWords) {
    const g = words.slice(i, i + maxWords);
    blocks.push({ text: g.map((w) => w.text).join(" "), start: g[0].start, end: g[g.length - 1].end });
  }
  return blocks;
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
 * Genera un .ass con resolución 1080x1920 y subtítulos en el TERCIO INFERIOR
 * (Alignment 2 = abajo-centro, MarginV alto). Blanco con borde violeta de marca.
 */
export function alignmentToAss(a: Alignment, maxWords = 4): string {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,58,&H00FFFFFF,&H000000FF,${OUTLINE()},&H64000000,-1,0,0,0,100,100,0,0,1,5,2,2,90,90,320,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = groupWords(a, maxWords)
    .map((b) => `Dialogue: 0,${assTime(b.start)},${assTime(b.end)},Default,,0,0,0,,${b.text.toUpperCase()}`)
    .join("\n");
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
Style: Headline,Arial,74,&H00FFFFFF,&H000000FF,${OUTLINE()},&H64000000,-1,0,0,0,100,100,0,0,1,6,3,8,80,80,300,1
Style: Sub,Arial,66,&H00FFFFFF,&H000000FF,${OUTLINE()},&H64000000,-1,0,0,0,100,100,0,0,1,5,3,5,120,120,0,1
Style: Cta,Arial,54,${CTA_COLOR()},&H000000FF,&H00201010,&H64000000,-1,0,0,0,100,100,0,0,1,5,2,2,90,90,200,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const dur = opts.durationSec;
  const end = assTime(dur);
  const headline = (opts.headline || "").replace(/\r?\n/g, "\\N").toUpperCase();

  const events: string[] = [];
  // Titular: fade-in (+ scale-in si es motion-graphics) y visible casi todo el reel.
  if (headline.trim()) {
    const fx = opts.kinetic
      ? `{\\fad(250,0)\\fscx82\\fscy82\\t(0,380,\\fscx100\\fscy100)}`
      : `{\\fad(280,0)}`;
    events.push(`Dialogue: 1,${assTime(0.2)},${end},Headline,,0,0,0,,${fx}${headline}`);
  }
  // Subtítulos sincronizados (si hay alineación).
  if (opts.alignment) {
    for (const b of groupWords(opts.alignment, opts.maxWords ?? 4)) {
      events.push(`Dialogue: 0,${assTime(b.start)},${assTime(b.end)},Sub,,0,0,0,,${b.text.toUpperCase()}`);
    }
  }
  // CTA en los últimos ~2.5s.
  if (opts.cta?.trim()) {
    const ctaStart = Math.max(0, dur - 2.6);
    events.push(`Dialogue: 2,${assTime(ctaStart)},${end},Cta,,0,0,0,,{\\fad(350,0)}${opts.cta.toUpperCase()}`);
  }
  return header + events.join("\n") + "\n";
}
