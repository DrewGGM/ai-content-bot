/**
 * Campañas de ads con IA: la IA PROPONE una campaña (objetivo, público, presupuesto, copies) a
 * partir del contexto de marca + las piezas que quieres promocionar; luego se CREA en Meta
 * (Facebook/Instagram) vía metaAds, y se puede OPTIMIZAR según métricas.
 *
 * Human-in-the-loop: proponer → revisar/editar en el panel → crear (PAUSED o ACTIVE) → optimizar.
 * El gasto está topado por ADS_MAX_DAILY_BUDGET.
 */
import { askBrandJson } from "./generateCopy.js";
import { loadBrandConfig } from "../lib/brandConfig.js";
import {
  OBJECTIVES, type Objective, type Targeting,
  createCampaign, createAdSet, uploadAdImage, createCreative, createAd,
  getInsights, updateObject, listAdSets, searchInterests,
} from "../lib/metaAds.js";

export interface AdPlanAd {
  pieceId?: string;   // pieza de la cola cuyo asset se usa como creativo
  imagePath: string;  // imagen del creativo (asset de la pieza)
  primaryText: string;
  headline: string;
  description?: string;
  cta: string;        // LEARN_MORE | SHOP_NOW | SIGN_UP | MESSAGE_PAGE | WHATSAPP_MESSAGE ...
  link: string;       // destino (web / wa.me)
}

export interface AdCampaignPlan {
  name: string;
  objective: Objective;
  dailyBudget: number;   // en la moneda de la cuenta (ej. 10 = $10/día)
  durationDays: number;
  targeting: {
    countries: string[]; // ISO ("CO", "US"...)
    ageMin: number;
    ageMax: number;
    genders: number[];   // vacío = todos; 1=hombre 2=mujer
    interests: string[]; // nombres (se resuelven a ids reales al lanzar)
    platforms: string[]; // ["facebook","instagram"]
  };
  rationale: string;     // por qué esta estrategia
  ads: AdPlanAd[];
}

/**
 * La IA propone una campaña para las piezas dadas. `pieces` = las que quieres promocionar
 * (imagen + caption). `objective` opcional fuerza el objetivo; si no, la IA elige.
 */
