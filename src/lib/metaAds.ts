/**
 * Cliente de la Meta Marketing API (Graph API) para campañas de ads en Facebook/Instagram.
 * Jerarquía: Campaign → Ad Set → Ad Creative → Ad. Además insights (métricas) y updates
 * (presupuesto/estado) para optimizar.
 *
 * Credenciales (desde el panel o .env):
 *   META_ADS_TOKEN         — token con permiso `ads_management` (o cae a INSTAGRAM_ACCESS_TOKEN)
 *   META_AD_ACCOUNT_ID     — id de la cuenta publicitaria SIN el prefijo act_ (ej. 1234567890)
 *   FACEBOOK_PAGE_ID       — página que publica el anuncio
 *   INSTAGRAM_BUSINESS_ACCOUNT_ID — (opcional) para anuncios en IG
 *   META_PIXEL_ID          — (opcional) para objetivos de conversión/ventas
 *   META_API_VERSION       — (opcional) versión del Graph API (default v21.0)
 *
 * SEGURIDAD: nada se activa solo. Las campañas se crean en el estado que se pida (por defecto
 * PAUSED) y el presupuesto se valida contra ADS_MAX_DAILY_BUDGET (tope de gasto diario).
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

function apiVersion(): string {
  return (process.env.META_API_VERSION || "v21.0").replace(/^v?/, "v");
}
function token(): string {
  const t = process.env.META_ADS_TOKEN || process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!t) throw new Error("Falta META_ADS_TOKEN (token con permiso ads_management)");
  return t;
}
function adAccount(): string {
  const id = (process.env.META_AD_ACCOUNT_ID || "").replace(/^act_/, "");
  if (!id) throw new Error("Falta META_AD_ACCOUNT_ID (id de la cuenta publicitaria, sin act_)");
  return `act_${id}`;
}
export function pageId(): string {
  const p = process.env.FACEBOOK_PAGE_ID;
  if (!p) throw new Error("Falta FACEBOOK_PAGE_ID (la página que publica el anuncio)");
  return p;
}
function base(): string {
  return `https://graph.facebook.com/${apiVersion()}`;
}

async function graph(path: string, method: "GET" | "POST" | "DELETE", params: Record<string, any> = {}): Promise<any> {
  const url = new URL(`${base()}/${path}`);
  const body = new URLSearchParams();
  body.set("access_token", token());
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    body.set(k, typeof v === "object" ? JSON.stringify(v) : String(v));
  }
  const init: RequestInit = { method };
  if (method === "GET") { for (const [k, v] of body) url.searchParams.set(k, v); }
  else { init.body = body; }
  const res = await fetch(url, init);
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const e = data.error ?? {};
    throw new Error(`Meta API ${res.status}: ${e.message ?? JSON.stringify(data).slice(0, 200)}${e.error_user_msg ? ` — ${e.error_user_msg}` : ""}`);
  }
  return data;
}

// ---------- Objetivos y metas (ODAX) ----------
export const OBJECTIVES = ["OUTCOME_AWARENESS", "OUTCOME_TRAFFIC", "OUTCOME_ENGAGEMENT", "OUTCOME_LEADS", "OUTCOME_SALES"] as const;
export type Objective = (typeof OBJECTIVES)[number];

// meta de optimización razonable por objetivo (para el ad set).
export const GOAL_BY_OBJECTIVE: Record<Objective, string> = {
  OUTCOME_AWARENESS: "REACH",
  OUTCOME_TRAFFIC: "LINK_CLICKS",
  OUTCOME_ENGAGEMENT: "POST_ENGAGEMENT",
  OUTCOME_LEADS: "LEAD_GENERATION",
  OUTCOME_SALES: "OFFSITE_CONVERSIONS",
};

export interface Targeting {
  geo_locations: { countries?: string[]; cities?: Array<{ key: string; radius?: number; distance_unit?: string }> };
  age_min?: number;
  age_max?: number;
  genders?: number[]; // 1=hombre, 2=mujer
  interests?: Array<{ id: string; name?: string }>;
  publisher_platforms?: string[]; // ["facebook","instagram"]
}

// ---------- Crear la estructura ----------
export async function createCampaign(o: { name: string; objective: Objective; status?: "PAUSED" | "ACTIVE"; specialCategories?: string[] }): Promise<{ id: string }> {
  return graph(`${adAccount()}/campaigns`, "POST", {
    name: o.name,
    objective: o.objective,
    status: o.status ?? "PAUSED",
    special_ad_categories: o.specialCategories ?? [],
    buying_type: "AUCTION",
  });
}

/** Valida el presupuesto diario contra el tope configurado (ADS_MAX_DAILY_BUDGET, en la moneda de la cuenta). */
export function assertBudgetWithinCap(dailyBudgetMajor: number): void {
  const cap = Number(process.env.ADS_MAX_DAILY_BUDGET || "0");
  if (cap > 0 && dailyBudgetMajor > cap) {
    throw new Error(`El presupuesto diario (${dailyBudgetMajor}) supera el tope configurado ADS_MAX_DAILY_BUDGET (${cap}). Súbelo en Ajustes si de verdad quieres gastar más.`);
  }
}

