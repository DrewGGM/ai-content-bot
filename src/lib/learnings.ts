/**
 * APRENDIZAJE a partir de las revisiones humanas.
 *
 * Cuando alguien rechaza una pieza en el panel escribe POR QUÉ (se guarda en
 * QueueItem.feedback). Este módulo cierra el ciclo en dos niveles:
 *
 *  1. CRUDO (siempre, gratis): `feedbackDigest()` lista los rechazos recientes con su razón
 *     y los aciertos aprobados. Se inyecta en el copy, el planner y la edición.
 *  2. DESTILADO (con el LLM): `refreshLearnings()` convierte TODO el historial de razones en
 *     un puñado de reglas estables guardadas en `config/learnings.md`, que también se inyecta.
 *     Se dispara sola tras cada rechazo (en segundo plano) y es editable desde el panel.
 *
 * El archivo destilado es el que hace que el bot "vaya aprendiendo": las razones sueltas se
 * convierten en reglas permanentes que sobreviven aunque el historial reciente cambie.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { listQueue, type QueueItem } from "../queue/queue.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const LEARNINGS_PATH = join(ROOT, "config", "learnings.md");

const MAX_LEARNINGS_CHARS = 4000;

/** Reglas destiladas que el bot ya aprendió (vacío si todavía no hay ninguna). */
export function loadLearnings(): string {
  try {
    return readFileSync(LEARNINGS_PATH, "utf8").trim().slice(0, MAX_LEARNINGS_CHARS);
  } catch {
    return "";
  }
}

export function saveLearnings(text: string): void {
  mkdirSync(dirname(LEARNINGS_PATH), { recursive: true });
  writeFileSync(LEARNINGS_PATH, text.trim().slice(0, MAX_LEARNINGS_CHARS) + "\n");
}

const line = (it: QueueItem) =>
  `- [${it.format}${it.pillar ? " · " + it.pillar : ""}] "${(it.topic ?? it.id).slice(0, 60)}" → ${(it.feedback ?? "").replace(/\s+/g, " ").slice(0, 300)}`;

/**
 * Resumen crudo de las últimas revisiones, para inyectar en cualquier prompt de generación.
 * Solo incluye piezas CON comentario: sin razón escrita no hay nada que aprender.
 */
export async function feedbackDigest(limit = 12): Promise<string> {
  let items: QueueItem[];
  try {
    items = await listQueue();
  } catch {
    return "";
  }
  const withNote = items.filter((i) => i.feedback?.trim());
  const rejected = withNote.filter((i) => i.status === "rejected").slice(0, limit);
  const approved = withNote.filter((i) => i.status === "approved" || i.status === "published").slice(0, 5);
  if (!rejected.length && !approved.length) return "";

  const parts: string[] = [];
  if (rejected.length) {
    parts.push(`RECHAZOS RECIENTES Y SU MOTIVO (no vuelvas a cometer estos errores):\n${rejected.map(line).join("\n")}`);
  }
  if (approved.length) {
    parts.push(`APROBACIONES CON COMENTARIO (lo que sí gustó — refuérzalo):\n${approved.map(line).join("\n")}`);
  }
  return parts.join("\n\n");
}

/**
 * Bloque completo listo para concatenar a un prompt: reglas destiladas + feedback crudo.
 * Devuelve "" si todavía no hay nada aprendido (primeras piezas).
 */
export async function learningGuidance(): Promise<string> {
  const rules = loadLearnings();
  const digest = await feedbackDigest();
  if (!rules && !digest) return "";
  return [
    "===== APRENDIZAJE DE REVISIONES ANTERIORES (PRIORITARIO — el humano ya corrigió esto) =====",
    rules ? `REGLAS APRENDIDAS (respétalas siempre):\n${rules}` : "",
    digest,
  ].filter(Boolean).join("\n\n");
}

// ---------- Destilación con el LLM ----------

/** Correcciones de contexto aplicadas por la IA (para auditar en el panel). */
export type ContextFix = { path: string; why: string };

let running: Promise<ContextFix[]> | null = null;

/**
 * Relee TODO el feedback humano y reescribe `config/learnings.md` con las reglas estables.
 * Se serializa (una sola destilación a la vez) para no lanzar N llamadas si se rechazan
 * varias piezas seguidas. Devuelve las correcciones de contexto aplicadas (si el permiso
 * AI_EDIT_CONTEXT está activo), para dejarlas registradas.
 */
export async function refreshLearnings(): Promise<ContextFix[]> {
  if (running) return running;
  running = distill().finally(() => { running = null; });
  return running;
}

