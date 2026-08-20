/**
 * Cola de aprobación / historial. Backend configurable por QUEUE_STORE:
 *   local (default) → queue.json    ·    d1 → Cloudflare D1 (src/queue/d1.ts)
 * Los assets se suben a S3/R2 si ASSET_STORE=s3 (src/lib/assets.ts).
 * API async y estable: addToQueue / listQueue / updateStatus.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { publishAssets } from "../lib/assets.js";

const QUEUE_PATH = join(dirname(fileURLToPath(import.meta.url)), "queue.json");
// Se lee de forma PEREZOSA (en cada llamada), no al cargar el módulo: así garantizamos que
// dotenv ya cargó el .env sin importar el orden de imports del entrypoint (CLI/panel/scheduler).
const backend = (): string => (process.env.QUEUE_STORE ?? "local").toLowerCase();

export type Status = "pending" | "approved" | "rejected" | "published";
export const STATUSES: Status[] = ["pending", "approved", "rejected", "published"];

/** Comentario del humano al cambiar el estado (sobre todo: por qué se rechazó). */
export interface Review {
  feedback?: string;
  by?: string;
}

/** Referencia a un post ya publicado (para luego medir su rendimiento). */
export interface PostRef {
  network: string;
  id: string;
  at: string;
}

/** Foto de las métricas orgánicas de una pieza publicada + un score de engagement. */
export interface PostInsights {
  at: string;
  metrics: Record<string, number>;
  score: number;
}

export interface QueueItem {
  id: string;
  createdAt: string;
  status: Status;
  platform: string;
  format: string; // reel | motion | ugc | carousel | post | design
  pillar?: string;
  topic?: string;
  caption: string;
  hashtags: string[];
  assets: { image?: string; video?: string; voice?: string; images?: string[] };
  dir: string;
  /** Por qué se rechazó (o se aprobó con comentario). Alimenta el aprendizaje: ver src/lib/learnings.ts. */
  feedback?: string;
  /** Quién revisó y cuándo (para mostrar en el panel y ordenar el aprendizaje). */
  reviewedBy?: string;
  reviewedAt?: string;
  /** Posts publicados en cada red (se llena al publicar) — base del bucle de rendimiento. */
  posts?: PostRef[];
  /** Métricas orgánicas + score, refrescadas en segundo plano tras publicar. Ver lib/performance.ts. */
  insights?: PostInsights;
  /** Costo estimado de generar la pieza (APIs de imagen/video/voz). Ver lib/usage.ts. */
  cost?: { usd: number; byProvider: Record<string, { calls: number; usd: number }>; estimated: true };
}

// ---------- backend local (queue.json) ----------
// Las MUTACIONES van serializadas por un lock de promesa: el panel lanza varios jobs en
// paralelo (Set) y sin lock dos read-modify-write simultáneos se pisan y pierden piezas.
let localLock: Promise<unknown> = Promise.resolve();
function withLocalLock<T>(fn: () => T): Promise<T> {
  const run = localLock.then(fn);
  localLock = run.catch(() => undefined);
  return run;
}

function localRead(): { items: QueueItem[] } {
  try {
    return JSON.parse(readFileSync(QUEUE_PATH, "utf8"));
  } catch {
    return { items: [] };
  }
}
function localAdd(item: QueueItem): Promise<void> {
  return withLocalLock(() => {
    const q = localRead();
    // Regenerar reusa el mismo id (equivalente al INSERT OR REPLACE de D1): sin duplicados.
    q.items = q.items.filter((i) => i.id !== item.id);
    q.items.unshift(item);
    writeFileSync(QUEUE_PATH, JSON.stringify(q, null, 2));
  });
}
function localUpdate(id: string, status: Status, review?: Review): Promise<QueueItem | null> {
  return withLocalLock(() => {
    const q = localRead();
    const item = q.items.find((i) => i.id === id);
    if (!item) return null;
    item.status = status;
    if (review) {
      // Un feedback vacío NO borra el anterior (ej. al publicar una pieza ya revisada).
      if (review.feedback?.trim()) item.feedback = review.feedback.trim();
      item.reviewedBy = review.by;
      item.reviewedAt = new Date().toISOString();
    }
    writeFileSync(QUEUE_PATH, JSON.stringify(q, null, 2));
    return item;
  });
}

