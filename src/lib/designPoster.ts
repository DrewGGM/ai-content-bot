/**
 * Poster de diseño renderizado 100% por CÓDIGO (SVG + sharp) — sin IA, sin API, gratis.
 * Aplica los principios de las skills de diseño: gradiente de marca, orbes glow, grano,
 * tarjeta glassmorphism (double-bezel), eyebrow tag, tipografía fuerte, sombras suaves, CTA pill.
 * Soporta variantes de layout: checklist | stat | quote | feature.
 */
import sharp from "sharp";
import { loadBrandConfig } from "./brandConfig.js";

const FONT = "'Segoe UI', 'Bahnschrift', 'Arial', sans-serif";
const W = 1080, H = 1350, M = 96;

export type DesignVariant = "checklist" | "stat" | "quote" | "feature";

export interface DesignPosterCopy {
  variant?: DesignVariant;
  eyebrow: string;
  headline?: string;
  subline?: string;
  bullets?: string[];
  stat?: string;
  statLabel?: string;
  quote?: string;
  author?: string;
  cta: string;
}

function esc(s: string): string {
  return (s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
}

/** Parte texto en líneas de ~maxChars sin cortar palabras. */
function wrap(text: string, maxChars: number): string[] {
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

function tspans(lines: string[], x: number, lh: number): string {
  return lines.map((l, i) => `<tspan x="${x}" dy="${i === 0 ? 0 : lh}">${esc(l)}</tspan>`).join("");
}

// ---- Fragmentos compartidos ----
function background(c: any): string {
  return `
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <g filter="url(#soft)" opacity="0.6">
      <circle cx="230" cy="380" r="280" fill="${c.primaryLight}"/>
      <circle cx="920" cy="1160" r="320" fill="${c.accent}"/>
    </g>
    <rect width="${W}" height="${H}" fill="url(#grain)" opacity="0.04"/>
    <rect width="${W}" height="${H}" fill="url(#vig)"/>`;
}

function eyebrow(text: string, c: any, y = 300): string {
  if (!text) return "";
  const w = Math.round(text.length * 17 + 64);
  return `
    <rect x="${M}" y="${y}" width="${w}" height="54" rx="27" fill="${c.accent}" fill-opacity="0.12" stroke="${c.accent}" stroke-width="1.5"/>
    <text x="${M + 32}" y="${y + 35}" font-family="${FONT}" font-size="22" font-weight="700" letter-spacing="3.5" fill="${c.accent}">${esc(text.toUpperCase())}</text>`;
}

function ctaPill(text: string, c: any): string {
  if (!text) return "";
  const w = Math.round(text.length * 19 + 76);
  return `
    <rect x="${M}" y="${H - 156}" width="${w}" height="78" rx="39" fill="${c.accent}"/>
    <text x="${M + 40}" y="${H - 105}" font-family="${FONT}" font-size="30" font-weight="800" fill="#06121a">${esc(text)}</text>`;
}

function glassCard(x: number, y: number, w: number, h: number): string {
  return `
    <g filter="url(#cardshadow)">
      <rect x="${x - 16}" y="${y - 16}" width="${w + 32}" height="${h + 32}" rx="40" fill="#fff" fill-opacity="0.05" stroke="#fff" stroke-opacity="0.10" stroke-width="1.5"/>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="30" fill="#fff" fill-opacity="0.06" stroke="#fff" stroke-opacity="0.12" stroke-width="1.5"/>
    </g>`;
}

// ---- Variantes (contenido central) ----
function vChecklist(copy: DesignPosterCopy, c: any): string {
  const head = wrap((copy.headline ?? "").toUpperCase(), 16).slice(0, 3);
  const bullets = (copy.bullets ?? []).slice(0, 4);
  const cardY = 770, cardH = 60 + bullets.length * 92 + 30;
  const rows = bullets.map((b, i) => {
    const y = cardY + 86 + i * 92;
    return `
      <circle cx="${M + 54}" cy="${y - 11}" r="29" fill="${c.accent}"/>
      <path d="M ${M + 40} ${y - 12} l 9 10 l 18 -20" fill="none" stroke="#06121a" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="${M + 106}" y="${y}" font-family="${FONT}" font-size="38" font-weight="600" fill="#EAEAF5">${esc(b)}</text>`;
  }).join("");
  return `
    <text x="${M}" y="466" font-family="${FONT}" font-size="86" font-weight="800" fill="#fff" letter-spacing="-1.5">${tspans(head, M, 94)}</text>
    <rect x="${M}" y="${500 + (head.length - 1) * 94}" width="120" height="7" rx="3.5" fill="${c.accent}"/>
    ${glassCard(M, cardY, W - 2 * M, cardH)}
    ${rows}`;
}

function vStat(copy: DesignPosterCopy, c: any): string {
  const stat = copy.stat ?? "";
  // Tamaño dinámico para que SIEMPRE quepa en el ancho útil.
  const fs = Math.max(90, Math.min(210, Math.floor((W - 2 * M) / Math.max(1, stat.length * 0.6))));
  const label = wrap(copy.statLabel ?? "", 24).slice(0, 2);
  const sub = wrap(copy.subline ?? "", 30).slice(0, 3);
  const baseY = 600;
  return `
    <text x="${M}" y="${baseY}" font-family="${FONT}" font-size="${fs}" font-weight="800" fill="#fff" letter-spacing="-4">${esc(stat)}</text>
    <rect x="${M}" y="${baseY + 44}" width="120" height="7" rx="3.5" fill="${c.accent}"/>
    <text x="${M}" y="${baseY + 130}" font-family="${FONT}" font-size="54" font-weight="700" fill="${c.accent}">${tspans(label, M, 62)}</text>
    <text x="${M}" y="${baseY + 130 + label.length * 62 + 70}" font-family="${FONT}" font-size="40" font-weight="500" fill="#C9C9DE">${tspans(sub, M, 54)}</text>`;
}

function vQuote(copy: DesignPosterCopy, c: any): string {
  const q = wrap(copy.quote ?? "", 22).slice(0, 5);
  const quoteY = 560; // arranca debajo del eyebrow
  return `
    <text x="${M - 8}" y="${quoteY - 18}" font-family="Georgia, serif" font-size="170" font-weight="800" fill="${c.accent}" fill-opacity="0.9">“</text>
    <text x="${M}" y="${quoteY + 96}" font-family="${FONT}" font-size="62" font-weight="700" fill="#fff" letter-spacing="-1">${tspans(q, M, 78)}</text>
    <text x="${M}" y="${quoteY + 96 + q.length * 78 + 24}" font-family="${FONT}" font-size="34" font-weight="600" fill="${c.accent}">— ${esc(copy.author ?? "")}</text>`;
}

function vFeature(copy: DesignPosterCopy, c: any): string {
  const head = wrap((copy.headline ?? "").toUpperCase(), 14).slice(0, 4);
  const sub = wrap(copy.subline ?? "", 34).slice(0, 3);
  return `
    <text x="${M}" y="540" font-family="${FONT}" font-size="98" font-weight="800" fill="#fff" letter-spacing="-2">${tspans(head, M, 106)}</text>
    <rect x="${M}" y="${574 + (head.length - 1) * 106}" width="120" height="7" rx="3.5" fill="${c.accent}"/>
    <text x="${M}" y="${680 + (head.length - 1) * 106}" font-family="${FONT}" font-size="42" font-weight="500" fill="#C9C9DE">${tspans(sub, M, 56)}</text>`;
}

export async function renderDesignPoster(copy: DesignPosterCopy): Promise<Buffer> {
  const c = loadBrandConfig().colors;
  const variant = copy.variant ?? "checklist";
  const middle =
    variant === "stat" ? vStat(copy, c) :
    variant === "quote" ? vQuote(copy, c) :
    variant === "feature" ? vFeature(copy, c) :
    vChecklist(copy, c);

  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${c.dark}"/>
        <stop offset="0.55" stop-color="${c.primary}"/>
        <stop offset="1" stop-color="${c.dark}"/>
      </linearGradient>
      <radialGradient id="vig" cx="0.5" cy="0.4" r="0.85">
        <stop offset="0.5" stop-color="#000" stop-opacity="0"/>
        <stop offset="1" stop-color="#000" stop-opacity="0.5"/>
      </radialGradient>
      <filter id="soft"><feGaussianBlur stdDeviation="120"/></filter>
      <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter>
      <filter id="cardshadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="24" stdDeviation="40" flood-color="#000" flood-opacity="0.35"/></filter>
    </defs>
    ${background(c)}
    ${eyebrow(copy.eyebrow, c)}
    ${middle}
    ${ctaPill(copy.cta, c)}
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}
