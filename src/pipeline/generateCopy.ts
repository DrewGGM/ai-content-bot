/**
 * Generadores de COPY con el agente/LLM configurado (COPY_PROVIDER) + contexto de la empresa
 * (knowledge/ + config/). El nombre y los colores de marca salen de config/brand.json.
 * Un generador por tipo de contenido: reel, motion, ugc, carrusel, post.
 */
import { askLLMJson } from "../providers/llm.js";
import { loadBrandContext } from "../knowledge/loader.js";
import { loadBrandConfig } from "../lib/brandConfig.js";
import { loadSkillGuidance } from "../lib/skills.js";
import { learningGuidance } from "../lib/learnings.js";

// Lectura perezosa: el panel puede editar config/brand.json en caliente.
const brand = () => loadBrandConfig();
/** "violeta #5B2DC4 a menta #00D4AA" → genérico desde config. */
const palette = () => `${brand().colors.primary} a ${brand().colors.accent}`;

/**
 * Limita la cantidad de hashtags según MAX_HASHTAGS (Ajustes → Conexiones). 0 = sin límite.
 * Por defecto 5: Instagram TOPA en 5 hashtags por publicación desde diciembre de 2025, así que
 * pasarse no aporta alcance y arriesga que la plataforma recorte el caption.
 */
function limitHashtags(arr: unknown): string[] {
  const tags = Array.isArray(arr) ? arr.map(String) : [];
  const max = Number(process.env.MAX_HASHTAGS ?? "5");
  return max > 0 ? tags.slice(0, max) : tags;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 50);
}

const BRAND_RULES =
  "Respeta el TONO y la identidad de la marca definidos en el CONTEXTO DE MARCA de abajo. " +
  "No inventes datos ni cifras que no estén en el contexto. No prometas resultados garantizados. " +
  "El texto va en el idioma de la marca (por defecto español); los prompts de imagen van en inglés.";

/** Pregunta al agente con TODO el contexto de marca + skills (lo usan también los workflows). */
export async function askBrandJson(prompt: string, instruction?: string): Promise<any> {
  return ask(prompt, instruction);
}

async function ask(prompt: string, instruction?: string): Promise<any> {
  const { raw } = loadBrandContext();
  const guidance = loadSkillGuidance();
  // Lo que el humano ya corrigió al rechazar piezas anteriores (reglas + motivos recientes).
  const learned = await learningGuidance();
  const cm = guidance
    ? `\n\n===== GUÍA DE COMMUNITY MANAGER (mejores prácticas — aplícalas al copy, ganchos, formato y hashtags) =====\n${guidance}`
    : "";
  // Instrucción del usuario al regenerar una pieza (tiene prioridad sobre el resto).
  const edit = instruction?.trim()
    ? `\n\n===== INSTRUCCIÓN DEL USUARIO (PRIORITARIA — aplícala al pie de la letra sobre TODO, incluidos titular, imagen/escena, voz y CTA) =====\n${instruction.trim()}`
    : "";
  const full = `${prompt}${edit}\n\n${BRAND_RULES}${cm}${learned ? `\n\n${learned}` : ""}\n\n===== CONTEXTO DE MARCA (config/brand.json + knowledge/ + config/) =====\nMarca: ${brand().name}${brand().tagline ? " — " + brand().tagline : ""}\n${raw}`;
  return askLLMJson(full);
}

// ---------- REEL (b-roll + overlay) ----------
// Enfoque profesional de anuncios: la ESCENA se genera SIN texto ni logo y se anima;
// el titular, subtítulos, logo y CTA se pegan como capa nítida en post (no se distorsionan).
export interface ReelCopy {
  slug: string;
  scenePrompt: string; // escena fotorrealista SIN texto ni logo (para image-to-video)
  motionPrompt: string; // movimiento de cámara/sujetos
  headline: string; // titular corto que va en el overlay (puede tener 1 salto de línea)
  voiceScript: string; // locución
  cta: string; // llamada a la acción corta para el overlay final
  caption: string;
  hashtags: string[];
  pillar?: string;
}