// ---------- API pública (async, elige backend) ----------
export async function addToQueue(item: QueueItem): Promise<void> {
  const finalItem = await publishAssets(item); // sube a S3/R2 si está activo
  if (backend() === "d1") {
    const { d1Add } = await import("./d1.js");
    return d1Add(finalItem);
  }
  await localAdd(finalItem);
}

export async function listQueue(): Promise<QueueItem[]> {
  if (backend() === "d1") {
    const { d1List } = await import("./d1.js");
    return d1List();
  }
  return localRead().items;
}

/**
 * Cambia el estado de una pieza. `review` guarda POR QUÉ (la razón del rechazo que escribe
 * el humano en el panel) — es la materia prima del aprendizaje (src/lib/learnings.ts).
 */
export async function updateStatus(id: string, status: Status, review?: Review): Promise<QueueItem | null> {
  if (backend() === "d1") {
    const { d1UpdateStatus } = await import("./d1.js");
    return d1UpdateStatus(id, status, review);
  }
  return localUpdate(id, status, review);
}

/** Elimina una pieza de la cola/historial (los assets se borran aparte con deleteAssets). */
export async function deleteItem(id: string): Promise<boolean> {
  if (backend() === "d1") {
    const { d1Delete } = await import("./d1.js");
    return d1Delete(id);
  }
  return withLocalLock(() => {
    const q = localRead();
    const before = q.items.length;
    q.items = q.items.filter((i) => i.id !== id);
    if (q.items.length === before) return false;
    writeFileSync(QUEUE_PATH, JSON.stringify(q, null, 2));
    return true;
  });
}

/** Guarda las referencias de los posts publicados (para medir su rendimiento después). */
export async function updatePosts(id: string, posts: PostRef[]): Promise<QueueItem | null> {
  if (backend() === "d1") {
    const { d1UpdatePosts } = await import("./d1.js");
    return d1UpdatePosts(id, posts);
  }
  return withLocalLock(() => {
    const q = localRead();
    const item = q.items.find((i) => i.id === id);
    if (!item) return null;
    item.posts = posts;
    writeFileSync(QUEUE_PATH, JSON.stringify(q, null, 2));
    return item;
  });
}

/** Guarda las métricas orgánicas + score de una pieza publicada. */
export async function updateInsights(id: string, insights: PostInsights): Promise<QueueItem | null> {
  if (backend() === "d1") {
    const { d1UpdateInsights } = await import("./d1.js");
    return d1UpdateInsights(id, insights);
  }
  return withLocalLock(() => {
    const q = localRead();
    const item = q.items.find((i) => i.id === id);
    if (!item) return null;
    item.insights = insights;
    writeFileSync(QUEUE_PATH, JSON.stringify(q, null, 2));
    return item;
  });
}

/** Guarda el costo estimado de generación de una pieza (lib/usage.ts). */
export async function updateCost(id: string, cost: NonNullable<QueueItem["cost"]>): Promise<QueueItem | null> {
  if (backend() === "d1") {
    const { d1UpdateCost } = await import("./d1.js");
    return d1UpdateCost(id, cost);
  }
  return withLocalLock(() => {
    const q = localRead();
    const item = q.items.find((i) => i.id === id);
    if (!item) return null;
    item.cost = cost;
    writeFileSync(QUEUE_PATH, JSON.stringify(q, null, 2));
    return item;
  });
}

/** Actualiza el copy (caption + hashtags) de una pieza — usado por la edición con IA. */
export async function updateCopy(id: string, caption: string, hashtags: string[]): Promise<QueueItem | null> {
  if (backend() === "d1") {
    const { d1UpdateCopy } = await import("./d1.js");
    return d1UpdateCopy(id, caption, hashtags);
  }
  return withLocalLock(() => {
    const q = localRead();
    const item = q.items.find((i) => i.id === id);
    if (!item) return null;
    item.caption = caption;
    item.hashtags = hashtags;
    writeFileSync(QUEUE_PATH, JSON.stringify(q, null, 2));
    return item;
  });
}
