/** Carga el contexto de la empresa (knowledge/ + config/) como texto para los prompts. */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function readIf(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

export interface BrandContext {
  raw: string;
  voice: any;
}

/** Devuelve todo el contexto de marca concatenado, listo para inyectar en un prompt. */
export function loadBrandContext(): BrandContext {
  const knowledgeDir = join(ROOT, "knowledge");
  const configDir = join(ROOT, "config");

  const parts: string[] = [];
  for (const dir of [knowledgeDir, configDir]) {
    let files: string[] = [];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".md"));
    } catch {
      /* dir vacio */
    }
    for (const f of files) {
      parts.push(`\n\n===== ${f} =====\n${readIf(join(dir, f))}`);
    }
  }

  let voice: any = {};
  try {
    voice = JSON.parse(readIf(join(knowledgeDir, "voice.json")) || "{}");
  } catch {
    /* json invalido */
  }

  return { raw: parts.join(""), voice };
}
