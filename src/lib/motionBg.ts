/** Fondo de marca premium para reels de motion-graphics (sin IA): gradiente + orbes + grano. */
import sharp from "sharp";
import { loadBrandConfig } from "./brandConfig.js";

/**
 * Renderiza un fondo 1080x1920 con gradiente de marca, orbes suaves desenfocados,
 * viñeta y grano fino. Devuelve un PNG buffer. `seed` varía la posición de los orbes.
 */
export async function renderBrandBg(seed = 0): Promise<Buffer> {
  const W = 1080, H = 1920;
  const c = loadBrandConfig().colors;
  // Orbes posicionados de forma "aleatoria" pero determinista según seed.
  const o = (n: number, base: number, span: number) => base + ((seed * 37 + n * 53) % 100) / 100 * span;
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${c.dark}"/>
        <stop offset="0.5" stop-color="${c.primary}"/>
        <stop offset="1" stop-color="${c.dark}"/>
      </linearGradient>
      <radialGradient id="v" cx="0.5" cy="0.42" r="0.75">
        <stop offset="0.55" stop-color="#000000" stop-opacity="0"/>
        <stop offset="1" stop-color="#000000" stop-opacity="0.45"/>
      </radialGradient>
      <filter id="blur"><feGaussianBlur stdDeviation="90"/></filter>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <g filter="url(#blur)" opacity="0.55">
      <circle cx="${o(1, 180, 200)}" cy="${o(2, 250, 300)}" r="240" fill="${c.primaryLight}"/>
      <circle cx="${o(3, 760, 200)}" cy="${o(4, 1300, 400)}" r="300" fill="${c.accent}"/>
      <circle cx="${o(5, 520, 200)}" cy="${o(6, 820, 300)}" r="200" fill="${c.primary}"/>
    </g>
    <rect width="${W}" height="${H}" fill="url(#v)"/>
  </svg>`;

  // Grano fino: ruido monocromo a baja opacidad.
  const grain = await sharp({
    create: { width: W, height: H, channels: 3, background: { r: 128, g: 128, b: 128 }, noise: { type: "gaussian", mean: 128, sigma: 22 } as any },
  }).png().toBuffer().catch(() => null);

  let img = sharp(Buffer.from(svg));
  if (grain) {
    img = sharp(await img.png().toBuffer()).composite([{ input: grain, blend: "overlay", opacity: 0.06 } as any]);
  }
  return img.png().toBuffer();
}
