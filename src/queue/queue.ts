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
function localUpdate(id: string, status: Status): Promise<QueueItem | null> {
  return withLocalLock(() => {
    const q = localRead();
    const item = q.items.find((i) => i.id === id);
    if (!item) return null;
    item.status = status;
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

export async function updateStatus(id: string, status: Status): Promise<QueueItem | null> {
  if (backend() === "d1") {
    const { d1UpdateStatus } = await import("./d1.js");
    return d1UpdateStatus(id, status);
  }
  return localUpdate(id, status);
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
