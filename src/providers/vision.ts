/**
 * QA visual con el proveedor configurado (COPY_PROVIDER) — analiza una imagen real y dice si
 * está lista para publicar, listando problemas y proponiendo un prompt mejorado.
 * - CLIs (claude/codex/gemini/qwen): el agente LEE la imagen del disco con sus herramientas.
 * - APIs (anthropic/openai): la imagen se envía en base64.
 * - Si el proveedor no soporta visión (opencode, custom sin AGENT_VISION), el QA se salta
 *   limpiamente y la imagen se acepta (fail-open: nunca bloquea la generación).
 */
import { askLLMJson, visionAvailable, copyProvider } from "./llm.js";

export interface ImageVerdict {
  ok: boolean;
  score: number; // 0-100
  issues: string[];
  improvedPrompt?: string;
}

let warnedNoVision = false;

/**
 * @param imagePath ruta absoluta de la imagen a revisar
 * @param originalPrompt el prompt con el que se generó (para mejorarlo)
 * @param brief contexto corto de qué debería comunicar la pieza
 */
export async function reviewImage(
  imagePath: string,
  originalPrompt: string,
  brief: string
): Promise<ImageVerdict> {
  if (!visionAvailable()) {
    if (!warnedNoVision) {
      console.log(`    (QA visual desactivado: el proveedor "${copyProvider()}" no soporta visión) — acepto las imágenes`);
      warnedNoVision = true;
    }
    return { ok: true, score: 0, issues: [] };
  }

  const prompt = `Eres director de arte y QA de la marca. Analiza la imagen adjunta.

Es una pieza para redes sociales que debe comunicar: "${brief}".

Evalúa con criterio profesional y estricto. Rechaza (ok=false) si encuentras CUALQUIERA de estos:
- Texto en español mal escrito, con caracteres raros, garabateado o ilegible.
- Costuras/bandas/barras sólidas con bordes duros o líneas divisorias feas (sobre todo arriba).
- Composición desordenada, elementos amontonados, recortados o que se salen del marco.
- Logos o marcas de agua falsos (la marca real se añade aparte; no debe haberla en la imagen).
- Elementos gigantes que tapan o dominan mal la escena, baja legibilidad o contraste pobre.
- Cualquier cosa que se vea "de IA", barata o poco profesional.

Devuelve ÚNICAMENTE un JSON válido (sin markdown):
{
  "ok": true|false,
  "score": 0-100,
  "issues": ["lista corta y concreta de problemas detectados; vacía si ok"],
  "improvedPrompt": "si ok=false: el prompt de imagen EN INGLÉS reescrito y mejorado que corrige TODOS los problemas (mantén la marca y su paleta, 9:16/1:1/4:5 según corresponda, deja la zona superior ~15% libre de texto pero con fondo continuo SIN banda ni costura). Si ok=true, omite este campo."
}

Prompt original con el que se generó (para que lo mejores):
"""${originalPrompt}"""`;

  try {
    const v = await askLLMJson<ImageVerdict>(prompt, { image: imagePath });
    return {
      ok: !!v.ok,
      score: typeof v.score === "number" ? v.score : v.ok ? 80 : 40,
      issues: Array.isArray(v.issues) ? v.issues : [],
      improvedPrompt: v.improvedPrompt,
    };
  } catch (e: any) {
    // Si el QA falla, no bloquees la generación: acepta la imagen.
    console.log(`    (QA visual no disponible: ${e.message}) — acepto la imagen`);
    return { ok: true, score: 0, issues: [] };
  }
}