export async function generateReelCopy(topic: string, instruction?: string): Promise<ReelCopy> {
  const data = await ask(
    `Eres el community manager de ${brand().name}. Crea un REEL vertical (9:16) tipo ANUNCIO sobre: "${topic}".
Usamos el flujo profesional: se genera una ESCENA fotorrealista SIN texto y se anima; el titular, subtítulos, logo y CTA se añaden como capa aparte. Por eso la escena NO debe contener texto ni logos.

Devuelve ÚNICAMENTE un JSON válido (sin markdown):
{
  "slug": "kebab-case-corto",
  "pillar": "uno de los pilares de contenido",
  "scenePrompt": "prompt EN INGLÉS de una ESCENA fotorrealista, cinematográfica, vertical 9:16, relacionada al tema y al público de la marca (personas reales en un contexto realista acorde al producto/servicio, luz natural cálida). MUY IMPORTANTE: SIN texto, SIN letras, SIN logos, SIN marcas de agua, SIN interfaces con palabras legibles. Estética premium, realista, no ilustración plana. Deja la composición con aire arriba y abajo para poner texto encima.",
  "motionPrompt": "prompt EN INGLÉS del MOVIMIENTO para image-to-video: movimiento de cámara suave y cinematográfico (slow push-in / gentle parallax), sujetos con micro-movimiento natural, estable, sin distorsión.",
  "headline": "titular corto en español para mostrar EN PANTALLA (máx 6-8 palabras, puede tener un salto de línea con \\n). Gancho potente.",
  "voiceScript": "locución en español MUY concisa: 2-3 frases, MÁXIMO 25 palabras (~10s), tono cálido y directo.",
  "cta": "llamada a la acción corta para el final (ej. 'Escríbenos por WhatsApp')",
  "caption": "caption en español: gancho en la 1a línea, saltos de línea, beneficio y CTA. Emojis moderados.",
  "hashtags": ["un hashtag de la marca", "3-4 hashtags relevantes y específicos"]
}`,
    instruction
  );
  return {
    slug: slugify(String(data.slug ?? "")) || slugify(topic) || "pieza",
    scenePrompt: data.scenePrompt,
    motionPrompt: data.motionPrompt,
    headline: data.headline ?? "",
    voiceScript: data.voiceScript,
    cta: data.cta ?? "Escríbenos por WhatsApp",
    caption: data.caption,
    hashtags: limitHashtags(data.hashtags),
    pillar: data.pillar,
  };
}

// ---------- REEL MOTION-GRAPHICS ----------
export interface MotionCopy {
  slug: string;
  headline: string;
  voiceScript: string;
  cta: string;
  caption: string;
  hashtags: string[];
  pillar?: string;
}

export async function generateMotionReelCopy(topic: string, instruction?: string): Promise<MotionCopy> {
  const data = await ask(
    `Eres el community manager de ${brand().name}. Crea un REEL de MOTION-GRAPHICS (texto animado sobre fondo de marca, sin escena fotográfica) sobre: "${topic}".
Devuelve ÚNICAMENTE un JSON válido (sin markdown):
{
  "slug": "kebab-case-corto",
  "pillar": "uno de los pilares de contenido",
  "headline": "titular corto y potente en español para mostrar en pantalla (máx 6-8 palabras, puede tener un salto de línea con \\n)",
  "voiceScript": "locución en español MUY concisa: 2-3 frases, MÁXIMO 25 palabras (~10s), tono cálido y directo",
  "cta": "llamada a la acción corta (ej. 'Escríbenos por WhatsApp')",
  "caption": "caption en español: gancho, saltos de línea, beneficio y CTA. Emojis moderados",
  "hashtags": ["un hashtag de la marca", "3-4 hashtags relevantes y específicos"]
}`,
    instruction
  );
  return {
    slug: slugify(String(data.slug ?? "")) || slugify(topic) || "pieza",
    headline: data.headline ?? "",
    voiceScript: data.voiceScript,
    cta: data.cta ?? "Escríbenos por WhatsApp",
    caption: data.caption,
    hashtags: limitHashtags(data.hashtags),
    pillar: data.pillar,
  };
}