export async function proposeAdCampaign(opts: {
  pieces: Array<{ id: string; caption: string; image: string; format: string }>;
  objective?: Objective;
  goalText?: string; // qué quieres lograr (ej. "más mensajes de WhatsApp", "ventas")
}): Promise<AdCampaignPlan> {
  const b = loadBrandConfig();
  const website = (b.website ?? "").trim();
  const piecesBrief = opts.pieces.map((p, i) => `#${i + 1} [${p.format}] ${p.caption.split("\n")[0].slice(0, 120)}`).join("\n");

  const data = await askBrandJson(
    `Eres estratega de paid media (Meta Ads) de la marca. Propón UNA campaña de anuncios para promocionar estas piezas en Facebook/Instagram:
${piecesBrief}

${opts.goalText ? `OBJETIVO DEL NEGOCIO: ${opts.goalText}\n` : ""}${opts.objective ? `Usa el objetivo de Meta: ${opts.objective}\n` : ""}
Usa el CONTEXTO DE MARCA (rubro, ubicación, audiencia, producto) para decidir público y mensaje. Presupuesto realista para una PyME.
Devuelve ÚNICAMENTE un JSON válido (sin markdown):
{
  "name": "nombre corto de la campaña",
  "objective": "uno de: ${OBJECTIVES.join(" | ")}",
  "dailyBudget": <número, presupuesto diario en la moneda local (ej. 15000 COP o 10 USD según la cuenta) — sé conservador>,
  "durationDays": <días de duración, ej. 7>,
  "targeting": {
    "countries": ["códigos ISO acordes a la ubicación de la marca, ej. CO"],
    "ageMin": <18-65>, "ageMax": <18-65>,
    "genders": [<vacío para todos, o 1=hombre 2=mujer>],
    "interests": ["2-5 intereses de segmentación EN INGLÉS o el idioma local, acordes al público (ej. 'Small business', 'Entrepreneurship', 'Point of sale')"],
    "platforms": ["facebook", "instagram"]
  },
  "rationale": "2-3 frases: por qué este público, objetivo y presupuesto",
  "ads": [
    { "primaryText": "texto principal del anuncio en el idioma de la marca (gancho + beneficio, 1-3 frases)",
      "headline": "titular corto (máx 40 caracteres)",
      "description": "descripción opcional corta",
      "cta": "uno de: LEARN_MORE | SHOP_NOW | SIGN_UP | MESSAGE_PAGE | WHATSAPP_MESSAGE | CONTACT_US",
      "link": "${website ? "https://" + website.replace(/^https?:\/\//, "") : "URL de destino"}" }
  ]
}
IMPORTANTE: genera un objeto en "ads" POR CADA pieza (en el mismo orden), reusando el mensaje/beneficio de su caption.`,
  );

  const t = data.targeting ?? {};
  const ads: AdPlanAd[] = (Array.isArray(data.ads) ? data.ads : []).map((a: any, i: number) => ({
    pieceId: opts.pieces[i]?.id,
    imagePath: opts.pieces[i]?.image ?? "",
    primaryText: String(a.primaryText ?? opts.pieces[i]?.caption ?? ""),
    headline: String(a.headline ?? "").slice(0, 40),
    description: a.description ? String(a.description) : undefined,
    cta: String(a.cta ?? "LEARN_MORE").toUpperCase(),
    link: String(a.link ?? (website ? `https://${website.replace(/^https?:\/\//, "")}` : "")),
  })).filter((a: AdPlanAd) => a.imagePath);

  return {
    name: String(data.name ?? "Campaña"),
    objective: (OBJECTIVES as readonly string[]).includes(data.objective) ? data.objective : (opts.objective ?? "OUTCOME_TRAFFIC"),
    dailyBudget: Number(data.dailyBudget) || 10,
    durationDays: Number(data.durationDays) || 7,
    targeting: {
      countries: Array.isArray(t.countries) && t.countries.length ? t.countries : [(b.industry ? "CO" : "CO")],
      ageMin: Number(t.ageMin) || 18,
      ageMax: Number(t.ageMax) || 65,
      genders: Array.isArray(t.genders) ? t.genders.filter((g: any) => g === 1 || g === 2) : [],
      interests: Array.isArray(t.interests) ? t.interests.map(String).slice(0, 5) : [],
      platforms: Array.isArray(t.platforms) && t.platforms.length ? t.platforms : ["facebook", "instagram"],
    },
    rationale: String(data.rationale ?? ""),
    ads,
  };
}

/** Crea la campaña completa en Meta a partir del plan. status=PAUSED (default) o ACTIVE. */
export async function launchCampaign(plan: AdCampaignPlan, opts: { status?: "PAUSED" | "ACTIVE" } = {}): Promise<{
  campaignId: string; adsetId: string; adIds: string[]; status: "PAUSED" | "ACTIVE";
}> {
  if (!plan.ads.length) throw new Error("El plan no tiene anuncios (piezas con imagen)");
  const status = opts.status ?? "PAUSED";

  // 1) Campaña.
  const campaign = await createCampaign({ name: plan.name, objective: plan.objective, status });

  // 2) Resolver intereses (nombres → ids reales de Meta).
  const interests: Array<{ id: string; name?: string }> = [];
  for (const q of plan.targeting.interests) {
    const found = await searchInterests(q);
    if (found[0]) interests.push({ id: found[0].id, name: found[0].name });
  }
  const targeting: Targeting = {
    geo_locations: { countries: plan.targeting.countries },
    age_min: plan.targeting.ageMin,
    age_max: plan.targeting.ageMax,
    ...(plan.targeting.genders.length ? { genders: plan.targeting.genders } : {}),
    ...(interests.length ? { interests } : {}),
    publisher_platforms: plan.targeting.platforms,
  };

  // 3) Ad set (presupuesto + público + duración).
  const end = new Date(Date.now() + plan.durationDays * 86400_000).toISOString();
  const adset = await createAdSet({
    name: `${plan.name} — conjunto`,
    campaignId: campaign.id,
    dailyBudgetMajor: plan.dailyBudget,
    objective: plan.objective,
    targeting,
    status,
    endTime: end,
  });

  // 4) Un creativo + anuncio por pieza.
  const adIds: string[] = [];
  for (const [i, ad] of plan.ads.entries()) {
    const hash = await uploadAdImage(ad.imagePath);
    const creative = await createCreative({
      name: `${plan.name} — creativo ${i + 1}`,
      imageHash: hash,
      link: ad.link,
      message: ad.primaryText,
      headline: ad.headline,
      description: ad.description,
      ctaType: ad.cta,
      useInstagram: plan.targeting.platforms.includes("instagram"),
    });
    const created = await createAd({ name: `${plan.name} — anuncio ${i + 1}`, adsetId: adset.id, creativeId: creative.id, status });
    adIds.push(created.id);
  }

  return { campaignId: campaign.id, adsetId: adset.id, adIds, status };
}

