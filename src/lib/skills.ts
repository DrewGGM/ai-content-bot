/**
 * Skills del agente (.agents/skills/): conocimiento que se inyecta en los prompts de
 * copy/planner (playbooks de CM, tácticas de engagement, skills propias subidas desde
 * el panel). Desde el panel se puede: subir skills nuevas (.md), activar/desactivar
 * cuáles usa la IA (config/skills.json → {"disabled": [...]}) y eliminarlas.
 * Desactivable globalmente con USE_CM_SKILLS=false.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS_DIR = join(ROOT, ".agents", "skills");
const SKILLS_CONFIG = join(ROOT, "config", "skills.json");
const DIR_RE = /^[a-z0-9._-]+$/i;
const MAX_SKILL_BYTES = 512 * 1024;

export interface InstalledSkill {
  name: string; // nombre del frontmatter (o el directorio)
  dir: string; // nombre del directorio (identificador estable)
  description: string;
  enabled: boolean;
  custom: boolean; // subida desde el panel (solo tiene SKILL.md) → se puede eliminar
}

function disabledSet(): Set<string> {
  try {
    const cfg = JSON.parse(readFileSync(SKILLS_CONFIG, "utf8"));
    return new Set(Array.isArray(cfg.disabled) ? cfg.disabled.map(String) : []);
  } catch {
    return new Set();
  }
}

function saveDisabled(disabled: Set<string>): void {
  mkdirSync(dirname(SKILLS_CONFIG), { recursive: true });
  writeFileSync(SKILLS_CONFIG, JSON.stringify({ disabled: [...disabled].sort() }, null, 2) + "\n");
}

/** Lista las skills instaladas en .agents/skills/ leyendo el frontmatter de cada SKILL.md. */
export function listInstalledSkills(): InstalledSkill[] {
  const out: InstalledSkill[] = [];
  if (!existsSync(SKILLS_DIR)) return out;
  const disabled = disabledSet();
  for (const dir of readdirSync(SKILLS_DIR).sort()) {
    const skillDir = join(SKILLS_DIR, dir);
    const skillMd = join(skillDir, "SKILL.md");
    if (!existsSync(skillMd) || !statSync(skillDir).isDirectory()) continue;
    let name = dir;
    let description = "";
    try {
      const txt = readFileSync(skillMd, "utf8");
      const fm = txt.match(/^---\s*([\s\S]*?)\s*---/);
      if (fm) {
        const n = fm[1].match(/name:\s*(.+)/);
        const d = fm[1].match(/description:\s*([\s\S]*?)(?:\n\w+:|$)/);
        if (n) name = n[1].trim();
        if (d) description = d[1].replace(/\s+/g, " ").trim();
      }
    } catch { /* ignora */ }
    // "custom" = subida desde el panel: el directorio solo contiene SKILL.md.
    let custom = false;
    try { custom = readdirSync(skillDir).every((f) => f === "SKILL.md"); } catch { /* no */ }
    out.push({ name, dir, description, enabled: !disabled.has(dir), custom });
  }
  return out;
}

function validDir(dir: string): string {
  if (!DIR_RE.test(dir) || dir !== basename(dir)) throw new Error("Nombre de skill inválido");
  return dir;
}

/** Activa/desactiva una skill (la IA solo usa las activas). */
export function setSkillEnabled(dir: string, enabled: boolean): void {
  const d = validDir(dir);
  if (!existsSync(join(SKILLS_DIR, d, "SKILL.md"))) throw new Error("Esa skill no existe");
  const disabled = disabledSet();
  if (enabled) disabled.delete(d);
  else disabled.add(d);
  saveDisabled(disabled);
}

/**
 * Sube una skill nueva desde el panel: un .md con el conocimiento (playbook de diseño,
 * guía de estilo, tácticas propias…). Se guarda como .agents/skills/<slug>/SKILL.md y
 * la IA lo inyecta en cada generación mientras esté activa.
 */
export function uploadSkill(slug: string, content: string): void {
  const d = validDir(slug.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "skill");
  if (!content.trim()) throw new Error("Contenido vacío");
  if (Buffer.byteLength(content, "utf8") > MAX_SKILL_BYTES) throw new Error("Skill demasiado grande (máx 512 KB)");
  const dirPath = join(SKILLS_DIR, d);
  mkdirSync(dirPath, { recursive: true });
  const hasFrontmatter = /^---\s*\n/.test(content);
  const body = hasFrontmatter ? content : `---\nname: ${d}\ndescription: Skill subida desde el panel\n---\n\n${content}`;
  writeFileSync(join(dirPath, "SKILL.md"), body);
}

/** Elimina una skill subida desde el panel (solo las "custom": un directorio con solo SKILL.md). */
export function deleteSkill(dir: string): void {
  const d = validDir(dir);
  const dirPath = join(SKILLS_DIR, d);
  if (!existsSync(join(dirPath, "SKILL.md"))) throw new Error("Esa skill no existe");
  const files = readdirSync(dirPath);
  if (!files.every((f) => f === "SKILL.md")) throw new Error("Solo se pueden eliminar skills subidas desde el panel (las preinstaladas se desactivan)");
  rmSync(dirPath, { recursive: true, force: true });
  const disabled = disabledSet();
  disabled.delete(d);
  saveDisabled(disabled);
}

// Archivos de conocimiento prioritarios para escribir copy (los más útiles primero).
// La clave inicial identifica la skill (para respetar activar/desactivar).
const PRIORITY_FILES = [
  "social-media/references/social-media-playbook.md",
  "social-media/references/engagement-tactics.md",
  "social-media/references/viral-mechanics.md",
  "social-media/references/platform-algorithms.md",
  "social-media/references/content-formats.md",
  "social-media-generator/SKILL.md",
];

const PER_FILE = 3500;
const TOTAL_CAP = 16000;

/**
 * Devuelve un digest de las skills ACTIVAS, listo para inyectar en un prompt (o "" si está off).
 * Primero los archivos prioritarios de las skills de CM; después el SKILL.md de cualquier otra
 * skill activa (incluidas las subidas desde el panel). Sin caché: el panel puede cambiar la
 * selección en caliente.
 */
export function loadSkillGuidance(): string {
  if ((process.env.USE_CM_SKILLS ?? "true").toLowerCase() === "false") return "";
  const disabled = disabledSet();
  const parts: string[] = [];
  const included = new Set<string>();
  let total = 0;

  const push = (rel: string): void => {
    const p = join(SKILLS_DIR, rel);
    if (included.has(rel) || !existsSync(p)) return;
    let txt = "";
    try { txt = readFileSync(p, "utf8").trim(); } catch { return; }
    if (!txt) return;
    if (txt.length > PER_FILE) txt = txt.slice(0, PER_FILE) + "\n…(truncado)";
    if (total + txt.length > TOTAL_CAP) return;
    total += txt.length;
    included.add(rel);
    parts.push(`----- ${rel} -----\n${txt}`);
  };

  for (const f of PRIORITY_FILES) {
    if (disabled.has(f.split("/")[0])) continue;
    push(f);
  }
  for (const s of listInstalledSkills()) {
    if (!s.enabled) continue;
    push(`${s.dir}/SKILL.md`);
  }
  return parts.join("\n\n");
}
