/**
 * Música de fondo generada con la API de Música de ElevenLabs (music_v2).
 * Usa ELEVENLABS_API_KEY. Devuelve un mp3 en `dest`.
 */
import { writeFileSync } from "node:fs";

export async function generateMusic(opts: { prompt: string; durationSec: number; dest: string }): Promise<void> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("Falta ELEVENLABS_API_KEY para generar música.");
  const music_length_ms = Math.min(180000, Math.max(10000, Math.round(opts.durationSec * 1000)));
  const res = await fetch("https://api.elevenlabs.io/v1/music", {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: opts.prompt, music_length_ms, model_id: "music_v2" }),
  });
  if (!res.ok) {
    throw new Error(`ElevenLabs music ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  writeFileSync(opts.dest, Buffer.from(await res.arrayBuffer()));
}
