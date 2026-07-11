/**
 * Motor de WORKFLOWS de contenido personalizables (estilo ElevenLabs Flows / fal.ai Workflows):
 * un JSON declara pasos encadenados (imagen IA → animarla → voz → subtítulos → música →
 * ensamblado con marca) y el motor los ejecuta reutilizando los providers del bot.
 *
 * Formato (referencias con "$", como fal.ai):
 *   { "name": "...", "title": "...",
 *     "steps": [ { "id": "img", "type": "image", "input": { "prompt": "$copy.image_prompt" }, "options": {...} } ],
 *     "output": { "video": "$assemble.video" } }
 * - `input` de cada paso: literal, "$input.<campo>" (lo que pide el usuario) o "$<paso>.<salida>".
 * - Los workflows viven en config/workflows/*.json y se editan desde el panel.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { STEP_TYPES, runStep, type StepCtx } from "./steps.js";
import { addToQueue, type QueueItem } from "../queue/queue.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WF_DIR = join(ROOT, "config", "workflows");
const NAME_RE = /^[a-z0-9-]+$/;

export interface WorkflowStep {
  id: string;
  type: string;
  input?: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface WorkflowDef {
  name: string;
  title?: string;
  description?: string;
  steps: WorkflowStep[];
  output?: Record<string, string>;
}

// ---------- almacenamiento (config/workflows/*.json) ----------

export function listWorkflows(): Array<{ name: string; title: string; description: string }> {
  let files: string[] = [];
  try { files = readdirSync(WF_DIR).filter((f) => f.endsWith(".json")); } catch { return []; }
  const out: Array<{ name: string; title: string; description: string }> = [];
  for (const f of files.sort()) {
    try {
      const def = JSON.parse(readFileSync(join(WF_DIR, f), "utf8"));
      out.push({ name: basename(f, ".json"), title: String(def.title ?? basename(f, ".json")), description: String(def.description ?? "") });
    } catch { /* json roto: no se lista */ }
  }
  return out;
}

export function readWorkflow(name: string): WorkflowDef {
  if (!NAME_RE.test(name)) throw new Error("Nombre de workflow inválido");
  const p = join(WF_DIR, `${name}.json`);
  if (!existsSync(p)) throw new Error(`El workflow "${name}" no existe`);
  const def = JSON.parse(readFileSync(p, "utf8")) as WorkflowDef;
  def.name = name;
  return def;
}

export function saveWorkflow(name: string, content: string): void {
  if (!NAME_RE.test(name)) throw new Error("Nombre inválido (minúsculas, números y guiones)");
  if (Buffer.byteLength(content, "utf8") > 64 * 1024) throw new Error("Workflow demasiado grande");
  const def = JSON.parse(content) as WorkflowDef;
  def.name = name;
  validateWorkflow(def);
  mkdirSync(WF_DIR, { recursive: true });
  writeFileSync(join(WF_DIR, `${name}.json`), JSON.stringify(def, null, 2) + "\n");
}

export function deleteWorkflow(name: string): void {
  if (!NAME_RE.test(name)) throw new Error("Nombre de workflow inválido");
  unlinkSync(join(WF_DIR, `${name}.json`));
}

// ---------- validación ----------

const REF_RE = /^\$([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_.-]+)$/;

/** Valida estructura, tipos de paso y que cada referencia "$x.y" apunte a un paso ANTERIOR. */
export function validateWorkflow(def: WorkflowDef): void {
  if (!Array.isArray(def.steps) || !def.steps.length) throw new Error("El workflow necesita al menos un paso en steps[]");
  if (def.steps.length > 20) throw new Error("Máximo 20 pasos");
  const seen = new Set<string>(["input"]);
  for (const s of def.steps) {
    if (!s.id || !/^[a-zA-Z0-9_-]+$/.test(s.id)) throw new Error(`Paso sin id válido`);
    if (seen.has(s.id)) throw new Error(`Paso duplicado: "${s.id}"`);
    if (!STEP_TYPES.includes(s.type as any)) throw new Error(`Paso "${s.id}": tipo desconocido "${s.type}" (usa: ${STEP_TYPES.join(", ")})`);
    for (const [k, v] of Object.entries(s.input ?? {})) {
      if (typeof v === "string" && v.startsWith("$")) {
        const m = v.match(REF_RE);
        if (!m) throw new Error(`Paso "${s.id}": referencia inválida en ${k}: "${v}" (formato $paso.salida)`);
        if (!seen.has(m[1])) throw new Error(`Paso "${s.id}": "${v}" apunta a un paso que no existe o viene DESPUÉS`);
      }
    }
    seen.add(s.id);
  }
  for (const [k, v] of Object.entries(def.output ?? {})) {
    const m = String(v).match(REF_RE);
    if (!m || !seen.has(m[1])) throw new Error(`output.${k}: referencia inválida "${v}"`);
  }
}

// ---------- ejecución ----------

