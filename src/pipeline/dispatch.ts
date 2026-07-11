/** Dado un formato + tema, escribe el copy con Claude y genera la pieza con el generador correcto. */
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBrandContext } from "../knowledge/loader.js";
import {
  generateReelCopy, generateRemotionCopy, generateUgcScript,
  generateCarouselCopy, generatePostCopy, generateDesignCopy, generateDeckCopy,
} from "./generateCopy.js";
import { generateReel } from "./generateReel.js";
import { generateRemotion, type Aspect, type AudioMode } from "./generateRemotion.js";
import { generateUgcReel } from "./generateUgcReel.js";
import { generateCarousel } from "./generateCarousel.js";
import { generatePost } from "./generatePost.js";
import { generateDesignPost } from "./generateDesignPost.js";
import { generateDeck } from "./generateDeck.js";
import { downloadMusicFromUrl } from "../lib/musicLibrary.js";
import { runWorkflow, readWorkflow } from "../workflows/engine.js";
import type { QueueItem } from "../queue/queue.js";

// reel = b-roll · motion = motion-graphics · ugc = avatar HeyGen · design/deck = por código (sin IA)
// "workflow:<nombre>" = workflow personalizado de config/workflows/ (motor src/workflows/).
export type Format = "reel" | "motion" | "ugc" | "carousel" | "post" | "design" | "deck" | `workflow:${string}`;

function defaultVoiceId(): string {
  const { voice } = loadBrandContext();
  const id = voice?.default?.voiceId;
  if (!id) throw new Error("Falta default.voiceId en knowledge/voice.json");
  return id;
}

/** ¿Hay voz USABLE? (key de ElevenLabs Y voiceId configurado — cualquiera de los dos puede faltar). */
function voiceReady(): boolean {
  try {
    return !!process.env.ELEVENLABS_API_KEY && !!loadBrandContext().voice?.default?.voiceId;
  } catch {
    return false;
  }
}

export async function createContent(opts: {
  format: Format;
  topic: string;
  platform?: string;
  instruction?: string; // instrucción del usuario al regenerar (afecta copy + visual)
  reuse?: { slug: string; createdAt: string }; // fuerza el mismo id/carpeta → regenera EN EL SITIO
  aspect?: Aspect; // solo motion (Remotion): reel 9:16 | square 1:1 | feed 4:5
  audio?: AudioMode; // solo motion (Remotion): voice | voice_music | music | silent
  musicUrl?: string; // solo motion: URL de una pista que pegó el usuario (se descarga y se usa)
}): Promise<QueueItem> {
  const platform = opts.platform ?? "instagram";
  const createdAt = opts.reuse?.createdAt ?? new Date().toISOString();
  const inst = opts.instruction;

  // Workflows personalizables (config/workflows/*.json): pipeline de pasos encadenados.
  if (opts.format.startsWith("workflow:")) {
    const name = opts.format.slice("workflow:".length);
    console.log(`  → ejecutando workflow "${name}"...`);
    return runWorkflow(readWorkflow(name), {
      topic: opts.topic, platform, aspect: opts.aspect, instruction: inst, reuse: opts.reuse,
    });
  }

  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  // Al regenerar, forzamos el slug del item existente para reusar id + carpeta (INSERT OR REPLACE).
  // En piezas NUEVAS el slug se hace ÚNICO (sufijo -2, -3…): dos piezas con el mismo slug
  // compartirían carpeta de assets (se pisarían los archivos y "Eliminar" borraría ambas).
  const fixSlug = <T extends { slug: string }>(c: T): T => {
    if (opts.reuse) return { ...c, slug: opts.reuse.slug };
    const base = c.slug || "pieza";
    let slug = base;
    for (let i = 2; existsSync(join(ROOT, "assets", "output", slug)) && i < 100; i++) slug = `${base}-${i}`;
    return { ...c, slug };
  };

  switch (opts.format) {
    case "carousel": {
      console.log(`  → copy del carrusel (Claude Code)...`);
      return generateCarousel(fixSlug(await generateCarouselCopy(opts.topic, inst)), platform, createdAt);
    }
    case "post": {
      console.log(`  → copy del post (Claude Code)...`);
      return generatePost(fixSlug(await generatePostCopy(opts.topic, inst)), platform, createdAt);
    }
    case "design": {
      console.log(`  → copy del poster de diseño (Claude Code)...`);
      return generateDesignPost(fixSlug(await generateDesignCopy(opts.topic, undefined, inst)), platform, createdAt);
    }
    case "deck": {
      console.log(`  → copy del carrusel por código (Claude Code)...`);
      return generateDeck(fixSlug(await generateDeckCopy(opts.topic, inst)), platform, createdAt);
    }
    case "motion": {
      // Video por CÓDIGO con Remotion (reemplaza el motion-graphics viejo).
      console.log(`  → copy del video Remotion (Claude Code)...`);
      // Voz solo si hay key Y voiceId (con key pero sin voiceId antes reventaba el job).
      // La música siempre es intentable: biblioteca local o descarga automática CC0
      // (Openverse); si todo falla, generateRemotion cae limpiamente a silencioso.
      let audio: AudioMode = opts.audio ?? (voiceReady() ? "voice_music" : "music");
      if ((audio === "voice" || audio === "voice_music") && !voiceReady()) {
        console.warn(`  ⚠ modo voz sin ELEVENLABS_API_KEY o sin default.voiceId (knowledge/voice.json) — cae a música de fondo`);
        audio = "music";
      }
      // Si el usuario pegó una URL de música, se descarga a la biblioteca y esa pista manda
      // (y el modo se ajusta para que efectivamente suene: silent→music, voice→voice_music).
      let musicTrack: string | undefined;
      if (opts.musicUrl) {
        musicTrack = await downloadMusicFromUrl(opts.musicUrl);
        if (audio === "silent") audio = "music";
        else if (audio === "voice") audio = "voice_music";
      }
      console.log(`  → generando video Remotion (aspecto: ${opts.aspect ?? "reel"}, audio: ${audio})...`);
      return generateRemotion(
        fixSlug(await generateRemotionCopy(opts.topic, inst)),
        { platform, aspect: opts.aspect ?? "reel", audio, voiceId: audio === "voice" || audio === "voice_music" ? defaultVoiceId() : undefined, musicTrack },
        createdAt,
      );
    }
    case "ugc": {
      console.log(`  → guion UGC (Claude Code)...`);
      return generateUgcReel(fixSlug(await generateUgcScript(opts.topic, inst)), platform, createdAt);
    }
    default: {
      // reel b-roll cinematográfico
      console.log(`  → copy del reel b-roll (Claude Code)...`);
      const copy = fixSlug(await generateReelCopy(opts.topic, inst));
      return generateReel({ ...copy, platform, voiceId: defaultVoiceId() }, createdAt);
    }
  }
}
