/** Genera un carrusel: N imágenes 4:5 (Nano Banana Pro) + caption → cola. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateReviewedImage } from "./visualQA.js";
import { overlayLogo } from "../lib/brand.js";
import { addToQueue, type QueueItem } from "../queue/queue.js";
import type { CarouselCopy } from "./generateCopy.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function generateCarousel(copy: CarouselCopy, platform: string, createdAt: string): Promise<QueueItem> {
  const outDir = join(ROOT, "assets", "output", copy.slug);
  mkdirSync(outDir, { recursive: true });

  const images: string[] = [];
  for (let i = 0; i < copy.slides.length; i++) {
    console.log(`  → slide ${i + 1}/${copy.slides.length} (Nano Banana Pro) + QA visual...`);
    const dest = join(outDir, `slide-${String(i + 1).padStart(2, "0")}.png`);
    await generateReviewedImage({
      prompt: copy.slides[i].imagePrompt, dest, aspect: "4:5", resolution: "4K",
      brief: `slide ${i + 1}: ${copy.slides[i].heading}`,
      label: `slide-${i + 1}`,
    });
    await overlayLogo(dest);
    images.push(dest);
  }

  writeFileSync(join(outDir, "post.md"), `# ${copy.slug}\n\n${copy.caption}\n\n${copy.hashtags.join(" ")}\n`);

  const item: QueueItem = {
    id: `${copy.slug}-${createdAt.replace(/[:.]/g, "-")}`,
    createdAt,
    status: "pending",
    platform,
    format: "carousel",
    pillar: copy.pillar,
    topic: copy.slug,
    caption: copy.caption,
    hashtags: copy.hashtags,
    assets: { images, image: images[0] },
    dir: outDir,
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(item, null, 2));
  await addToQueue(item);
  return item;
}
