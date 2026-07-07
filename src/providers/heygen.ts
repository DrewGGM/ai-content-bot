/**
 * Proveedor UGC: HeyGen (avatar realista hablando) — para anuncios tipo testimonio.
 * Requiere HEYGEN_API_KEY. Avatar y voz configurables por env (HEYGEN_AVATAR_ID, HEYGEN_VOICE_ID).
 * Docs: https://docs.heygen.com  ·  Skill instalada: heygen-com/skills
 */
import { writeFileSync } from "node:fs";
import { loadBrandConfig } from "../lib/brandConfig.js";

const BASE = "https://api.heygen.com";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function key(): string {
  const k = process.env.HEYGEN_API_KEY;
  if (!k) throw new Error("Falta HEYGEN_API_KEY en .env (necesaria para UGC con avatar)");
  return k;
}

/**
 * Genera un video 9:16 de un avatar hablando el `script` (en español) y lo descarga a `dest`.
 * El avatar genera su propia voz (HeyGen TTS). Devuelve la ruta del .mp4.
 */
export async function generateAvatarVideo(opts: { script: string; dest: string }): Promise<string> {
  const avatarId = process.env.HEYGEN_AVATAR_ID;
  const voiceId = process.env.HEYGEN_VOICE_ID;
  if (!avatarId || !voiceId) {
    throw new Error("Falta HEYGEN_AVATAR_ID y/o HEYGEN_VOICE_ID en .env. Lístalos con la API de HeyGen (avatares y voces en español).");
  }

  const gen = await fetch(`${BASE}/v2/video/generate`, {
    method: "POST",
    headers: { "X-Api-Key": key(), "Content-Type": "application/json" },
    body: JSON.stringify({
      video_inputs: [
        {
          character: { type: "avatar", avatar_id: avatarId, avatar_style: "normal" },
          voice: { type: "text", input_text: opts.script, voice_id: voiceId },
          background: { type: "color", value: loadBrandConfig().colors.primary },
        },
      ],
      dimension: { width: 720, height: 1280 }, // 9:16
    }),
  });
  if (!gen.ok) throw new Error(`HeyGen generate ${gen.status}: ${(await gen.text()).slice(0, 200)}`);
  const genJson: any = await gen.json();
  const videoId = genJson?.data?.video_id;
  if (!videoId) throw new Error(`HeyGen no devolvió video_id: ${JSON.stringify(genJson).slice(0, 200)}`);

  // Poll del estado.
  const deadline = Date.now() + 600000; // 10 min
  let url = "";
  while (Date.now() < deadline) {
    await sleep(8000);
    const st = await fetch(`${BASE}/v1/video_status.get?video_id=${videoId}`, { headers: { "X-Api-Key": key() } });
    const sj: any = await st.json();
    const status = sj?.data?.status;
    if (status === "completed") { url = sj.data.video_url; break; }
    if (status === "failed") throw new Error(`HeyGen falló: ${JSON.stringify(sj?.data?.error ?? sj).slice(0, 200)}`);
  }
  if (!url) throw new Error("HeyGen: timeout esperando el video");

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HeyGen download ${res.status}`);
  writeFileSync(opts.dest, Buffer.from(await res.arrayBuffer()));
  return opts.dest;
}
