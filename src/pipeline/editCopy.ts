/**
 * Edición del copy de una pieza con IA: toma el caption/hashtags actuales + una instrucción
 * del usuario y Claude los reescribe aplicando ese criterio, en el tono de marca.
 * Usa la SUSCRIPCIÓN (askClaude), no API key.
 */
import { askLLMJson } from "../providers/llm.js";
import { loadBrandConfig } from "../lib/brandConfig.js";
import { loadSkillGuidance } from "../lib/skills.js";
import { learningGuidance } from "../lib/learnings.js";
import type { QueueItem } from "../queue/queue.js";

export async function editCopy(
  item: QueueItem,
  instruction: string,
): Promise<{ caption: string; hashtags: string[] }> {
  const brand = loadBrandConfig();
  const guidance = loadSkillGuidance();
  const learned = await learningGuidance();

  const prompt = `Eres el community manager de ${brand.name}. Vas a EDITAR el copy de una publicación ya generada aplicando la instrucción del usuario.

FORMATO: ${item.format} · PLATAFORMA: ${item.platform}${item.pillar ? ` · PILAR: ${item.pillar}` : ""}

CAPTION ACTUAL:
${item.caption}

HASHTAGS ACTUALES:
${item.hashtags.join(" ")}

INSTRUCCIÓN DEL USUARIO (aplícala al pie de la letra):
"${instruction}"

Reescribe el caption y los hashtags aplicando exactamente ese cambio. Mantén el idioma y el tono de marca. No inventes datos ni promociones productos marcados como no disponibles.
${guidance ? `\nGuía de marca/CM:\n${guidance}\n` : ""}${learned ? `\n${learned}\n` : ""}
Responde ÚNICAMENTE un JSON válido, sin texto alrededor:
{"caption": "<nuevo caption>", "hashtags": ["#uno", "#dos", ...]}`;

  const out = await askLLMJson<{ caption?: string; hashtags?: string[] }>(prompt);
  return {
    caption: typeof out.caption === "string" && out.caption.trim() ? out.caption.trim() : item.caption,
    hashtags: Array.isArray(out.hashtags) && out.hashtags.length ? out.hashtags.map(String) : item.hashtags,
  };
}
