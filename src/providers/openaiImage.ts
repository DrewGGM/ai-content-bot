/** Proveedor de imagen: OpenAI (gpt-image-1). Requiere OPENAI_API_KEY.
 *  Con `referenceImages` usa el endpoint de EDICIÓN (/images/edits) pasando el logo + las
 *  referencias de estilo como `image[]` — gpt-image-1 también escribe texto y reproduce logos
 *  muy bien, así que sirve igual para los posts de marca premium. */
import { writeFileSync } from "node:fs";

const SIZE: Record<string, string> = {
  "9:16": "1024x1536",
  "4:5": "1024x1536",
  "1:1": "1024x1024",
  "16:9": "1536x1024",
};

/** data URI o URL http → bytes + tipo MIME (para el multipart de /images/edits). */
async function toBytes(ref: string): Promise<{ buf: Buffer; type: string } | null> {
  const m = ref.match(/^data:([^;]+);base64,(.*)$/s);
  if (m) return { buf: Buffer.from(m[2], "base64"), type: m[1] };
  if (/^https?:\/\//.test(ref)) {
    const res = await fetch(ref);
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "image/png";
    return { buf: Buffer.from(await res.arrayBuffer()), type };
  }
  return null;
}

function extFor(type: string): string {
  return type.includes("jpeg") || type.includes("jpg") ? "jpg" : type.includes("webp") ? "webp" : "png";
}

export async function openaiImage(opts: {
  prompt: string;
  dest: string;
  aspect?: "9:16" | "1:1" | "4:5" | "16:9";
  model?: string;
  referenceImages?: string[];
}): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Falta OPENAI_API_KEY en .env (IMAGE_PROVIDER=openai)");
  const aspect = opts.aspect ?? "9:16";
  const model = opts.model ?? "gpt-image-1";
  const refs = (opts.referenceImages ?? []).filter(Boolean);

  let data: any;
  if (refs.length) {
    // EDICIÓN con referencias (logo + estilo) → multipart /images/edits.
    const form = new FormData();
    form.append("model", model);
    form.append("prompt", opts.prompt);
    form.append("size", SIZE[aspect] ?? "1024x1024");
    form.append("quality", "high");
    form.append("n", "1");
    let i = 0;
    for (const ref of refs.slice(0, 16)) { // gpt-image-1 admite hasta 16 imágenes de entrada
      const b = await toBytes(ref);
      if (!b) continue;
      form.append("image[]", new Blob([Uint8Array.from(b.buf)], { type: b.type }), `ref-${i++}.${extFor(b.type)}`);
    }
    const res = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` }, // el boundary lo pone fetch con FormData
      body: form,
    });
    if (!res.ok) throw new Error(`OpenAI edit ${res.status}: ${(await res.text()).slice(0, 200)}`);
    data = await res.json();
  } else {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt: opts.prompt,
        size: SIZE[aspect] ?? "1024x1536",
        quality: "high",
        n: 1,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI image ${res.status}: ${(await res.text()).slice(0, 200)}`);
    data = await res.json();
  }

  const b64 = data?.data?.[0]?.b64_json;
  const url = data?.data?.[0]?.url;
  if (b64) writeFileSync(opts.dest, Buffer.from(b64, "base64"));
  else if (url) writeFileSync(opts.dest, Buffer.from(await (await fetch(url)).arrayBuffer()));
  else throw new Error("OpenAI no devolvió imagen");
  return opts.dest;
}
