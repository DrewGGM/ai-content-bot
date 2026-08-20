/**
 * BUCLE DE RENDIMIENTO — el bot aprende de lo que funcionó de verdad, no solo del rechazo humano.
 *
 * Flujo:
 *  1. Al publicar, se guardan las referencias de los posts (QueueItem.posts). Ver web/server.ts.
 *  2. `refreshInsights()` (cron diario + botón en el panel) jala las métricas ORGÁNICAS de cada
 *     post publicado hace ≥ INSIGHTS_MIN_AGE_HOURS y las guarda con un `score` de engagement.
 *  3. `performanceGuidance()` resume los mejores/peores y se inyecta en el planner y el copy:
 *     pasa de "evita este ángulo (lo rechacé)" a "haz más de esto (rindió 3x)".
 *
 * Solo Meta (IG/FB) por ahora — es donde hay API de insights orgánicos. Nunca lanza: si el token
 * no tiene permiso de insights, cae a like_count/comments_count y sigue.
 */
import { listQueue, updateInsights, type PostInsights, type PostRef, type QueueItem } from "../queue/queue.js";

const GRAPH = "https://graph.facebook.com/v21.0";

/** Horas mínimas tras publicar antes de medir (deja madurar el alcance). Ajustable en Ajustes. */
function minAgeHours(): number {
  const n = Number(process.env.INSIGHTS_MIN_AGE_HOURS);
  return Number.isFinite(n) && n > 0 ? n : 48;
}

/**
 * Score de engagement (relativo, no un %): pondera las señales que más valen para una marca.
 * Guardados y compartidos pesan más que un like porque indican intención real.
 */
function scoreOf(m: Record<string, number>): number {
  const saved = m.saved ?? m.saves ?? 0;
  const shares = m.shares ?? 0;
  const comments = m.comments ?? 0;
  const likes = m.likes ?? 0;
  return saved * 3 + shares * 3 + comments * 2 + likes;
}

async function getJson(url: string): Promise<any> {
  const res = await fetch(url);
  return res.json().catch(() => ({}));
}

/** Métricas orgánicas de un media de Instagram. Tolerante: si insights falla, cae a los contadores. */
async function instagramMetrics(mediaId: string, token: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  // 1) insights (requiere permiso instagram_manage_insights)
  const ins = await getJson(`${GRAPH}/${mediaId}/insights?metric=reach,likes,comments,saved,shares&access_token=${encodeURIComponent(token)}`);
  if (Array.isArray(ins?.data)) {
    for (const d of ins.data) {
      const v = d?.values?.[0]?.value;
      if (typeof v === "number") out[d.name] = v;
    }
  }
  // 2) contadores básicos (siempre disponibles) — rellenan lo que falte
  const basic = await getJson(`${GRAPH}/${mediaId}?fields=like_count,comments_count,permalink&access_token=${encodeURIComponent(token)}`);
  if (typeof basic?.like_count === "number" && out.likes == null) out.likes = basic.like_count;
  if (typeof basic?.comments_count === "number" && out.comments == null) out.comments = basic.comments_count;
  return out;
}

/** Métricas orgánicas de un post de una Página de Facebook. */
async function facebookMetrics(postId: string, token: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const j = await getJson(`${GRAPH}/${postId}?fields=shares,likes.summary(true),comments.summary(true)&access_token=${encodeURIComponent(token)}`);
  if (typeof j?.shares?.count === "number") out.shares = j.shares.count;
  if (typeof j?.likes?.summary?.total_count === "number") out.likes = j.likes.summary.total_count;
  if (typeof j?.comments?.summary?.total_count === "number") out.comments = j.comments.summary.total_count;
  const imp = await getJson(`${GRAPH}/${postId}/insights/post_impressions?access_token=${encodeURIComponent(token)}`);
  const v = imp?.data?.[0]?.values?.[0]?.value;
  if (typeof v === "number") out.reach = v;
  return out;
}

