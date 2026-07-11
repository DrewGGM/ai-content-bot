/**
 * QA visual en loop: genera una imagen, deja que Claude (visión) la analice,
 * y si tiene problemas la regenera con el prompt mejorado. Hasta `maxAttempts` intentos.
 */
import { spawn } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { generateImage } from "../providers/images.js";
import { reviewImage } from "../providers/vision.js";

const QA_ATTEMPTS = Number(process.env.QA_ATTEMPTS ?? 2); // 2 = 1 revisión + 1 posible regen

export async function generateReviewedImage(opts: {
  prompt: string;
  dest: string;
  aspect: "9:16" | "1:1" | "4:5" | "16:9";
  resolution?: "1K" | "2K" | "4K";
  brief: string;
  label?: string;
  referenceImages?: string[]; // fal nano-banana-pro/edit: logo + referencias de estilo
  rawPrompt?: boolean; // el prompt ya viene completo (no anteponer la dirección de arte genérica)
}): Promise<void> {
  let prompt = opts.prompt;
  const label = opts.label ?? basename(opts.dest);

  for (let attempt = 1; attempt <= QA_ATTEMPTS; attempt++) {
    await generateImage({ prompt, dest: opts.dest, aspect: opts.aspect, resolution: opts.resolution, referenceImages: opts.referenceImages, rawPrompt: opts.rawPrompt });
    if (attempt >= QA_ATTEMPTS) return; // último intento: aceptar

    const v = await reviewImage(opts.dest, prompt, opts.brief);
    if (v.ok) {
      console.log(`      QA ${label}: OK (${v.score}/100)`);
      return;
    }
    console.log(`      QA ${label}: ${v.score}/100 — regenerando. Problemas: ${v.issues.slice(0, 3).join("; ")}`);
    if (v.improvedPrompt) prompt = v.improvedPrompt;
  }
}

function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args, { cwd, shell: false });
    let err = "";
    c.stderr.on("data", (d) => (err += d));
    c.on("error", reject);
    c.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd}: ${err.slice(-200)}`))));
  });
}

/** Extrae un frame del video en el segundo `t` y devuelve su ruta. */
export async function extractFrame(videoPath: string, t: number, name: string): Promise<string> {
  const dir = dirname(videoPath);
  const out = join(dir, name);
  await run("ffmpeg", ["-y", "-ss", String(t), "-i", basename(videoPath), "-vframes", "1", name], dir);
  return out;
}