// ---------- VIDEO REMOTION (por código: reel/square/feed) ----------
// La IA NO escribe un titular fijo: arma una SECUENCIA DE ESCENAS (remotion/scenes.tsx). Así
// dos videos del mismo formato ya no se ven iguales — cambian la estructura y el ritmo, no
// solo las palabras.
export type VideoScene =
  | { kind: "hook"; text: string; accentWord?: string; eyebrow?: string }
  | { kind: "stat"; value: string; label: string; note?: string; eyebrow?: string }
  | { kind: "list"; title?: string; items: string[]; eyebrow?: string }
  | { kind: "quote"; text: string; author?: string }
  | { kind: "compare"; beforeLabel: string; before: string; afterLabel: string; after: string; eyebrow?: string }
  | { kind: "cta"; text: string; sub?: string };

const SCENE_KINDS = ["hook", "stat", "list", "quote", "compare", "cta"];

export interface RemotionCopy {
  slug: string;
  scenes: VideoScene[];
  headline: string; // titular del gancho (se reusa en el brief de música y en overlays)
  cta: string;
  voiceScript: string; // locución (si el modo es con voz)
  caption: string;
  hashtags: string[];
  pillar?: string;
}

/**
 * Saneado de escenas: descarta lo que no encaje con el contrato del render y garantiza que
 * SIEMPRE haya un gancho al principio y un CTA al final (si la IA se los salta, el video
 * quedaría sin entrada ni cierre).
 */
function normalizeScenes(raw: unknown, fallbackHeadline: string, fallbackCta: string): VideoScene[] {
  const arr = Array.isArray(raw) ? raw : [];
  const out: VideoScene[] = [];
  for (const s of arr) {
    const kind = String((s as any)?.kind ?? "");
    if (!SCENE_KINDS.includes(kind)) continue;
    const v: any = { kind };
    if (kind === "hook") {
      if (!s.text) continue;
      v.text = String(s.text); v.accentWord = s.accentWord ? String(s.accentWord) : undefined; v.eyebrow = s.eyebrow ? String(s.eyebrow) : undefined;
    } else if (kind === "stat") {
      if (!s.value || !s.label) continue;
      v.value = String(s.value); v.label = String(s.label); v.note = s.note ? String(s.note) : undefined; v.eyebrow = s.eyebrow ? String(s.eyebrow) : undefined;
    } else if (kind === "list") {
      const items = Array.isArray(s.items) ? s.items.slice(0, 4).map(String) : [];
      if (!items.length) continue;
      v.items = items; v.title = s.title ? String(s.title) : undefined; v.eyebrow = s.eyebrow ? String(s.eyebrow) : undefined;
    } else if (kind === "quote") {
      if (!s.text) continue;
      v.text = String(s.text); v.author = s.author ? String(s.author) : undefined;
    } else if (kind === "compare") {
      if (!s.before || !s.after) continue;
      v.before = String(s.before); v.after = String(s.after);
      v.beforeLabel = String(s.beforeLabel ?? "Antes"); v.afterLabel = String(s.afterLabel ?? "Después");
      v.eyebrow = s.eyebrow ? String(s.eyebrow) : undefined;
    } else {
      if (!s.text) continue;
      v.text = String(s.text); v.sub = s.sub ? String(s.sub) : undefined;
    }
    out.push(v as VideoScene);
  }
  if (!out.length || out[0].kind !== "hook") out.unshift({ kind: "hook", text: fallbackHeadline });
  if (out[out.length - 1].kind !== "cta") out.push({ kind: "cta", text: fallbackCta });
  return out.slice(0, 6);
}

