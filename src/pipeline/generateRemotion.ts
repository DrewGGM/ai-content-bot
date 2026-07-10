/**
 * Video por CÓDIGO con Remotion (React → Chromium headless → mp4). Sin fal.
 * 3 aspectos (reel 9:16 · square 1:1 · feed 4:5) y 3 modos de audio:
 *   voice   → locución ElevenLabs + subtítulos quemados (ass)
 *   music   → música de fondo (ElevenLabs music)
 *   silent  → solo animación
 * El titular/chips/CTA los escribe Claude; el logo real y colores salen de la marca.
 */
import { mkdirSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { bundle } from "@remotion/bundler";
import { selectComposition, renderMedia } from "@remotion/renderer";
import { textToSpeechWithTimestamps } from "../providers/elevenlabs.js";
import { generateMusic } from "../providers/music.js";
import { alignmentToAss } from "../lib/srt.js";
import { applyPronunciation, fixSubtitleText } from "../lib/pronunciation.js";
import { audioDuration } from "./assembleVideo.js";
import { loadBrandConfig } from "../lib/brandConfig.js";
import { addToQueue, type QueueItem } from "../queue/queue.js";
import type { RemotionCopy } from "./generateCopy.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const REMOTION_ENTRY = join(ROOT, "remotion", "index.ts");
const FPS = 30;

export type Aspect = "reel" | "square" | "feed";
export type AudioMode = "voice" | "music" | "silent";

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell: false });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} salió ${code}: ${err.slice(-400)}`))));
  });
}

const PUBLIC_DIR = join(ROOT, "remotion", "public");
let _bundle: string | null = null;
async function getBundle(): Promise<string> {
  if (_bundle) return _bundle;
  _bundle = await bundle({ entryPoint: REMOTION_ENTRY, publicDir: PUBLIC_DIR });
  return _bundle;
}

/**
 * Logo de marca como DATA URI para la composición (prop logoSrc). Soporta svg/png/jpg/webp
 * y si no hay logo devuelve "" (el video sale sin logo). Antes se copiaba a public/logo.svg
 * y un logo faltante o en otro formato tumbaba el render ("Error loading image ... logo.svg").
 */
function logoDataUri(): string {
  try {
    const brand = loadBrandConfig();
    const p = join(ROOT, "assets", "brand", brand.logoFile);
    const ext = extname(p).toLowerCase();
    const mime =
      ext === ".svg" ? "image/svg+xml" :
      ext === ".png" ? "image/png" :
      ext === ".webp" ? "image/webp" : "image/jpeg";
    return `data:${mime};base64,${readFileSync(p).toString("base64")}`;
  } catch {
    return "";
  }
}

export async function generateRemotion(
  copy: RemotionCopy,
  opts: { platform: string; aspect: Aspect; audio: AudioMode; voiceId?: string },
  createdAt: string,
): Promise<QueueItem> {
  const outDir = join(ROOT, "assets", "output", copy.slug);
  mkdirSync(outDir, { recursive: true });
  const brand = loadBrandConfig();
  const videoPath = join(outDir, "reel.mp4");

  // 1) Voz + subtítulos (si aplica) → determina la duración.
  let voicePath: string | undefined;
  let durationFrames: number;
  if (opts.audio === "voice") {
    if (!opts.voiceId) throw new Error("El modo voz necesita un voiceId (ElevenLabs).");
    console.log("  → voz + timestamps (ElevenLabs)...");
    voicePath = join(outDir, "voice.mp3");
    const alignment = await textToSpeechWithTimestamps({ text: applyPronunciation(copy.voiceScript || copy.headline), dest: voicePath, voiceId: opts.voiceId });
    durationFrames = Math.ceil(((await audioDuration(voicePath)) + 0.4) * FPS);
    writeFileSync(join(outDir, "subs.ass"), fixSubtitleText(alignmentToAss(alignment, 4)));
  } else {
    durationFrames = opts.aspect === "square" ? 190 : opts.aspect === "feed" ? 210 : 255;
  }

  // 2) Render de la animación con Remotion (sin audio).
  console.log(`  → renderizando video ${opts.aspect} con Remotion (código, sin fal)...`);
  const serveUrl = await getBundle();
  const inputProps = {
    format: opts.aspect,
    headline: copy.headline,
    accentWord: copy.accentWord ?? "",
    chips: copy.chips ?? [],
    cta: copy.cta,
    colors: { primary: brand.colors.primary, accent: brand.colors.accent },
    durationInFrames: durationFrames,
    logoSrc: logoDataUri(),
  };
  const composition = await selectComposition({ serveUrl, id: "Video", inputProps });
  const visuals = join(outDir, "visuals.mp4");
  await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: visuals, inputProps });

  // 3) Audio + ensamblado final con ffmpeg (cwd = outDir para rutas relativas).
  if (opts.audio === "voice") {
    console.log("  → ensamblando (voz + subtítulos)...");
    await run("ffmpeg", ["-y", "-i", "visuals.mp4", "-i", "voice.mp3", "-filter_complex", "[0:v]ass=subs.ass[v]", "-map", "[v]", "-map", "1:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "reel.mp4"], outDir);
  } else if (opts.audio === "music") {
    console.log("  → música de fondo (ElevenLabs)...");
    const durSec = durationFrames / FPS;
    await generateMusic({ prompt: `Upbeat, modern, clean branding background music for ${brand.name}. Positive, corporate, no vocals.`, durationSec: durSec, dest: join(outDir, "music.mp3") });
    await run("ffmpeg", ["-y", "-i", "visuals.mp4", "-i", "music.mp3", "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-shortest", "-af", `afade=t=out:st=${Math.max(0, durSec - 1.2).toFixed(2)}:d=1.2`, "reel.mp4"], outDir);
  } else {
    copyFileSync(visuals, videoPath);
  }

  writeFileSync(join(outDir, "post.md"), `# ${copy.slug}\n\n${copy.caption}\n\n${copy.hashtags.join(" ")}\n`);

  const item: QueueItem = {
    id: `${copy.slug}-${createdAt.replace(/[:.]/g, "-")}`,
    createdAt, status: "pending", platform: opts.platform, format: "motion",
    pillar: copy.pillar, topic: copy.slug, caption: copy.caption, hashtags: copy.hashtags,
    assets: { video: videoPath, ...(voicePath ? { voice: voicePath } : {}) }, dir: outDir,
  };
  writeFileSync(join(outDir, "manifest.json"), JSON.stringify(item, null, 2));
  await addToQueue(item);
  return item;
}
