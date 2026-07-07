/**
 * Publicación en Instagram (Business) y Facebook (Página) vía Meta Graph API.
 * Requiere: INSTAGRAM_ACCESS_TOKEN (token de página de larga duración),
 * INSTAGRAM_BUSINESS_ACCOUNT_ID (IG), FACEBOOK_PAGE_ID (FB). FACEBOOK_PAGE_TOKEN opcional
 * (si no, usa INSTAGRAM_ACCESS_TOKEN).
 * Las imágenes/videos se pasan como URL pública temporal (presigned de R2).
 */
import type { QueueItem } from "../queue/queue.js";

const GRAPH = "https://graph.facebook.com/v21.0";

async function graph(path: string, params: Record<string, any>): Promise<any> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) body.append(k, String(v));
  const res = await fetch(`${GRAPH}/${path}`, { method: "POST", body });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error(`Meta API: ${json?.error?.message ?? res.status} ${json?.error?.error_user_title ?? ""}`.trim());
  }
  return json;
}

/** Espera a que un contenedor de media (video/carrusel) termine de procesarse en IG. */
async function waitContainer(id: string, token: string, tries = 30): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${GRAPH}/${id}?fields=status_code&access_token=${encodeURIComponent(token)}`);
    const json: any = await res.json().catch(() => ({}));
    if (json.status_code === "FINISHED") return;
    if (json.status_code === "ERROR") throw new Error("Meta: el video/carrusel falló al procesarse");
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error("Meta: el video tardó demasiado en procesarse");
}

function fullCaption(item: QueueItem): string {
  const tags = (item.hashtags ?? []).join(" ");
  return tags ? `${item.caption}\n\n${tags}` : item.caption;
}

export type MediaUrls = { image?: string; video?: string; images?: string[] };

// ---------- Instagram ----------
export async function publishInstagram(item: QueueItem, urls: MediaUrls): Promise<string> {
  const ig = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!ig || !token) throw new Error("Instagram: faltan INSTAGRAM_BUSINESS_ACCOUNT_ID / INSTAGRAM_ACCESS_TOKEN");
  const caption = fullCaption(item);

  if (urls.video) {
    const c = await graph(`${ig}/media`, { media_type: "REELS", video_url: urls.video, caption, access_token: token });
    await waitContainer(c.id, token);
    const pub = await graph(`${ig}/media_publish`, { creation_id: c.id, access_token: token });
    return pub.id;
  }
  if (urls.images?.length) {
    const children: string[] = [];
    for (const image_url of urls.images) {
      const child = await graph(`${ig}/media`, { image_url, is_carousel_item: true, access_token: token });
      children.push(child.id);
    }
    const parent = await graph(`${ig}/media`, { media_type: "CAROUSEL", children: children.join(","), caption, access_token: token });
    await waitContainer(parent.id, token);
    const pub = await graph(`${ig}/media_publish`, { creation_id: parent.id, access_token: token });
    return pub.id;
  }
  if (urls.image) {
    const c = await graph(`${ig}/media`, { image_url: urls.image, caption, access_token: token });
    const pub = await graph(`${ig}/media_publish`, { creation_id: c.id, access_token: token });
    return pub.id;
  }
  throw new Error("Instagram: la pieza no tiene imagen ni video publicable");
}

// ---------- Facebook (Página) ----------
export async function publishFacebook(item: QueueItem, urls: MediaUrls): Promise<string> {
  const page = process.env.FACEBOOK_PAGE_ID;
  const token = process.env.FACEBOOK_PAGE_TOKEN || process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!page || !token) throw new Error("Facebook: faltan FACEBOOK_PAGE_ID / token de página");
  const message = fullCaption(item);

  if (urls.video) {
    const r = await graph(`${page}/videos`, { file_url: urls.video, description: message, access_token: token });
    return r.id;
  }
  if (urls.images?.length) {
    const fbids: string[] = [];
    for (const url of urls.images) {
      const p = await graph(`${page}/photos`, { url, published: false, access_token: token });
      fbids.push(p.id);
    }
    const attached_media = fbids.map((id) => ({ media_fbid: id }));
    const r = await graph(`${page}/feed`, { message, attached_media: JSON.stringify(attached_media), access_token: token });
    return r.id;
  }
  if (urls.image) {
    const r = await graph(`${page}/photos`, { url: urls.image, caption: message, access_token: token });
    return r.post_id ?? r.id;
  }
  const r = await graph(`${page}/feed`, { message, access_token: token });
  return r.id;
}