export async function generateRemotionCopy(topic: string, instruction?: string): Promise<RemotionCopy> {
  const data = await ask(
    `Eres el director creativo de ${brand().name}. Diseña un VIDEO vertical animado POR CÓDIGO (motion-graphics
de texto, sin fotos ni escenas de IA) sobre: "${topic}".

Tú DECIDES la estructura: eliges qué escenas usar y en qué orden, según lo que mejor cuente ESTE tema.
No uses siempre la misma receta — un dato duro pide "stat", una objeción pide "compare", una promesa
pide "list", un testimonio pide "quote".

ESCENAS DISPONIBLES:
- "hook": el gancho. Texto grande y corto que para el scroll. SIEMPRE es la primera.
- "stat": un número protagonista que se anima contando (ej. "0", "+1.5M", "10 min") + qué significa.
- "list": 2-4 puntos muy cortos que entran uno a uno. Para beneficios o pasos.
- "quote": una frase fuerte o testimonio + autor. Para prueba social o manifiesto.
- "compare": antes vs. después (el "antes" sale tachado). Para contrastar con el problema.
- "cta": el cierre con el logo. SIEMPRE es la última.

Reglas: 3 a 5 escenas en total (contando hook y cta). Textos CORTÍSIMOS — se leen en movimiento, no
son párrafos. Nada de datos inventados: los números deben salir del contexto de marca.

Devuelve ÚNICAMENTE un JSON válido (sin markdown). En cada escena incluye SOLO los campos de su tipo:
{
  "slug": "kebab-case-corto",
  "pillar": "uno de los pilares de contenido",
  "scenes": [
    { "kind": "hook", "eyebrow": "etiqueta de 1-2 palabras (opcional)", "text": "gancho de 4-8 palabras", "accentWord": "UNA palabra del gancho para resaltar en color" },
    { "kind": "stat", "eyebrow": "opcional", "value": "el número tal cual se muestra", "label": "qué significa (máx 5 palabras)", "note": "1 frase de apoyo (opcional)" },
    { "kind": "list", "eyebrow": "opcional", "title": "titular corto (opcional)", "items": ["2-4 puntos de máx 5 palabras"] },
    { "kind": "quote", "text": "frase de máx 16 palabras", "author": "quién lo dice" },
    { "kind": "compare", "eyebrow": "opcional", "beforeLabel": "Antes", "before": "el dolor, máx 6 palabras", "afterLabel": "Con ${brand().name}", "after": "la solución, máx 6 palabras" },
    { "kind": "cta", "text": "llamada a la acción de 2-5 palabras", "sub": "línea de apoyo corta (opcional)" }
  ],
  "voiceScript": "locución en español MUY concisa que ACOMPAÑE a las escenas en orden: 2-3 frases, MÁXIMO 28 palabras (~11s), cálida y directa",
  "caption": "caption en español: gancho, saltos de línea, beneficio y CTA. Emojis moderados",
  "hashtags": ["un hashtag de la marca", "3-4 hashtags relevantes y específicos"]
}`,
    instruction
  );
  const fallbackCta = data.cta ? String(data.cta) : brand().ctaDefault;
  const scenes = normalizeScenes(data.scenes, String(data.headline ?? topic), fallbackCta);
  const hook = scenes.find((s) => s.kind === "hook") as Extract<VideoScene, { kind: "hook" }> | undefined;
  const cta = scenes.find((s) => s.kind === "cta") as Extract<VideoScene, { kind: "cta" }> | undefined;
  return {
    slug: slugify(String(data.slug ?? "")) || slugify(topic) || "pieza",
    scenes,
    headline: hook?.text ?? topic,
    cta: cta?.text ?? fallbackCta,
    voiceScript: data.voiceScript ?? hook?.text ?? topic,
    caption: data.caption ?? "",
    hashtags: limitHashtags(data.hashtags),
    pillar: data.pillar,
  };
}

// ---------- UGC (avatar HeyGen) ----------
export interface UgcCopy {
  slug: string;
  script: string; // guion hablado (testimonio/recomendación), 25-45 palabras
  headline: string; // titular corto opcional en overlay
  cta: string;
  caption: string;
  hashtags: string[];
  pillar?: string;
}

