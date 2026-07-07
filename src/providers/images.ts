/**
 * Dispatcher de generación de imágenes. Soporta varios proveedores; elige por
 * env IMAGE_PROVIDER (fal | openai | gemini) o por opts.provider. Default: fal.
 * Aplica la dirección de arte de marca a TODOS los proveedores.
 */
import { withArtDirection } from "../lib/artDirection.js";
import { falImage } from "./fal.js";
import { openaiImage } from "./openaiImage.js";
import { geminiImage } from "./geminiImage.js";

export type ImageProvider = "fal" | "openai" | "gemini";

export interface ImageOpts {
  prompt: string;
  dest: string;
  aspect?: "9:16" | "1:1" | "4:5" | "16:9";
  resolution?: "1K" | "2K" | "4K";
  model?: string;
  provider?: ImageProvider;
}

export async function generateImage(opts: ImageOpts): Promise<string> {
  const provider = (opts.provider ?? (process.env.IMAGE_PROVIDER as ImageProvider) ?? "fal").toLowerCase() as ImageProvider;
  const prompt = withArtDirection(opts.prompt);
  const base = { ...opts, prompt };

  switch (provider) {
    case "openai":
      return openaiImage(base);
    case "gemini":
      return geminiImage(base);
    case "fal":
    default:
      return falImage(base);
  }
}
