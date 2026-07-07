/** Lee config/brand.json (identidad básica) para inyectar nombre, colores y logo en el sistema. */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface BrandConfig {
  name: string;
  tagline: string;
  language: string;
  ctaDefault: string;
  logoFile: string;
  colors: { primary: string; primaryLight: string; accent: string; dark: string };
}

const DEFAULTS: BrandConfig = {
  name: "TU EMPRESA",
  tagline: "",
  language: "es",
  ctaDefault: "Escríbenos por WhatsApp",
  logoFile: "logo-horizontal-white.svg",
  colors: { primary: "#5B2DC4", primaryLight: "#7B4DDB", accent: "#00D4AA", dark: "#0F0F1A" },
};

let cache: BrandConfig | null = null;
export function loadBrandConfig(): BrandConfig {
  if (cache) return cache;
  let cfg: BrandConfig;
  try {
    const raw = JSON.parse(readFileSync(join(ROOT, "config", "brand.json"), "utf8"));
    cfg = { ...DEFAULTS, ...raw, colors: { ...DEFAULTS.colors, ...(raw.colors ?? {}) } };
  } catch {
    cfg = DEFAULTS;
  }
  cache = cfg;
  return cfg;
}

/** #RRGGBB → color ASS &H00BBGGRR (alfa opaco). Para bordes/colores de subtítulos. */
export function hexToAssBGR(hex: string): string {
  const h = hex.replace("#", "");
  const r = h.slice(0, 2), g = h.slice(2, 4), b = h.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}
