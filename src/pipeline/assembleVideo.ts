/**
 * Ensambla un reel 9:16 (.mp4) a partir de imagen + audio + subtítulos (.srt) con ffmpeg.
 * - Escala/recorta a 1080x1920
 * - Zoom suave (Ken Burns)
 * - Subtítulos quemados, estilo de marca (blanco con borde violeta)
 * Ejecuta ffmpeg con cwd = carpeta de salida para evitar problemas de rutas en Windows.
 */
import { spawn } from "node:child_process";
import { basename, dirname } from "node:path";

function run(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, shell: false });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => reject(new Error(`No se pudo ejecutar '${cmd}': ${e.message}`)));
    child.on("close", (code) =>
      code === 0 ? resolve(out || err) : reject(new Error(`${cmd} falló (${code}): ${err.slice(-500)}`))
    );
  });
}

export async function audioDuration(audioPath: string): Promise<number> {
  const dir = dirname(audioPath);
  const out = await run(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", basename(audioPath)],
    dir
  );
  return parseFloat(out.trim()) || 8;
}

/**
 * Reel final a partir de un VIDEO ya animado (Kling) + voz + subtítulos .ass + LOGO real.
 * Reescala/recorta a 1080x1920, hace loop del clip hasta cubrir la voz, quema subtítulos,
 * superpone el logo (arriba-centro), mezcla audio.
 */
export async function assembleReelFromVideo(opts: {
  video: string; // clip animado (Kling), ruta absoluta
  audio: string; // voz, ruta absoluta
  ass: string; // subtítulos .ass, ruta absoluta
  logo: string; // logo real (png), ruta absoluta
  out: string;
}): Promise<string> {
  const dir = dirname(opts.out);
  const dur = await audioDuration(opts.audio);
  const total = dur + 0.4;

  // El logo viene como "plate" de ancho completo (scrim + logo) → overlay en 0,0.
  const filter =
    `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,` +
    `ass=${basename(opts.ass)}[s];` +
    `[s][2:v]overlay=0:0[v]`;

  const args = [
    "-y",
    "-stream_loop", "-1", "-i", basename(opts.video), // loop del clip si es más corto que la voz
    "-i", basename(opts.audio),
    "-i", basename(opts.logo),
    "-filter_complex", filter,
    "-map", "[v]",
    "-map", "1:a",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-profile:v", "high",
    "-c:a", "aac",
    "-b:a", "192k",
    "-t", String(total),
    basename(opts.out),
  ];
  await run("ffmpeg", args, dir);
  return opts.out;
}

/**
 * Reel UGC: toma el video del avatar (HeyGen, con su propio audio), lo reescala a 1080x1920,
 * superpone la capa overlay (logo + titular/CTA opcionales) y conserva el audio del avatar.
 */
export async function assembleUgcReel(opts: {
  video: string; // video del avatar (HeyGen), ruta absoluta
  ass: string;
  logo: string;
  out: string;
}): Promise<string> {
  const dir = dirname(opts.out);
  const filter =
    `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,` +
    `ass=${basename(opts.ass)}[s];[s][1:v]overlay=0:0[v]`;
  const args = [
    "-y",
    "-i", basename(opts.video),
    "-i", basename(opts.logo),
    "-filter_complex", filter,
    "-map", "[v]", "-map", "0:a?",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "high",
    "-c:a", "aac", "-b:a", "192k",
    basename(opts.out),
  ];
  await run("ffmpeg", args, dir);
  return opts.out;
}

/**
 * Reel de MOTION-GRAPHICS: anima un fondo de marca (imagen fija) con zoom lento,
 * superpone la capa overlay (.ass) y el logo, y mezcla el audio. No usa fal.
 */
export async function assembleMotionReel(opts: {
  bg: string; // fondo de marca (png), ruta absoluta
  audio: string;
  ass: string;
  logo: string;
  out: string;
  fps?: number;
}): Promise<string> {
  const dir = dirname(opts.out);
  const fps = opts.fps ?? 30;
  const dur = await audioDuration(opts.audio);
  const total = dur + 0.4;
  const frames = Math.round(total * fps);

  const filter =
    `[0:v]scale=1188:2112,zoompan=z='min(zoom+0.00018,1.10)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=${fps},` +
    `ass=${basename(opts.ass)}[s];[s][2:v]overlay=0:0[v]`;

  const args = [
    "-y",
    "-loop", "1", "-i", basename(opts.bg),
    "-i", basename(opts.audio),
    "-i", basename(opts.logo),
    "-filter_complex", filter,
    "-map", "[v]", "-map", "1:a",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "high",
    "-c:a", "aac", "-b:a", "192k", "-t", String(total),
    basename(opts.out),
  ];
  await run("ffmpeg", args, dir);
  return opts.out;
}

