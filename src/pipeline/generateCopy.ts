/**
 * Generadores de COPY con el agente/LLM configurado (COPY_PROVIDER) + contexto de la empresa
 * (knowledge/ + config/). El nombre y los colores de marca salen de config/brand.json.
 * Un generador por tipo de contenido: reel, motion, ugc, carrusel, post.
 */
import { askLLMJson } from "../providers/llm.js";
import { loadBrandContext } from "../knowledge/loader.js";
import { loadBrandConfig } from "../lib/brandConfig.js";
import { loadSkillGuidance } from "../lib/skills.js";

export const brand = loadBrandConfig();
/** "violeta #5B2DC4 a menta #00D4AA" → genérico desde config. */
export const palette = `${brand.colors.primary} a ${brand.colors.accent}`;

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

async function ask(prompt: string, instruction?: string): Promise<any> {
  const { raw } = loadBrandContext();
  const guidance = loadSkillGuidance();
  const cm = guidance
    ? `\n\n===== GUÍA DE COMMUNITY MANAGER (mejores prácticas — aplícalas al copy, ganchos, formato y hashtags) =====\n${guidance}`
    : "";
  // Instrucción del usuario al regenerar una pieza (tiene prioridad sobre el resto).
  const edit = instruction?.trim()
    ? `\n\n===== INSTRUCCIÓN DEL USUARIO (PRIORITARIA — aplícala al pie de la letra sobre TODO, incluidos titular, imagen/escena, voz y CTA) =====\n${instruction.trim()}`
    : "";
  const full = `${prompt}${edit}\n\n${BRAND_RULES}${cm}\n\n===== CONTEXTO DE MARCA (config/brand.json + knowledge/ + config/) =====\nMarca: ${brand.name}${brand.tagline ? " — " + brand.tagline : ""}\n${raw}`;
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
    `Eres el community manager de ${brand.name}. Crea un REEL vertical (9:16) tipo ANUNCIO sobre: "${topic}".
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
  "hashtags": ["un hashtag de la marca", "5-8 hashtags relevantes"]
}`,
    instruction
  );
  return {
    slug: data.slug?.trim() || slugify(topic),
    scenePrompt: data.scenePrompt,
    motionPrompt: data.motionPrompt,
    headline: data.headline ?? "",
    voiceScript: data.voiceScript,
    cta: data.cta ?? "Escríbenos por WhatsApp",
    caption: data.caption,
    hashtags: Array.isArray(data.hashtags) ? data.hashtags : [],
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
    `Eres el community manager de ${brand.name}. Crea un REEL de MOTION-GRAPHICS (texto animado sobre fondo de marca, sin escena fotográfica) sobre: "${topic}".
Devuelve ÚNICAMENTE un JSON válido (sin markdown):
{
  "slug": "kebab-case-corto",
  "pillar": "uno de los pilares de contenido",
  "headline": "titular corto y potente en español para mostrar en pantalla (máx 6-8 palabras, puede tener un salto de línea con \\n)",
  "voiceScript": "locución en español MUY concisa: 2-3 frases, MÁXIMO 25 palabras (~10s), tono cálido y directo",
  "cta": "llamada a la acción corta (ej. 'Escríbenos por WhatsApp')",
  "caption": "caption en español: gancho, saltos de línea, beneficio y CTA. Emojis moderados",
  "hashtags": ["un hashtag de la marca", "5-8 hashtags relevantes"]
}`,
    instruction
  );
  return {
    slug: data.slug?.trim() || slugify(topic),
    headline: data.headline ?? "",
    voiceScript: data.voiceScript,
    cta: data.cta ?? "Escríbenos por WhatsApp",
    caption: data.caption,
    hashtags: Array.isArray(data.hashtags) ? data.hashtags : [],
    pillar: data.pillar,
  };
}

// ---------- VIDEO REMOTION (por código: reel/square/feed) ----------
export interface RemotionCopy {
  slug: string;
  headline: string; // titular corto (5-7 palabras)
  accentWord?: string; // una palabra del titular a resaltar en color de acento
  chips: string[]; // 3 beneficios muy cortos
  cta: string;
  voiceScript: string; // locución (si el modo es con voz)
  caption: string;
  hashtags: string[];
  pillar?: string;
}

