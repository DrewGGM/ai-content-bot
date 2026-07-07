/**
 * Reel de MOTION-GRAPHICS (sin fal): fondo de marca animado + titular/subtítulos/CTA + logo + voz.
 * Confiable, 100% on-brand, texto siempre nítido. Ideal para contenido educativo de texto.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { textToSpeechWithTimestamps } from "../providers/elevenlabs.js";
import { buildReelOverlayAss } from "../lib/srt.js";
import { applyPronunciation, fixSubtitleText } from "../lib/pronunciation.js";
import { renderLogoPlate } from "../lib/brand.js";
import { renderBrandBg } from "../lib/motionBg.js";
import { assembleMotionReel, audioDuration } from "./assembleVideo.js";
import { addToQueue, type QueueItem } from "../queue/queue.js";
import type { MotionCopy } from "./generateCopy.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function generateMotionReel(copy: MotionCopy, platform: string, voiceId: string, createdAt: string): Promise<QueueItem> {
  const outDir = join(ROOT, "assets", "output", copy.slug);
  mkdirSync(outDir, { recursive: true });

  const bgPath = join(outDir, "bg.png");
  const voicePath = join(outDir, "voice.mp3");
  const assPath = join(outDir, "overlay.ass");
  const logoPath = join(outDir, "logo.png");
  const videoPath = join(outDir, "reel.mp4");

  console.log(`  → fondo de marca (motion-graphics)...`);
  writeFileSync(bgPath, await renderBrandBg(copy.slug.length));

  console.log(`  → voz + timestamps (ElevenLabs)...`);
  const alignment = await textToSpeechWithTimestamps({
    text: applyPronunciation(copy.voiceScript), dest: voicePath, voiceId,
  });

  const total = (await audioDuration(voicePath)) + 0.4;
  const overlay = buildReelOverlayAss({ headline: copy.headline, alignment, cta: copy.cta, durationSec: total, kinetic: true });
  writeFileSync(assPath, fixSubtitleText(overlay));

  console.log(`  → logo + ensamblando reel.mp4...`);
  writeFileSync(logoPath, await renderLogoPlate(1080, Math.round(1920 * 0.16)));
  await assembleMotionReel({ bg: bgPath, audio: voicePath, ass: assPath, logo: logoPath, out: videoPath });

  writeFileSync(join(outDir, "post.md"), `# ${copy.slug}\n\n${copy.caption}\n\n${copy.hashtags.join(" ")}\n`);

  const item: QueueItem = {
    id: `${copy.slug}-${createdAt.replace(/[:.]/g, "-")}`,
    createdAt, status: "pending", platform, format: "reel",
    pillar: copy.pillar, topic: copy.slug, caption: copy.caption, hashtags: copy.hashtags,
    assets: { voice: voicePath, video: videoPath }, dir: outDir,
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(item, null, 2));
  await addToQueue(item);
  return item;
}