export async function createAdSet(o: {
  name: string;
  campaignId: string;
  dailyBudgetMajor: number; // en la moneda de la cuenta (ej. 5 = $5/día); se convierte a la "menor unidad"
  objective: Objective;
  targeting: Targeting;
  status?: "PAUSED" | "ACTIVE";
  startTime?: string; // ISO
  endTime?: string;
  usePixel?: boolean;
}): Promise<{ id: string }> {
  assertBudgetWithinCap(o.dailyBudgetMajor);
  const goal = GOAL_BY_OBJECTIVE[o.objective];
  const promoted: any = {};
  if (o.objective === "OUTCOME_ENGAGEMENT" || o.objective === "OUTCOME_AWARENESS" || o.objective === "OUTCOME_LEADS") promoted.page_id = pageId();
  if (o.usePixel && process.env.META_PIXEL_ID && o.objective === "OUTCOME_SALES") { promoted.pixel_id = process.env.META_PIXEL_ID; promoted.custom_event_type = "PURCHASE"; }
  return graph(`${adAccount()}/adsets`, "POST", {
    name: o.name,
    campaign_id: o.campaignId,
    daily_budget: Math.round(o.dailyBudgetMajor * 100), // "menor unidad" (centavos)
    billing_event: "IMPRESSIONS",
    optimization_goal: goal,
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    targeting: o.targeting,
    status: o.status ?? "PAUSED",
    ...(Object.keys(promoted).length ? { promoted_object: promoted } : {}),
    ...(o.startTime ? { start_time: o.startTime } : {}),
    ...(o.endTime ? { end_time: o.endTime } : {}),
  });
}

/** Sube una imagen a la cuenta publicitaria y devuelve su hash (para el creativo). */
export async function uploadAdImage(imagePath: string): Promise<string> {
  const bytes = readFileSync(imagePath).toString("base64");
  const name = basename(imagePath);
  const res = await graph(`${adAccount()}/adimages`, "POST", { bytes, name });
  // La respuesta es { images: { <name>: { hash, url } } }
  const images = res.images ?? {};
  const first = images[name] ?? Object.values(images)[0];
  const hash = (first as any)?.hash;
  if (!hash) throw new Error("Meta no devolvió el hash de la imagen subida");
  return hash;
}

