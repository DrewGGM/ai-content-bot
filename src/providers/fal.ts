/** Proveedor de imagen y video: fal.ai (API REST directa) */
import { writeFileSync, readFileSync } from "node:fs";
import { env } from "../lib/env.js";

const sleepMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch con reintentos ante fallos de red transitorios. */
async function fetchRetry(url: string, init?: RequestInit, tries = 3): Promise<Response> {
  let lastErr: any;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, init);
      // 5xx transitorios → reintentar
      if (res.status >= 500 && i < tries) {
        await sleepMs(1500 * i);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (i < tries) await sleepMs(1500 * i);
    }
  }
  throw lastErr ?? new Error("fetch falló");
}

async function downloadTo(url: string, dest: string) {
  const res = await fetchRetry(url);
  if (!res.ok) throw new Error(`Descarga fallida ${res.status}: ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
}

/**
 * Modelos de imagen disponibles. Default: Nano Banana Pro (Google Gemini 3 Pro)
 * — el mejor en tipografía/marca y calidad profesional.
 */
export const IMAGE_MODELS = {
  nanoBananaPro: "fal-ai/nano-banana-pro", // pro: mejor texto + calidad (premium)
  nanoBanana2: "fal-ai/nano-banana-2", // rapido SOTA de Google
  fluxProUltra: "fal-ai/flux-pro/v1.1-ultra", // fotorealismo hasta 2K
  recraftV3: "fal-ai/recraft/v3/text-to-image", // marca + vector + texto largo
  fluxSchnell: "fal-ai/flux/schnell", // barato/rapido (borradores)
} as const;

const FLUX_SIZE_MAP: Record<string, string> = {
  "9:16": "portrait_16_9",
  "1:1": "square_hd",
  "4:5": "portrait_4_3",
  "16:9": "landscape_16_9",
};

/** Genera una imagen con fal y la guarda en `dest`. Default: Nano Banana Pro a 2K.
 *  El `prompt` debe venir ya con la dirección de arte aplicada (lo hace el dispatcher images.ts). */
export async function falImage(opts: {
  prompt: string;
  dest: string;
  aspect?: "9:16" | "1:1" | "4:5" | "16:9";
  model?: string;
  resolution?: "1K" | "2K" | "4K";
}): Promise<string> {
  const aspect = opts.aspect ?? "9:16";
  const model = opts.model ?? IMAGE_MODELS.nanoBananaPro;
  const isGoogle = model.includes("nano-banana") || model.includes("gemini");
  const prompt = opts.prompt;

  const resolution = opts.resolution ?? "2K";
  // Cada familia de modelos usa un esquema de entrada distinto.
  const input = isGoogle
    ? { prompt, aspect_ratio: aspect, resolution, num_images: 1 }
    : { prompt, image_size: FLUX_SIZE_MAP[aspect], num_images: 1 };

  let result: any;
  if (resolution === "4K") {
    // 4K puede tardar → usar la cola (submit + poll), más robusta que el sync.
    result = await runViaQueue(model, input, 240000);
  } else {
    const res = await fetchRetry(`https://fal.run/${model}`, {
      method: "POST",
      headers: { Authorization: `Key ${env.falKey()}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`fal ${model} ${res.status}: ${(await res.text()).slice(0, 200)}`);
    result = await res.json();
  }

  const url = result?.images?.[0]?.url ?? result?.data?.images?.[0]?.url;
  if (!url) throw new Error("fal.ai no devolvio imagen");
  await downloadTo(url, opts.dest);
  return opts.dest;
}

/** Modelos de image-to-video. */
export const VIDEO_MODELS = {
  kling25TurboPro: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video", // ~$0.35/5s, 9:16 nativo, default
  kling25TurboStd: "fal-ai/kling-video/v2.5-turbo/standard/image-to-video", // más barato
  veo3Fast: "fal-ai/veo3/fast/image-to-video", // premium, audio nativo, ~$0.25-0.40/s
  seedance2: "bytedance/seedance-2.0/image-to-video", // premium con audio
} as const;

/** Motor de video según env VIDEO_ENGINE (kling | veo). Default: kling. */
export function videoModelFromEnv(): string {
  const engine = (process.env.VIDEO_ENGINE ?? "kling").toLowerCase();
  if (engine === "veo") return VIDEO_MODELS.veo3Fast;
  return VIDEO_MODELS.kling25TurboPro;
}

function imageToDataUri(localPath: string, contentType = "image/png"): string {
  return `data:${contentType};base64,${readFileSync(localPath).toString("base64")}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ejecuta un modelo lento vía la cola REST de fal (submit → poll → result). */
async function runViaQueue(model: string, input: any, timeoutMs = 360000): Promise<any> {
  const key = env.falKey();
  const headers = { Authorization: `Key ${key}`, "Content-Type": "application/json" };

  const submit = await fetchRetry(`https://queue.fal.run/${model}`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
  if (!submit.ok) throw new Error(`fal queue submit ${submit.status}: ${(await submit.text()).slice(0, 200)}`);
  const { status_url, response_url } = await submit.json();

  const deadline = Date.now() + timeoutMs;
  let completed = false;
  while (Date.now() < deadline) {
    await sleep(4000);
    const st = await fetchRetry(status_url, { headers });
    const sj: any = await st.json();
    if (sj.status === "COMPLETED") { completed = true; break; }
    if (sj.status === "FAILED" || sj.status === "ERROR") throw new Error(`fal job ${sj.status}`);
  }
  if (!completed) throw new Error(`fal ${model}: timeout tras ${Math.round(timeoutMs / 1000)}s esperando el job`);
  const res = await fetchRetry(response_url, { headers });
  if (!res.ok) throw new Error(`fal queue result ${res.status}`);
  return res.json();
}

/**
 * PERSONAJE que habla: retrato (imagen local) + audio (voz local) → video del personaje
 * hablando con gestos naturales (ByteDance OmniHuman en fal — la mejor calidad/simplicidad
 * 2025-26; misma key de fal). Lo usan los workflows tipo "personaje presentador".
 */
export async function generateTalkingAvatar(opts: {
  imagePath: string;
  audioPath: string;
  dest: string;
  model?: string;
}): Promise<string> {
  const model = opts.model ?? "fal-ai/bytedance/omnihuman";
  const result: any = await runViaQueue(model, {
    image_url: imageToDataUri(opts.imagePath),
    audio_url: `data:audio/mpeg;base64,${readFileSync(opts.audioPath).toString("base64")}`,
  }, 600000);
  const url = result?.video?.url ?? result?.data?.video?.url;
  if (!url) throw new Error("fal.ai (omnihuman) no devolvió video");
  await downloadTo(url, opts.dest);
  return opts.dest;
}

/**
 * Anima una imagen local a un video corto (image-to-video) con Kling.
 * `prompt` describe el MOVIMIENTO deseado (cámara, sujetos). Devuelve la ruta del .mp4.
 */
export async function generateVideoFromImage(opts: {
  imagePath: string;
  prompt: string;
  dest: string;
  duration?: 5 | 10;
  model?: string;
}): Promise<string> {
  const model = opts.model ?? VIDEO_MODELS.kling25TurboPro;
  const result: any = await runViaQueue(model, {
    prompt: opts.prompt,
    image_url: imageToDataUri(opts.imagePath),
    duration: String(opts.duration ?? 5),
  });
  const url = result?.video?.url ?? result?.data?.video?.url;
  if (!url) throw new Error("fal.ai no devolvio video");
  await downloadTo(url, opts.dest);
  return opts.dest;
}
