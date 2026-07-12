/** Composición de marca: superpone el LOGO REAL (config.logoFile) con un scrim suave (sin banda dura). */
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBrandConfig } from "./brandConfig.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// Lectura perezosa (el panel puede editar config/brand.json en caliente); el caché de
// rasterizado incluye el nombre del logo para invalidarse si la marca cambia de archivo.
const logoCache = new Map<string, Buffer>();
async function logoPng(widthPx: number): Promise<Buffer> {
  const logoFile = loadBrandConfig().logoFile;
  const cacheKey = `${logoFile}:${widthPx}`;
  if (logoCache.has(cacheKey)) return logoCache.get(cacheKey)!;
  const svg = readFileSync(join(ROOT, "assets", "brand", logoFile));
  const png = await sharp(svg, { density: 400 }).resize({ width: widthPx }).png().toBuffer();
  logoCache.set(cacheKey, png);
  return png;
}

/**
 * "Plate" del logo: una banda superior de ancho completo con un degradado oscuro suave
 * (transparente hacia abajo, SIN borde duro) y el logo centrado encima. Ancho = W, alto = plateH.
 * Sirve igual para imágenes (sharp) y para video (ffmpeg overlay en 0,0).
 */
export async function renderLogoPlate(W: number, plateH: number): Promise<Buffer> {
  const DARK = loadBrandConfig().colors.dark;
  const scrimSvg = Buffer.from(
    `<svg width="${W}" height="${plateH}" xmlns="http://www.w3.org/2000/svg">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${DARK}" stop-opacity="0.55"/>
        <stop offset="0.6" stop-color="${DARK}" stop-opacity="0.18"/>
        <stop offset="1" stop-color="${DARK}" stop-opacity="0"/>
      </linearGradient></defs>
      <rect width="${W}" height="${plateH}" fill="url(#g)"/>
    </svg>`
  );
  const logoW = Math.round(W * 0.28);
  const logo = await logoPng(logoW);
  const lMeta = await sharp(logo).metadata();
  const lH = lMeta.height ?? Math.round(logoW * 0.43);
  const top = Math.max(8, Math.round(plateH * 0.32 - lH / 2));
  const left = Math.round((W - logoW) / 2);

  return sharp(scrimSvg)
    .composite([{ input: logo, top, left }])
    .png()
    .toBuffer();
}

/**
 * Logo como IMAGEN DE REFERENCIA para Nano Banana Pro (edit): rasteriza el SVG y lo compone
 * sobre una tarjeta del color oscuro de marca para que la silueta del logo (a menudo blanco)
 * sea visible. El modelo reproduce esta marca en las piezas, recoloreándola según la composición.
 * Devuelve un data URI PNG, o null si no hay logo.
 */