async function distill(): Promise<ContextFix[]> {
  const items = await listQueue();
  const reviewed = items.filter((i) => i.feedback?.trim());
  if (reviewed.length < 2) return []; // con un solo comentario no hay patrón que destilar

  const rejected = reviewed.filter((i) => i.status === "rejected");
  const liked = reviewed.filter((i) => i.status === "approved" || i.status === "published");
  const previous = loadLearnings();

  const { askLLM } = await import("../providers/llm.js");
  const prompt = `Eres el editor jefe del bot de contenido de esta marca. Tu trabajo es convertir el feedback
humano de las revisiones en REGLAS PERMANENTES que el bot aplicará al escribir y diseñar las próximas piezas.

${previous ? `REGLAS QUE YA HABÍAS ESCRITO (consérvalas si siguen siendo válidas, corrígelas si el feedback nuevo las contradice):\n${previous}\n` : ""}
PIEZAS RECHAZADAS Y EL MOTIVO QUE ESCRIBIÓ EL HUMANO:
${rejected.map(line).join("\n") || "(ninguna)"}

PIEZAS APROBADAS CON COMENTARIO POSITIVO:
${liked.map(line).join("\n") || "(ninguna)"}

Devuelve ÚNICAMENTE una lista markdown de 5 a 12 reglas, sin preámbulo ni cierre. Cada regla:
- en imperativo y ACCIONABLE ("Nunca uses…", "Empieza el caption con…", "Evita el formato X para el pilar Y"),
- concreta y verificable, nada de consejos genéricos de marketing,
- basada SOLO en el feedback de arriba (no inventes preferencias que nadie expresó),
- agrupa los motivos que se repiten en una sola regla en vez de repetirlos.

Formato exacto de cada línea: \`- <regla>\``;

  const out = (await askLLM(prompt)).trim();
  const rules = out.split("\n").filter((l) => l.trim().startsWith("-")).join("\n").trim();
  if (rules) saveLearnings(rules);

  return correctContextFacts(rejected);
}

/**
 * Corrección de DATOS en el contexto de la empresa. Solo corre si el admin activó el permiso
 * `AI_EDIT_CONTEXT` (Ajustes → Aprendizaje). Motivación: si rechazas una pieza porque dice
 * "30 días de prueba" y en realidad son 7, el error está en `knowledge/`, no en el estilo —
 * arreglar la regla no sirve, hay que arreglar el dato.
 *
 * Seguridad: la IA NO reescribe archivos enteros; propone reemplazos puntuales y solo se
 * aplican los que casan EXACTAMENTE una vez con el texto actual. Cada archivo tocado deja
 * un `.bak`. Devuelve las correcciones aplicadas (para auditar).
 */
export async function correctContextFacts(rejected: QueueItem[]): Promise<ContextFix[]> {
  const { aiMayEditContext } = await import("./appSettings.js");
  if (!aiMayEditContext() || !rejected.length) return [];

  const { listContextFiles, readContextFile, aiWriteContextFile } = await import("./contextFiles.js");
  const files = listContextFiles().filter((f) => f.path.endsWith(".md"));
  if (!files.length) return [];

  const dump = files
    .map((f) => {
      let body = "";
      try { body = readContextFile(f.path); } catch { return ""; }
      return `----- ${f.path} -----\n${body.slice(0, 4000)}`;
    })
    .filter(Boolean)
    .join("\n\n");

  const { askLLMJson } = await import("../providers/llm.js");
  const prompt = `Un humano rechazó estas piezas de contenido señalando errores:
${rejected.map(line).join("\n")}

Este es el contexto de la empresa que usa el bot para escribir:
${dump}

Pregunta: ¿alguno de esos rechazos revela un DATO FACTUAL EQUIVOCADO O DESACTUALIZADO en el contexto
de arriba (un precio, un plazo, un nombre, una cifra, una función que ya no existe)?

Responde SOLO con los errores de DATO que el feedback demuestre. NO cambies el estilo, el tono ni la
redacción. NO corrijas nada que el feedback no mencione. Si no hay ningún error de dato demostrado,
devuelve una lista vacía.

Devuelve ÚNICAMENTE un JSON válido:
{"fixes": [{"path": "ruta exacta del archivo", "find": "el fragmento EXACTO y literal del archivo que está mal (cópialo tal cual, lo más corto posible pero único)", "replace": "el fragmento corregido", "why": "qué feedback lo demuestra"}]}`;

  let data: any;
  try { data = await askLLMJson(prompt); } catch { return []; }

  const applied: ContextFix[] = [];
  const allowed = new Set(files.map((f) => f.path));
  for (const fix of Array.isArray(data?.fixes) ? data.fixes : []) {
    const path = String(fix?.path ?? "");
    const find = String(fix?.find ?? "");
    const replace = String(fix?.replace ?? "");
    if (!allowed.has(path) || !find || find === replace) continue;
    let body: string;
    try { body = readContextFile(path); } catch { continue; }
    // Solo se aplica si el fragmento es INEQUÍVOCO: si aparece 0 o 2+ veces se descarta,
    // porque un reemplazo global podría destrozar el archivo.
    if (body.split(find).length !== 2) continue;
    if (aiWriteContextFile(path, body.replace(find, replace))) {
      applied.push({ path, why: String(fix?.why ?? "").slice(0, 200) });
    }
  }
  return applied;
}
