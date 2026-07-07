/**
 * Pipeline de reel estilo ANUNCIO (b-roll + overlay):
 * 1. Escena fotorrealista SIN texto (Nano Banana Pro) + QA visual
 * 2. Animación (Kling/Veo, configurable) + QA de frame (re-anima si distorsiona)
 * 3. Voz (pronunciación corregida) + alineación
 * 4. Capa overlay nítida: titular + subtítulos + CTA  (.ass)
 * 5. Ensamblado ffmpeg: video + overlay + LOGO real + audio
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateVideoFromImage, videoModelFromEnv } from "../providers/fal.js";
import { textToSpeechWithTimestamps } from "../providers/elevenlabs.js";
import { reviewImage } from "../providers/vision.js";
import { buildReelOverlayAss } from "../lib/srt.js";
import { applyPronunciation, fixSubtitleText } from "../lib/pronunciation.js";
import { renderLogoPlate } from "../lib/brand.js";
import { generateReviewedImage, extractFrame } from "./visualQA.js";
import { assembleReelFromVideo, audioDuration } from "./assembleVideo.js";
import { addToQueue, type QueueItem } from "../queue/queue.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface ReelBrief {
  slug: string;
  platform: string;
  scenePrompt: string;
  motionPrompt: string;
  headline: string;
  voiceScript: string;
  cta: string;
  caption: string;
  hashtags: string[];
  voiceId: string;
  pillar?: string;
}

export async function generateReel(brief: ReelBrief, createdAt: string): Promise<QueueItem> {
  const outDir = join(ROOT, "assets", "output", brief.slug);
  mkdirSync(outDir, { recursive: true });

  const scenePath = join(outDir, "scene.png");
  const clipPath = join(outDir, "clip.mp4");
  const voicePath = join(outDir, "voice.mp3");
  const assPath = join(outDir, "overlay.ass");
  const logoPath = join(outDir, "logo.png");
  const videoPath = join(outDir, "reel.mp4");

  console.log(`  → escena fotorrealista SIN texto (Nano Banana Pro) + QA...`);
  await generateReviewedImage({
    prompt: brief.scenePrompt, dest: scenePath, aspect: "9:16", resolution: "2K",
    brief: `escena de reel SIN texto ni logos: ${brief.slug}. Debe verse fotorrealista y premium, sin letras.`,
  });

  // Animación con QA de frame: re-anima si distorsiona.
  const model = videoModelFromEnv();
  const motion = brief.motionPrompt || "subtle cinematic camera push-in, gentle natural motion, professional";
  const videoAttempts = Number(process.env.VIDEO_QA_ATTEMPTS ?? 2);
  for (let attempt = 1; attempt <= videoAttempts; attempt++) {
    console.log(`  → animando (${model.includes("veo") ? "Veo3" : "Kling"})${attempt > 1 ? ` (reintento ${attempt})` : ""}...`);
    await generateVideoFromImage({
      imagePath: scenePath,
      prompt: attempt === 1 ? motion : "very subtle, minimal smooth motion, slow gentle camera drift, no warping or distortion, keep everything stable and clean",
      dest: clipPath, duration: 5, model,
    });
    if (attempt >= videoAttempts) break;
    const frame = await extractFrame(clipPath, 2.5, "_qaframe.png");
    const v = await reviewImage(frame, brief.scenePrompt, `frame del reel ${brief.slug}: revisa distorsión/artefactos de movimiento (la escena NO debe tener texto)`);
    try { rmSync(frame); } catch {}
    if (v.ok) { console.log(`      QA video: OK (${v.score}/100)`); break; }
    console.log(`      QA video: ${v.score}/100 — re-animando. ${v.issues.slice(0, 2).join("; ")}`);
  }

  console.log(`  → voz + timestamps (ElevenLabs, pronunciación corregida)...`);
  const alignment = await textToSpeechWithTimestamps({
    text: applyPronunciation(brief.voiceScript), dest: voicePath, voiceId: brief.voiceId,
  });

  const total = (await audioDuration(voicePath)) + 0.4;
  const overlay = buildReelOverlayAss({ headline: brief.headline, alignment, cta: brief.cta, durationSec: total });
  writeFileSync(assPath, fixSubtitleText(overlay));

  console.log(`  → logo real + ensamblando reel.mp4 (b-roll + overlay)...`);
  writeFileSync(logoPath, await renderLogoPlate(1080, Math.round(1920 * 0.16)));
  await assembleReelFromVideo({ video: clipPath, audio: voicePath, ass: assPath, logo: logoPath, out: videoPath });

  writeFileSync(join(outDir, "post.md"), `# ${brief.slug}\n\n${brief.caption}\n\n${brief.hashtags.join(" ")}\n`);

  const item: QueueItem = {
    id: `${brief.slug}-${createdAt.replace(/[:.]/g, "-")}`,
    createdAt, status: "pending", platform: brief.platform, format: "reel",
    pillar: brief.pillar, topic: brief.slug, caption: brief.caption, hashtags: brief.hashtags,
    assets: { image: scenePath, voice: voicePath, video: videoPath }, dir: outDir,
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(item, null, 2));
  await addToQueue(item);
  return item;
}
