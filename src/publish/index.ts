/**
 * Orquestador de publicación a redes. Detecta qué redes están configuradas (tokens en .env)
 * y publica una pieza a las seleccionadas. Las imágenes/videos se pasan como URL pública
 * temporal (presigned de R2). Meta (IG/FB) implementado; el resto queda listo para enchufar.
 */
import type { QueueItem } from "../queue/queue.js";
import { presignedUrl } from "../lib/assets.js";

export type Network = "instagram" | "facebook" | "linkedin" | "tiktok" | "x";
export const NETWORKS: Network[] = ["instagram", "facebook", "linkedin", "tiktok", "x"];
export const NETWORK_LABEL: Record<Network, string> = {
  instagram: "Instagram", facebook: "Facebook", linkedin: "LinkedIn", tiktok: "TikTok", x: "X (Twitter)",
};

/** Qué redes están listas para publicar (tokens presentes). */
export function publishCapabilities(): Record<Network, boolean> {
  const igToken = !!process.env.INSTAGRAM_ACCESS_TOKEN;
  return {
    instagram: igToken && !!process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID,
    facebook: (!!process.env.FACEBOOK_PAGE_TOKEN || igToken) && !!process.env.FACEBOOK_PAGE_ID,
    linkedin: !!process.env.LINKEDIN_ACCESS_TOKEN, // motor pendiente
    tiktok: !!process.env.TIKTOK_ACCESS_TOKEN, // Content Posting API (Direct Post)
    x: !!(process.env.X_API_KEY && process.env.X_ACCESS_TOKEN), // motor pendiente
  };
}

async function mediaUrls(item: QueueItem) {
  const a = item.assets;
  const out: { image?: string; video?: string; images?: string[] } = {};
  if (a.video) out.video = await presignedUrl(a.video);
  else if (a.images?.length) out.images = await Promise.all(a.images.map((p) => presignedUrl(p)));
  else if (a.image) out.image = await presignedUrl(a.image);
  return out;
}

export interface PublishResult { network: Network; ok: boolean; id?: string; error?: string }

export async function publishItem(item: QueueItem, networks: Network[]): Promise<PublishResult[]> {
  const caps = publishCapabilities();
  const urls = await mediaUrls(item); // presigned una sola vez, reutilizado por todas las redes
  const results: PublishResult[] = [];
  for (const net of networks) {
    try {
      if (!caps[net]) throw new Error(`${NETWORK_LABEL[net]}: falta configurar el token (ver .env)`);
      let id: string;
      if (net === "instagram") { const { publishInstagram } = await import("./meta.js"); id = await publishInstagram(item, urls); }
      else if (net === "facebook") { const { publishFacebook } = await import("./meta.js"); id = await publishFacebook(item, urls); }
      else if (net === "tiktok") { const { publishTikTok } = await import("./tiktok.js"); id = await publishTikTok(item, urls); }
      else throw new Error(`${NETWORK_LABEL[net]}: motor de publicación aún no implementado`);
      results.push({ network: net, ok: true, id });
    } catch (e: any) {
      results.push({ network: net, ok: false, error: String(e?.message ?? e) });
    }
  }
  return results;
}
