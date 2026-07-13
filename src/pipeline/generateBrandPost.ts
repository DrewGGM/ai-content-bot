/**
 * Post de MARCA premium: imagen 1:1 diseñada con Nano Banana Pro (Gemini 3 Pro) en modo EDIT,
 * usando el LOGO real + las imágenes de referencia de la marca (assets/brand/references) + fotos
 * de producto (assets/brand/products) como ancla — igual que pasarle referencias a ChatGPT.
 * fal/openai hornean todo (logo, titular, subtítulo, mockup, iconos, CTA, web); Leonardo genera
 * el visual y el texto/logo se hornean por código (no sabe escribir). Sin referencias ni logo,
 * cae al post normal.
 * `renderBrandImage()` (exportada) renderiza UNA imagen de marca y la reusa el carrusel de marca.
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateReviewedImage } from "./visualQA.js";
import { brandPosterPrompt, brandPosterVisualPrompt, type BrandPosterFields } from "../lib/artDirection.js";
import { brandLogoReferenceDataUri, overlayBrandPoster } from "../lib/brand.js";
import { loadBrandConfig } from "../lib/brandConfig.js";
import { brandReferenceDataUris, brandProductDataUris } from "../lib/brandReferences.js";
import { generatePost } from "./generatePost.js";
import { generatePostCopy } from "./generateCopy.js";
import { addToQueue, type QueueItem } from "../queue/queue.js";
import type { BrandPostCopy } from "./generateCopy.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Imagen local → data URI (para encadenar consistencia entre slides de un carrusel). */
export function imageFileToDataUri(path: string): string {
  return `data:image/png;base64,${readFileSync(path).toString("base64")}`;
}

/**
 * Renderiza UNA imagen de marca premium a `dest`: logo real + referencias de estilo + fotos de
 * producto + prompt maestro. fal/openai hornean texto+logo en la imagen; Leonardo genera el visual
 * y el texto/logo se hornean por código. `extraReferenceImages` ancla la consistencia (p. ej. el
 * slide previo de un carrusel). Devuelve false si NO hay ninguna referencia (ni logo) → el caller
 * decide el fallback (post/carrusel clásico).
 */
export async function renderBrandImage(o: {
  dest: string;
  fields: BrandPosterFields;
  extraReferenceImages?: string[];
}): Promise<boolean> {
  const prov = (process.env.IMAGE_PROVIDER ?? "fal").toLowerCase();
  // Leonardo NO escribe texto ni reproduce logos/productos → visual + overlay por código.
  const bakeInImage = prov !== "leonardo";

  const refs: string[] = [];
  const logo = await brandLogoReferenceDataUri();
  if (logo) refs.push(logo);
  refs.push(...brandReferenceDataUris());
  const productRefs = bakeInImage ? brandProductDataUris() : [];
  refs.push(...productRefs);
  if (o.extraReferenceImages?.length) refs.push(...o.extraReferenceImages);
  if (!refs.length) return false;

  const fields = { ...o.fields, hasProducts: productRefs.length > 0 };
  const prompt = bakeInImage ? brandPosterPrompt(fields) : brandPosterVisualPrompt(fields);
  await generateReviewedImage({
    prompt, dest: o.dest, aspect: "1:1", resolution: "2K",
    referenceImages: refs, rawPrompt: true,
    brief: bakeInImage
      ? `pieza de marca: titular "${o.fields.headline}". Premium, con el logo, textos bien escritos y consistente con las referencias de marca.`
      : `visual de marca SIN texto ni logo, con espacio limpio a la izquierda, consistente con las referencias.`,
  });
  if (!bakeInImage) {
    await overlayBrandPoster(o.dest, { headline: o.fields.headline, subline: o.fields.subline, cta: o.fields.cta, website: loadBrandConfig().website });
  }
  return true;
}

export async function generateBrandPost(copy: BrandPostCopy, platform: string, createdAt: string, instruction?: string): Promise<QueueItem> {
  const outDir = join(ROOT, "assets", "output", copy.slug);
  mkdirSync(outDir, { recursive: true });
  const imagePath = join(outDir, "image.png");

  const prov = (process.env.IMAGE_PROVIDER ?? "fal").toLowerCase();
  const provLabel = prov === "openai" ? "gpt-image-1 edit" : prov === "leonardo" ? "Leonardo (visual) + texto por código" : "Nano Banana Pro edit";
  console.log(`  → post de marca (${provLabel}) + QA visual...`);
  const ok = await renderBrandImage({
    dest: imagePath,
    fields: { headline: copy.headline, subline: copy.subline, cta: copy.cta, visualIdea: copy.visualIdea, iconLabels: copy.iconLabels },
  });
  if (!ok) {
    console.log("  ⚠ post de marca sin logo ni referencias — usando el post clásico");
    return generatePost(await generatePostCopy(copy.slug, instruction), platform, createdAt);
  }

  writeFileSync(join(outDir, "post.md"), `# ${copy.slug}\n\n${copy.caption}\n\n${copy.hashtags.join(" ")}\n`);

  const item: QueueItem = {
    id: `${copy.slug}-${createdAt.replace(/[:.]/g, "-")}`,
    createdAt, status: "pending", platform, format: "brandpost",
    pillar: copy.pillar, topic: copy.slug, caption: copy.caption, hashtags: copy.hashtags,
    assets: { image: imagePath }, dir: outDir,
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(item, null, 2));
  await addToQueue(item);
  return item;
}
