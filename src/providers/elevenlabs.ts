/** Proveedor de voz: ElevenLabs (TTS) */
import { writeFileSync } from "node:fs";
import { env } from "../lib/env.js";

const BASE = "https://api.elevenlabs.io/v1";

export interface Voice {
  voice_id: string;
  name: string;
  labels?: Record<string, string>;
}

/** Lista las voces disponibles en la cuenta. */
export async function listVoices(): Promise<Voice[]> {
  const res = await fetch(`${BASE}/voices`, {
    headers: { "xi-api-key": env.elevenLabsKey() },
  });
  if (!res.ok) throw new Error(`ElevenLabs /voices ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  return data.voices ?? [];
}

export interface Alignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/** TTS con timestamps por carácter (para subtítulos sincronizados). Guarda mp3 y devuelve alignment. */
export async function textToSpeechWithTimestamps(opts: {
  text: string;
  dest: string;
  voiceId: string;
  model?: string;
  stability?: number;
  similarityBoost?: number;
}): Promise<Alignment> {
  const model = opts.model ?? "eleven_multilingual_v2";
  const res = await fetch(`${BASE}/text-to-speech/${opts.voiceId}/with-timestamps`, {
    method: "POST",
    headers: {
      "xi-api-key": env.elevenLabsKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: opts.text,
      model_id: model,
      voice_settings: {
        stability: opts.stability ?? 0.5,
        similarity_boost: opts.similarityBoost ?? 0.75,
      },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs TTS(ts) ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  writeFileSync(opts.dest, Buffer.from(data.audio_base64, "base64"));
  return (data.alignment ?? data.normalized_alignment) as Alignment;
}

/** Genera audio TTS y lo guarda como mp3 en `dest`. */
export async function textToSpeech(opts: {
  text: string;
  dest: string;
  voiceId: string;
  model?: string;
  stability?: number;
  similarityBoost?: number;
}): Promise<string> {
  const model = opts.model ?? "eleven_multilingual_v2";
  const res = await fetch(`${BASE}/text-to-speech/${opts.voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": env.elevenLabsKey(),
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: opts.text,
      model_id: model,
      voice_settings: {
        stability: opts.stability ?? 0.5,
        similarity_boost: opts.similarityBoost ?? 0.75,
      },
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs TTS ${res.status}: ${await res.text()}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(opts.dest, buf);
  return opts.dest;
}
