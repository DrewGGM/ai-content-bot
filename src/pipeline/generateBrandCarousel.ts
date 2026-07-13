/**
 * Carrusel de MARCA premium: N slides 1:1, cada uno una imagen de marca (logo real + referencias
 * + prompt maestro), con la MISMA línea gráfica. Para que los slides sean consistentes entre sí,
 * el slide 1 se pasa como referencia extra a los siguientes. Reusa `renderBrandImage` del post de
 * marca. Sin logo ni referencias, cae al carrusel clásico.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderBrandImage, imageFileToDataUri } from "./generateBrandPost.js";
import { generateCarousel } from "./generateCarousel.js";
import { generateCarouselCopy } from "./generateCopy.js";
import { addToQueue, type QueueItem } from "../queue/queue.js";
import type { BrandCarouselCopy } from "./generateCopy.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function generateBrandCarousel(copy: BrandCarouselCopy, platform: string, createdAt: string, instruction?: string): Promise<QueueItem> {
  const outDir = join(ROOT, "assets", "output", copy.slug);
  mkdirSync(outDir, { recursive: true });

  const slides = (copy.slides ?? []).slice(0, 6);
  if (!slides.length) throw new Error("El carrusel de marca no tiene slides");

  const images: string[] = [];
  let firstUri: string | undefined; // slide 1 como ancla de estilo para los demás

  for (let i = 0; i < slides.length; i++) {
    const s = slides[i];
    const dest = join(outDir, `slide-${String(i + 1).padStart(2, "0")}.png`);
    console.log(`  → slide de marca ${i + 1}/${slides.length}...`);
    const ok = await renderBrandImage({
      dest,
      fields: { headline: s.headline, subline: s.subline, cta: s.cta, visualIdea: s.visualIdea, iconLabels: s.iconLabels },
      extraReferenceImages: firstUri ? [firstUri] : undefined,
    });
    if (!ok) {
      // Sin logo ni referencias no hay ancla de marca → carrusel clásico (escena + overlay).
      console.log("  ⚠ carrusel de marca sin logo ni referencias — usando el carrusel clásico");
      return generateCarousel(await generateCarouselCopy(copy.slug, instruction), platform, createdAt);
    }
    if (i === 0) firstUri = imageFileToDataUri(dest);
    images.push(dest);
  }

  writeFileSync(join(outDir, "post.md"), `# ${copy.slug}\n\n${copy.caption}\n\n${copy.hashtags.join(" ")}\n`);

  const item: QueueItem = {
    id: `${copy.slug}-${createdAt.replace(/[:.]/g, "-")}`,
    createdAt, status: "pending", platform, format: "brandcarousel",
    pillar: copy.pillar, topic: copy.slug, caption: copy.caption, hashtags: copy.hashtags,
    assets: { images, image: images[0] }, dir: outDir,
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(item, null, 2));
  await addToQueue(item);
  return item;
}
