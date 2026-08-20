/**
 * QA DE TEXTO — revisa el copy (caption + hashtags) contra la voz de marca, las reglas aprendidas
 * y el rendimiento antes de encolar, y lo PULE en sitio si hace falta.
 *
 * Es barato y seguro: el caption es independiente del visual (el visual usa scenePrompt/headline,
 * no el caption), así que pulir el texto después de generar NO desperdicia imagen/video. Corre una
 * sola llamada de LLM (gratis en CLI con suscripción). Se controla con el ajuste TEXT_QA (default on)
 * y nunca rompe la generación: si el QA falla, se deja el copy original.
 */
import { askLLMJson } from "../providers/llm.js";
import { loadBrandContext } from "../knowledge/loader.js";
import { loadBrandConfig } from "../lib/brandConfig.js";
import { learningGuidance } from "../lib/learnings.js";

export interface CopyReview {
  ok: boolean;               // true si el copy ya respeta la voz de marca (sin cambios)
  issues: string[];          // qué estaba mal (vacío si ok)
  caption: string;           // caption final (pulido o el mismo)
  hashtags: string[];        // hashtags finales
}

function enabled(): boolean {
  return (process.env.TEXT_QA ?? "true").toLowerCase() !== "false";
}

/**
 * Revisa y, si hace falta, pule el copy. Devuelve el copy final. Nunca lanza: ante cualquier
 * problema devuelve el original con `ok:true`.
 */
export async function reviewCopy(caption: string, hashtags: string[], format: string): Promise<CopyReview> {
  const original: CopyReview = { ok: true, issues: [], caption, hashtags };
  if (!enabled() || !caption?.trim()) return original;

  try {
    const brand = loadBrandConfig();
    const { raw } = loadBrandContext();
    const learned = await learningGuidance();

    const prompt = `Eres el editor de estilo de la marca "${brand.name}". Revisa ESTE copy de una pieza de
${format} para redes y verifica que respeta la voz de marca, sea claro y no prometa cosas falsas.

CAPTION ACTUAL:
${caption}

HASHTAGS ACTUALES: ${hashtags.join(" ") || "(ninguno)"}

Tu tarea: si el caption ya está bien, déjalo IGUAL. Si tiene problemas de VOZ (tono equivocado,
promesas infladas, tecnicismos, datos que contradicen el contexto, muletillas, hook flojo), reescríbelo
CORRIGIENDO SOLO eso — mantén el mensaje, la longitud parecida y el idioma. No inventes datos nuevos.
No agregues ni quites emojis salvo que sobren o falten para la voz. No cambies hashtags salvo que sean
irrelevantes o incumplan el límite.

Devuelve ÚNICAMENTE un JSON válido:
{"ok": true|false, "issues": ["qué estaba mal, corto"], "caption": "el caption final", "hashtags": ["#..."]}
Si ok es true, devuelve el caption y hashtags SIN cambios.
${learned ? `\n${learned}\n` : ""}
===== VOZ Y CONTEXTO DE MARCA =====
Marca: ${brand.name}${brand.tagline ? " — " + brand.tagline : ""}
${raw.slice(0, 6000)}`;

    const data = await askLLMJson<Partial<CopyReview>>(prompt);
    const outCaption = typeof data.caption === "string" && data.caption.trim() ? data.caption.trim() : caption;
    const outTags = Array.isArray(data.hashtags) && data.hashtags.length ? data.hashtags.map(String) : hashtags;
    const changed = outCaption !== caption || outTags.join(" ") !== hashtags.join(" ");
    return {
      ok: !changed,
      issues: Array.isArray(data.issues) ? data.issues.map(String).slice(0, 6) : [],
      caption: outCaption,
      hashtags: outTags,
    };
  } catch {
    return original; // el QA de texto es un plus: si falla, no bloquea la pieza
  }
}
