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
  website?: string; // opcional: se muestra al pie de los posts de marca (ej. "lyroo.com.co")
  industry?: string; // opcional: rubro del negocio (ej. "restaurante", "software", "gimnasio")
  colors: { primary: string; primaryLight: string; accent: string; dark: string; light: string };
}

const DEFAULTS: BrandConfig = {
  name: "TU EMPRESA",
  tagline: "",
  language: "es",
  ctaDefault: "Escríbenos por WhatsApp",
  logoFile: "logo-horizontal-white.svg",
  website: "",
  colors: { primary: "#5B2DC4", primaryLight: "#7B4DDB", accent: "#00D4AA", dark: "#0F0F1A", light: "#FFFFFF" },
};

// Sin caché: el panel permite editar config/brand.json en caliente y cada generación
// debe ver la versión actual. Es un JSON pequeño leído unas pocas veces por pieza.
export function loadBrandConfig(): BrandConfig {
  try {
    const raw = JSON.parse(readFileSync(join(ROOT, "config", "brand.json"), "utf8"));
    return { ...DEFAULTS, ...raw, colors: { ...DEFAULTS.colors, ...(raw.colors ?? {}) } };
  } catch {
    return DEFAULTS;
  }
}

/** #RRGGBB → color ASS &H00BBGGRR (alfa opaco). Para bordes/colores de subtítulos. */
export function hexToAssBGR(hex: string): string {
  const h = hex.replace("#", "");
  const r = h.slice(0, 2), g = h.slice(2, 4), b = h.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}
