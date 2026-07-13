/**
 * Imágenes de marca para el formato "Post de marca premium", en dos carpetas con roles distintos:
 *  - assets/brand/references/  → REFERENCIAS DE ESTILO: ejemplos de la línea gráfica (un post que
 *    te gustó). El modelo copia el look/layout/logo. Como darle referencias de estilo a ChatGPT.
 *  - assets/brand/products/    → FOTOS DE PRODUCTO: platos, productos, artículos reales. El modelo
 *    los usa como PROTAGONISTAS de la imagen (ej. restaurante: genera el post CON tus platos reales).
 * Ambas se pasan a Nano Banana Pro (edit) / gpt-image-1 (edits). Se gestionan desde el panel.
 * Son contenido de marca privado (no se versiona).
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const NAME_RE = /^[a-z0-9._-]+\.(png|jpg|jpeg|webp)$/i;
const MAX_BYTES = 6 * 1024 * 1024;

export interface BrandImage {
  name: string;
  bytes: number;
}

/** Crea el conjunto de operaciones para una carpeta de imágenes de marca. */
function imageFolder(subdir: string, max: number) {
  const DIR = join(ROOT, "assets", "brand", subdir);

  function list(): BrandImage[] {
    let names: string[] = [];
    try { names = readdirSync(DIR); } catch { return []; }
    return names.filter((n) => NAME_RE.test(n)).sort().map((name) => ({ name, bytes: statSync(join(DIR, name)).size }));
  }
  function valid(name: string): string {
    if (!NAME_RE.test(name) || name !== basename(name)) throw new Error("Nombre inválido (png/jpg/webp)");
    return name;
  }
  function save(name: string, dataBase64: string): void {
    if (list().length >= max) throw new Error(`Máximo ${max} imágenes (borra alguna primero)`);
    const n = valid(name);
    const buf = Buffer.from(dataBase64, "base64");
    if (!buf.length) throw new Error("Archivo vacío");
    if (buf.length > MAX_BYTES) throw new Error("Archivo demasiado grande (máx 6 MB)");
    mkdirSync(DIR, { recursive: true });
    writeFileSync(join(DIR, n), buf);
  }
  function remove(name: string): void {
    unlinkSync(join(DIR, valid(name)));
  }
  function read(name: string): { buffer: Buffer; mime: string } {
    const n = valid(name);
    const ext = extname(n).toLowerCase();
    const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
    return { buffer: readFileSync(join(DIR, n)), mime };
  }
  function dataUris(): string[] {
    const out: string[] = [];
    for (const { name } of list()) {
      try { const { buffer, mime } = read(name); out.push(`data:${mime};base64,${buffer.toString("base64")}`); } catch { /* ignora */ }
    }
    return out;
  }
  return { list, save, remove, read, dataUris, has: () => list().length > 0 };
}

const styleRefs = imageFolder("references", 4);
const products = imageFolder("products", 8);

// ---- Referencias de estilo ----
export const listBrandReferences = styleRefs.list;
export const saveBrandReference = styleRefs.save;
export const deleteBrandReference = styleRefs.remove;
export const readBrandReference = styleRefs.read;
export const brandReferenceDataUris = styleRefs.dataUris;
export const hasBrandReferences = styleRefs.has;

// ---- Fotos de producto ----
export const listBrandProducts = products.list;
export const saveBrandProduct = products.save;
export const deleteBrandProduct = products.remove;
export const readBrandProduct = products.read;
export const brandProductDataUris = products.dataUris;
export const hasBrandProducts = products.has;