/** Suma las métricas de todos los posts de una pieza (todas sus redes). Devuelve null si no hubo nada. */
async function metricsForPosts(posts: PostRef[]): Promise<Record<string, number> | null> {
  const igToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const fbToken = process.env.FACEBOOK_PAGE_TOKEN || process.env.INSTAGRAM_ACCESS_TOKEN;
  const total: Record<string, number> = {};
  let any = false;
  for (const p of posts) {
    try {
      let m: Record<string, number> | null = null;
      if (p.network === "instagram" && igToken) m = await instagramMetrics(p.id, igToken);
      else if (p.network === "facebook" && fbToken) m = await facebookMetrics(p.id, fbToken);
      if (m && Object.keys(m).length) {
        any = true;
        for (const [k, v] of Object.entries(m)) total[k] = (total[k] ?? 0) + v;
      }
    } catch { /* red caída o post borrado: se ignora, no rompe el resto */ }
  }
  return any ? total : null;
}

function isDue(it: QueueItem): boolean {
  if (!it.posts?.length) return false;
  const publishedAt = Math.min(...it.posts.map((p) => Date.parse(p.at) || Date.now()));
  const ageH = (Date.now() - publishedAt) / 3.6e6;
  if (ageH < minAgeHours()) return false;              // aún muy fresco para medir
  if (ageH > 24 * 45) return false;                    // demasiado viejo: no remedir eternamente
  if (!it.insights) return true;                        // nunca medido
  const staleH = (Date.now() - (Date.parse(it.insights.at) || 0)) / 3.6e6;
  return staleH > 24;                                   // remide máximo 1 vez al día
}

let running: Promise<number> | null = null;

/**
 * Refresca las métricas de las piezas publicadas que toca medir. Serializado (una pasada a la vez).
 * Devuelve cuántas piezas actualizó. Se llama desde el cron diario y desde el panel.
 */
export async function refreshInsights(): Promise<number> {
  if (running) return running;
  running = (async () => {
    let items: QueueItem[];
    try { items = await listQueue(); } catch { return 0; }
    let n = 0;
    for (const it of items) {
      if (!isDue(it)) continue;
      const metrics = await metricsForPosts(it.posts!);
      if (!metrics) continue;
      const insights: PostInsights = { at: new Date().toISOString(), metrics, score: scoreOf(metrics) };
      try { await updateInsights(it.id, insights); n++; } catch { /* sigue con las demás */ }
    }
    return n;
  })().finally(() => { running = null; });
  return running;
}

const fmtMetrics = (m: Record<string, number>) =>
  ["reach", "likes", "comments", "saved", "shares"].filter((k) => m[k] != null).map((k) => `${k}:${m[k]}`).join(" ");

/**
 * Bloque para inyectar en el planner y el copy: qué rindió mejor y peor de lo ya publicado.
 * Devuelve "" si aún no hay piezas medidas (primeras semanas).
 */
export async function performanceGuidance(): Promise<string> {
  let items: QueueItem[];
  try { items = await listQueue(); } catch { return ""; }
  const measured = items.filter((i) => i.insights && i.posts?.length);
  if (measured.length < 3) return ""; // sin muestra suficiente, no sesgar

  const byScore = [...measured].sort((a, b) => (b.insights!.score) - (a.insights!.score));
  const top = byScore.slice(0, 5);
  const bottom = byScore.slice(-3).filter((i) => !top.includes(i));
  const desc = (i: QueueItem) =>
    `- [${i.format}${i.pillar ? " · " + i.pillar : ""}] "${(i.topic ?? i.id).slice(0, 60)}" → score ${i.insights!.score} (${fmtMetrics(i.insights!.metrics)})`;

  return [
    "===== RENDIMIENTO REAL EN REDES (datos, no opiniones — PRIORIZA replicar lo que funcionó) =====",
    `MEJORES piezas por engagement (guardados/compartidos pesan más que likes) — haz MÁS de este formato/ángulo:\n${top.map(desc).join("\n")}`,
    bottom.length ? `PEORES (bajo engagement) — evita repetir este formato/ángulo tal cual:\n${bottom.map(desc).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}