export async function generateUgcScript(topic: string, instruction?: string): Promise<UgcCopy> {
  const data = await ask(
    `Eres el community manager de ${brand().name}. Escribe un guion para un ANUNCIO UGC (una persona real hablando a cámara, estilo testimonio/recomendación) sobre: "${topic}".
Devuelve ÚNICAMENTE un JSON válido (sin markdown):
{
  "slug": "kebab-case-corto",
  "pillar": "uno de los pilares de contenido",
  "script": "guion hablado en español, natural y conversacional, como si un cliente recomendara la marca. 30-45 palabras (~15-20s). Cercano, creíble, sin sonar a comercial.",
  "headline": "titular corto opcional para overlay (máx 5-6 palabras)",
  "cta": "llamada a la acción corta (ej. 'Escríbenos por WhatsApp')",
  "caption": "caption en español con gancho y CTA. Emojis moderados",
  "hashtags": ["un hashtag de la marca", "3-4 hashtags relevantes y específicos"]
}`,
    instruction
  );
  return {
    slug: slugify(String(data.slug ?? "")) || slugify(topic) || "pieza",
    script: data.script,
    headline: data.headline ?? "",
    cta: data.cta ?? "Escríbenos por WhatsApp",
    caption: data.caption,
    hashtags: limitHashtags(data.hashtags),
    pillar: data.pillar,
  };
}

// ---------- DESIGN POSTER (render por código, sin IA de imagen) ----------
export type DesignVariant = "checklist" | "stat" | "quote" | "feature";
export interface DesignCopy {
  slug: string;
  variant: DesignVariant;
  eyebrow: string;
  headline?: string;
  subline?: string;
  bullets?: string[];
  stat?: string;
  statLabel?: string;
  quote?: string;
  author?: string;
  cta: string;
  caption: string;
  hashtags: string[];
  pillar?: string;
}

export async function generateDesignCopy(topic: string, forceVariant?: DesignVariant, instruction?: string): Promise<DesignCopy> {
  const data = await ask(
    `Eres el community manager de ${brand().name}. Crea el texto para un POST de DISEÑO (se renderiza por código) sobre: "${topic}".
${forceVariant ? `Usa la variante "${forceVariant}".` : "Elige la VARIANTE de layout que mejor comunique el mensaje:"}
- "checklist": titular + 3 beneficios cortos. (para propuesta de valor / features)
- "stat": un dato/número grande + etiqueta + frase de apoyo. (para una cifra impactante)
- "quote": una frase/testimonio fuerte + autor. (para social proof o manifiesto)
- "feature": titular grande + subtítulo. (para una idea/anuncio simple)

Devuelve ÚNICAMENTE un JSON válido (sin markdown). Incluye SOLO los campos que use la variante elegida:
{
  "slug": "kebab-case-corto",
  "pillar": "uno de los pilares de contenido",
  "variant": "checklist|stat|quote|feature",
  "eyebrow": "etiqueta corta (2-3 palabras)",
  "headline": "titular potente y conciso (checklist/feature) — máx 6-8 palabras",
  "subline": "subtítulo (stat/feature) — 1 frase corta",
  "bullets": ["3 beneficios MUY cortos (checklist) — máx 5 palabras c/u"],
  "stat": "el número/dato (stat) — ej. '10-15 min', '0 folios', '+1.5M'",
  "statLabel": "qué significa el dato (stat) — frase corta",
  "quote": "la frase/testimonio (quote) — máx 18 palabras",
  "author": "autor de la cita (quote) — ej. 'Andrew, fundador'",
  "cta": "llamada a la acción corta (máx 4 palabras)",
  "caption": "caption en español con gancho y CTA. Emojis moderados",
  "hashtags": ["un hashtag de la marca", "3-4 hashtags relevantes y específicos"]
}`,
    instruction
  );
  const variant: DesignVariant = forceVariant ?? (["checklist", "stat", "quote", "feature"].includes(data.variant) ? data.variant : "checklist");
  return {
    slug: slugify(String(data.slug ?? "")) || slugify(topic) || "pieza",
    variant,
    eyebrow: data.eyebrow ?? "",
    headline: data.headline,
    subline: data.subline,
    bullets: Array.isArray(data.bullets) ? data.bullets.slice(0, 4) : [],
    stat: data.stat,
    statLabel: data.statLabel,
    quote: data.quote,
    author: data.author,
    cta: data.cta ?? brand().ctaDefault,
    caption: data.caption,
    hashtags: limitHashtags(data.hashtags),
    pillar: data.pillar,
  };
}

