/**
 * Runners de los pasos de workflow: cada tipo envuelve un provider EXISTENTE del bot
 * (imagen fal con QA, image-to-video Kling, voz ElevenLabs, subtítulos ASS, música de la
 * biblioteca/CC0, avatar OmniHuman/HeyGen, ensamblado ffmpeg con marca). Los runners corren
 * con el perfil activo del job (multi-usuario) porque los providers leen env vía envGet().
 */
import { writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { join, basename, isAbsolute } from "node:path";
import { spawn } from "node:child_process";
import { askBrandJson } from "../pipeline/generateCopy.js";
import { generateReviewedImage } from "../pipeline/visualQA.js";
import { generateVideoFromImage, generateTalkingAvatar, videoModelFromEnv } from "../providers/fal.js";
import { textToSpeechWithTimestamps, type Alignment } from "../providers/elevenlabs.js";
import { generateAvatarVideo } from "../providers/heygen.js";
import { alignmentToAss, buildReelOverlayAss } from "../lib/srt.js";
import { applyPronunciation, fixSubtitleText } from "../lib/pronunciation.js";
import { renderLogoPlate } from "../lib/brand.js";
import { obtainMusic } from "../lib/musicLibrary.js";
import { audioDuration } from "../pipeline/assembleVideo.js";
import { loadBrandContext } from "../knowledge/loader.js";

export interface StepCtx {
  outDir: string;
  slug: string;
  aspect: "reel" | "square" | "feed";
  topic: string;
  instruction?: string;
}

type Runner = (id: string, inputs: Record<string, unknown>, options: Record<string, unknown>, ctx: StepCtx) => Promise<Record<string, unknown>>;

const ASPECT_RATIO: Record<StepCtx["aspect"], "9:16" | "1:1" | "4:5"> = { reel: "9:16", square: "1:1", feed: "4:5" };
const ASPECT_SIZE: Record<StepCtx["aspect"], [number, number]> = { reel: [1080, 1920], square: [1080, 1080], feed: [1080, 1350] };

function str(v: unknown, what: string): string {
  if (typeof v !== "string" || !v.trim()) throw new Error(`falta la entrada "${what}" (o no es texto)`);
  return v;
}

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell: false });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} salió ${code}: ${err.slice(-400)}`))));
  });
}

// Descripciones de campos conocidos para el paso `copy` (el usuario puede pedir otros).
const FIELD_DESC: Record<string, string> = {
  slug: '"kebab-case-corto"',
  headline: '"titular corto y potente en español para pantalla (máx 6-8 palabras)"',
  hook: '"gancho corto en español para pantalla (máx 6-8 palabras)"',
  voiceover: '"locución en español MUY concisa: 2-3 frases, MÁXIMO 25 palabras (~10s), tono cálido y directo"',
  script: '"guion hablado en español, natural y directo, 30-60 palabras"',
  cta: '"llamada a la acción corta (ej. \'Escríbenos por WhatsApp\')"',
  caption: '"caption en español: gancho en la 1a línea, saltos de línea, beneficio y CTA. Emojis moderados"',
  hashtags: '["un hashtag de la marca", "5-8 hashtags relevantes"]',
  pillar: '"uno de los pilares de contenido"',
  image_prompt: '"prompt EN INGLÉS de una escena/visual premium relacionada al tema. SIN texto, SIN letras, SIN logos, SIN marcas de agua. Composición con aire para overlay."',
  motion_prompt: '"prompt EN INGLÉS del MOVIMIENTO para image-to-video: cámara suave cinematográfica, micro-movimiento natural, estable, sin distorsión"',
  character_prompt: '"prompt EN INGLÉS de un RETRATO frontal fotorrealista de una persona acorde a la marca (busto, mirando a cámara, fondo limpio, luz suave). SIN texto ni logos."',
};

const runners: Record<string, Runner> = {
  /** El agente escribe el copy (con TODO el contexto de marca + skills activas). */
  async copy(_id, inputs, options, ctx) {
    const tema = typeof inputs.tema === "string" && inputs.tema.trim() ? inputs.tema : ctx.topic;
    const fields = Array.isArray(options.fields) && options.fields.length ? options.fields.map(String) : ["headline", "voiceover", "caption", "hashtags", "image_prompt", "motion_prompt"];
    for (const f of ["slug", "caption", "hashtags", "pillar"]) if (!fields.includes(f)) fields.push(f);
    const shape = fields.map((f) => `  "${f}": ${FIELD_DESC[f] ?? '"texto en español acorde al tema y la marca"'}`).join(",\n");
    const data = await askBrandJson(
      `Eres el community manager de la marca. Crea el contenido de una pieza sobre: "${tema}".\n` +
      `Devuelve ÚNICAMENTE un JSON válido (sin markdown):\n{\n${shape}\n}`,
      ctx.instruction,
    );
    if (!Array.isArray(data.hashtags)) data.hashtags = [];
    return data;
  },

  /** Imagen IA (con QA visual y dirección de arte de la marca). */
  async image(id, inputs, options, ctx) {
    const dest = join(ctx.outDir, `${id}.png`);
    const aspect = (typeof options.aspect_ratio === "string" ? options.aspect_ratio : ASPECT_RATIO[ctx.aspect]) as "9:16" | "1:1" | "4:5" | "16:9";
    await generateReviewedImage({
      prompt: str(inputs.prompt, "prompt"), dest, aspect,
      resolution: (options.resolution as any) ?? "2K",
      brief: `pieza de workflow sobre "${ctx.topic}" — SIN texto ni logos, estética premium`,
    });
    return { image: dest };
  },

  /** Anima una imagen a video corto (Kling/Veo image-to-video). */
  async animate(id, inputs, options, ctx) {
    const dest = join(ctx.outDir, `${id}.mp4`);
    await generateVideoFromImage({
      imagePath: str(inputs.image, "image"),
      prompt: typeof inputs.prompt === "string" && inputs.prompt.trim() ? inputs.prompt : "subtle cinematic camera push-in, gentle natural motion, professional",
      dest,
      duration: options.duration === 10 ? 10 : 5,
      model: typeof options.model === "string" ? options.model : videoModelFromEnv(),
    });
    return { video: dest };
  },

  /** Voz ElevenLabs con timestamps (para subtítulos sincronizados). */
  async tts(id, inputs, options, ctx) {
    const voiceId = (typeof options.voiceId === "string" && options.voiceId) || loadBrandContext().voice?.default?.voiceId;
    if (!voiceId) throw new Error("el paso tts necesita un voiceId (options.voiceId o knowledge/voice.json → default.voiceId)");
    const dest = join(ctx.outDir, `${id}.mp3`);
    const alignment = await textToSpeechWithTimestamps({ text: applyPronunciation(str(inputs.text, "text")), dest, voiceId });
    return { audio: dest, alignment };
  },

  /** Subtítulos .ass sincronizados (+ titular/CTA como overlay si se pasan). */
  async subtitles(id, inputs, options, ctx) {
    const alignment = inputs.alignment as Alignment | undefined;
    const headline = typeof inputs.headline === "string" ? inputs.headline : "";
    const cta = typeof inputs.cta === "string" ? inputs.cta : "";
    const maxWords = Number(options.maxWords ?? 4);
    let ass: string;
    if (headline || cta) {
      const ends = alignment?.character_end_times_seconds ?? [];
      const durationSec = (ends.length ? ends[ends.length - 1] : 8) + 0.4;
      ass = buildReelOverlayAss({ headline, alignment, cta, durationSec, maxWords });
    } else {
      if (!alignment) throw new Error("el paso subtitles necesita alignment (de un paso tts) o headline/cta");
      ass = alignmentToAss(alignment, maxWords);
    }
    const dest = join(ctx.outDir, `${id}.ass`);
    writeFileSync(dest, fixSubtitleText(ass));
    return { ass: dest };
  },

  /** Música de fondo: la IA elige de la biblioteca o descarga una pista CC0. */
  async music(_id, inputs, _options, ctx) {
    const brief = typeof inputs.brief === "string" && inputs.brief.trim() ? inputs.brief : ctx.topic;
    const track = await obtainMusic(brief);
    if (!track) console.warn("  ⚠ paso music: sin pista disponible — el ensamblado sigue sin música");
    return { track: track ?? null };
  },

  /** Personaje que habla: retrato + voz → OmniHuman (fal); o guion → avatar HeyGen. */
  async avatar(id, inputs, options, ctx) {
    const dest = join(ctx.outDir, `${id}.mp4`);
    const provider = typeof options.provider === "string" ? options.provider : (inputs.script ? "heygen" : "omnihuman");
    if (provider === "heygen") {
      await generateAvatarVideo({ script: str(inputs.script, "script"), dest });
    } else {
      await generateTalkingAvatar({ imagePath: str(inputs.image, "image"), audioPath: str(inputs.audio, "audio"), dest });
    }
    return { video: dest };
  },

  /** Ensamblado final ffmpeg: escala al aspecto, quema subtítulos, logo de marca, voz+música. */
  async assemble(id, inputs, options, ctx) {
    const video = str(inputs.video, "video");
    const voice = typeof inputs.voice === "string" ? inputs.voice : "";
    const music = typeof inputs.music === "string" ? inputs.music : ""; // null del paso music → no llega
    const assIn = typeof inputs.ass === "string" ? inputs.ass : "";
    const [W, H] = ASPECT_SIZE[ctx.aspect];
    const out = join(ctx.outDir, `${id}.mp4`);

    // duración: la voz manda; si no hay, el propio clip (con tope de 60s).
    const durSec = voice ? (await audioDuration(voice)) + 0.4 : Math.min(await videoDuration(video), 60);
    const fadeSt = Math.max(0, durSec - 1.2).toFixed(2);

    // el filtro ass necesita ruta relativa (cwd = outDir); si viene de otra carpeta se copia.
    let assName = "";
    if (assIn) {
      assName = basename(assIn);
      if (!isAbsolute(assIn) || !assIn.startsWith(ctx.outDir)) { copyFileSync(assIn, join(ctx.outDir, assName)); }
    }

    const args: string[] = ["-y", "-stream_loop", "-1", "-i", video];
    const audioInputs: string[] = [];
    if (voice) { args.push("-i", voice); audioInputs.push("voice"); }
    if (music) { args.push("-stream_loop", "-1", "-i", music); audioInputs.push("music"); }
    let logoIdx = -1;
    if (options.brandOverlay !== false) {
      const logoPath = join(ctx.outDir, "logo-plate.png");
      writeFileSync(logoPath, await renderLogoPlate(W, Math.round(H * 0.16)));
      args.push("-i", logoPath);
      logoIdx = 1 + audioInputs.length;
    }

    let v = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
    if (assName) v += `,ass=${assName}`;
    v += `[s]`;
    const vf = logoIdx >= 0 ? `${v};[s][${logoIdx}:v]overlay=0:0[v]` : v.replace("[s]", "[v]");

    const musicVol = Number(options.musicVolume ?? 0.22);
    let af = "";
    let audioMap: string[] = [];
    if (voice && music) {
      af = `;[2:a]volume=${musicVol},afade=t=out:st=${fadeSt}:d=1.2[m];[1:a][m]amix=inputs=2:duration=first:normalize=0[a]`;
      audioMap = ["-map", "[a]"];
    } else if (voice) {
      audioMap = ["-map", "1:a"];
    } else if (music) {
      af = `;[1:a]volume=0.9,afade=t=out:st=${fadeSt}:d=1.2[a]`;
      audioMap = ["-map", "[a]"];
    }

    args.push(
      "-filter_complex", vf + af,
      "-map", "[v]", ...audioMap,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "high",
      ...(audioMap.length ? ["-c:a", "aac", "-b:a", "192k"] : []),
      "-t", String(durSec), out,
    );
    await run("ffmpeg", args, ctx.outDir);
    return { video: out };
  },
};

async function videoDuration(path: string): Promise<number> {
  // ffprobe de la duración del contenedor (para clips sin voz).
  return new Promise((resolve) => {
    const child = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path], { shell: false });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.on("close", () => resolve(parseFloat(out.trim()) || 8));
    child.on("error", () => resolve(8));
  });
}

export const STEP_TYPES = Object.keys(runners);

export async function runStep(type: string, inputs: Record<string, unknown>, options: Record<string, unknown>, ctx: StepCtx, id = type): Promise<Record<string, unknown>> {
  const runner = runners[type];
  if (!runner) throw new Error(`Tipo de paso desconocido: "${type}"`);
  return runner(id, inputs, options, ctx);
}
