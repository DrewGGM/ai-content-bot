/**
 * Imágenes de REFERENCIA de estilo (assets/brand/references/): ejemplos de piezas que definen
 * la línea gráfica de la marca (p. ej. el post premium que te gustó). Nano Banana Pro (edit) las
 * usa como ancla de estilo para que TODAS las piezas se reconozcan como la misma marca —
 * exactamente como cuando le pasas imágenes de referencia a ChatGPT. Se gestionan desde el panel.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REF_DIR = join(ROOT, "assets", "brand", "references");
const NAME_RE = /^[a-z0-9._-]+\.(png|jpg|jpeg|webp)$/i;
const MAX_BYTES = 6 * 1024 * 1024;
const MAX_REFS = 4; // Nano Banana Pro rinde mejor con pocas referencias fuertes.

export interface BrandReference {
  name: string;
  bytes: number;
}

export function listBrandReferences(): BrandReference[] {
  let names: string[] = [];
  try { names = readdirSync(REF_DIR); } catch { return []; }
  return names
    .filter((n) => NAME_RE.test(n))
    .sort()
    .map((name) => ({ name, bytes: statSync(join(REF_DIR, name)).size }));
}

function validName(name: string): string {
  if (!NAME_RE.test(name) || name !== basename(name)) throw new Error("Nombre inválido (png/jpg/webp)");
  return name;
}

export function saveBrandReference(name: string, dataBase64: string): void {
  if (listBrandReferences().length >= MAX_REFS) throw new Error(`Máximo ${MAX_REFS} referencias (borra alguna primero)`);
  const n = validName(name);
  const buf = Buffer.from(dataBase64, "base64");
  if (!buf.length) throw new Error("Archivo vacío");
  if (buf.length > MAX_BYTES) throw new Error("Archivo demasiado grande (máx 6 MB)");
  mkdirSync(REF_DIR, { recursive: true });
  writeFileSync(join(REF_DIR, n), buf);
}

export function deleteBrandReference(name: string): void {
  unlinkSync(join(REF_DIR, validName(name)));
}

export function readBrandReference(name: string): { buffer: Buffer; mime: string } {
  const n = validName(name);
  const ext = extname(n).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return { buffer: readFileSync(join(REF_DIR, n)), mime };
}

/** Referencias como data URIs (para pasarlas a nano-banana-pro/edit). Vacío si no hay. */
export function brandReferenceDataUris(): string[] {
  const out: string[] = [];
  for (const { name } of listBrandReferences()) {
    try {
      const { buffer, mime } = readBrandReference(name);
      out.push(`data:${mime};base64,${buffer.toString("base64")}`);
    } catch { /* ignora una referencia rota */ }
  }
  return out;
}

export function hasBrandReferences(): boolean {
  return listBrandReferences().length > 0;
}