// ---------- CARRUSEL POR CÓDIGO (deck) — varios pósters de diseño, sin IA de imagen ----------
export interface DeckSlide {
  variant: DesignVariant;
  eyebrow: string;
  headline?: string;
  subline?: string;
  bullets?: string[];
  stat?: string;
  statLabel?: string;
  quote?: string;
  author?: string;
  cta?: string;
}
export interface DeckCopy {
  slug: string;
  slides: DeckSlide[];
  caption: string;
  hashtags: string[];
  pillar?: string;
}

export async function generateDeckCopy(topic: string, instruction?: string): Promise<DeckCopy> {
  const data = await ask(
    `Eres el community manager de ${brand().name}. Crea un CARRUSEL de Instagram de 4-5 slides que se renderiza POR CÓDIGO (sin imágenes IA) sobre: "${topic}".
Cada slide es un póster de diseño con UNA variante de layout:
- "checklist": titular + 3 bullets muy cortos.
- "stat": un número/dato grande + etiqueta + frase de apoyo.
- "quote": una frase fuerte + autor.
- "feature": titular grande + subtítulo.
Estructura: slide 1 = gancho potente; slides 2-4 = valor (un punto por slide); último = CTA.
Devuelve ÚNICAMENTE un JSON válido (incluye SOLO los campos que use la variante de cada slide):
{
  "slug": "kebab-case-corto",
  "pillar": "uno de los pilares de contenido",
  "slides": [
    { "variant": "checklist|stat|quote|feature", "eyebrow": "2-3 palabras", "headline": "titular corto",
      "subline": "1 frase", "bullets": ["3 bullets de máx 5 palabras"], "stat": "ej '0 folios'", "statLabel": "qué significa",
      "quote": "frase máx 18 palabras", "author": "autor", "cta": "CTA corto (solo en el último)" }
  ],
  "caption": "caption del post con gancho y CTA a WhatsApp. Emojis moderados",
  "hashtags": ["un hashtag de la marca", "3-4 hashtags relevantes y específicos"]
}`,
    instruction
  );
  const slides: DeckSlide[] = (Array.isArray(data.slides) ? data.slides : []).slice(0, 6).map((s: any) => ({
    variant: (["checklist", "stat", "quote", "feature"].includes(s?.variant) ? s.variant : "feature") as DesignVariant,
    eyebrow: s?.eyebrow ?? "",
    headline: s?.headline,
    subline: s?.subline,
    bullets: Array.isArray(s?.bullets) ? s.bullets.slice(0, 4) : undefined,
    stat: s?.stat,
    statLabel: s?.statLabel,
    quote: s?.quote,
    author: s?.author,
    cta: s?.cta,
  }));
  return {
    slug: slugify(String(data.slug ?? "")) || slugify(topic) || "pieza",
    slides: slides.length ? slides : [{ variant: "feature", eyebrow: brand().name, headline: topic, cta: brand().ctaDefault }],
    caption: data.caption ?? "",
    hashtags: limitHashtags(data.hashtags),
    pillar: data.pillar,
  };
}

// ---------- CARRUSEL ----------
export interface CarouselCopy {
  slug: string;
  slides: { imagePrompt: string; heading: string }[];
  caption: string;
  hashtags: string[];
  pillar?: string;
}

