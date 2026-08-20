/**
 * CALENDARIO DE CONTENIDO — planifica varias piezas por adelantado en horarios óptimos.
 *
 * Cada slot tiene fecha + hora (Colombia, UTC-5, igual que el scheduler del panel) y, opcional,
 * el formato/tema/plataforma. Al llegar su hora, el scheduler in-process (web/server.ts) genera la
 * pieza (si el slot no trae tema, deja que el planner decida). `planWeek()` llena una semana con la
 * ayuda del LLM, repartiendo las piezas en los MEJORES HORARIOS por red.
 *
 * Se guarda en data/calendar.json (untracked → sobrevive a los deploys).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CAL_PATH = join(ROOT, "data", "calendar.json");

export type SlotStatus = "planned" | "done" | "skipped";
export interface Slot {
  id: string;
  date: string;      // "YYYY-MM-DD" (hora Colombia)
  time: string;      // "HH:MM" (hora Colombia)
  format?: string;   // si falta, el planner decide al generar
  topic?: string;
  platform?: string;
  pillar?: string;
  status: SlotStatus;
  itemId?: string;   // id de la pieza generada
  userId?: string;   // con el agente de quién se genera
}

/**
 * Mejores horarios por red (hora Colombia). Heurística de partida; el bucle de rendimiento
 * (lib/performance.ts) puede afinar esto en el futuro con datos reales de la cuenta.
 */
export const BEST_TIMES: Record<string, string[]> = {
  instagram: ["12:00", "19:00", "21:00"],
  facebook: ["13:00", "20:00"],
  tiktok: ["11:00", "18:00", "22:00"],
  linkedin: ["08:00", "12:00", "17:00"],
};

export function bestTimesFor(platform: string): string[] {
  return BEST_TIMES[platform] ?? BEST_TIMES.instagram;
}

function read(): { slots: Slot[] } {
  try { return JSON.parse(readFileSync(CAL_PATH, "utf8")); } catch { return { slots: [] }; }
}
function write(data: { slots: Slot[] }): void {
  try { mkdirSync(dirname(CAL_PATH), { recursive: true }); } catch { /* ya existe */ }
  writeFileSync(CAL_PATH, JSON.stringify(data, null, 2));
}

export function listSlots(): Slot[] {
  return read().slots.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
}

export function addSlot(s: Omit<Slot, "id" | "status"> & { status?: SlotStatus }): Slot {
  const data = read();
  const slot: Slot = { id: randomBytes(5).toString("hex"), status: "planned", ...s };
  data.slots.push(slot);
  write(data);
  return slot;
}

export function updateSlot(id: string, patch: Partial<Slot>): Slot | null {
  const data = read();
  const slot = data.slots.find((s) => s.id === id);
  if (!slot) return null;
  Object.assign(slot, patch);
  write(data);
  return slot;
}

export function removeSlot(id: string): boolean {
  const data = read();
  const before = data.slots.length;
  data.slots = data.slots.filter((s) => s.id !== id);
  if (data.slots.length === before) return false;
  write(data);
  return true;
}

/** Fecha + minutos actuales en Colombia (UTC-5), para comparar con los slots. */
function colombiaNow(): { minutes: number; date: string } {
  const col = new Date(Date.now() - 5 * 3600 * 1000);
  return { minutes: col.getUTCHours() * 60 + col.getUTCMinutes(), date: col.toISOString().slice(0, 10) };
}

/** Slots cuya hora ya llegó y siguen pendientes (para que el scheduler los genere). */
export function dueSlots(): Slot[] {
  const now = colombiaNow();
  return read().slots.filter((s) => {
    if (s.status !== "planned") return false;
    if (s.date > now.date) return false;               // futuro
    if (s.date < now.date) return true;                // se pasó (día anterior): genérala igual
    const [h, m] = s.time.split(":").map(Number);
    return now.minutes >= (h || 0) * 60 + (m || 0);    // hoy, ya es la hora
  });
}

/** Fecha Colombia + N días como "YYYY-MM-DD". */
function addDays(days: number): string {
  const col = new Date(Date.now() - 5 * 3600 * 1000 + days * 86400 * 1000);
  return col.toISOString().slice(0, 10);
}

/**
 * Llena los próximos `count` días con una pieza cada uno: el LLM propone formato/tema/plataforma/
 * pilar (variando, aprendiendo del historial y del rendimiento), y cada pieza cae en el MEJOR
 * horario de su plataforma. Devuelve los slots creados.
 */
export async function planWeek(count = 7, userId?: string): Promise<Slot[]> {
  const { askLLMJson } = await import("../providers/llm.js");
  const { loadBrandContext } = await import("../knowledge/loader.js");
  const { availableFormats } = await import("./capabilities.js");
  const { recentHistory, historyAnalysis } = await import("../history.js");
  const { learningGuidance } = await import("./learnings.js");
  const { performanceGuidance } = await import("./performance.js");

  const available = availableFormats() as string[];
  const { raw } = loadBrandContext();
  const [history, analysis, learned, performance] = await Promise.all([
    recentHistory(12), historyAnalysis(), learningGuidance(), performanceGuidance(),
  ]);

  const prompt = `Eres el estratega de contenido de la marca. Planifica las PRÓXIMAS ${count} piezas (una por día),
variando formato, pilar y plataforma, sin repetir temas recientes, y equilibrando educar / mostrar producto / conectar.

FORMATOS DISPONIBLES (elige SOLO de estos): ${available.join(", ")}
PLATAFORMAS: instagram, tiktok, facebook, linkedin

ANÁLISIS DEL HISTORIAL:
${analysis}

HISTORIAL RECIENTE:
${history}
${performance ? `\n${performance}\n` : ""}${learned ? `\n${learned}\n` : ""}
Devuelve ÚNICAMENTE un JSON válido:
{"pieces":[{"format":"...","platform":"...","pillar":"...","topic":"tema concreto en español"}]}
Exactamente ${count} piezas, en orden para los próximos ${count} días.

===== ESTRATEGIA Y MARCA =====
${raw.slice(0, 5000)}`;

  let data: any;
  try { data = await askLLMJson(prompt); } catch { data = { pieces: [] }; }
  const pieces: any[] = Array.isArray(data?.pieces) ? data.pieces.slice(0, count) : [];

  const created: Slot[] = [];
  for (let i = 0; i < pieces.length; i++) {
    const p = pieces[i] ?? {};
    const platform = (typeof p.platform === "string" && p.platform) || "instagram";
    const format = available.includes(p.format) ? p.format : undefined;
    const times = bestTimesFor(platform);
    created.push(addSlot({
      date: addDays(i + 1),                 // desde mañana
      time: times[i % times.length],        // rota entre los mejores horarios de la red
      format, topic: typeof p.topic === "string" ? p.topic : undefined,
      platform, pillar: typeof p.pillar === "string" ? p.pillar : undefined,
      userId,
    }));
  }
  return created;
}