export async function createCreative(o: {
  name: string;
  imageHash: string;
  link: string; // destino (web / wa.me / etc.)
  message: string; // texto principal
  headline?: string; // titular
  description?: string;
  ctaType?: string; // LEARN_MORE, SHOP_NOW, SIGN_UP, MESSAGE_PAGE, WHATSAPP_MESSAGE, ...
  useInstagram?: boolean;
}): Promise<{ id: string }> {
  const link_data: any = {
    image_hash: o.imageHash,
    link: o.link,
    message: o.message,
    ...(o.headline ? { name: o.headline } : {}),
    ...(o.description ? { description: o.description } : {}),
    ...(o.ctaType ? { call_to_action: { type: o.ctaType, value: { link: o.link } } } : {}),
  };
  const object_story_spec: any = { page_id: pageId(), link_data };
  if (o.useInstagram && process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID) object_story_spec.instagram_actor_id = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  return graph(`${adAccount()}/adcreatives`, "POST", { name: o.name, object_story_spec });
}

export async function createAd(o: { name: string; adsetId: string; creativeId: string; status?: "PAUSED" | "ACTIVE" }): Promise<{ id: string }> {
  return graph(`${adAccount()}/ads`, "POST", {
    name: o.name,
    adset_id: o.adsetId,
    creative: { creative_id: o.creativeId },
    status: o.status ?? "PAUSED",
  });
}

// ---------- Optimización ----------
export interface Insights {
  impressions?: string; clicks?: string; spend?: string; ctr?: string; cpc?: string; cpm?: string;
  reach?: string; frequency?: string; actions?: Array<{ action_type: string; value: string }>;
}

/** Métricas de un objeto (campaign/adset/ad). datePreset: today|yesterday|last_7d|last_14d|last_30d|maximum. */
export async function getInsights(objectId: string, datePreset = "last_7d"): Promise<Insights> {
  const res = await graph(`${objectId}/insights`, "GET", {
    fields: "impressions,clicks,spend,ctr,cpc,cpm,reach,frequency,actions",
    date_preset: datePreset,
  });
  return (res.data?.[0] ?? {}) as Insights;
}

/** Cambia estado (PAUSED/ACTIVE) o presupuesto diario de un objeto. */
export async function updateObject(id: string, o: { status?: "PAUSED" | "ACTIVE"; dailyBudgetMajor?: number }): Promise<{ success: boolean }> {
  if (o.dailyBudgetMajor !== undefined) assertBudgetWithinCap(o.dailyBudgetMajor);
  return graph(id, "POST", {
    ...(o.status ? { status: o.status } : {}),
    ...(o.dailyBudgetMajor !== undefined ? { daily_budget: Math.round(o.dailyBudgetMajor * 100) } : {}),
  });
}

export async function listCampaigns(): Promise<Array<{ id: string; name: string; status: string; objective: string }>> {
  const res = await graph(`${adAccount()}/campaigns`, "GET", { fields: "name,status,objective,created_time", limit: 50 });
  return res.data ?? [];
}

export async function listAdSets(campaignId: string): Promise<Array<{ id: string; name: string; status: string; daily_budget?: string }>> {
  const res = await graph(`${campaignId}/adsets`, "GET", { fields: "name,status,daily_budget,optimization_goal", limit: 50 });
  return res.data ?? [];
}

/** Busca intereses de segmentación por nombre → devuelve ids reales de Meta (para el targeting). */
export async function searchInterests(query: string): Promise<Array<{ id: string; name: string; audience_size_lower_bound?: number }>> {
  try {
    const res = await graph("search", "GET", { type: "adinterest", q: query, limit: 5 });
    return res.data ?? [];
  } catch {
    return [];
  }
}

/** ¿Están las credenciales mínimas para operar ads? */
export function adsReady(): boolean {
  return !!(process.env.META_ADS_TOKEN || process.env.INSTAGRAM_ACCESS_TOKEN) && !!process.env.META_AD_ACCOUNT_ID && !!process.env.FACEBOOK_PAGE_ID;
}

/** Moneda + info de la cuenta (para el panel). */
export async function accountInfo(): Promise<{ id: string; currency?: string; name?: string; amount_spent?: string }> {
  return graph(adAccount(), "GET", { fields: "name,currency,amount_spent,account_status" });
}
