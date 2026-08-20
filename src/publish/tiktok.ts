/**
 * Publicación en TikTok vía Content Posting API (Direct Post).
 * Requiere TIKTOK_ACCESS_TOKEN (OAuth con scope video.publish; el flujo OAuth es del usuario).
 * La media se pasa como URL pública (PULL_FROM_URL) — el dominio debe estar verificado en el
 * portal de TikTok para apps no auditadas. Video → /video/init; imágenes → /content/init (PHOTO).
 *
 * Privacidad: las apps en modo sandbox (sin auditar) SOLO pueden publicar como SELF_ONLY (privado).
 * Con la app auditada usa PUBLIC_TO_EVERYONE. Configurable con TIKTOK_PRIVACY (ajuste del panel).
 */
import type { QueueItem } from "../queue/queue.js";
import type { MediaUrls } from "./meta.js";

const API = "https://open.tiktokapis.com/v2";

function token(): string {
  const t = process.env.TIKTOK_ACCESS_TOKEN;
  if (!t) throw new Error("TikTok: falta TIKTOK_ACCESS_TOKEN (OAuth con scope video.publish)");
  return t;
}

function privacy(): string {
  return process.env.TIKTOK_PRIVACY?.trim() || "PUBLIC_TO_EVERYONE";
}

async function post(path: string, body: any): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify(body),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || json?.error?.code !== "ok") {
    const e = json?.error;
    throw new Error(`TikTok API: ${e?.message ?? res.status} ${e?.code ?? ""}`.trim());
  }
  return json;
}

/** Espera a que la publicación termine de procesarse. Devuelve el post_id publicado. */
async function waitPublish(publishId: string, tries = 30): Promise<string> {
  for (let i = 0; i < tries; i++) {
    const json = await post("/post/publish/status/fetch/", { publish_id: publishId });
    const status = json?.data?.status;
    if (status === "PUBLISH_COMPLETE") {
      return json?.data?.publicaly_available_post_id?.[0] ?? publishId;
    }
    if (status === "FAILED") throw new Error(`TikTok: la publicación falló (${json?.data?.fail_reason ?? "desconocido"})`);
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error("TikTok: la publicación tardó demasiado en procesarse");
}

const title = (item: QueueItem): string => {
  const tags = (item.hashtags ?? []).join(" ");
  return (tags ? `${item.caption}\n\n${tags}` : item.caption).slice(0, 2200);
};

export async function publishTikTok(item: QueueItem, urls: MediaUrls): Promise<string> {
  const post_info: any = { title: title(item), privacy_level: privacy(), disable_comment: false };

  if (urls.video) {
    const init = await post("/post/publish/video/init/", {
      post_info,
      source_info: { source: "PULL_FROM_URL", video_url: urls.video },
    });
    return waitPublish(init.data.publish_id);
  }

  const photos = urls.images?.length ? urls.images : urls.image ? [urls.image] : [];
  if (photos.length) {
    const init = await post("/post/publish/content/init/", {
      post_info: { ...post_info, auto_add_music: true },
      source_info: { source: "PULL_FROM_URL", photo_cover_index: 0, photo_images: photos },
      post_mode: "DIRECT_POST",
      media_type: "PHOTO",
    });
    return waitPublish(init.data.publish_id);
  }

  throw new Error("TikTok: la pieza no tiene video ni imágenes publicables");
}