export async function generateRemotionCopy(topic: string, instruction?: string): Promise<RemotionCopy> {
  const data = await ask(
    `Eres el community manager de ${brand.name}. Crea el texto para un VIDEO animado por código (texto cinético, sin escena fotográfica) sobre: "${topic}".
El video tiene 3 escenas: (1) titular gancho, (2) 3 chips de beneficio, (3) CTA. Además una locución corta opcional.
Devuelve ÚNICAMENTE un JSON válido (sin markdown):
{
  "slug": "kebab-case-corto",
  "pillar": "uno de los pilares de contenido",
  "headline": "titular corto y potente en español (5-7 palabras, sin signos de más)",
  "accentWord": "UNA palabra del titular para resaltar en color (la clave; ej. 'DIAN')",
  "chips": ["3 beneficios MUY cortos, máx 4 palabras c/u"],
  "cta": "llamada a la acción corta (ej. 'Escríbenos por WhatsApp')",
  "voiceScript": "locución en español MUY concisa: 2-3 frases, MÁXIMO 28 palabras (~11s), cálida y directa",
  "caption": "caption en español: gancho, saltos de línea, beneficio y CTA. Emojis moderados",
  "hashtags": ["un hashtag de la marca", "5-8 hashtags relevantes"]
}`,
    instruction
  );
  return {
    slug: data.slug?.trim() || slugify(topic),
    headline: data.headline ?? topic,
    accentWord: typeof data.accentWord === "string" ? data.accentWord : undefined,
    chips: Array.isArray(data.chips) ? data.chips.slice(0, 3).map(String) : [],
    cta: data.cta ?? brand.ctaDefault,
    voiceScript: data.voiceScript ?? data.headline ?? topic,
    caption: data.caption ?? "",
    hashtags: Array.isArray(data.hashtags) ? data.hashtags : [],
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
    `Eres el community manager de ${brand.name}. Escribe un guion para un ANUNCIO UGC (una persona real hablando a cámara, estilo testimonio/recomendación) sobre: "${topic}".
Devuelve ÚNICAMENTE un JSON válido (sin markdown):
{
  "slug": "kebab-case-corto",
  "pillar": "uno de los pilares de contenido",
  "script": "guion hablado en español, natural y conversacional, como si un cliente recomendara la marca. 30-45 palabras (~15-20s). Cercano, creíble, sin sonar a comercial.",
  "headline": "titular corto opcional para overlay (máx 5-6 palabras)",
  "cta": "llamada a la acción corta (ej. 'Escríbenos por WhatsApp')",
  "caption": "caption en español con gancho y CTA. Emojis moderados",
  "hashtags": ["un hashtag de la marca", "5-8 hashtags relevantes"]
}`,
    instruction
  );
  return {
    slug: data.slug?.trim() || slugify(topic),
    script: data.script,
    headline: data.headline ?? "",
    cta: data.cta ?? "Escríbenos por WhatsApp",
    caption: data.caption,
    hashtags: Array.isArray(data.hashtags) ? data.hashtags : [],
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
    `Eres el community manager de ${brand.name}. Crea el texto para un POST de DISEÑO (se renderiza por código) sobre: "${topic}".
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
  "hashtags": ["un hashtag de la marca", "5-8 hashtags"]
}`,
    instruction
  );
  const variant: DesignVariant = forceVariant ?? (["checklist", "stat", "quote", "feature"].includes(data.variant) ? data.variant : "checklist");
  return {
    slug: data.slug?.trim() || slugify(topic),
    variant,
    eyebrow: data.eyebrow ?? "",
    headline: data.headline,
    subline: data.subline,
    bullets: Array.isArray(data.bullets) ? data.bullets.slice(0, 4) : [],
    stat: data.stat,
    statLabel: data.statLabel,
    quote: data.quote,
    author: data.author,
    cta: data.cta ?? brand.ctaDefault,
    caption: data.caption,
    hashtags: Array.isArray(data.hashtags) ? data.hashtags : [],
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
    `Eres el community manager de ${brand.name}. Crea un CARRUSEL de Instagram de 4-5 slides que se renderiza POR CÓDIGO (sin imágenes IA) sobre: "${topic}".
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
  "hashtags": ["un hashtag de la marca", "5-8 hashtags"]
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
    slug: data.slug?.trim() || slugify(topic),
    slides: slides.length ? slides : [{ variant: "feature", eyebrow: brand.name, headline: topic, cta: brand.ctaDefault }],
    caption: data.caption ?? "",
    hashtags: Array.isArray(data.hashtags) ? data.hashtags : [],
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
    `Eres el community manager de ${brand.name}. Crea un CARRUSEL educativo de Instagram (4 a 6 slides) sobre: "${topic}".
Devuelve ÚNICAMENTE un JSON válido (sin markdown):
{
  "slug": "kebab-case-corto",
  "pillar": "pilar de contenido",
  "slides": [
    { "heading": "texto corto en español para ESTE slide (gancho en el slide 1, valor en los siguientes, CTA en el último)",
      "imagePrompt": "prompt EN INGLÉS para una imagen vertical 4:5, que muestre el heading escrito (bien escrito), paleta de marca (${palette}), premium, consistente con los demás slides, sin watermark. CRÍTICO: fondo CONTINUO sin costuras — NO una banda/barra/línea sólida arriba; deja el ~15% superior libre de texto pero con el MISMO fondo (el logo real se añade aparte); el heading va debajo" }
  ],
  "caption": "caption en español para el post del carrusel, con CTA a WhatsApp",
  "hashtags": ["un hashtag de la marca", "5-8 hashtags"]
}`,
    instruction
  );
  return {
    slug: data.slug?.trim() || slugify(topic),
    slides: Array.isArray(data.slides) ? data.slides : [],
    caption: data.caption,
    hashtags: Array.isArray(data.hashtags) ? data.hashtags : [],
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
    `Eres el community manager de ${brand.name}. Crea un POST de imagen única (1:1) para Instagram/Facebook sobre: "${topic}".
Devuelve ÚNICAMENTE un JSON válido (sin markdown):
{
  "slug": "kebab-case-corto",
  "pillar": "pilar de contenido",
  "imagePrompt": "prompt EN INGLÉS para una imagen cuadrada 1:1 profesional con el titular en español escrito (bien escrito), paleta de marca (${palette}), premium, sin watermark. CRÍTICO: fondo CONTINUO sin costuras — NO una banda/barra/línea sólida arriba; deja el ~15% superior libre de texto pero con el MISMO fondo (el logo real se añade aparte); el titular va debajo",
  "caption": "caption en español con gancho y CTA a WhatsApp",
  "hashtags": ["un hashtag de la marca", "5-8 hashtags"]
}`,
    instruction
  );
  return {
    slug: data.slug?.trim() || slugify(topic),
    imagePrompt: data.imagePrompt,
    caption: data.caption,
    hashtags: Array.isArray(data.hashtags) ? data.hashtags : [],
    pillar: data.pillar,
  };
}
