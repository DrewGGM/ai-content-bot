/** Genera un post de imagen única 1:1 (Nano Banana Pro) + caption → cola. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateReviewedImage } from "./visualQA.js";
import { overlayLogo } from "../lib/brand.js";
import { addToQueue, type QueueItem } from "../queue/queue.js";
import type { PostCopy } from "./generateCopy.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function generatePost(copy: PostCopy, platform: string, createdAt: string): Promise<QueueItem> {
  const outDir = join(ROOT, "assets", "output", copy.slug);
  mkdirSync(outDir, { recursive: true });

  const imagePath = join(outDir, "image.png");
  console.log(`  → imagen 1:1 (Nano Banana Pro) + QA visual...`);
  await generateReviewedImage({
    prompt: copy.imagePrompt, dest: imagePath, aspect: "1:1", resolution: "4K",
    brief: `${copy.slug} (post): ${copy.caption.split("\n")[0]}`,
  });
  await overlayLogo(imagePath);

  writeFileSync(join(outDir, "post.md"), `# ${copy.slug}\n\n${copy.caption}\n\n${copy.hashtags.join(" ")}\n`);

  const item: QueueItem = {
    id: `${copy.slug}-${createdAt.replace(/[:.]/g, "-")}`,
    createdAt,
    status: "pending",
    platform,
    format: "post",
    pillar: copy.pillar,
    topic: copy.slug,
    caption: copy.caption,
    hashtags: copy.hashtags,
    assets: { image: imagePath },
    dir: outDir,
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(item, null, 2));
  await addToQueue(item);
  return item;
}
