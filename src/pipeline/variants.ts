/**
 * VARIANTES DE HOOK (A/B) — propone captions alternativos con distinto ángulo de gancho para que
 * el humano elija el mejor en el panel (o pruebe uno y otro). Barato: una llamada de LLM, no toca
 * el visual (el caption es el texto del post). Se controla con AB_HOOKS (default on) y nunca rompe.
 */
import { askLLMJson } from "../providers/llm.js";
import { loadBrandConfig } from "../lib/brandConfig.js";
import { learningGuidance } from "../lib/learnings.js";

function enabled(): boolean {
  return (process.env.AB_HOOKS ?? "true").toLowerCase() !== "false";
}

/**
 * Devuelve 2-3 captions alternativos (distinto gancho) respecto al actual. [] si está desactivado
 * o si algo falla — nunca lanza.
 */
export async function generateHookVariants(caption: string, topic: string, format: string): Promise<string[]> {
  if (!enabled() || !caption?.trim()) return [];
  try {
    const brand = loadBrandConfig();
    const learned = await learningGuidance();
    const prompt = `Eres copywriter de la marca "${brand.name}". Para esta pieza de ${format} sobre "${topic}",
el caption elegido es:

${caption}

Escribe 2 captions ALTERNATIVOS con un ÁNGULO DE GANCHO distinto (ej. pregunta, dato sorprendente,
historia, objeción, urgencia) — mismo mensaje y misma marca, longitud parecida, con sus hashtags.
No repitas el gancho del original. Mantén la voz de marca.

Devuelve ÚNICAMENTE un JSON válido: {"variants": ["caption alternativo 1", "caption alternativo 2"]}
${learned ? `\n${learned}\n` : ""}`;

    const data = await askLLMJson<{ variants?: string[] }>(prompt);
    return Array.isArray(data.variants)
      ? data.variants.map((v) => String(v).trim()).filter((v) => v && v !== caption).slice(0, 3)
      : [];
  } catch {
    return [];
  }
}
