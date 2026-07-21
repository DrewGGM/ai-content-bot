/**
 * Almacenamiento de assets. Por defecto local (assets/output/). Si ASSET_STORE=s3, sube los
 * archivos a S3/R2.
 * - PRIVADO por defecto: guarda una referencia `r2:<key>` y el panel la sirve por proxy
 *   (autenticado). El bucket puede quedar 100% privado.
 * - PÚBLICO opcional: si defines S3_PUBLIC_BASE, reescribe a esa URL pública directa.
 * Env S3: S3_ENDPOINT (R2), S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_REGION, [S3_PUBLIC_BASE].
 */
import { readFileSync, rmSync } from "node:fs";
import { basename, extname } from "node:path";
import type { QueueItem } from "../queue/queue.js";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".mp3": "audio/mpeg", ".srt": "text/plain", ".ass": "text/plain",
};

let _client: any = null;
let _clientFor = "";
async function client() {
  // La config de R2 se edita EN CALIENTE desde el panel (Ajustes → Conexiones), así que el
  // cliente se cachea por huella: si cambian endpoint/región/llaves, se reconstruye.
  const fingerprint = [
    process.env.S3_REGION, process.env.S3_ENDPOINT, process.env.S3_ACCESS_KEY_ID, process.env.S3_SECRET_ACCESS_KEY,
  ].join("|");
  if (_client && _clientFor === fingerprint) return _client;
  const { S3Client } = await import("@aws-sdk/client-s3");
  _clientFor = fingerprint;
  _client = new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT, // R2: https://<acc>.r2.cloudflarestorage.com
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
    forcePathStyle: true,
  });
  return _client;
}

function s3Enabled(): boolean {
  return (process.env.ASSET_STORE ?? "local").toLowerCase() === "s3";
}

/** Sube un archivo local a S3/R2 y devuelve una referencia (privada `r2:<key>` o URL pública). */
async function upload(localPath: string, keyPrefix: string): Promise<string> {
  const { PutObjectCommand } = await import("@aws-sdk/client-s3");
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("Falta S3_BUCKET para ASSET_STORE=s3");
  const key = `${keyPrefix}/${basename(localPath)}`;
  const body = readFileSync(localPath);
  await (await client()).send(new PutObjectCommand({
    Bucket: bucket, Key: key, Body: body, ContentType: MIME[extname(localPath)] ?? "application/octet-stream",
  }));
  // Público solo si se define S3_PUBLIC_BASE; si no, referencia privada servida por el panel.
  const pub = process.env.S3_PUBLIC_BASE?.replace(/\/$/, "");
  return pub ? `${pub}/${key}` : `r2:${key}`;
}

/**
 * Si S3 está activo, sube los assets del item y reescribe sus rutas a URLs públicas.
 * Si no, devuelve el item tal cual (rutas locales).
 */
export async function publishAssets(item: QueueItem): Promise<QueueItem> {
  if (!s3Enabled()) return item;
  const prefix = `output/${basename(item.dir)}`;
  const a = item.assets;
  const next: QueueItem["assets"] = { ...a };
  if (a.image) next.image = await upload(a.image, prefix);
  if (a.video) next.video = await upload(a.video, prefix);
  if (a.voice) next.voice = await upload(a.voice, prefix);
  if (a.images?.length) next.images = await Promise.all(a.images.map((p) => upload(p, prefix)));
  return { ...item, assets: next };
}

/**
 * Devuelve una URL pública TEMPORAL (presigned) para un asset, para que las APIs de redes
 * (Meta, etc.) puedan descargarlo al publicar sin exponer el bucket permanentemente.
 * - `http(s)://…`  → ya es pública, se devuelve tal cual.
 * - `r2:<key>`     → presigned GET de R2 (válida `expiresIn` segundos).
 * - ruta local     → error (para publicar hace falta ASSET_STORE=s3).
 */
export async function presignedUrl(ref: string, expiresIn = 3600): Promise<string> {
  if (/^https?:\/\//i.test(ref)) return ref;
  if (!ref.startsWith("r2:")) {
    throw new Error("El asset es local; para publicar en redes necesitas ASSET_STORE=s3 (R2).");
  }
  const key = ref.slice(3);
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  return getSignedUrl(await client(), new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }), { expiresIn });
}

/**
 * Borra TODOS los assets de una pieza: la carpeta local y, si ASSET_STORE=s3, todos los
 * objetos del prefijo output/<slug>/ en R2 (para no acumular espacio). Idempotente.
 */
export async function deleteAssets(item: QueueItem): Promise<void> {
  // Carpeta local.
  try { rmSync(item.dir, { recursive: true, force: true }); } catch { /* ya no existe */ }

  if (!s3Enabled()) return;
  const slug = item.dir.split(/[\\/]/).filter(Boolean).pop();
  if (!slug) return;
  const bucket = process.env.S3_BUCKET;
  if (!bucket) return;
  const { ListObjectsV2Command, DeleteObjectsCommand } = await import("@aws-sdk/client-s3");
  const c = await client();
  const prefix = `output/${slug}/`;
  let cursor: string | undefined;
  do {
    const list: any = await c.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: cursor }));
    const keys = (list.Contents ?? []).map((o: any) => ({ Key: o.Key }));
    if (keys.length) await c.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys } }));
    cursor = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (cursor);
}
