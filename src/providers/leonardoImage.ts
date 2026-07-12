/**
 * Proveedor de imagen: Leonardo.Ai. Requiere LEONARDO_API_KEY.
 * Flujo con referencias (posts de marca): 1) subir cada referencia (init-image, presigned URL),
 * 2) generar con `controlnets` (Style/Content Reference) apuntando a las imágenes subidas,
 * 3) hacer poll de la generación hasta obtener la URL de la imagen.
 * OJO: Leonardo NO escribe texto tan bien como Nano Banana Pro / gpt-image-1 — buen estilo y
 * mockups, pero los textos finos pueden salir con erratas. Ideal para estética; para posts con
 * mucho texto, fal (nano-banana-pro) sigue siendo el mejor.
 */
import { writeFileSync } from "node:fs";

const BASE = "https://cloud.leonardo.ai/api/rest/v1";
const DEFAULT_MODEL = "b24e16ff-06e3-43eb-8d33-4416c2d75876"; // Leonardo Phoenix (buena calidad + texto)
// Preprocesadores de guía de imagen (docs Leonardo): 67 = Style Reference, 430 = Content Reference.
const STYLE_REF = 67;

// Dimensiones por aspecto (múltiplos de 8, Leonardo).
const DIMS: Record<string, { width: number; height: number }> = {
  "1:1": { width: 1024, height: 1024 },
  "4:5": { width: 832, height: 1024 },
  "9:16": { width: 768, height: 1360 },
  "16:9": { width: 1360, height: 768 },
};

function headers(key: string) {
  return { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${key}` };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function toBytes(ref: string): Promise<{ buf: Buffer; ext: string } | null> {
  const m = ref.match(/^data:([^;]+);base64,(.*)$/s);
  if (m) {
    const t = m[1];
    const ext = t.includes("jpeg") || t.includes("jpg") ? "jpg" : t.includes("webp") ? "webp" : "png";
    return { buf: Buffer.from(m[2], "base64"), ext };
  }
  if (/^https?:\/\//.test(ref)) {
    const res = await fetch(ref);
    if (!res.ok) return null;
    return { buf: Buffer.from(await res.arrayBuffer()), ext: "png" };
  }
  return null;
}

/** Sube una imagen a Leonardo (init-image) y devuelve su id, o null si falla. */
async function uploadInitImage(key: string, ref: string): Promise<string | null> {
  const b = await toBytes(ref);
  if (!b) return null;
  const presign = await fetch(`${BASE}/init-image`, { method: "POST", headers: headers(key), body: JSON.stringify({ extension: b.ext }) });
  if (!presign.ok) throw new Error(`Leonardo init-image ${presign.status}: ${(await presign.text()).slice(0, 160)}`);
  const pj: any = await presign.json();
  const info = pj?.uploadInitImage;
  if (!info?.url || !info?.fields) return null;
  const fields = typeof info.fields === "string" ? JSON.parse(info.fields) : info.fields;

  // Subida al presigned S3 (multipart, sin auth). Los `fields` van ANTES del archivo.
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  form.append("file", new Blob([Uint8Array.from(b.buf)]), `ref.${b.ext}`);
  const up = await fetch(info.url, { method: "POST", body: form });
  if (up.status !== 204 && !up.ok) throw new Error(`Leonardo upload ${up.status}`);
  return String(info.id);
}

export async function leonardoImage(opts: {
  prompt: string;
  dest: string;
  aspect?: "9:16" | "1:1" | "4:5" | "16:9";
  model?: string;
  referenceImages?: string[];
}): Promise<string> {
  const key = process.env.LEONARDO_API_KEY;
  if (!key) throw new Error("Falta LEONARDO_API_KEY en .env (IMAGE_PROVIDER=leonardo)");
  const aspect = opts.aspect ?? "9:16";
  const { width, height } = DIMS[aspect] ?? DIMS["1:1"];
  const refs = (opts.referenceImages ?? []).filter(Boolean);

  // 1) Subir referencias como guía de estilo (máx 4 controlnets).
  const controlnets: any[] = [];
  for (const ref of refs.slice(0, 4)) {
    const id = await uploadInitImage(key, ref);
    if (id) controlnets.push({ initImageId: id, initImageType: "UPLOADED", preprocessorId: STYLE_REF, strengthType: "High" });
  }

  // 2) Generar.
  const payload: any = {
    modelId: opts.model ?? DEFAULT_MODEL,
    prompt: opts.prompt.slice(0, 1490),
    width, height, num_images: 1,
    ...(controlnets.length ? { controlnets } : {}),
  };
  const gen = await fetch(`${BASE}/generations`, { method: "POST", headers: headers(key), body: JSON.stringify(payload) });
  if (!gen.ok) throw new Error(`Leonardo generations ${gen.status}: ${(await gen.text()).slice(0, 200)}`);
  const gj: any = await gen.json();
  const genId = gj?.sdGenerationJob?.generationId;
  if (!genId) throw new Error("Leonardo no devolvió generationId");

  // 3) Poll hasta COMPLETE (máx ~2 min).
  const deadline = Date.now() + 150_000;
  let imageUrl: string | undefined;
  while (Date.now() < deadline) {
    await sleep(5000);
    const st = await fetch(`${BASE}/generations/${genId}`, { headers: headers(key) });
    if (!st.ok) continue;
    const sj: any = await st.json();
    const g = sj?.generations_by_pk;
    if (g?.status === "COMPLETE") { imageUrl = g?.generated_images?.[0]?.url; break; }
    if (g?.status === "FAILED") throw new Error("Leonardo: la generación falló");
  }
  if (!imageUrl) throw new Error("Leonardo: timeout esperando la imagen");

  const img = await fetch(imageUrl);
  if (!img.ok) throw new Error(`Leonardo descarga ${img.status}`);
  writeFileSync(opts.dest, Buffer.from(await img.arrayBuffer()));
  return opts.dest;
}
