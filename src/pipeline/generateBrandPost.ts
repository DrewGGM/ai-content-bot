/**
 * Post de MARCA premium: imagen 1:1 diseñada con Nano Banana Pro (Gemini 3 Pro) en modo EDIT,
 * usando el LOGO real + las imágenes de referencia de la marca (assets/brand/references) como
 * ancla de estilo — igual que pasarle referencias a ChatGPT. Todo va horneado (logo, titular,
 * subtítulo, mockup, iconos, CTA, web); NO se superpone logo por código.
 * Si no hay referencias ni logo, cae al post normal (escena + overlay) para no romperse.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateReviewedImage } from "./visualQA.js";
import { brandPosterPrompt } from "../lib/artDirection.js";
import { brandLogoReferenceDataUri } from "../lib/brand.js";
import { brandReferenceDataUris } from "../lib/brandReferences.js";
import { generatePost } from "./generatePost.js";
import { generatePostCopy } from "./generateCopy.js";
import { addToQueue, type QueueItem } from "../queue/queue.js";
import type { BrandPostCopy } from "./generateCopy.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function generateBrandPost(copy: BrandPostCopy, platform: string, createdAt: string, instruction?: string): Promise<QueueItem> {
  // Referencias: logo real (rasterizado) + ejemplos de estilo subidos al panel.
  const refs: string[] = [];
  const logo = await brandLogoReferenceDataUri();
  if (logo) refs.push(logo);
  refs.push(...brandReferenceDataUris());

  // Sin ninguna referencia el modelo edit no tiene ancla → usar el post clásico (escena + overlay).
  if (!refs.length) {
    console.log("  ⚠ post de marca sin logo ni referencias — usando el post clásico");
    return generatePost(await generatePostCopy(copy.slug, instruction), platform, createdAt);
  }

  const outDir = join(ROOT, "assets", "output", copy.slug);
  mkdirSync(outDir, { recursive: true });
  const imagePath = join(outDir, "image.png");

  const prompt = brandPosterPrompt({
    headline: copy.headline,
    subline: copy.subline,
    cta: copy.cta,
    visualIdea: copy.visualIdea,
    iconLabels: copy.iconLabels,
  });

  console.log(`  → post de marca (Nano Banana Pro edit · ${refs.length} referencia(s)) + QA visual...`);
  await generateReviewedImage({
    prompt, dest: imagePath, aspect: "1:1", resolution: "2K",
    referenceImages: refs, rawPrompt: true,
    brief: `post de marca de ${copy.slug}: titular "${copy.headline}". Debe verse premium, con el logo, textos bien escritos y consistente con las referencias de marca.`,
  });
  // NO overlayLogo: el logo ya va horneado en la composición.

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
