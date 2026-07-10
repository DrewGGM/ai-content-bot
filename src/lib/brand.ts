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
