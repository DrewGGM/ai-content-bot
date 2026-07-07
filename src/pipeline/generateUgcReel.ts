/**
 * Reel UGC (HeyGen): avatar realista hablando un guion → overlay logo + titular/CTA.
 * Requiere HEYGEN_API_KEY + HEYGEN_AVATAR_ID + HEYGEN_VOICE_ID. Lo que más convierte en ads.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateAvatarVideo } from "../providers/heygen.js";
import { buildReelOverlayAss } from "../lib/srt.js";
import { applyPronunciation, fixSubtitleText } from "../lib/pronunciation.js";
import { renderLogoPlate } from "../lib/brand.js";
import { assembleUgcReel, audioDuration } from "./assembleVideo.js";
import { addToQueue, type QueueItem } from "../queue/queue.js";
import type { UgcCopy } from "./generateCopy.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function generateUgcReel(copy: UgcCopy, platform: string, createdAt: string): Promise<QueueItem> {
  const outDir = join(ROOT, "assets", "output", copy.slug);
  mkdirSync(outDir, { recursive: true });

  const avatarPath = join(outDir, "avatar.mp4");
  const assPath = join(outDir, "overlay.ass");
  const logoPath = join(outDir, "logo.png");
  const videoPath = join(outDir, "reel.mp4");

  console.log(`  → avatar hablando (HeyGen)...`);
  await generateAvatarVideo({ script: applyPronunciation(copy.script), dest: avatarPath });

  const dur = await audioDuration(avatarPath);
  const overlay = buildReelOverlayAss({ headline: copy.headline, cta: copy.cta, durationSec: dur });
  writeFileSync(assPath, fixSubtitleText(overlay));

  console.log(`  → logo + ensamblando reel.mp4...`);
  writeFileSync(logoPath, await renderLogoPlate(1080, Math.round(1920 * 0.16)));
  await assembleUgcReel({ video: avatarPath, ass: assPath, logo: logoPath, out: videoPath });

  writeFileSync(join(outDir, "post.md"), `# ${copy.slug}\n\n${copy.caption}\n\n${copy.hashtags.join(" ")}\n`);

  const item: QueueItem = {
    id: `${copy.slug}-${createdAt.replace(/[:.]/g, "-")}`,
    createdAt, status: "pending", platform, format: "reel",
    pillar: copy.pillar, topic: copy.slug, caption: copy.caption, hashtags: copy.hashtags,
    assets: { video: videoPath }, dir: outDir,
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(item, null, 2));
  await addToQueue(item);
  return item;
}