export interface OptimizationAction {
  target: string;       // id del adset
  metric: string;       // qué se miró
  suggestion: string;   // recomendación legible
  applied: boolean;     // si se aplicó
}

/**
 * Optimiza una campaña según métricas de los últimos 7 días:
 *  - CTR muy bajo → pausa el conjunto (creativo/público flojo).
 *  - CTR alto y con margen bajo el tope → sube el presupuesto 20%.
 * `apply=false` solo sugiere; `apply=true` ejecuta los cambios.
 */
export async function optimizeCampaign(campaignId: string, apply = false): Promise<{ actions: OptimizationAction[]; report: string }> {
  const adsets = await listAdSets(campaignId);
  const actions: OptimizationAction[] = [];
  for (const as of adsets) {
    const ins = await getInsights(as.id, "last_7d");
    const ctr = Number(ins.ctr ?? 0);
    const spend = Number(ins.spend ?? 0);
    const clicks = Number(ins.clicks ?? 0);
    const dailyMajor = as.daily_budget ? Number(as.daily_budget) / 100 : 0;

    if (spend > 3 && ctr > 0 && ctr < 0.6) {
      // Poco interés (CTR < 0.6%) tras gastar algo → pausar.
      const suggestion = `CTR ${ctr.toFixed(2)}% muy bajo con gasto ${spend.toFixed(2)} → pausar el conjunto (revisar creativo/público).`;
      if (apply) await updateObject(as.id, { status: "PAUSED" });
      actions.push({ target: as.id, metric: `CTR ${ctr}%`, suggestion, applied: apply });
    } else if (ctr >= 1.5 && dailyMajor > 0) {
      // Buen rendimiento → subir presupuesto 20% (respeta el tope).
      const next = Math.round(dailyMajor * 1.2 * 100) / 100;
      const suggestion = `CTR ${ctr.toFixed(2)}% alto → subir presupuesto de ${dailyMajor} a ${next}/día.`;
      if (apply) { try { await updateObject(as.id, { dailyBudgetMajor: next }); } catch (e: any) { actions.push({ target: as.id, metric: "budget", suggestion: `No se pudo subir presupuesto: ${e?.message ?? e}`, applied: false }); continue; } }
      actions.push({ target: as.id, metric: `CTR ${ctr}%`, suggestion, applied: apply });
    } else {
      actions.push({ target: as.id, metric: `CTR ${ctr || 0}% · ${clicks} clics`, suggestion: "Rendimiento en rango — dejar correr y volver a medir en 2-3 días.", applied: false });
    }
  }
  const report = actions.length
    ? actions.map((a) => `• ${a.suggestion}${a.applied ? " (aplicado)" : ""}`).join("\n")
    : "Sin conjuntos con datos suficientes todavía.";
  return { actions, report };
}