export async function generateCarouselCopy(topic: string, instruction?: string): Promise<CarouselCopy> {
  const data = await ask(
    `Eres el community manager de ${brand().name}. Crea un CARRUSEL educativo de Instagram (4 a 6 slides) sobre: "${topic}".
Devuelve ÚNICAMENTE un JSON válido (sin markdown):
{
  "slug": "kebab-case-corto",
  "pillar": "pilar de contenido",
  "slides": [
    { "heading": "texto corto en español para ESTE slide (gancho en el slide 1, valor en los siguientes, CTA en el último)",
      "imagePrompt": "prompt EN INGLÉS para una imagen vertical 4:5, que muestre el heading escrito (bien escrito), paleta de marca (${palette()}), premium, consistente con los demás slides, sin watermark. CRÍTICO: fondo CONTINUO sin costuras — NO una banda/barra/línea sólida arriba; deja el ~15% superior libre de texto pero con el MISMO fondo (el logo real se añade aparte); el heading va debajo" }
  ],
  "caption": "caption en español para el post del carrusel, con CTA a WhatsApp",
  "hashtags": ["un hashtag de la marca", "3-4 hashtags relevantes y específicos"]
}`,
    instruction
  );
  return {
    slug: slugify(String(data.slug ?? "")) || slugify(topic) || "pieza",
    slides: Array.isArray(data.slides) ? data.slides : [],
    caption: data.caption,
    hashtags: limitHashtags(data.hashtags),
    pillar: data.pillar,
  };
}

// ---------- POST IMAGEN ÚNICA ----------
export interface PostCopy {
  slug: string;
  imagePrompt: string;
  caption: string;
  hashtags: string[];
  pillar?: string;
}

export async function generatePostCopy(topic: string, instruction?: string): Promise<PostCopy> {
  const data = await ask(
    `Eres el community manager de ${brand().name}. Crea un POST de imagen única (1:1) para Instagram/Facebook sobre: "${topic}".
Devuelve ÚNICAMENTE un JSON válido (sin markdown):
{
  "slug": "kebab-case-corto",
  "pillar": "pilar de contenido",
  "imagePrompt": "prompt EN INGLÉS para una imagen cuadrada 1:1 profesional con el titular en español escrito (bien escrito), paleta de marca (${palette()}), premium, sin watermark. CRÍTICO: fondo CONTINUO sin costuras — NO una banda/barra/línea sólida arriba; deja el ~15% superior libre de texto pero con el MISMO fondo (el logo real se añade aparte); el titular va debajo",
  "caption": "caption en español con gancho y CTA a WhatsApp",
  "hashtags": ["un hashtag de la marca", "3-4 hashtags relevantes y específicos"]
}`,
    instruction
  );
  return {
    slug: slugify(String(data.slug ?? "")) || slugify(topic) || "pieza",
    imagePrompt: data.imagePrompt,
    caption: data.caption,
    hashtags: limitHashtags(data.hashtags),
    pillar: data.pillar,
  };
}

// ---------- POST DE MARCA PREMIUM (Nano Banana Pro edit + referencias) ----------
// La IA solo aporta los TEXTOS (en el idioma de marca) y la idea del mockup; la composición
// visual y la identidad las fija el prompt maestro + las imágenes de referencia.
export interface BrandPostCopy {
  slug: string;
  headline: string;
  subline: string;
  cta: string;
  visualIdea: string;
  iconLabels: string[];
  caption: string;
  hashtags: string[];
  pillar?: string;
}

