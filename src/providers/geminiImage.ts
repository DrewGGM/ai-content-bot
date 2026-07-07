/** Proveedor de imagen: Google Gemini (gemini-2.5-flash-image / "Nano Banana"). Requiere GEMINI_API_KEY. */
import { writeFileSync } from "node:fs";

export async function geminiImage(opts: {
  prompt: string;
  dest: string;
  aspect?: "9:16" | "1:1" | "4:5" | "16:9";
  model?: string;
}): Promise<string> {
  const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) throw new Error("Falta GEMINI_API_KEY (o GOOGLE_API_KEY) en .env (IMAGE_PROVIDER=gemini)");
  const model = opts.model ?? "gemini-2.5-flash-image";
  const aspect = opts.aspect ?? "9:16";

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${opts.prompt}\n\n(Aspect ratio: ${aspect}, vertical/portrait if 9:16 or 4:5.)` }] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"], imageConfig: { aspectRatio: aspect } },
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini image ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data: any = await res.json();
  const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
  const img = parts.find((p) => p.inlineData?.data)?.inlineData?.data;
  if (!img) throw new Error("Gemini no devolvió imagen");
  writeFileSync(opts.dest, Buffer.from(img, "base64"));
  return opts.dest;
}
