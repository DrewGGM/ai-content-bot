/**
 * Dirección de arte premium para imágenes. Destila las skills de diseño instaladas
 * (.agents/skills/high-end-visual-design, frontend-design) en lenguaje apto para modelos
 * de imagen — NO código CSS. Incluye un MOTOR DE VARIACIÓN: cada pieza elige un "vibe"
 * distinto (siempre dentro de la paleta de marca) para que el contenido se vea premium y variado.
 */
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBrandConfig } from "./brandConfig.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Override editable desde el panel (Ajustes → Estilos de diseño). Si existe y tiene
// contenido, REEMPLAZA la dirección de arte por defecto (la paleta de marca se añade
// siempre). Se lee en cada llamada: el panel lo puede cambiar en caliente.
const OVERRIDE_FILE = join(ROOT, "config", "art-direction.md");

function styleOverride(): string {
  try {
    return readFileSync(OVERRIDE_FILE, "utf8").trim();
  } catch {
    return "";
  }
}

/** Para el panel: override actual ("" = usando el default). */
export function readStyleOverride(): string {
  return styleOverride();
}

/** Guarda el override desde el panel; contenido vacío = volver al default. */
export function saveStyleOverride(content: string): void {
  if (Buffer.byteLength(content, "utf8") > 64 * 1024) throw new Error("Demasiado largo (máx 64 KB)");
  if (!content.trim()) {
    try { unlinkSync(OVERRIDE_FILE); } catch { /* no existía */ }
    return;
  }
  writeFileSync(OVERRIDE_FILE, content.trim() + "\n");
}

// Arquetipos de acabado/composición (textura, luz, tipografía) — todos compatibles con la marca.
const VIBES = [
  "ETHEREAL GLASS: glassmorphism — vantablack/deep tinted cards with heavy backdrop blur and thin white hairline highlights, radial mesh gradient glow orbs in the brand colors, wide geometric grotesk typography, OLED-deep base.",
  "SOFT STRUCTURALISM: airy floating components with unbelievably soft, highly diffused ambient shadows, massive bold grotesk headline, immense whitespace, clean and weightless.",
  "EDITORIAL LUXURY: high-contrast variable-serif/display headline, subtle film-grain/paper texture overlay, magazine-grade layout with eyebrow tag, refined and expensive.",
  "CINEMATIC 3D: realistic 3D product/device mockups with accurate materials, dramatic studio key light + soft fill, glossy reflections, shallow depth of field, volumetric light rays.",
];

function pick(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return VIBES[h % VIBES.length];
}

/** Texto por defecto (visible en el panel como punto de partida para personalizar). */
export function defaultArtDirection(): string {
  return artDirectionDefault("ejemplo");
}

export function artDirection(seed = ""): string {
  const { colors } = loadBrandConfig();
  const custom = styleOverride();
  if (custom) {
    return (
      `ART DIRECTION (mandatory — defined by the brand team):\n${custom}\n` +
      `Brand palette (always honor): gradient ${colors.primary} → ${colors.primaryLight} → ${colors.accent} over a ${colors.dark} base.`
    );
  }
  return artDirectionDefault(seed);
}

function artDirectionDefault(seed: string): string {
  const { colors } = loadBrandConfig();
  const vibe = pick(seed || String(Date.now()));
  return (
    "ART DIRECTION (mandatory, agency-grade): engineer a $150k-agency, Awwwards/Dribbble top-shelf visual — " +
    "NOT flat, NOT generic, NOT a template, NOT cheap AI clipart. Obsessive detail and intentional composition.\n" +
    `VIBE FOR THIS PIECE → ${vibe}\n` +
    `Brand palette (always honor): gradient ${colors.primary} → ${colors.primaryLight} → ${colors.accent} over a ${colors.dark} base; ` +
    "rich but tasteful, high contrast, fine film grain/noise for depth, soft vignette, cinematic lighting.\n" +
    "Premium typography (think Clash Display / PP Editorial New / Geist / Plus Jakarta), strong size hierarchy, perfect kerning, impeccable spelling. " +
    "Macro whitespace — let it breathe. Nested 'double-bezel' cards (outer shell + inner core, concentric radii). Eyebrow micro-tags. " +
    "Ultra-light precise iconography (Phosphor/Remix line style). Soft DIFFUSED shadows — never harsh black drop shadows. " +
    "BANNED (instant fail): Inter/Roboto/Arial/Helvetica look, generic 1px gray borders, harsh shadows, cheap stock 3D emoji-icons, symmetric boring grids, watermarks, extra logos. " +
    "Production-ready, crisp, expensive."
  );
}

/** Une el prompt base con la dirección de arte (el seed varía el vibe por pieza). */
export function withArtDirection(prompt: string): string {
  return `${prompt}\n\n${artDirection(prompt)}`;
}
