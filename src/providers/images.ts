/**
 * Dispatcher de generación de imágenes. Soporta varios proveedores; elige por
 * env IMAGE_PROVIDER (fal | openai | gemini) o por opts.provider. Default: fal.
 * Aplica la dirección de arte de marca a TODOS los proveedores.
 */
import { withArtDirection } from "../lib/artDirection.js";
import { falImage } from "./fal.js";
import { openaiImage } from "./openaiImage.js";
import { geminiImage } from "./geminiImage.js";
import { leonardoImage } from "./leonardoImage.js";

export type ImageProvider = "fal" | "openai" | "gemini" | "leonardo";

export interface ImageOpts {
  prompt: string;
  dest: string;
  aspect?: "9:16" | "1:1" | "4:5" | "16:9";
  resolution?: "1K" | "2K" | "4K";
  model?: string;
  provider?: ImageProvider;
  referenceImages?: string[]; // solo fal (nano-banana-pro/edit): logo + referencias de estilo
  rawPrompt?: boolean; // no anteponer la dirección de arte genérica (el prompt ya es completo)
}

export async function generateImage(opts: ImageOpts): Promise<string> {
  const { track } = await import("../lib/usage.js");
  track("image"); // costo estimado por imagen (cuenta cada intento, incl. regeneraciones de QA)
  const provider = (opts.provider ?? (process.env.IMAGE_PROVIDER as ImageProvider) ?? "fal").toLowerCase() as ImageProvider;
  const prompt = opts.rawPrompt ? opts.prompt : withArtDirection(opts.prompt);
  const base = { ...opts, prompt };

  switch (provider) {
    case "openai":
      return openaiImage(base);
    case "gemini":
      return geminiImage(base);
    case "leonardo":
      return leonardoImage(base);
    case "fal":
    default:
      return falImage(base);
  }
}
