/**
 * Carrusel por CÓDIGO (deck): varios pósters de diseño (SVG + sharp), sin IA de imagen ni API
 * de pago. Cada slide se renderiza con renderDesignPoster y lleva el logo real. Se guarda como
 * carrusel (assets.images) para que el panel lo muestre como galería.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderDesignPoster } from "../lib/designPoster.js";
import { overlayLogo } from "../lib/brand.js";
import { addToQueue, type QueueItem } from "../queue/queue.js";
import type { DeckCopy } from "./generateCopy.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function generateDeck(copy: DeckCopy, platform: string, createdAt: string): Promise<QueueItem> {
  const outDir = join(ROOT, "assets", "output", copy.slug);
  mkdirSync(outDir, { recursive: true });

  console.log(`  → renderizando ${copy.slides.length} slides por código (sin API)...`);
  const images: string[] = [];
  for (let i = 0; i < copy.slides.length; i++) {
    const s = copy.slides[i];
    const p = join(outDir, `slide-${i + 1}.png`);
    writeFileSync(p, await renderDesignPoster({
      variant: s.variant,
      eyebrow: s.eyebrow,
      headline: s.headline,
      subline: s.subline,
      bullets: s.bullets,
      stat: s.stat,
      statLabel: s.statLabel,
      quote: s.quote,
      author: s.author,
      cta: s.cta ?? "",
    }));
    await overlayLogo(p);
    images.push(p);
  }

  writeFileSync(join(outDir, "post.md"), `# ${copy.slug}\n\n${copy.caption}\n\n${copy.hashtags.join(" ")}\n`);

  const item: QueueItem = {
    id: `${copy.slug}-${createdAt.replace(/[:.]/g, "-")}`,
    createdAt, status: "pending", platform, format: "carousel",
    pillar: copy.pillar, topic: copy.slug, caption: copy.caption, hashtags: copy.hashtags,
    assets: { images }, dir: outDir,
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(item, null, 2));
  await addToQueue(item);
  return item;
}
