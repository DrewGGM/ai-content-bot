/**
 * Inyecta el conocimiento de las skills de community manager (instaladas en .agents/skills/)
 * en los prompts de copy: playbook, tácticas de engagement, mecánicas virales, algoritmos
 * por plataforma y formatos. Así el bot escribe siguiendo esas buenas prácticas.
 * Desactivable con USE_CM_SKILLS=false.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS_DIR = join(ROOT, ".agents", "skills");

export interface InstalledSkill {
  name: string;
  description: string;
}

/** Lista las skills instaladas en .agents/skills/ leyendo el frontmatter de cada SKILL.md. */
export function listInstalledSkills(): InstalledSkill[] {
  const out: InstalledSkill[] = [];
  if (!existsSync(SKILLS_DIR)) return out;
  for (const dir of readdirSync(SKILLS_DIR)) {
    const skillMd = join(SKILLS_DIR, dir, "SKILL.md");
    if (!existsSync(skillMd) || !statSync(join(SKILLS_DIR, dir)).isDirectory()) continue;
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
    out.push({ name, description });
  }
  return out;
}

// Archivos de conocimiento relevantes para escribir copy (los más útiles primero).
const FILES = [
  "social-media/references/social-media-playbook.md",
  "social-media/references/engagement-tactics.md",
  "social-media/references/viral-mechanics.md",
  "social-media/references/platform-algorithms.md",
  "social-media/references/content-formats.md",
  "social-media-generator/SKILL.md",
];

const PER_FILE = 3500;
const TOTAL_CAP = 16000;

let cache: string | null = null;

/** Devuelve un digest de buenas prácticas de CM, listo para inyectar en un prompt (o "" si está off). */
export function loadSkillGuidance(): string {
  if (cache !== null) return cache;
  if ((process.env.USE_CM_SKILLS ?? "true").toLowerCase() === "false") {
    cache = "";
    return cache;
  }
  const parts: string[] = [];
  let total = 0;
  for (const f of FILES) {
    const p = join(SKILLS_DIR, f);
    if (!existsSync(p)) continue;
    let txt = readFileSync(p, "utf8").trim();
    if (!txt) continue;
    if (txt.length > PER_FILE) txt = txt.slice(0, PER_FILE) + "\n…(truncado)";
    if (total + txt.length > TOTAL_CAP) break;
    total += txt.length;
    parts.push(`----- ${f} -----\n${txt}`);
  }
  cache = parts.join("\n\n");
  return cache;
}