export async function brandLogoReferenceDataUri(): Promise<string | null> {
  try {
    const dark = loadBrandConfig().colors.dark;
    const W = 640, H = 400, logoW = Math.round(W * 0.6);
    const logo = await logoPng(logoW);
    const lMeta = await sharp(logo).metadata();
    const lH = lMeta.height ?? Math.round(logoW * 0.43);
    const card = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="${W}" height="${H}" fill="${dark}"/></svg>`);
    const png = await sharp(card)
      .composite([{ input: logo, top: Math.round((H - lH) / 2), left: Math.round((W - logoW) / 2) }])
      .png().toBuffer();
    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    return null;
  }
}

// ---- Overlay de POST DE MARCA por código (para proveedores que no saben escribir texto, ej. Leonardo) ----
const POSTER_FONT = "'Segoe UI', 'Bahnschrift', 'Arial', sans-serif";
function escXml(s: string): string {
  return (s ?? "").replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]!));
}
function wrapText(text: string, maxChars: number): string[] {
  const words = (text ?? "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars && cur) { lines.push(cur.trim()); cur = w; }
    else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Compone titular + subtítulo + CTA + web + LOGO real sobre una imagen ya generada (útil cuando
 * el proveedor de imagen NO sabe escribir texto — ej. Leonardo: se le pide solo el visual y el
 * texto se hornea aquí, nítido). Un scrim a la izquierda garantiza legibilidad sobre cualquier fondo.
 */
export async function overlayBrandPoster(
  imagePath: string,
  opts: { headline: string; subline?: string; cta?: string; website?: string },
): Promise<void> {
  // Leer a buffer primero: sharp leyendo y escribiendo la MISMA ruta bloquea el archivo en Windows.
  const img = sharp(readFileSync(imagePath));
  const meta = await img.metadata();
  const W = meta.width ?? 1024;
  const H = meta.height ?? 1024;
  const c = loadBrandConfig().colors;
  const M = Math.round(W * 0.075);

  const logoW = Math.round(W * 0.24);
  const logo = await logoPng(logoW);
  const lMeta = await sharp(logo).metadata();
  const lH = lMeta.height ?? Math.round(logoW * 0.43);

  const hlSize = Math.round(W * 0.072);
  const hlLh = Math.round(hlSize * 1.08);
  const hlLines = wrapText(opts.headline, 15).slice(0, 4);
  const hlTop = Math.round(H * 0.40);
  const hlSpans = hlLines.map((l, i) => `<tspan x="${M}" dy="${i === 0 ? 0 : hlLh}">${escXml(l)}</tspan>`).join("");

  const subSize = Math.round(W * 0.036);
  const subLh = Math.round(subSize * 1.3);
  const subTop = hlTop + (hlLines.length - 1) * hlLh + Math.round(hlSize * 0.9);
  const subLines = opts.subline ? wrapText(opts.subline, 30).slice(0, 3) : [];
  const subSpans = subLines.map((l, i) => `<tspan x="${M}" dy="${i === 0 ? 0 : subLh}">${escXml(l)}</tspan>`).join("");

  const ctaTop = subTop + Math.max(0, subLines.length - 1) * subLh + Math.round(W * 0.06);
  const ctaTxt = (opts.cta ?? "").trim();
  const ctaW = Math.round(ctaTxt.length * hlSize * 0.34 + W * 0.06);
  const ctaH = Math.round(W * 0.075);
  const cta = ctaTxt
    ? `<rect x="${M}" y="${ctaTop}" width="${ctaW}" height="${ctaH}" rx="${Math.round(ctaH / 2)}" fill="${c.primary}"/>
       <text x="${M + ctaW / 2}" y="${ctaTop + ctaH * 0.64}" text-anchor="middle" font-family="${POSTER_FONT}" font-size="${Math.round(W * 0.03)}" font-weight="700" fill="#ffffff">${escXml(ctaTxt)}</text>`
    : "";

  const web = (opts.website ?? "").trim()
    ? `<text x="${M}" y="${H - M}" font-family="${POSTER_FONT}" font-size="${Math.round(W * 0.028)}" font-weight="600" fill="#ffffff" fill-opacity="0.9">${escXml(opts.website!.trim())}</text>`
    : "";

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="scrim" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${c.dark}" stop-opacity="0.88"/>
      <stop offset="0.45" stop-color="${c.dark}" stop-opacity="0.6"/>
      <stop offset="0.72" stop-color="${c.dark}" stop-opacity="0"/>
    </linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#scrim)"/>
    <text x="${M}" y="${hlTop}" font-family="${POSTER_FONT}" font-size="${hlSize}" font-weight="800" fill="#ffffff" letter-spacing="-1">${hlSpans}</text>
    ${subSpans ? `<text x="${M}" y="${subTop}" font-family="${POSTER_FONT}" font-size="${subSize}" font-weight="500" fill="#ffffff" fill-opacity="0.9">${subSpans}</text>` : ""}
    ${cta}
    ${web}
  </svg>`;

  const composed = await img
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }, { input: logo, top: M, left: M }])
    .png().toBuffer();
  await sharp(composed).toFile(imagePath);
  void lH; // reservado por si luego se ancla el titular al alto real del logo
}

/** Superpone el plate (scrim + logo) en la parte superior de la imagen y sobreescribe el archivo. */
export async function overlayLogo(imagePath: string): Promise<void> {
  const img = sharp(imagePath);
  const meta = await img.metadata();
  const W = meta.width ?? 1080;
  const H = meta.height ?? 1080;
  const plateH = Math.round(H * 0.16);

  const plate = await renderLogoPlate(W, plateH);
  const composed = await img.composite([{ input: plate, top: 0, left: 0 }]).png().toBuffer();
  await sharp(composed).toFile(imagePath);
}
