/** Dado un formato + tema, escribe el copy con Claude y genera la pieza con el generador correcto. */
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
import type { QueueItem } from "../queue/queue.js";

// reel = b-roll · motion = motion-graphics · ugc = avatar HeyGen · design/deck = por código (sin IA)
export type Format = "reel" | "motion" | "ugc" | "carousel" | "post" | "design" | "deck";

function defaultVoiceId(): string {
  const { voice } = loadBrandContext();
  const id = voice?.default?.voiceId;
  if (!id) throw new Error("Falta default.voiceId en knowledge/voice.json");
  return id;
}

export async function createContent(opts: {
  format: Format;
  topic: string;
  platform?: string;
  instruction?: string; // instrucción del usuario al regenerar (afecta copy + visual)
  reuse?: { slug: string; createdAt: string }; // fuerza el mismo id/carpeta → regenera EN EL SITIO
  aspect?: Aspect; // solo motion (Remotion): reel 9:16 | square 1:1 | feed 4:5
  audio?: AudioMode; // solo motion (Remotion): voice | music | silent
}): Promise<QueueItem> {
  const platform = opts.platform ?? "instagram";
  const createdAt = opts.reuse?.createdAt ?? new Date().toISOString();
  const inst = opts.instruction;
  // Al regenerar, forzamos el slug del item existente para reusar id + carpeta (INSERT OR REPLACE).
  const fixSlug = <T extends { slug: string }>(c: T): T => (opts.reuse ? { ...c, slug: opts.reuse.slug } : c);

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
      const hasVoice = !!process.env.ELEVENLABS_API_KEY;
      const audio: AudioMode = opts.audio ?? (hasVoice ? "voice" : "silent");
      console.log(`  → generando video Remotion (aspecto: ${opts.aspect ?? "reel"}, audio: ${audio})...`);
      return generateRemotion(
        fixSlug(await generateRemotionCopy(opts.topic, inst)),
        { platform, aspect: opts.aspect ?? "reel", audio, voiceId: audio === "voice" ? defaultVoiceId() : undefined },
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
