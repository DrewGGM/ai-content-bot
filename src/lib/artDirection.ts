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

// ---------- PROMPT MAESTRO para POSTS DE MARCA (Nano Banana Pro edit + referencias) ----------
// A diferencia de la escena b-roll (foto sin texto), aquí SÍ se hornea todo: logo, titular,
// subtítulo, mockup del producto, iconos, CTA y web — como el ejemplo premium de ChatGPT.
// La consistencia real la dan las IMÁGENES DE REFERENCIA (assets/brand/references) que se pasan
// aparte; este texto fija la composición y la identidad. El override editable (config/art-direction.md)
// se añade como guía extra.

export interface BrandPosterFields {
  headline: string;
  subline?: string;
  cta?: string;
  visualIdea?: string; // qué mostrar como protagonista (un plato, un producto, un mockup…)
  iconLabels?: string[]; // 2-3 chips/iconos pequeños opcionales
  hasProducts?: boolean; // hay fotos de producto reales que se deben USAR en la imagen
}

/** Contexto de industria para el prompt (del rubro en brand.json, si está). */
function industryPhrase(): string {
  const ind = (loadBrandConfig().industry ?? "").trim();
  return ind ? `, a ${ind} brand,` : "";
}

/** Instrucción para usar las fotos de producto reales como protagonistas. */
function productInstruction(hasProducts?: boolean): string {
  return hasProducts
    ? `Some of the reference images are REAL PRODUCT PHOTOS (e.g. dishes, products, items). FEATURE those exact real products faithfully as the hero of the composition — reproduce them realistically, do NOT invent different ones.`
    : ``;
}

/**
 * Variante SIN TEXTO para proveedores que no saben escribir (ej. Leonardo): pide solo el VISUAL
 * premium de marca (fondo, patrones, mockup) dejando espacio limpio a la izquierda y arriba —
 * el titular, logo, subtítulo, CTA y web se hornean por código encima (overlayBrandPoster).
 */
export function brandPosterVisualPrompt(f: BrandPosterFields): string {
  const b = loadBrandConfig();
  const c = b.colors;
  const custom = styleOverride();
  return [
    `Design a premium, square 1080x1080 background visual for the brand "${b.name}"${industryPhrase()} — modern, clean, high-end, agency-grade advertising quality.`,
    `Palette: ${c.primary}, ${c.primaryLight}, accent ${c.accent}. Soft smooth gradients, tasteful textures fitting the brand, lots of whitespace.`,
    f.visualIdea
      ? `Hero visual on the RIGHT half: ${f.visualIdea}. Render it realistic, crisp, believable and detailed, on-brand — NOT a flat generic illustration.`
      : `Hero visual on the RIGHT half: a realistic, on-brand hero image fitting the topic.`,
    productInstruction(f.hasProducts),
    `CRITICAL: leave the LEFT half and the TOP-LEFT corner as CLEAN EMPTY negative space (just the soft background) for text and logo to be added later.`,
    `Absolutely NO text, NO letters, NO words, NO logo, NO watermark — only the styled scene and the hero subject. Uncluttered, premium, advertising-grade.`,
    custom ? `\nEXTRA BRAND STYLE GUIDANCE:\n${custom}` : ``,
  ].filter(Boolean).join("\n");
}

export function brandPosterPrompt(f: BrandPosterFields): string {
  const b = loadBrandConfig();
  const c = b.colors;
  const website = (b.website ?? "").trim();
  const custom = styleOverride();
  const icons = (f.iconLabels ?? []).filter(Boolean).slice(0, 3);

  return [
    `Design a premium, square 1080x1080 Instagram post for the brand "${b.name}"${industryPhrase()}${b.tagline ? ` (${b.tagline})` : ""}.`,
    `Modern, clean, high-end, agency-grade advertising quality — the kind of feed post a top branding studio would deliver.`,
    ``,
    `BRAND IDENTITY (use the provided reference images as the SINGLE source of truth for style, layout language and the logo):`,
    `- Reproduce the "${b.name}" logo mark from the reference images faithfully; place the logo at the TOP-LEFT. Do not redraw or restyle the logo.`,
    `- Palette: ${c.primary}, ${c.primaryLight}, accent ${c.accent} (honor the mood of the reference images — light or dark). Soft smooth gradients, tasteful textures, lots of whitespace.`,
    `- Typography: modern geometric sans-serif — heavy/bold for the headline, light for the subtitle. Impeccable spelling. Rounded corners, soft diffused shadows.`,
    ``,
    `COMPOSITION:`,
    `- One big headline (left side): "${f.headline}". Emphasize a key word with the accent color ${c.accent}.`,
    f.subline ? `- Short subtitle below the headline: "${f.subline}".` : ``,
    f.visualIdea
      ? `- Hero visual on the right or bottom: ${f.visualIdea}. Realistic, crisp, believable and detailed, on-brand — NOT a flat generic illustration.`
      : `- Hero visual on the right: a realistic, on-brand hero image fitting the topic.`,
    productInstruction(f.hasProducts),
    icons.length ? `- ${icons.length} small rounded icon chips with tiny labels: ${icons.map((i) => `"${i}"`).join(", ")}. Line-style icons only.` : ``,
    f.cta ? `- One discreet call-to-action: "${f.cta}".` : ``,
    website ? `- Small website at the bottom: "${website}".` : ``,
    ``,
    `RULES: premium advertising look, uncluttered, no unnecessary boxes, no excess icons, no watermarks, no extra logos, no lorem ipsum, perfect legible Spanish text exactly as written above. Keep the exact same visual identity as the reference images so every post is recognizably "${b.name}".`,
    custom ? `\nEXTRA BRAND STYLE GUIDANCE (from the team):\n${custom}` : ``,
  ].filter(Boolean).join("\n");
}
