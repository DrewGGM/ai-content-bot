/**
 * Editor de contexto de empresa desde el panel: knowledge/ + config/ + logos (assets/brand).
 * ALLOWLIST estricta — solo archivos .md y .json de primer nivel en esas dos carpetas;
 * jamás rutas arbitrarias. Los .json se validan antes de guardar.
 * Crear un .md nuevo en knowledge/ o config/ = contexto/prompt extra que el bot inyecta
 * automáticamente (el loader concatena TODOS los .md de esas carpetas).
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIRS = ["knowledge", "config"] as const;
const NAME_RE = /^[a-z0-9._-]+\.(md|json)$/i;
const MAX_BYTES = 512 * 1024;
const BRAND_DIR = join(ROOT, "assets", "brand");
const BRAND_NAME_RE = /^[a-z0-9._-]+\.(svg|png|jpg|jpeg|webp)$/i;
const BRAND_MAX_BYTES = 3 * 1024 * 1024;

export interface ContextFile {
  path: string; // relativa, p. ej. "knowledge/company.md"
  bytes: number;
  mtime: string;
}

export function listContextFiles(): ContextFile[] {
  const out: ContextFile[] = [];
  for (const dir of DIRS) {
    let names: string[] = [];
    try {
      names = readdirSync(join(ROOT, dir));
    } catch { continue; }
    for (const name of names.sort()) {
      if (!NAME_RE.test(name)) continue;
      const abs = join(ROOT, dir, name);
      const st = statSync(abs);
      if (!st.isFile()) continue;
      out.push({ path: `${dir}/${name}`, bytes: st.size, mtime: st.mtime.toISOString() });
    }
  }
  return out;
}

/** Resuelve una ruta relativa contra la allowlist; lanza si no está permitida. */
function resolveAllowed(rel: string): string {
  const parts = rel.replace(/\\/g, "/").split("/");
  if (parts.length !== 2) throw new Error("Ruta no permitida");
  const [dir, name] = parts;
  if (!(DIRS as readonly string[]).includes(dir)) throw new Error("Ruta no permitida");
  if (!NAME_RE.test(name) || name !== basename(name)) throw new Error("Ruta no permitida");
  return join(ROOT, dir, name);
}

export function readContextFile(rel: string): string {
  return readFileSync(resolveAllowed(rel), "utf8");
}

export function writeContextFile(rel: string, content: string): void {
  if (Buffer.byteLength(content, "utf8") > MAX_BYTES) throw new Error("Archivo demasiado grande (máx 512 KB)");
  const abs = resolveAllowed(rel);
  if (abs.endsWith(".json")) {
    try {
      JSON.parse(content);
    } catch (e: any) {
      throw new Error(`JSON inválido: ${e.message}`);
    }
  }
  writeFileSync(abs, content);
}

/**
 * Crea un archivo de contexto NUEVO (.md) en knowledge/ o config/. Como el loader concatena
 * todos los .md de esas carpetas, esto sirve para prompts/estilos personalizados o contexto
 * extra de la empresa sin tocar código.
 */
export function createContextFile(rel: string): void {
  if (!rel.endsWith(".md")) throw new Error("Solo se pueden crear archivos .md");
  const abs = resolveAllowed(rel);
  if (existsSync(abs)) throw new Error("Ese archivo ya existe");
  const title = basename(rel, ".md").replace(/[-_]/g, " ");
  writeFileSync(abs, `# ${title}\n\n> Contexto adicional de la empresa. El bot inyecta este archivo en cada generación\n> (copy, planner, edición). Escribe aquí instrucciones, estilo o información extra.\n\n`);
}

/** Elimina un archivo de contexto (.md de knowledge/ solamente; config/ está protegido). */
export function deleteContextFile(rel: string): void {
  const abs = resolveAllowed(rel);
  if (!rel.startsWith("knowledge/") || !rel.endsWith(".md")) {
    throw new Error("Solo se pueden eliminar archivos .md de knowledge/");
  }
  unlinkSync(abs);
}

// ---------- Logos / assets de marca (assets/brand) ----------

export interface BrandAsset {
  name: string;
  bytes: number;
  isLogo: boolean; // == logoFile de config/brand.json
}

function validBrandName(name: string): string {
  if (!BRAND_NAME_RE.test(name) || name !== basename(name)) throw new Error("Nombre de archivo inválido (svg/png/jpg/webp)");
  return name;
}

export function listBrandAssets(): BrandAsset[] {
  let logoFile = "";
  try {
    logoFile = JSON.parse(readFileSync(join(ROOT, "config", "brand.json"), "utf8")).logoFile ?? "";
  } catch { /* defaults */ }
  let names: string[] = [];
  try {
    names = readdirSync(BRAND_DIR);
  } catch { return []; }
  return names
    .filter((n) => BRAND_NAME_RE.test(n))
    .sort()
    .map((name) => ({ name, bytes: statSync(join(BRAND_DIR, name)).size, isLogo: name === logoFile }));
}

export function readBrandAsset(name: string): { buffer: Buffer; mime: string } {
  const n = validBrandName(name);
  const ext = n.toLowerCase().split(".").pop()!;
  const mime = ext === "svg" ? "image/svg+xml" : ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  return { buffer: readFileSync(join(BRAND_DIR, n)), mime };
}

/** Sube un logo/asset de marca (base64). Ideal: SVG o PNG con transparencia, texto claro. */
export function saveBrandAsset(name: string, dataBase64: string): void {
  const n = validBrandName(name);
  const buf = Buffer.from(dataBase64, "base64");
  if (!buf.length) throw new Error("Archivo vacío");
  if (buf.length > BRAND_MAX_BYTES) throw new Error("Archivo demasiado grande (máx 3 MB)");
  mkdirSync(BRAND_DIR, { recursive: true });
  writeFileSync(join(BRAND_DIR, n), buf);
}

/** Marca un asset como logo principal (logoFile de config/brand.json). */
export function setBrandLogo(name: string): void {
  const n = validBrandName(name);
  if (!existsSync(join(BRAND_DIR, n))) throw new Error("Ese archivo no existe en assets/brand/");
  const path = join(ROOT, "config", "brand.json");
  const cfg = JSON.parse(readFileSync(path, "utf8"));
  cfg.logoFile = n;
  writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
}
