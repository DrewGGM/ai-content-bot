/**
 * Backend de cola/historial en Cloudflare D1 (SQLite serverless) vía su API REST.
 * Requiere CF_ACCOUNT_ID, CF_D1_DATABASE_ID, CF_API_TOKEN.
 * Se usa cuando QUEUE_STORE=d1. Mismo contrato que el backend local.
 */
import type { QueueItem, Status } from "./queue.js";

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
  };
}

export async function d1Add(item: QueueItem): Promise<void> {
  await query(
    `INSERT OR REPLACE INTO queue (id, created_at, status, platform, format, pillar, topic, caption, hashtags, assets, dir)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [
      item.id, item.createdAt, item.status, item.platform, item.format,
      item.pillar ?? null, item.topic ?? null, item.caption,
      JSON.stringify(item.hashtags ?? []), JSON.stringify(item.assets ?? {}), item.dir,
    ]
  );
}

export async function d1List(): Promise<QueueItem[]> {
  const rows = await query(`SELECT * FROM queue ORDER BY created_at DESC`);
  return rows.map(rowToItem);
}

export async function d1UpdateStatus(id: string, status: Status): Promise<QueueItem | null> {
  await query(`UPDATE queue SET status=? WHERE id=?`, [status, id]);
  const rows = await query(`SELECT * FROM queue WHERE id=? LIMIT 1`, [id]);
  return rows[0] ? rowToItem(rows[0]) : null;
}

export async function d1Delete(id: string): Promise<boolean> {
  const rows = await query(`SELECT id FROM queue WHERE id=? LIMIT 1`, [id]);
  if (!rows.length) return false;
  await query(`DELETE FROM queue WHERE id=?`, [id]);
  return true;
}

export async function d1UpdateCopy(id: string, caption: string, hashtags: string[]): Promise<QueueItem | null> {
  await query(`UPDATE queue SET caption=?, hashtags=? WHERE id=?`, [caption, JSON.stringify(hashtags ?? []), id]);
  const rows = await query(`SELECT * FROM queue WHERE id=? LIMIT 1`, [id]);
  return rows[0] ? rowToItem(rows[0]) : null;
}