export async function generateBrandPostCopy(topic: string, instruction?: string): Promise<BrandPostCopy> {
  const data = await ask(
    `Eres el director creativo de ${brand().name}. Crea el contenido de un POST DE MARCA premium (cuadrado 1:1, estilo publicitario de alta gama) sobre: "${topic}".
La imagen se diseña con IA a partir de las referencias e imágenes de la marca; tú defines SOLO los textos (en el idioma de la marca) y qué mostrar como visual, ACORDE AL RUBRO del negocio (usa el contexto de marca).
Devuelve ÚNICAMENTE un JSON válido (sin markdown):
{
  "slug": "kebab-case-corto",
  "pillar": "uno de los pilares de contenido",
  "headline": "titular principal potente y corto (4-8 palabras), en el idioma de la marca",
  "subline": "subtítulo de apoyo de 1 frase corta",
  "cta": "llamada a la acción corta y discreta (2-4 palabras)",
  "visualIdea": "EN INGLÉS: qué mostrar como PROTAGONISTA de la imagen, acorde al rubro (ej. restaurante: 'a beautifully plated gourmet dish on a rustic table'; tienda de ropa: 'a model wearing the featured jacket'; software: 'a laptop showing a clean dashboard'; gimnasio: 'an athlete training with equipment'). Si la marca subió fotos de producto, se usarán esas reales.",
  "iconLabels": ["2-3 etiquetas MUY cortas para chips con icono, en el idioma de la marca, acordes al rubro (ej. 'Envío gratis', 'Reservas', 'A domicilio')"],
  "caption": "caption en español con gancho, saltos de línea, beneficio y CTA. Emojis moderados",
  "hashtags": ["un hashtag de la marca", "3-4 hashtags relevantes y específicos"]
}`,
    instruction,
  );
  return {
    slug: slugify(String(data.slug ?? "")) || slugify(topic) || "pieza",
    headline: data.headline ?? "",
    subline: data.subline ?? "",
    cta: data.cta ?? brand().ctaDefault,
    visualIdea: data.visualIdea ?? "",
    iconLabels: Array.isArray(data.iconLabels) ? data.iconLabels.slice(0, 3) : [],
    caption: data.caption ?? "",
    hashtags: limitHashtags(data.hashtags),
    pillar: data.pillar,
  };
}

// ---------- CARRUSEL DE MARCA PREMIUM (N slides, imágenes de marca consistentes) ----------
export interface BrandCarouselSlide {
  headline: string;
  subline?: string;
  cta?: string;
  visualIdea?: string;
  iconLabels?: string[];
}
export interface BrandCarouselCopy {
  slug: string;
  slides: BrandCarouselSlide[];
  caption: string;
  hashtags: string[];
  pillar?: string;
}

export async function generateBrandCarouselCopy(topic: string, instruction?: string): Promise<BrandCarouselCopy> {
  const data = await ask(
    `Eres el director creativo de ${brand().name}. Crea un CARRUSEL DE MARCA premium de 4-5 slides (cuadrados 1:1, estilo publicitario de alta gama, misma línea gráfica en todos) sobre: "${topic}".
Cada slide se diseña como una pieza de marca (logo + estilo consistente); tú defines SOLO los textos (idioma de la marca) y qué mostrar como visual, acorde al rubro.
Estructura: slide 1 = PORTADA con gancho potente; slides intermedios = un punto de valor cada uno; último slide = CTA.
Devuelve ÚNICAMENTE un JSON válido (sin markdown):
{
  "slug": "kebab-case-corto",
  "pillar": "uno de los pilares de contenido",
  "slides": [
    { "headline": "titular corto y potente del slide (4-8 palabras)",
      "subline": "subtítulo de apoyo de 1 frase corta (opcional)",
      "visualIdea": "EN INGLÉS: qué mostrar como protagonista del slide, acorde al rubro y coherente con los demás slides (ej. 'a plated gourmet dish', 'a laptop showing a dashboard'). Si hay fotos de producto, se usan reales.",
      "cta": "SOLO en el último slide: llamada a la acción corta (2-4 palabras)" }
  ],
  "caption": "caption en español para el post del carrusel: gancho, saltos de línea, valor y CTA. Emojis moderados",
  "hashtags": ["un hashtag de la marca", "3-4 hashtags relevantes y específicos"]
}`,
    instruction,
  );
  const slides: BrandCarouselSlide[] = (Array.isArray(data.slides) ? data.slides : []).slice(0, 6).map((s: any) => ({
    headline: String(s.headline ?? ""),
    subline: s.subline ? String(s.subline) : undefined,
    cta: s.cta ? String(s.cta) : undefined,
    visualIdea: s.visualIdea ? String(s.visualIdea) : undefined,
    iconLabels: Array.isArray(s.iconLabels) ? s.iconLabels.slice(0, 3) : undefined,
  }));
  return {
    slug: slugify(String(data.slug ?? "")) || slugify(topic) || "pieza",
    slides,
    caption: data.caption ?? "",
    hashtags: limitHashtags(data.hashtags),
    pillar: data.pillar,
  };
}
