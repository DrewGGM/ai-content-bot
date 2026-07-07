/**
 * Planificador: Claude Code decide la PRÓXIMA pieza a publicar según:
 *  - los pilares y la estrategia (config/),
 *  - el contexto de marca (knowledge/),
 *  - el HISTORIAL reciente (para variar formato y tema, no repetir).
 * Devuelve { format, topic, pillar, platform, rationale }.
 */
import { askLLMJson } from "../providers/llm.js";
import { loadBrandContext } from "../knowledge/loader.js";
import { loadSkillGuidance } from "../lib/skills.js";
import { availableFormats } from "../lib/capabilities.js";
import { recentHistory, historyAnalysis } from "../history.js";

export type PlanFormat = "reel" | "motion" | "ugc" | "carousel" | "post" | "design";
export interface ContentPlan {
  format: PlanFormat;
  topic: string;
  pillar: string;
  platform: string;
  rationale: string;
}

const FORMAT_DESC: Record<string, string> = {
  reel: "video b-roll cinematográfico (escena real animada + texto). Para storytelling/emoción.",
  motion: "reel de motion-graphics (texto animado sobre fondo de marca). Para datos/educativo de texto.",
  ugc: "avatar tipo testimonio hablando a cámara. Para anuncios de conversión/recomendación.",
  carousel: "4-6 imágenes. Para educativo paso a paso / listas.",
  post: "imagen única IA. Para una idea/dato potente con escena.",
  design: "poster por código (glassmorphism de marca, sin IA de imagen). Para datos, listas, citas o anuncios limpios y on-brand.",
};

export async function planNextContent(): Promise<ContentPlan> {
  const { raw } = loadBrandContext();
  const guidance = loadSkillGuidance();
  const history = await recentHistory(12);
  const analysis = await historyAnalysis();

  // Conciencia de capacidades: solo ofrecer formatos que el bot puede producir AHORA.
  const available = availableFormats() as PlanFormat[];
  const formatList = available.map((f) => `- "${f}": ${FORMAT_DESC[f]}`).join("\n");

  const prompt = `Eres el estratega de contenido de la marca. Decide la PRÓXIMA pieza a crear hoy.

Objetivos: VARIAR el formato y el pilar respecto a lo último, mantener equilibrio entre educar, mostrar producto y conectar. Aprende del análisis: refuerza lo que se APROBÓ, evita repetir ángulos RECHAZADOS, y no repitas temas recientes.

ANÁLISIS DEL HISTORIAL (úsalo para decidir):
${analysis}

HISTORIAL RECIENTE (más nuevo primero):
${history}

FORMATOS DISPONIBLES (elige SOLO uno de estos — son los que el bot puede producir ahora mismo):
${formatList}

Devuelve ÚNICAMENTE un JSON válido (sin markdown):
{
  "format": ${available.map((f) => `"${f}"`).join(" | ")},
  "platform": "instagram" | "tiktok" | "facebook" | "linkedin",
  "pillar": "el pilar de contenido elegido",
  "topic": "tema concreto y específico para la pieza, en español",
  "rationale": "1 frase: por qué este formato y tema ahora (variedad vs. historial)"
}

Reglas: elige el formato SOLO de la lista disponible. VARÍA el formato respecto a las últimas piezas. No repitas el mismo tema de las últimas 5 piezas.
${guidance ? `\n===== GUÍA DE COMMUNITY MANAGER (úsala para elegir formato y ángulo que mejor funcionen) =====\n${guidance}\n` : ""}
===== ESTRATEGIA Y MARCA =====
${raw}`;

  const data = await askLLMJson<ContentPlan>(prompt);
  const fallback = available[0] ?? "design";
  return {
    format: (available.includes(data.format) ? data.format : fallback) as PlanFormat,
    topic: data.topic,
    pillar: data.pillar ?? "",
    platform: data.platform ?? "instagram",
    rationale: data.rationale ?? "",
  };
}
