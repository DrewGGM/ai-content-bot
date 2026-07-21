/** Historial y análisis de la cola para que el planner decida con criterio. */
import { listQueue, type QueueItem } from "./queue/queue.js";

/** Texto compacto con las últimas N piezas: fecha, tipo, pilar, tema, estado. */
export async function recentHistory(n = 12): Promise<string> {
  const items = (await listQueue()).slice(0, n);
  if (!items.length) return "(todavía no hay publicaciones; es la primera pieza)";
  return items
    .map((it) => {
      const date = it.createdAt.slice(0, 10);
      const firstLine = (it.caption || "").split("\n")[0].slice(0, 80);
      return `- ${date} · ${it.format} · pilar:${it.pillar ?? "?"} · ${it.topic ?? it.id} · estado:${it.status} · "${firstLine}"`;
    })
    .join("\n");
}

function tally(items: QueueItem[], key: (i: QueueItem) => string | undefined): Record<string, number> {
  const m: Record<string, number> = {};
  for (const it of items) {
    const k = key(it) || "?";
    m[k] = (m[k] ?? 0) + 1;
  }
  return m;
}
const fmt = (m: Record<string, number>) =>
  Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(", ") || "—";

/**
 * Análisis del historial para guiar al planner:
 *  - qué FORMATOS y PILARES se han usado (para variar),
 *  - qué se APROBÓ (funciona → reforzar el estilo) y qué se RECHAZÓ (evitar repetir ese ángulo).
 */
export async function historyAnalysis(): Promise<string> {
  const all = await listQueue();
  if (!all.length) return "(sin historial — primera pieza; elige el formato/pilar más estratégico)";
  const approved = all.filter((i) => i.status === "approved" || i.status === "published");
  const rejected = all.filter((i) => i.status === "rejected");

  const recentTopics = all.slice(0, 6).map((i) => i.topic ?? i.id);
  // Con el motivo que escribió el humano al rechazar, cuando lo hay: es mucho más útil para el
  // planner saber POR QUÉ falló que solo qué tema era.
  const rejectedTopics = rejected.slice(0, 6).map((i) => {
    const why = i.feedback?.trim().replace(/\s+/g, " ").slice(0, 120);
    return `${i.topic ?? i.id} (${i.format})${why ? ` — motivo: ${why}` : ""}`;
  });

  return [
    `Formatos usados (todos): ${fmt(tally(all, (i) => i.format))}`,
    `Pilares usados (todos): ${fmt(tally(all, (i) => i.pillar))}`,
    `APROBADOS/PUBLICADOS por pilar (lo que funciona → refuerza ese tono): ${fmt(tally(approved, (i) => i.pillar))}`,
    `RECHAZADOS por pilar (revisa qué falló): ${fmt(tally(rejected, (i) => i.pillar))}`,
    `Temas recientes (NO repetir): ${recentTopics.join(" | ") || "—"}`,
    `Temas/ángulos RECHAZADOS (evítalos): ${rejectedTopics.join(" | ") || "—"}`,
  ].join("\n");
}