function resolveValue(v: unknown, ctx: Record<string, Record<string, unknown>>): unknown {
  if (typeof v !== "string" || !v.startsWith("$")) return v;
  const m = v.match(REF_RE);
  if (!m) throw new Error(`Referencia inválida: "${v}"`);
  const [, stepId, path] = m;
  const bag = ctx[stepId];
  if (!bag) throw new Error(`"${v}": el paso "${stepId}" no ha corrido`);
  let cur: unknown = bag;
  for (const part of path.split(".")) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "workflow";
}

/**
 * Ejecuta un workflow y deja la pieza en la cola de aprobación (igual que cualquier formato).
 * El paso `copy` (si existe) define slug/caption/hashtags; si no, se derivan del tema.
 */
export async function runWorkflow(
  def: WorkflowDef,
  opts: { topic: string; platform: string; aspect?: "reel" | "square" | "feed"; instruction?: string; reuse?: { slug: string; createdAt: string } },
): Promise<QueueItem> {
  validateWorkflow(def);
  const createdAt = opts.reuse?.createdAt ?? new Date().toISOString();
  const aspect = opts.aspect ?? "reel";

  // slug provisional (el paso copy puede refinarlo); al regenerar se reusa la carpeta.
  let slug = opts.reuse?.slug ?? `${slugify(opts.topic)}-wf`;
  let outDir = join(ROOT, "assets", "output", slug);
  if (!opts.reuse) for (let i = 2; existsSync(outDir) && i < 100; i++) { slug = `${slugify(opts.topic)}-wf-${i}`; outDir = join(ROOT, "assets", "output", slug); }
  mkdirSync(outDir, { recursive: true });

  const ctx: Record<string, Record<string, unknown>> = {
    input: { topic: opts.topic, tema: opts.topic, instruction: opts.instruction ?? "", aspect },
  };
  const stepCtx: StepCtx = { outDir, slug, aspect, topic: opts.topic, instruction: opts.instruction };

  for (const step of def.steps) {
    const inputs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(step.input ?? {})) inputs[k] = resolveValue(v, ctx);
    console.log(`  → [workflow ${def.name}] paso "${step.id}" (${step.type})...`);
    ctx[step.id] = await runStep(step.type, inputs, step.options ?? {}, stepCtx, step.id);
  }

  // Salidas del workflow → pieza en la cola.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(def.output ?? {})) out[k] = resolveValue(v, ctx);

  const copyBag = def.steps.some((s) => s.type === "copy") ? ctx[def.steps.find((s) => s.type === "copy")!.id] : {};
  const caption = String(out.caption ?? copyBag.caption ?? opts.topic);
  const hashtags = Array.isArray(copyBag.hashtags) ? (copyBag.hashtags as string[]) : [];
  const video = typeof out.video === "string" ? out.video : undefined;
  const image = typeof out.image === "string" ? out.image : undefined;
  if (!video && !image) throw new Error(`El workflow "${def.name}" no produjo ni video ni imagen (revisa output.video / output.image)`);

  writeFileSync(join(outDir, "post.md"), `# ${slug}\n\n${caption}\n\n${hashtags.join(" ")}\n`);
  const item: QueueItem = {
    id: `${slug}-${createdAt.replace(/[:.]/g, "-")}`,
    // format "workflow:<nombre>" → al regenerar, dispatch sabe qué workflow correr de nuevo.
    createdAt, status: "pending", platform: opts.platform, format: `workflow:${def.name}`,
    pillar: typeof copyBag.pillar === "string" ? copyBag.pillar : def.title ?? def.name,
    topic: opts.topic, caption, hashtags,
    assets: { ...(video ? { video } : {}), ...(image ? { image } : {}) }, dir: outDir,
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(item, null, 2));
  await addToQueue(item);
  return item;
}

/** Plantilla para crear un workflow nuevo desde el panel. */
export function workflowTemplate(): string {
  return JSON.stringify(
    {
      title: "Mi workflow",
      description: "Imagen IA → animarla → voz → subtítulos → música → ensamblado con marca",
      steps: [
        { id: "copy", type: "copy", input: { tema: "$input.topic" }, options: { fields: ["headline", "voiceover", "caption", "hashtags", "image_prompt", "motion_prompt"] } },
        { id: "img", type: "image", input: { prompt: "$copy.image_prompt" } },
        { id: "anim", type: "animate", input: { image: "$img.image", prompt: "$copy.motion_prompt" }, options: { duration: 5 } },
        { id: "voz", type: "tts", input: { text: "$copy.voiceover" } },
        { id: "subs", type: "subtitles", input: { alignment: "$voz.alignment", headline: "$copy.headline" } },
        { id: "musica", type: "music", input: { brief: "$input.topic" } },
        { id: "final", type: "assemble", input: { video: "$anim.video", voice: "$voz.audio", music: "$musica.track", ass: "$subs.ass" }, options: { brandOverlay: true } },
      ],
      output: { video: "$final.video", caption: "$copy.caption" },
    },
    null, 2,
  );
}
