/**
 * Backend de cola/historial en Cloudflare D1 (SQLite serverless) vía su API REST.
 * Requiere CF_ACCOUNT_ID, CF_D1_DATABASE_ID, CF_API_TOKEN.
 * Se usa cuando QUEUE_STORE=d1. Mismo contrato que el backend local.
 */
import type { PostInsights, PostRef, QueueItem, Review, Status } from "./queue.js";

function cfg() {
  const account = process.env.CF_ACCOUNT_ID;
  const db = process.env.CF_D1_DATABASE_ID;
  const token = process.env.CF_API_TOKEN;
  if (!account || !db || !token) {
    throw new Error("Faltan CF_ACCOUNT_ID / CF_D1_DATABASE_ID / CF_API_TOKEN para QUEUE_STORE=d1");
  }
  return { account, db, token };
}

/** Ejecuta SQL en D1 y devuelve las filas del primer resultado. */
async function query(sql: string, params: any[] = []): Promise<any[]> {
  const { account, db, token } = cfg();
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${db}/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params }),
    }
  );
  const json: any = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(`D1 error: ${JSON.stringify(json.errors ?? json).slice(0, 200)}`);
  }
  return json.result?.[0]?.results ?? [];
}

// El esquema se asegura UNA vez por proceso (memoizado). Así una base creada antes de agregar
// el feedback de rechazo se auto-migra al primer uso, sin depender de `npm run init-db`.
let schemaReady: Promise<void> | null = null;
function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = d1InitSchema().catch((e) => {
      schemaReady = null; // si falló, reintentar en la próxima operación
      throw e;
    });
  }
  return schemaReady;
}

/** Crea la tabla si no existe. */
export async function d1InitSchema(): Promise<void> {
  await query(`CREATE TABLE IF NOT EXISTS queue (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL,
    platform TEXT,
    format TEXT,
    pillar TEXT,
    topic TEXT,
    caption TEXT,
    hashtags TEXT,
    assets TEXT,
    dir TEXT
  )`);
  // Migración incremental: bases creadas antes del feedback de rechazo no tienen estas columnas.
  // D1 no soporta ADD COLUMN IF NOT EXISTS, así que se ignora el error de "duplicate column".
  for (const col of ["feedback TEXT", "reviewed_by TEXT", "reviewed_at TEXT", "posts TEXT", "insights TEXT", "cost TEXT"]) {
    try { await query(`ALTER TABLE queue ADD COLUMN ${col}`); } catch { /* ya existe */ }
  }
}

function rowToItem(r: any): QueueItem {
  return {
    id: r.id,
    createdAt: r.created_at,
    status: r.status,
    platform: r.platform,
    format: r.format,
    pillar: r.pillar ?? undefined,
    topic: r.topic ?? undefined,
    caption: r.caption ?? "",
    hashtags: r.hashtags ? JSON.parse(r.hashtags) : [],
    assets: r.assets ? JSON.parse(r.assets) : {},
    dir: r.dir ?? "",
    feedback: r.feedback ?? undefined,
    reviewedBy: r.reviewed_by ?? undefined,
    reviewedAt: r.reviewed_at ?? undefined,
    posts: r.posts ? JSON.parse(r.posts) : undefined,
    insights: r.insights ? JSON.parse(r.insights) : undefined,
    cost: r.cost ? JSON.parse(r.cost) : undefined,
  };
}

export async function d1Add(item: QueueItem): Promise<void> {
  await ensureSchema();
  await query(
    `INSERT OR REPLACE INTO queue (id, created_at, status, platform, format, pillar, topic, caption, hashtags, assets, dir, feedback, reviewed_by, reviewed_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      item.id, item.createdAt, item.status, item.platform, item.format,
      item.pillar ?? null, item.topic ?? null, item.caption,
      JSON.stringify(item.hashtags ?? []), JSON.stringify(item.assets ?? {}), item.dir,
      item.feedback ?? null, item.reviewedBy ?? null, item.reviewedAt ?? null,
    ]
  );
}

export async function d1List(): Promise<QueueItem[]> {
  await ensureSchema();
  const rows = await query(`SELECT * FROM queue ORDER BY created_at DESC`);
  return rows.map(rowToItem);
}

export async function d1UpdateStatus(id: string, status: Status, review?: Review): Promise<QueueItem | null> {
  await ensureSchema();
  const note = review?.feedback?.trim();
  if (review) {
    // COALESCE: un feedback vacío no pisa la razón de rechazo ya guardada.
    await query(
      `UPDATE queue SET status=?, feedback=COALESCE(?, feedback), reviewed_by=?, reviewed_at=? WHERE id=?`,
      [status, note || null, review.by ?? null, new Date().toISOString(), id]
    );
  } else {
    await query(`UPDATE queue SET status=? WHERE id=?`, [status, id]);
  }
  const rows = await query(`SELECT * FROM queue WHERE id=? LIMIT 1`, [id]);
  return rows[0] ? rowToItem(rows[0]) : null;
}

export async function d1Delete(id: string): Promise<boolean> {
  await ensureSchema();
  const rows = await query(`SELECT id FROM queue WHERE id=? LIMIT 1`, [id]);
  if (!rows.length) return false;
  await query(`DELETE FROM queue WHERE id=?`, [id]);
  return true;
}

export async function d1UpdateCopy(id: string, caption: string, hashtags: string[]): Promise<QueueItem | null> {
  await ensureSchema();
  await query(`UPDATE queue SET caption=?, hashtags=? WHERE id=?`, [caption, JSON.stringify(hashtags ?? []), id]);
  const rows = await query(`SELECT * FROM queue WHERE id=? LIMIT 1`, [id]);
  return rows[0] ? rowToItem(rows[0]) : null;
}

export async function d1UpdatePosts(id: string, posts: PostRef[]): Promise<QueueItem | null> {
  await ensureSchema();
  await query(`UPDATE queue SET posts=? WHERE id=?`, [JSON.stringify(posts ?? []), id]);
  const rows = await query(`SELECT * FROM queue WHERE id=? LIMIT 1`, [id]);
  return rows[0] ? rowToItem(rows[0]) : null;
}

export async function d1UpdateInsights(id: string, insights: PostInsights): Promise<QueueItem | null> {
  await ensureSchema();
  await query(`UPDATE queue SET insights=? WHERE id=?`, [JSON.stringify(insights), id]);
  const rows = await query(`SELECT * FROM queue WHERE id=? LIMIT 1`, [id]);
  return rows[0] ? rowToItem(rows[0]) : null;
}

export async function d1UpdateCost(id: string, cost: NonNullable<QueueItem["cost"]>): Promise<QueueItem | null> {
  await ensureSchema();
  await query(`UPDATE queue SET cost=? WHERE id=?`, [JSON.stringify(cost), id]);
  const rows = await query(`SELECT * FROM queue WHERE id=? LIMIT 1`, [id]);
  return rows[0] ? rowToItem(rows[0]) : null;
}
