/**
 * Post de DISEÑO renderizado por código (SVG + sharp) — sin IA de imagen, sin API de pago.
 * Aplica los principios de las skills de diseño. El copy lo escribe Claude (suscripción).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderDesignPoster } from "../lib/designPoster.js";
import { overlayLogo } from "../lib/brand.js";
import { addToQueue, type QueueItem } from "../queue/queue.js";
import type { DesignCopy } from "./generateCopy.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function generateDesignPost(copy: DesignCopy, platform: string, createdAt: string): Promise<QueueItem> {
  const outDir = join(ROOT, "assets", "output", copy.slug);
  mkdirSync(outDir, { recursive: true });
  const imagePath = join(outDir, "image.png");

  console.log(`  → renderizando poster de diseño (${copy.variant}, código, sin API)...`);
  writeFileSync(imagePath, await renderDesignPoster({
    variant: copy.variant,
    eyebrow: copy.eyebrow,
    headline: copy.headline,
    subline: copy.subline,
    bullets: copy.bullets,
    stat: copy.stat,
    statLabel: copy.statLabel,
    quote: copy.quote,
    author: copy.author,
    cta: copy.cta,
  }));
  await overlayLogo(imagePath, true);

  writeFileSync(join(outDir, "post.md"), `# ${copy.slug}\n\n${copy.caption}\n\n${copy.hashtags.join(" ")}\n`);

  const item: QueueItem = {
    id: `${copy.slug}-${createdAt.replace(/[:.]/g, "-")}`,
    createdAt, status: "pending", platform, format: "post",
    pillar: copy.pillar, topic: copy.slug, caption: copy.caption, hashtags: copy.hashtags,
    assets: { image: imagePath }, dir: outDir,
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(item, null, 2));
  await addToQueue(item);
  return item;
}
