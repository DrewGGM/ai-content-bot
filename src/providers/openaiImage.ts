/** Proveedor de imagen: OpenAI (gpt-image-1). Requiere OPENAI_API_KEY. */
import { writeFileSync } from "node:fs";

const SIZE: Record<string, string> = {
  "9:16": "1024x1536",
  "4:5": "1024x1536",
  "1:1": "1024x1024",
  "16:9": "1536x1024",
};

export async function openaiImage(opts: {
  prompt: string;
  dest: string;
  aspect?: "9:16" | "1:1" | "4:5" | "16:9";
  model?: string;
}): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("Falta OPENAI_API_KEY en .env (IMAGE_PROVIDER=openai)");
  const aspect = opts.aspect ?? "9:16";

  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model ?? "gpt-image-1",
      prompt: opts.prompt,
      size: SIZE[aspect] ?? "1024x1536",
      quality: "high",
      n: 1,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI image ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  const b64 = data?.data?.[0]?.b64_json;
  const url = data?.data?.[0]?.url;
  if (b64) writeFileSync(opts.dest, Buffer.from(b64, "base64"));
  else if (url) writeFileSync(opts.dest, Buffer.from(await (await fetch(url)).arrayBuffer()));
  else throw new Error("OpenAI no devolvió imagen");
  return opts.dest;
}
