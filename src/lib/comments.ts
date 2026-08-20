/**
 * COMMUNITY MANAGER — lee los comentarios de los posts publicados (Meta) y REDACTA respuestas con
 * la voz de marca para que el humano las revise y publique. Solo BORRADOR: publicar una respuesta
 * es una acción del humano (nunca auto-responde). Requiere los permisos de lectura de comentarios
 * (instagram_manage_comments / pages_read_engagement); si faltan, devuelve lista vacía sin romper.
 */
import type { PostRef, QueueItem } from "../queue/queue.js";

const GRAPH = "https://graph.facebook.com/v21.0";

export interface CommentDraft {
  network: string;
  author: string;
  text: string;
  reply: string; // respuesta sugerida (borrador)
}

async function getJson(url: string): Promise<any> {
  try { return await (await fetch(url)).json(); } catch { return {}; }
}

/** Comentarios recientes de un post (IG o FB). Tolerante: [] si falla o falta permiso. */
async function fetchComments(post: PostRef): Promise<{ author: string; text: string }[]> {
  const igToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const fbToken = process.env.FACEBOOK_PAGE_TOKEN || process.env.INSTAGRAM_ACCESS_TOKEN;
  const out: { author: string; text: string }[] = [];
  if (post.network === "instagram" && igToken) {
    const j = await getJson(`${GRAPH}/${post.id}/comments?fields=text,username,timestamp&limit=25&access_token=${encodeURIComponent(igToken)}`);
    for (const c of j?.data ?? []) if (c?.text) out.push({ author: c.username ?? "usuario", text: String(c.text) });
  } else if (post.network === "facebook" && fbToken) {
    const j = await getJson(`${GRAPH}/${post.id}/comments?fields=message,from&limit=25&access_token=${encodeURIComponent(fbToken)}`);
    for (const c of j?.data ?? []) if (c?.message) out.push({ author: c?.from?.name ?? "usuario", text: String(c.message) });
  }
  return out;
}

/**
 * Redacta respuestas para los comentarios de una pieza publicada. Una sola llamada de LLM para
 * todos los comentarios (barata). Devuelve [] si no hay comentarios legibles.
 */
export async function draftReplies(item: QueueItem): Promise<CommentDraft[]> {
  if (!item.posts?.length) return [];

  const all: { network: string; author: string; text: string }[] = [];
  for (const p of item.posts) {
    for (const c of await fetchComments(p)) all.push({ network: p.network, ...c });
  }
  if (!all.length) return [];

  try {
    const { askLLMJson } = await import("../providers/llm.js");
    const { loadBrandConfig } = await import("./brandConfig.js");
    const { loadBrandContext } = await import("../knowledge/loader.js");
    const { learningGuidance } = await import("./learnings.js");
    const brand = loadBrandConfig();
    const { raw } = loadBrandContext();
    const learned = await learningGuidance();

    const prompt = `Eres el community manager de la marca "${brand.name}". Redacta una respuesta breve, cálida y
en la voz de marca para CADA comentario de esta publicación. Responde dudas con datos del contexto, agradece
lo positivo, y en críticas mantén la calma y ofrece ayuda. Nada de promesas falsas ni tono corporativo.

PUBLICACIÓN (caption): ${item.caption.slice(0, 500)}

COMENTARIOS (índice · autor · texto):
${all.map((c, i) => `${i}. @${c.author}: ${c.text}`).join("\n")}

Devuelve ÚNICAMENTE un JSON válido con una respuesta por comentario, en el MISMO orden:
{"replies": ["respuesta al comentario 0", "respuesta al comentario 1", ...]}
${learned ? `\n${learned}\n` : ""}
===== CONTEXTO DE MARCA =====
${raw.slice(0, 4000)}`;

    const data = await askLLMJson<{ replies?: string[] }>(prompt);
    const replies = Array.isArray(data.replies) ? data.replies : [];
    return all.map((c, i) => ({ network: c.network, author: c.author, text: c.text, reply: String(replies[i] ?? "").trim() }));
  } catch {
    // Sin LLM: al menos devuelve los comentarios (sin borrador) para que el humano los vea.
    return all.map((c) => ({ network: c.network, author: c.author, text: c.text, reply: "" }));
  }
}
