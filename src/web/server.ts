/**
 * Panel web de aprobación (sin dependencias, solo node:http).
 * Muestra reels (video), carruseles (galería con flechas) y posts (imagen con zoom).
 * Permite Aprobar / Rechazar / Descargar. Iconografía SVG (Lucide), sin emojis.
 *
 * Seguridad (2 capas): (1) Cloudflare Access a nivel de red; (2) login POR USUARIO
 * (data/users.json, cookie de sesión). El primer arranque pide crear el usuario admin
 * (si PANEL_PASSWORD está definido, se exige como código de instalación).
 * Cada usuario tiene su PERFIL DE AGENTE IA (proveedor + credenciales cifradas): los jobs
 * que lanza corren con SU cuenta (multi-cuenta de Claude Code / API keys en un servidor).
 *   npm run panel  →  http://localhost:4321
 */
import "dotenv/config"; // carga .env ANTES de cualquier lectura de process.env
import { createServer, type IncomingMessage } from "node:http";
import { readFileSync, existsSync, writeFileSync, mkdirSync, createReadStream, statSync } from "node:fs";
import { extname, normalize, join, dirname, basename, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { env } from "../lib/env.js";
import { loadBrandConfig } from "../lib/brandConfig.js";
import { listQueue, updateStatus, updateCopy, updatePosts, deleteItem, STATUSES, type QueueItem } from "../queue/queue.js";
import { refreshLearnings, loadLearnings, saveLearnings } from "../lib/learnings.js";
import { createContent, type Format } from "../pipeline/dispatch.js";
import { editCopy } from "../pipeline/editCopy.js";
import { planNextContent } from "../pipeline/planContent.js";
import { deleteAssets } from "../lib/assets.js";
import { availableFormats } from "../lib/capabilities.js";
import { publishItem, publishCapabilities, NETWORKS, NETWORK_LABEL, type Network } from "../publish/index.js";
import { askLLM } from "../providers/llm.js";
import { P, icon, esc, baseCss } from "./ui.js";
import { settingsPage } from "./settingsPage.js";
import { hasUsers, listUsers, getUserById, createUser, verifyLogin, setPassword, deleteUser, type User } from "../lib/users.js";
import { profileSummary, updateAgentProfile, setSecret, clearSecret, activeProfileFor } from "../lib/agentProfile.js";
import { runWithProfile } from "../lib/activeProfile.js";
import { ptySupported, startLogin, submitCode, loginStatus, cancelLogin } from "../lib/claudeLogin.js";
import {
  listContextFiles, readContextFile, writeContextFile, createContextFile, deleteContextFile,
  listBrandAssets, readBrandAsset, saveBrandAsset, setBrandLogo,
  readBrandIdentity, saveBrandIdentity,
} from "../lib/contextFiles.js";
import { listModels } from "../lib/modelCatalog.js";
import { listMusic, saveMusic, deleteMusic } from "../lib/musicLibrary.js";
import { audit, readAudit } from "../lib/auditLog.js";
import { readStyleOverride, saveStyleOverride, defaultArtDirection } from "../lib/artDirection.js";
import { listBrandReferences, saveBrandReference, deleteBrandReference, readBrandReference, listBrandProducts, saveBrandProduct, deleteBrandProduct, readBrandProduct } from "../lib/brandReferences.js";
import { listInstalledSkills, setSkillEnabled, uploadSkill, deleteSkill } from "../lib/skills.js";
import { listCompanySecrets, setCompanySecret, deleteCompanySecret, applyCompanySecrets } from "../lib/companySecrets.js";
import { listAppSettings, setAppSetting, applyAppSettings } from "../lib/appSettings.js";
import { adsReady, accountInfo, updateObject, type Objective } from "../lib/metaAds.js";
import { proposeAdCampaign, launchCampaign, optimizeCampaign, type AdCampaignPlan } from "../pipeline/adsCampaign.js";
import { listAdCampaigns, addAdCampaign, updateAdCampaignStatus } from "../lib/adsStore.js";
import { listWorkflows, readWorkflow, saveWorkflow, deleteWorkflow, workflowTemplate } from "../workflows/engine.js";

const brand = loadBrandConfig();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUTPUT = join(ROOT, "assets", "output");

const MIME: Record<string, string> = {
  ".mp4": "video/mp4", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".mp3": "audio/mpeg",
};
const BADGE: Record<string, string> = {
  pending: "#7B4DDB", approved: "#00B892", rejected: "#e05252", published: "#5b6472",
};
const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente", approved: "Aprobado", rejected: "Rechazado", published: "Publicado",
};

const isUrl = (p: string) => /^https?:\/\//i.test(p);
const isR2 = (p: string) => p.startsWith("r2:");           // asset privado en R2 → proxy autenticado
const r2Key = (p: string) => p.slice(3);
const rel = (p: string) => p.slice(OUTPUT.length + 1).replace(/\\/g, "/");
// r2: se sirve por el proxy /r2/ (privado); http(s): URL directa; local: /media//download.
// Los assets locales van VERSIONADOS por mtime (?v=): al regenerar, el archivo cambia bajo
// la MISMA ruta y las cachés (navegador/CDN) seguían sirviendo el video viejo.
const fileVer = (p: string): string => { try { return String(Math.floor(statSync(p).mtimeMs)); } catch { return "0"; } };
const mediaUrl = (p?: string) => (!p ? "" : isR2(p) ? "/r2/" + r2Key(p).split("/").map(encodeURIComponent).join("/") : isUrl(p) ? p : "/media/" + rel(p) + "?v=" + fileVer(p));
const dlUrl = (p: string) => (isR2(p) ? "/r2/" + r2Key(p).split("/").map(encodeURIComponent).join("/") + "?dl=1" : isUrl(p) ? p : "/download/" + rel(p) + "?v=" + fileVer(p));

// ---- Auth por usuario (cookie de sesión → data/users.json) ----
// PANEL_PASSWORD (si existe) se usa como CÓDIGO DE INSTALACIÓN al crear el primer admin.
const SETUP_CODE = env.panelPassword;
const SESSION_TTL_MS = 7 * 86_400_000; // 7 días
// Persistidas en data/sessions.json: los deploys reinician el proceso y sin esto TODAS las
// sesiones morían (te sacaba del panel y las páginas abiertas se quedaban con fetches en 401).
const SESSIONS_PATH = join(ROOT, "data", "sessions.json");
const sessions = new Map<string, { userId: string; expires: number }>();
try {
  const saved = JSON.parse(readFileSync(SESSIONS_PATH, "utf8"));
  for (const [sid, v] of Object.entries(saved) as Array<[string, { userId: string; expires: number }]>) {
    if (v && typeof v.expires === "number" && Date.now() < v.expires) sessions.set(sid, v);
  }
} catch { /* primer arranque */ }
function saveSessions(): void {
  try {
    mkdirSync(dirname(SESSIONS_PATH), { recursive: true });
    writeFileSync(SESSIONS_PATH, JSON.stringify(Object.fromEntries(sessions)), { mode: 0o600 });
  } catch { /* no bloquea el login */ }
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionUser(req: IncomingMessage): User | null {
  const sid = parseCookies(req).sid;
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (Date.now() > s.expires) {
    sessions.delete(sid);
    saveSessions();
    return null;
  }
  const user = getUserById(s.userId);
  if (!user) {
    sessions.delete(sid);
    return null;
  }
  return user;
}

// Rate-limit del login: tras 5 fallos seguidos por IP, se bloquea 60s (frena fuerza bruta;
// Cloudflare Access sigue siendo la 1ª capa).
const loginFails = new Map<string, { count: number; lockedUntil: number }>();
function loginAllowed(ip: string): boolean {
  const f = loginFails.get(ip);
  return !f || Date.now() >= f.lockedUntil;
}
function loginFailed(ip: string): void {
  const f = loginFails.get(ip) ?? { count: 0, lockedUntil: 0 };
  f.count += 1;
  if (f.count >= 5) { f.lockedUntil = Date.now() + 60_000; f.count = 0; }
  loginFails.set(ip, f);
}

function createSession(userId: string): string {
  // Poda sesiones caducadas para que el Map no crezca sin límite.
  for (const [k, v] of sessions) if (Date.now() > v.expires) sessions.delete(k);
  const sid = randomBytes(24).toString("hex");
  sessions.set(sid, { userId, expires: Date.now() + SESSION_TTL_MS });
  saveSessions();
  return sid;
}

/** Lee y parsea el body JSON de un request (límite 1 MB salvo que se indique otro). */
function jsonBody(req: IncomingMessage, maxBytes = 1_048_576): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > maxBytes) {
        reject(new Error("body demasiado grande"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("JSON inválido"));
      }
    });
  });
}

function sendJson(res: any, status: number, data: any): void {
  res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(data));
}

// ---- PWA (instalable en móvil): manifest + iconos generados + service worker ----
const iconCache: Record<number, Buffer> = {};
async function iconPng(size: number): Promise<Buffer> {
  if (iconCache[size]) return iconCache[size];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${brand.colors.primary}"/><stop offset="1" stop-color="${brand.colors.accent}"/>
    </linearGradient></defs>
    <rect width="512" height="512" fill="url(#g)"/>
    <g transform="translate(256 256) scale(9) translate(-12 -12)" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${P.bot}</g>
  </svg>`;
  const sharp = (await import("sharp")).default;
  const buf = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  iconCache[size] = buf;
  return buf;
}
const MANIFEST = JSON.stringify({
  id: "/",
  name: `${brand.name} · Content Bot`,
  short_name: brand.name,
  description: "Panel de aprobación de contenido",
  start_url: "/",
  scope: "/",
  display: "standalone",
  display_override: ["standalone", "minimal-ui"],
  orientation: "portrait",
  background_color: "#05060c",
  theme_color: brand.colors.primary,
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
});
// Service worker: cachea el shell mínimo para satisfacer instalabilidad (requiere un fetch
// handler que responda). Network-first en navegación; NUNCA cachea /manifest, /sw, /login ni
// respuestas no-OK (evita guardar la pantalla de Cloudflare Access).
const SW_JS = `const C='cb-v1';
self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>{e.waitUntil((async()=>{for(const k of await caches.keys())if(k!==C)await caches.delete(k);await self.clients.claim()})())});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin)return;
  if(u.pathname==='/sw.js'||u.pathname==='/manifest.webmanifest'||u.pathname.startsWith('/media')||u.pathname.startsWith('/r2/')||u.pathname.startsWith('/download'))return;
  e.respondWith((async()=>{try{const r=await fetch(e.request);return r}catch(err){const c=await caches.match(e.request);return c||Response.error()}})());
});`;
const PWA_HEAD = `<link rel="manifest" href="/manifest.webmanifest">
  <meta name="theme-color" content="${brand.colors.primary}">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="${esc(brand.name)}">
  <link rel="apple-touch-icon" href="/icon-192.png">
  <link rel="icon" type="image/png" href="/icon-192.png">`;

// ---- Cliente S3/R2 (para servir assets privados por proxy) ----
let _s3: any = null;
let _s3For = "";
async function s3() {
  // Igual que en lib/assets.ts: la config se edita en caliente desde Ajustes, cachear por huella.
  const fingerprint = [
    process.env.S3_REGION, process.env.S3_ENDPOINT, process.env.S3_ACCESS_KEY_ID, process.env.S3_SECRET_ACCESS_KEY,
  ].join("|");
  if (_s3 && _s3For === fingerprint) return _s3;
  const { S3Client } = await import("@aws-sdk/client-s3");
  _s3For = fingerprint;
  _s3 = new S3Client({
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
    },
    forcePathStyle: true,
  });
  return _s3;
}

// ---- Generación manual desde el panel (registro de jobs in-process) ----
// Cada job corre con el PERFIL DE AGENTE del usuario que lo lanzó (runWithProfile):
// su COPY_PROVIDER, su token de Claude Code / API keys, su CLAUDE_CONFIG_DIR aislado, etc.
type Job = { id: string; format: string; topic: string; status: "running" | "done" | "error"; started: number; itemId?: string; error?: string; user?: string };
const jobs: Job[] = [];
const FORMAT_LABELS: Record<string, string> = {
  design: "Diseño — 1 póster, código sin API",
  deck: "Carrusel (código) — varios pósters, sin fal",
  post: "Post — imagen única (fal)",
  brandpost: "Post de marca premium — logo + referencias (fal)",
  brandcarousel: "Carrusel de marca premium — slides con logo/referencias (fal)",
  carousel: "Carrusel — imágenes IA (fal)",
  reel: "Reel — video b-roll (fal)",
  motion: "Video (Remotion) — animado por código, sin fal",
  ugc: "UGC — avatar HeyGen",
};
function startJob(user: User, format: Format, topic: string, platform?: string, extra?: { aspect?: any; audio?: any; musicUrl?: string }): Job {
  const job: Job = { id: randomBytes(6).toString("hex"), format, topic, status: "running", started: Date.now(), user: user.name };
  audit(user.name, "generar", `${format} · ${topic}`);
  jobs.unshift(job);
  if (jobs.length > 20) jobs.length = 20;
  // fire-and-forget: la generación sigue en segundo plano; el front hace polling de /jobs.
  runWithProfile(activeProfileFor(user), () =>
    createContent({ format, topic, ...(platform ? { platform } : {}), ...(extra?.aspect ? { aspect: extra.aspect } : {}), ...(extra?.audio ? { audio: extra.audio } : {}), ...(extra?.musicUrl ? { musicUrl: extra.musicUrl } : {}) })
  )
    .then((item) => { job.status = "done"; job.itemId = item.id; })
    .catch((e) => { job.status = "error"; job.error = String(e?.message ?? e); });
  return job;
}

function startEditJob(user: User, item: QueueItem, instruction: string): Job {
  const job: Job = { id: randomBytes(6).toString("hex"), format: item.format, topic: `editar: ${instruction}`, status: "running", started: Date.now(), user: user.name };
  audit(user.name, "editar copy", `${item.id} · ${instruction.slice(0, 120)}`);
  jobs.unshift(job);
  if (jobs.length > 20) jobs.length = 20;
  runWithProfile(activeProfileFor(user), () => editCopy(item, instruction))
    .then((copy) => updateCopy(item.id, copy.caption, copy.hashtags))
    .then(() => { job.status = "done"; job.itemId = item.id; })
    .catch((e) => { job.status = "error"; job.error = String(e?.message ?? e); });
  return job;
}

// Regenera el VISUAL (imagen/video) de una pieza con la instrucción, reusando su id/carpeta.
function startRegenJob(user: User, item: QueueItem, instruction: string, extra?: { aspect?: any; audio?: any; musicUrl?: string }): Job {
  const slug = item.dir.split(/[\\/]/).filter(Boolean).pop() || item.topic || item.id;
  const job: Job = { id: randomBytes(6).toString("hex"), format: item.format, topic: `regenerar: ${instruction}`, status: "running", started: Date.now(), user: user.name };
  audit(user.name, "regenerar visual", `${item.id} · ${instruction.slice(0, 120)}`);
  jobs.unshift(job);
  if (jobs.length > 20) jobs.length = 20;
  runWithProfile(activeProfileFor(user), () =>
    createContent({
      format: item.format as Format,
      topic: item.topic || slug,
      platform: item.platform,
      instruction,
      reuse: { slug, createdAt: item.createdAt },
      ...(extra?.aspect ? { aspect: extra.aspect } : {}),
      ...(extra?.audio ? { audio: extra.audio } : {}),
      ...(extra?.musicUrl ? { musicUrl: extra.musicUrl } : {}),
    })
  )
    .then((it) => { job.status = "done"; job.itemId = it.id; })
    .catch((e) => { job.status = "error"; job.error = String(e?.message ?? e); });
  return job;
}

// Publica una pieza a las redes seleccionadas; si al menos una funciona, la marca "published".
// (Los tokens de publicación son del servidor, no del perfil del usuario.)
function startPublishJob(user: User, item: QueueItem, networks: Network[]): Job {
  const job: Job = { id: randomBytes(6).toString("hex"), format: item.format, topic: `publicar: ${networks.map((n) => NETWORK_LABEL[n]).join(", ")}`, status: "running", started: Date.now(), user: user.name };
  jobs.unshift(job);
  if (jobs.length > 20) jobs.length = 20;
  audit(user.name, "publicar", `${item.id} → ${networks.join(", ")}`);
  publishItem(item, networks)
    .then(async (results) => {
      const fail = results.filter((r) => !r.ok);
      audit(user.name, fail.length ? "publicación con fallos" : "publicado",
        `${item.id} · ` + results.map((r) => `${r.network}:${r.ok ? "ok" : "error"}`).join(" "));
      if (results.some((r) => r.ok)) {
        await updateStatus(item.id, "published");
        // Guarda las referencias de los posts para medir su rendimiento luego (lib/performance.ts).
        const now = new Date().toISOString();
        const posts = results.filter((r) => r.ok && r.id).map((r) => ({ network: r.network, id: r.id!, at: now }));
        if (posts.length) await updatePosts(item.id, posts);
      }
      if (fail.length) { job.status = "error"; job.error = fail.map((f) => `${NETWORK_LABEL[f.network]}: ${f.error}`).join(" · "); }
      else { job.status = "done"; job.itemId = item.id; }
    })
    .catch((e) => { job.status = "error"; job.error = String(e?.message ?? e); });
  return job;
}

// Plan: Claude decide la pieza según el historial y la genera (cae a design si un proveedor falla).
function startPlanJob(user: User): Job {
  const job: Job = { id: randomBytes(6).toString("hex"), format: "plan", topic: "IA decide la pieza…", status: "running", started: Date.now(), user: user.name };
  audit(user.name, "plan IA", "la IA decide formato + tema");
  jobs.unshift(job);
  if (jobs.length > 20) jobs.length = 20;
  runWithProfile(activeProfileFor(user), async () => {
    const plan = await planNextContent();
    job.topic = `${plan.format}: ${plan.topic}`;
    try {
      const it = await createContent({ format: plan.format, topic: plan.topic, platform: plan.platform });
      job.status = "done"; job.itemId = it.id;
    } catch {
      const it = await createContent({ format: "design", topic: plan.topic, platform: plan.platform });
      job.status = "done"; job.itemId = it.id;
    }
  }).catch((e) => { job.status = "error"; job.error = String(e?.message ?? e); });
  return job;
}

// Set: una pieza de cada formato disponible (lanza un job por formato).
const SET_TOPICS: Record<string, string> = {
  reel: "El principal beneficio de tu producto para el cliente",
  motion: "Un dato o idea clave de tu sector, explicado simple",
  carousel: "3 mitos o errores comunes en tu industria",
  post: "Tu propuesta de valor en una frase",
  design: "Por qué elegirte (poster por código)",
  deck: "Guía rápida: 3 razones para elegirte (carrusel por código)",
  ugc: "Un cliente recomienda tu producto y por qué",
};
function startSet(user: User): number {
  audit(user.name, "set completo", "una pieza por formato disponible");
  const avail = availableFormats();
  for (const f of avail) startJob(user, f as Format, SET_TOPICS[f] ?? "Contenido de marca");
  return avail.length;
}

// ---- Programación automática (in-process, configurable desde el panel) ----
// Persistida en data/schedule.json (untracked → sobrevive a los deploys). Reemplaza al cron del SO.
// userId = con el perfil de agente de QUIÉN corre la pieza diaria (quien guardó la programación).
type Sched = { enabled: boolean; time: string; lastRun?: string; userId?: string }; // time = "HH:MM" hora Colombia (UTC-5)
const SCHED_PATH = join(ROOT, "data", "schedule.json");
function readSched(): Sched {
  try { return { enabled: false, time: "09:00", ...JSON.parse(readFileSync(SCHED_PATH, "utf8")) }; }
  catch { return { enabled: false, time: "09:00" }; }
}
function writeSched(s: Sched): void {
  try { mkdirSync(dirname(SCHED_PATH), { recursive: true }); } catch { /* ya existe */ }
  writeFileSync(SCHED_PATH, JSON.stringify(s, null, 2));
}
// Hora/fecha en Colombia (UTC-5, sin horario de verano) calculada desde UTC del servidor.
function colombiaNow(): { minutes: number; date: string } {
  const col = new Date(Date.now() - 5 * 3600 * 1000);
  return { minutes: col.getUTCHours() * 60 + col.getUTCMinutes(), date: col.toISOString().slice(0, 10) };
}
let schedStarted = false;
function startScheduler(): void {
  if (schedStarted) return;
  schedStarted = true;
  setInterval(async () => {
    const s = readSched();
    if (!s.enabled) return;
    const now = colombiaNow();
    const [sh, sm] = s.time.split(":").map(Number);
    const schedMin = (sh || 0) * 60 + (sm || 0);
    // Ventana de 5 min desde la hora programada; una sola vez al día.
    if (now.minutes < schedMin || now.minutes >= schedMin + 5 || s.lastRun === now.date) return;
    writeSched({ ...s, lastRun: now.date }); // marca ANTES de generar (evita doble disparo)
    // La pieza automática corre con el perfil de agente de quien guardó la programación.
    const owner = s.userId ? getUserById(s.userId) : null;
    const profile = owner ? activeProfileFor(owner) : null;
    try {
      await runWithProfile(profile, async () => {
        const plan = await planNextContent();
        try { await createContent({ format: plan.format, topic: plan.topic, platform: plan.platform }); }
        catch { await createContent({ format: "design", topic: plan.topic, platform: plan.platform }); }
      });
      audit("cron", "pieza automática generada", owner ? `con el agente de ${owner.name}` : "con el agente del servidor");
      console.log(`[scheduler] pieza automática generada (${now.date}${owner ? `, agente de ${owner.name}` : ""})`);
    } catch (e: any) { console.error("[scheduler]", e?.message ?? e); }
  }, 60_000);
}

// ---- Media / acciones por card ----
function mediaHtml(it: QueueItem): string {
  if (it.assets.video) {
    return `<video src="${esc(mediaUrl(it.assets.video))}" controls playsinline preload="metadata"></video>`;
  }
  if (it.assets.images && it.assets.images.length) {
    const slides = it.assets.images
      .map((im) => `<img src="${esc(mediaUrl(im))}" alt="Slide del carrusel" loading="lazy" onclick="zoom(this.src)">`)
      .join("");
    return `<div class="carousel"><button class="nav prev" aria-label="Anterior" onclick="slide(this,-1)">&lsaquo;</button>
      <div class="track">${slides}</div>
      <button class="nav next" aria-label="Siguiente" onclick="slide(this,1)">&rsaquo;</button>
      <span class="count">${it.assets.images.length} slides</span></div>`;
  }
  if (it.assets.image) {
    return `<img class="single" src="${esc(mediaUrl(it.assets.image))}" alt="Imagen de la pieza" loading="lazy" onclick="zoom(this.src)">`;
  }
  return `<div class="novid">${icon("layers", "ic")} sin media</div>`;
}

function downloadBtn(it: QueueItem): string {
  if (it.assets.video) return `<a class="dl" href="${esc(dlUrl(it.assets.video))}" download>${icon("download")} Descargar</a>`;
  if (it.assets.images && it.assets.images.length) {
    const urls = it.assets.images.map((p) => dlUrl(p));
    return `<button class="dl" onclick='dlAll(${JSON.stringify(urls)})'>${icon("download")} Descargar (${urls.length})</button>`;
  }
  if (it.assets.image) return `<a class="dl" href="${esc(dlUrl(it.assets.image))}" download>${icon("download")} Descargar</a>`;
  return "";
}

// ---- Página de acceso: login por usuario, o SETUP del primer admin si no hay usuarios ----
function authPage(mode: "login" | "setup", error = ""): string {
  const b = loadBrandConfig();
  const isSetup = mode === "setup";
  const fields = isSetup
    ? `<label for="u">Tu nombre</label>
    <div class="field"><span class="lk">${icon("bot", "ic")}</span>
      <input id="u" name="name" autocomplete="username" autofocus placeholder="ej. Andrew"></div>
    <label for="pw" style="margin-top:14px">Contraseña nueva</label>
    <div class="field"><span class="lk">${icon("lock", "ic")}</span>
      <input id="pw" name="password" type="password" autocomplete="new-password" placeholder="mínimo 6 caracteres"></div>
    ${SETUP_CODE ? `<label for="code" style="margin-top:14px">Código de instalación (PANEL_PASSWORD del .env)</label>
    <div class="field"><span class="lk">${icon("key", "ic")}</span>
      <input id="code" name="code" type="password" autocomplete="off" placeholder="••••••••"></div>` : ""}`
    : `<label for="u">Usuario</label>
    <div class="field"><span class="lk">${icon("bot", "ic")}</span>
      <input id="u" name="name" autocomplete="username" autofocus placeholder="Tu nombre de usuario"></div>
    <label for="pw" style="margin-top:14px">Contraseña</label>
    <div class="field"><span class="lk">${icon("lock", "ic")}</span>
      <input id="pw" name="password" type="password" autocomplete="current-password" placeholder="••••••••"></div>`;

  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(b.name)} · Acceso</title>
  <style>${baseCss()}
    .wrap{min-height:100vh;display:grid;place-items:center;padding:24px}
    .box{width:100%;max-width:380px;background:linear-gradient(180deg,var(--card2),var(--card));
      border:1px solid var(--line);border-radius:22px;padding:34px 30px;box-shadow:0 30px 80px #000a}
    .logo{display:flex;align-items:center;gap:10px;font-weight:800;font-size:19px;margin-bottom:4px}
    .logo .badge{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;
      background:linear-gradient(135deg,var(--violet),var(--mint));color:#fff}
    .sub{color:var(--mut);font-size:13px;margin:2px 0 22px;line-height:1.5}
    label{display:block;font-size:12px;color:var(--mut);margin-bottom:7px;font-weight:600}
    .field{position:relative}
    .field .lk{position:absolute;left:13px;top:50%;transform:translateY(-50%);color:var(--mut)}
    input{width:100%;padding:13px 13px 13px 42px;border-radius:12px;border:1px solid var(--line);
      background:#0b0d1c;color:var(--txt);font-size:15px;font-family:inherit;transition:border-color .2s}
    input:focus{outline:none;border-color:var(--violet2)}
    button{width:100%;margin-top:16px;padding:13px;border:0;border-radius:12px;font-weight:700;font-size:15px;
      cursor:pointer;color:#fff;background:linear-gradient(135deg,var(--violet),var(--violet2));
      transition:filter .2s,transform .15s}
    button:hover{filter:brightness(1.1)} button:active{transform:translateY(1px)}
    .err{color:#ff8f8f;font-size:13px;margin-top:14px;min-height:18px;text-align:center}
  </style></head><body>
  <div class="wrap"><form class="box" method="POST" action="${isSetup ? "/setup" : "/login"}">
    <div class="logo"><span class="badge">${icon("bot", "ic")}</span> ${esc(b.name)}</div>
    <div class="sub">${isSetup
      ? "Primer arranque — crea la cuenta de <b>administrador</b> del panel."
      : "Panel de contenido — acceso privado"}</div>
    ${fields}
    <button type="submit">${icon("lock", "ic")} ${isSetup ? "Crear cuenta admin" : "Entrar"}</button>
    <div class="err">${esc(error)}</div>
  </form></div></body></html>`;
}

// ---- Página principal ----
async function page(user: User): Promise<string> {
  const items = await listQueue();
  const counts = {
    all: items.length,
    pending: items.filter((i) => i.status === "pending").length,
    approved: items.filter((i) => i.status === "approved").length,
    rejected: items.filter((i) => i.status === "rejected").length,
    published: items.filter((i) => i.status === "published").length,
  };
  const tabs = [
    ["all", "Todas", counts.all],
    ["pending", "Pendientes", counts.pending],
    ["approved", "Aprobadas", counts.approved],
    ["rejected", "Rechazadas", counts.rejected],
    ["published", "Publicadas", counts.published],
  ] as const;

  const cards = items
    .map((it) => {
      const tags = it.hashtags.map((h) => `<span class="tag">${esc(h)}</span>`).join(" ");
      // Texto completo para copiar: caption + hashtags (lo que pegas en Instagram/etc.).
      const fullCopy = it.caption + (it.hashtags.length ? `\n\n${it.hashtags.join(" ")}` : "");
      const done = it.status === "approved" || it.status === "rejected";
      const fmtIcon = P[it.format] ? it.format : "post";
      const label = `${it.format} · ${it.topic ?? it.id}`;
      return `<article class="card" data-status="${esc(it.status)}" data-label="${esc(label)}" data-format="${esc(it.format)}">
        <div class="media">${mediaHtml(it)}
          <span class="badge" style="background:${BADGE[it.status] ?? "#555"}">${esc(STATUS_LABEL[it.status] ?? it.status)}</span>
        </div>
        <div class="body">
          <div class="meta">${icon(fmtIcon, "ic sm")}<span>${esc(it.format)}</span><i>·</i><span>${esc(it.platform)}</span>${it.pillar ? `<i>·</i><span>${esc(it.pillar)}</span>` : ""}${it.cost && it.cost.usd > 0 ? `<i>·</i><span title="Costo estimado de generación (APIs de imagen/video/voz). ${esc(Object.entries(it.cost.byProvider).map(([k, v]) => `${k}: ${v.calls}× $${v.usd.toFixed(2)}`).join(" · "))}">≈ $${it.cost.usd.toFixed(2)}</span>` : ""}</div>
          <p class="cap">${esc(it.caption).replace(/\n/g, "<br>")}</p>
          ${tags ? `<div class="tags">${tags}</div>` : ""}
          ${it.feedback ? `<p class="why"><b>${it.status === "rejected" ? "Motivo del rechazo" : "Comentario"}${it.reviewedBy ? ` · ${esc(it.reviewedBy)}` : ""}:</b> ${esc(it.feedback)}</p>` : ""}
          ${it.insights ? `<p class="perf">${icon("spark", "ic sm")} <b>Rendimiento:</b> score ${it.insights.score} · ${["reach", "likes", "comments", "saved", "shares"].filter((k) => (it.insights!.metrics as any)[k] != null).map((k) => `${k} ${(it.insights!.metrics as any)[k]}`).join(" · ") || "sin datos"}</p>` : (it.status === "published" && it.posts?.length ? `<p class="perf">${icon("spark", "ic sm")} <span style="color:var(--mut)">rendimiento: pendiente de medir</span></p>` : "")}
          <div class="act-stack">
          <div class="actions">
            <button class="copy-btn" data-copy="${esc(fullCopy)}" onclick="copyCap(this)">${icon("copy")} Copiar descripción</button>
          </div>
          <div class="actions">
            <button class="ok" ${done ? "disabled" : ""} onclick="askAct(this,'${esc(it.id)}','approved')">${icon("check")} Aprobar</button>
            <button class="no" ${done ? "disabled" : ""} onclick="askAct(this,'${esc(it.id)}','rejected')">${icon("x")} Rechazar</button>
          </div>
          <div class="actions">
            <button class="pub-btn" onclick="openPub(this,'${esc(it.id)}')">${icon("send")} Publicar</button>
          </div>
          <div class="actions">
            <button class="edit-btn" onclick="openEdit(this,'${esc(it.id)}')">${icon("edit")} Editar con IA</button>
            ${downloadBtn(it)}
            <button class="del-btn" title="Eliminar pieza y sus assets" onclick="askDelete(this,'${esc(it.id)}')">${icon("trash")}</button>
          </div>
          </div>
        </div>
      </article>`;
    })
    .join("");

  const logoutBtn = `<a class="logout" href="/logout" title="Cerrar sesión (${esc(user.name)})">${icon("logout")}<span>Salir</span></a>`;
  const settingsBtn = `<a class="logout" href="/settings" title="Ajustes: tu agente IA, contexto y usuarios">${icon("gear")}<span>Ajustes</span></a>`;

  const genFormats = availableFormats();
  const wfs = listWorkflows();
  const fmtOptions =
    genFormats.map((f) => `<option value="${f}">${esc(FORMAT_LABELS[f] ?? f)}</option>`).join("") +
    (wfs.length
      ? `<optgroup label="Workflows (personalizables en Ajustes)">${wfs.map((w) => `<option value="workflow:${esc(w.name)}">${esc(w.title)}</option>`).join("")}</optgroup>`
      : "");
  const platOptions = ["", "instagram", "facebook", "tiktok", "linkedin"]
    .map((p) => `<option value="${p}">${p ? p[0].toUpperCase() + p.slice(1) : "Automática"}</option>`).join("");

  const pubCaps = publishCapabilities();
  const netChecks = NETWORKS.map((n) => {
    const on = pubCaps[n];
    return `<label class="netopt${on ? "" : " off"}"><input type="checkbox" value="${n}"${on ? "" : " disabled"}> <span>${esc(NETWORK_LABEL[n])}</span>${on ? "" : ' <em>falta configurar</em>'}</label>`;
  }).join("");

  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>${esc(brand.name)} · Content Bot</title>
  ${PWA_HEAD}
  <style>${baseCss()}
    header{position:sticky;top:0;z-index:var(--z-header);backdrop-filter:blur(14px);
      background:color-mix(in srgb,var(--bg) 82%,transparent);border-bottom:1px solid var(--line)}
    .hbar{max-width:1560px;margin:0 auto;padding:14px 26px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
    .brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:17px}
    .brand .badge{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;
      background:linear-gradient(135deg,var(--violet),var(--mint));color:#fff}
    .brand small{font-weight:500;color:var(--mut);font-size:12px}
    .spacer{flex:1}
    .logout{display:inline-flex;align-items:center;gap:7px;color:var(--mut);text-decoration:none;
      padding:8px 13px;border-radius:10px;border:1px solid var(--line);font-size:13px;font-weight:600;transition:color .2s,border-color .2s}
    .logout:hover{color:var(--txt);border-color:var(--violet2)}
    .tabs{max-width:1560px;margin:0 auto;padding:0 26px 12px;display:flex;gap:8px;flex-wrap:wrap}
    .tab{display:inline-flex;align-items:center;gap:8px;padding:8px 15px;border-radius:99px;cursor:pointer;
      border:1px solid var(--line);background:transparent;color:var(--mut);font-size:13px;font-weight:600;
      font-family:inherit;transition:color .2s,border-color .2s,background .2s}
    .tab:hover{color:var(--txt)}
    .tab[aria-selected="true"]{color:#fff;background:linear-gradient(135deg,var(--violet),var(--violet2));border-color:transparent}
    .tab .n{font-family:'Fira Code',monospace;font-size:11px;padding:1px 8px;border-radius:99px;
      background:#ffffff1a;min-width:22px;text-align:center}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:22px;
      padding:8px 26px 40px;max-width:1560px;margin:0 auto;align-items:start}
    .card{background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--line);
      border-radius:18px;overflow:hidden;display:flex;flex-direction:column;
      box-shadow:0 10px 34px #0007;transition:transform .2s,border-color .2s,box-shadow .2s}
    .card:hover{transform:translateY(-3px);border-color:color-mix(in srgb,var(--violet2) 55%,var(--line));
      box-shadow:0 20px 50px #0009}
    .card.hide{display:none}
    .media{position:relative;background:#000;line-height:0}
    .media .badge{position:absolute;top:11px;left:11px;padding:4px 11px;border-radius:99px;font-size:10.5px;
      font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:#fff;box-shadow:0 4px 14px #0007;line-height:1.4}
    video,.single{width:100%;display:block}
    video{background:#000;max-height:74vh} /* proporción NATURAL: los cuadrados y 4:5 se ven como son, no recortados a 9:16 */
    .single{cursor:zoom-in}
    .carousel{position:relative}
    .track{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;scroll-behavior:smooth;scrollbar-width:none}
    .track::-webkit-scrollbar{display:none}
    .track img{width:100%;flex:0 0 100%;scroll-snap-align:center;cursor:zoom-in}
    .nav{position:absolute;top:50%;transform:translateY(-50%);z-index:2;width:40px;height:40px;min-width:40px;
      border-radius:50%;border:0;background:#000b;color:#fff;font-size:22px;cursor:pointer;transition:background .2s}
    .nav:hover{background:var(--violet)} .prev{left:8px} .next{right:8px}
    .count{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);background:#000b;padding:3px 12px;
      border-radius:99px;font-size:11px;font-family:'Fira Code',monospace}
    .novid{aspect-ratio:9/16;display:flex;flex-direction:column;gap:8px;align-items:center;justify-content:center;color:#6a6c8c;background:#0a0a16}
    .body{padding:16px;display:flex;flex-direction:column;gap:11px}
    .meta{display:flex;align-items:center;gap:6px;color:var(--mut);font-size:12px;text-transform:capitalize}
    .meta i{opacity:.5;font-style:normal} .meta span{white-space:nowrap}
    .cap{font-size:13px;line-height:1.6;color:#dcdcec;margin:0;max-height:216px;overflow:auto;overscroll-behavior:contain}
    .tags{display:flex;flex-wrap:wrap;gap:5px} .tag{font-size:11px;color:var(--mint);font-family:'Fira Code',monospace}
    .act-stack{margin-top:auto;display:flex;flex-direction:column;gap:9px}
    .actions{display:flex;gap:9px;flex-wrap:wrap}
    .actions button,.actions .dl{min-width:0}
    button,.dl{flex:1;padding:10px;border:0;border-radius:11px;font-weight:700;cursor:pointer;color:#fff;
      font-size:13.5px;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:7px;
      text-decoration:none;transition:filter .2s,transform .12s;white-space:nowrap}
    .ok{background:#00a578} .no{background:#c0392b} .dl{background:#1a1d33;border:1px solid var(--line);color:var(--txt)}
    .edit-btn{background:#1a1d33;border:1px solid var(--line);color:var(--txt)} .edit-btn:hover{border-color:var(--violet2)}
    .copy-btn{background:#1a1d33;border:1px solid var(--line);color:var(--txt);flex:1} .copy-btn:hover{border-color:var(--mint)}
    .pub-btn{background:linear-gradient(135deg,var(--mint),#00a578);color:#04150f}
    .nets{display:flex;flex-direction:column;gap:6px;margin-top:8px}
    .netopt{display:flex;align-items:center;gap:9px;padding:9px 11px;border:1px solid var(--line);border-radius:11px;cursor:pointer;font-size:13.5px;font-weight:600;transition:border-color .2s}
    .netopt:hover{border-color:var(--violet2)} .netopt input{accent-color:var(--violet);width:17px;height:17px;flex:none;cursor:pointer}
    .netopt.off{opacity:.5;cursor:not-allowed} .netopt.off:hover{border-color:var(--line)}
    .netopt em{color:var(--mut);font-style:normal;font-weight:500;font-size:11.5px;margin-left:auto}
    button:hover:not(:disabled),.dl:hover{filter:brightness(1.12)} button:active:not(:disabled){transform:translateY(1px)}
    button:disabled{opacity:.38;cursor:default}
    .empty{grid-column:1/-1;padding:90px 20px;text-align:center;color:var(--mut)}
    .empty svg{width:40px;height:40px;opacity:.5;margin-bottom:14px}
    .empty code{background:#ffffff12;padding:2px 8px;border-radius:6px;font-family:'Fira Code',monospace}
    .gen-btn{display:inline-flex;align-items:center;gap:7px;padding:9px 16px;border:0;border-radius:10px;cursor:pointer;
      font-family:inherit;font-size:13px;font-weight:700;color:#fff;background:linear-gradient(135deg,var(--violet),var(--violet2));transition:filter .2s,transform .12s}
    .gen-btn:hover{filter:brightness(1.12)} .gen-btn:active{transform:translateY(1px)}
    .hbtn{display:inline-flex;align-items:center;gap:6px;padding:8px 13px;border:1px solid var(--line);border-radius:10px;cursor:pointer;
      font-family:inherit;font-size:13px;font-weight:600;color:var(--txt);background:transparent;transition:border-color .2s,color .2s}
    .hbtn:hover{border-color:var(--violet2);color:#fff}
    @media (max-width:900px){.hbtn span,.gen-btn span,.logout span{display:none}.gen-btn,.logout{padding:9px 11px}.hbtn{padding:9px 10px}}
    .del-btn{flex:none!important;width:46px;background:#1a1d33;border:1px solid var(--line);color:var(--mut)}
    .del-btn:hover{border-color:#c0392b;color:#e05252}
    .modal{position:fixed;inset:0;background:#000b;display:none;align-items:flex-start;justify-content:center;z-index:var(--z-lb);padding:8vh 16px;backdrop-filter:blur(4px)}
    .modal.show{display:flex}
    .modal-box{width:100%;max-width:480px;background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--line);border-radius:20px;padding:22px;box-shadow:0 30px 80px #000c}
    .modal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
    .mh-title{display:inline-flex;align-items:center;gap:9px;font-weight:800;font-size:16px}
    .mh-close{background:transparent;border:0;color:var(--mut);cursor:pointer;padding:4px;display:inline-flex}
    .mh-close:hover{color:var(--txt)}
    .modal label{display:block;font-size:12px;color:var(--mut);margin:0 0 6px;font-weight:600}
    .modal textarea,.modal select{width:100%;padding:11px;border-radius:11px;border:1px solid var(--line);background:#0b0d1c;color:var(--txt);font-size:14px;font-family:inherit;resize:vertical}
    .modal textarea:focus,.modal select:focus{outline:none;border-color:var(--violet2)}
    .modal-row{display:flex;gap:12px;margin-top:14px}.modal-row>div{flex:1;min-width:0}
    .modal-err{color:#ff8f8f;font-size:13px;min-height:18px;margin-top:12px}
    .modal .check{display:flex;align-items:flex-start;gap:9px;margin-top:14px;font-size:12.5px;color:var(--mut);font-weight:500;cursor:pointer;line-height:1.4}
    .modal .check input{margin:2px 0 0;accent-color:var(--violet);width:17px;height:17px;flex:none;cursor:pointer}
    .modal-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:6px}
    .btn-ghost,.btn-primary{padding:11px 18px;border-radius:11px;font-weight:700;font-size:14px;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:7px}
    .btn-ghost{background:transparent;color:var(--mut);border:1px solid var(--line)} .btn-ghost:hover{color:var(--txt)}
    .btn-primary{border:0;color:#fff;background:linear-gradient(135deg,var(--violet),var(--violet2))}
    .btn-primary:hover{filter:brightness(1.12)} .btn-primary:disabled{opacity:.5;cursor:default}
    .btn-primary.danger{background:linear-gradient(135deg,#a93226,#d0453a)}
    .cf-body{color:var(--mut);font-size:13.5px;line-height:1.6;margin:0 0 6px}
    .cf-body b{color:var(--txt)}
    .cf-chips{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 8px}
    .cf-chip{font-size:11.5px;padding:5px 10px;border-radius:99px;cursor:pointer;font-family:inherit;
      background:transparent;color:var(--mut);border:1px solid var(--line)}
    .cf-chip:hover{color:var(--txt);border-color:var(--violet2)}
    .cf-chip.on{background:color-mix(in srgb,var(--violet) 26%,transparent);color:#cdb6ff;border-color:var(--violet2)}
    .cf-note{width:100%;padding:10px;border-radius:11px;border:1px solid var(--line);background:#0b0d1c;
      color:var(--txt);font-size:13px;font-family:inherit;resize:vertical}
    .cf-note:focus{outline:none;border-color:var(--violet2)}
    .why{margin:8px 0 0;padding:8px 11px;border-radius:10px;font-size:12px;line-height:1.5;color:var(--mut);
      background:#ffffff08;border-left:2px solid #d0453a}
    .why b{color:var(--txt)}
    .perf{margin:8px 0 0;padding:8px 11px;border-radius:10px;font-size:12px;line-height:1.5;color:var(--mut);
      background:#00d4aa10;border-left:2px solid var(--mint)}
    .perf b{color:var(--txt)}
    .pub-warn{display:none;margin-top:12px;padding:10px 13px;border-radius:11px;font-size:12.5px;line-height:1.5;
      background:color-mix(in srgb,#e0a52b 14%,transparent);border:1px solid #e0a52b55;color:#f0c974}
    .pub-warn.show{display:block}
    .jobs{position:fixed;right:16px;bottom:16px;z-index:var(--z-lb);display:flex;flex-direction:column;gap:8px;max-width:340px}
    .job{display:flex;align-items:center;gap:10px;padding:11px 13px;border-radius:12px;border:1px solid var(--line);background:var(--card2);box-shadow:0 12px 30px #0009;font-size:12.5px}
    .job .jb{flex:1;min-width:0}
    .job .jt{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-transform:capitalize}
    .job .jerr{font-size:11px;color:#ff9d94;line-height:1.45;margin-top:3px;white-space:normal;word-break:break-word;max-height:52px;overflow:auto}
    .job .js{flex:none;display:inline-flex} .job b{flex:none;font-family:'Fira Code',monospace;font-size:11px}
    .job .jx{flex:none;background:transparent;border:0;color:var(--mut);cursor:pointer;padding:2px;display:inline-flex;border-radius:6px}
    .job .jx:hover{color:#fff;background:#ffffff14}
    .job.run .js{color:var(--violet2);animation:spin 1.1s linear infinite}
    .job.done{border-color:#00a57855} .job.done .js{color:#00c893}
    .job.error{border-color:#c0392b66} .job.error .js{color:#e05252}
    @keyframes spin{to{transform:rotate(360deg)}}
    @media (prefers-reduced-motion:reduce){.job.run .js{animation:none}}
    #lb{position:fixed;inset:0;background:#000e;display:none;align-items:center;justify-content:center;z-index:var(--z-lb);cursor:zoom-out}
    #lb img{max-width:92vw;max-height:92vh;border-radius:12px;box-shadow:0 20px 60px #000}
    @media (max-width:640px){
      .hbar,.tabs,.grid{padding-left:12px;padding-right:12px}
      .hbar{gap:7px;flex-wrap:wrap;padding-top:11px;padding-bottom:11px}
      .brand{font-size:15px;gap:8px} .brand small{display:none} .brand .badge{width:30px;height:30px}
      .gen-btn span,.logout span{display:none}
      .gen-btn,.logout{padding:9px 11px} .hbtn{padding:9px 10px}
      .jobs{left:12px;right:12px;max-width:none}
      .grid{gap:16px;grid-template-columns:1fr}
      .modal{padding:5vh 12px} .modal-box{padding:18px}
    }
  </style></head><body>
  <header>
    <div class="hbar">
      <span class="brand"><span class="badge">${icon("bot","ic")}</span> ${esc(brand.name)}
        <small>Content Bot · ${items.length} piezas · ${esc(user.name)}</small></span>
      <span class="spacer"></span>
      <button class="hbtn" onclick="doPlan()" title="Claude decide y genera una pieza">${icon("wand")}<span>Plan</span></button>
      <button class="hbtn" onclick="doSet()" title="Una pieza de cada formato disponible">${icon("layers")}<span>Set</span></button>
      <button class="hbtn" onclick="openSched()" title="Programación automática">${icon("clock")}<span>Auto</span></button>
      <button class="gen-btn" onclick="openGen()">${icon("spark")}<span>Generar</span></button>
      ${settingsBtn}
      ${logoutBtn}
    </div>
    <div class="tabs" role="tablist">
      ${tabs.map(([k, label, n], i) => `<button class="tab" role="tab" data-filter="${k}" aria-selected="${i === 0 ? "true" : "false"}" onclick="filter(this,'${k}')">${esc(label)} <span class="n">${n}</span></button>`).join("")}
    </div>
  </header>
  <main class="grid" id="grid">${cards || `<div class="empty">${icon("layers","ic")}<div>No hay piezas en la cola.</div><div style="margin-top:6px">Pulsa <b>Generar</b> arriba, o usa <code>npm run plan</code>.</div></div>`}</main>

  <div id="genModal" class="modal" onclick="if(event.target===this)closeGen()">
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="Generar contenido">
      <div class="modal-head">
        <span class="mh-title">${icon("spark")} Generar contenido</span>
        <button class="mh-close" onclick="closeGen()" aria-label="Cerrar">${icon("x")}</button>
      </div>
      <label for="genTopic">Tema o prompt</label>
      <textarea id="genTopic" rows="3" placeholder="Ej: el principal beneficio de tu producto para el cliente"></textarea>
      <div class="modal-row">
        <div><label for="genFormat">Formato</label><select id="genFormat" onchange="onGenFormat()">${fmtOptions}</select></div>
        <div><label for="genPlatform">Plataforma</label><select id="genPlatform">${platOptions}</select></div>
      </div>
      <div class="modal-row" id="genVideoOpts" style="display:none">
        <div><label for="genAspect">Aspecto</label><select id="genAspect">
          <option value="reel">Reel 9:16</option><option value="square">Cuadrado 1:1</option><option value="feed">Feed 4:5</option>
        </select></div>
        <div><label for="genAudio">Audio</label><select id="genAudio">
          <option value="voice_music">Voz + música de fondo</option>
          <option value="voice">Con voz + subtítulos</option>
          <option value="music">Solo música (IA elige de tu biblioteca)</option>
          <option value="silent">Silencioso</option>
        </select></div>
      </div>
      <div id="genMusicRow" style="display:none;margin-top:10px">
        <label for="genMusicUrl">URL de música (opcional)</label>
        <input id="genMusicUrl" type="url" placeholder="Pega el link directo de una pista (mp3/ogg/wav) — si lo dejas vacío, la IA elige/descarga una libre">
      </div>
      <div class="modal-err" id="genErr"></div>
      <div class="modal-actions">
        <button class="btn-ghost" onclick="closeGen()">Cancelar</button>
        <button class="btn-primary" id="genSubmit" onclick="submitGen()">${icon("spark")} Generar</button>
      </div>
    </div>
  </div>
  <div id="editModal" class="modal" onclick="if(event.target===this)closeEdit()">
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="Editar con IA">
      <div class="modal-head">
        <span class="mh-title">${icon("edit")} Editar con IA</span>
        <button class="mh-close" onclick="closeEdit()" aria-label="Cerrar">${icon("x")}</button>
      </div>
      <label for="editPrompt">¿Qué quieres cambiar?</label>
      <textarea id="editPrompt" rows="3" placeholder="Ej: hazlo más corto y directo, añade una pregunta al inicio, tono más divertido, quita emojis, cambia el enfoque a..."></textarea>
      <label class="check"><input type="checkbox" id="editRegen" onchange="onEditRegen()"> <span>También regenerar el visual (imagen/video). Más lento; reemplaza la pieza.</span></label>
      <div class="modal-row" id="editVideoOpts" style="display:none">
        <div><label for="editAspect">Aspecto del video</label><select id="editAspect">
          <option value="reel">Reel 9:16</option><option value="square">Cuadrado 1:1</option><option value="feed">Feed 4:5</option>
        </select></div>
        <div><label for="editAudio">Audio</label><select id="editAudio">
          <option value="voice_music">Voz + música de fondo</option>
          <option value="voice">Con voz + subtítulos</option>
          <option value="music">Solo música (IA elige de tu biblioteca)</option>
          <option value="silent">Silencioso (quitar la música)</option>
        </select></div>
      </div>
      <div id="editMusicRow" style="display:none;margin-top:10px">
        <label for="editMusicUrl">URL de música (opcional)</label>
        <input id="editMusicUrl" type="url" placeholder="Pega el link directo de una pista para usarla de fondo — vacío = la IA elige/descarga una libre">
      </div>
      <div class="modal-err" id="editErr"></div>
      <div class="modal-actions">
        <button class="btn-ghost" onclick="closeEdit()">Cancelar</button>
        <button class="btn-primary" id="editSubmit" onclick="submitEdit()">${icon("spark")} Aplicar cambio</button>
      </div>
    </div>
  </div>
  <div id="schedModal" class="modal" onclick="if(event.target===this)closeSched()">
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="Programación automática">
      <div class="modal-head">
        <span class="mh-title">${icon("clock")} Programación automática</span>
        <button class="mh-close" onclick="closeSched()" aria-label="Cerrar">${icon("x")}</button>
      </div>
      <label class="check"><input type="checkbox" id="schedEnabled"> <span>Generar 1 pieza automáticamente cada día (Claude decide el formato/tema según tu historial; cae a diseño si un proveedor falla).</span></label>
      <div style="margin-top:14px"><label for="schedTime">Hora (Colombia)</label>
        <input type="time" id="schedTime" value="09:00" style="width:auto"></div>
      <div style="margin-top:14px"><label for="schedAgent">Con el agente / cuenta de</label>
        <select id="schedAgent"></select>
        <div style="font-size:12px;color:var(--mut);margin-top:6px;line-height:1.45">La pieza diaria corre con el
        proveedor y las credenciales de ese usuario (los admin pueden elegir a cualquiera).</div></div>
      <div class="modal-err" id="schedErr"></div>
      <div class="modal-actions">
        <button class="btn-ghost" onclick="closeSched()">Cancelar</button>
        <button class="btn-primary" id="schedSave" onclick="saveSched()">${icon("check")} Guardar</button>
      </div>
    </div>
  </div>
  <div id="pubModal" class="modal" onclick="if(event.target===this)closePub()">
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="Publicar">
      <div class="modal-head">
        <span class="mh-title">${icon("send")} Publicar a redes</span>
        <button class="mh-close" onclick="closePub()" aria-label="Cerrar">${icon("x")}</button>
      </div>
      <label>¿En qué redes?</label>
      <div class="nets">${netChecks}</div>
      <div class="pub-warn" id="pubWarn"></div>
      <div class="modal-err" id="pubErr"></div>
      <div class="modal-actions">
        <button class="btn-ghost" onclick="closePub()">Cancelar</button>
        <button class="btn-primary" id="pubSubmit" onclick="submitPub()">${icon("send")} Publicar</button>
      </div>
    </div>
  </div>
  <div id="cfModal" class="modal" onclick="if(event.target===this)closeCf()">
    <div class="modal-box" role="dialog" aria-modal="true" aria-label="Confirmar acción">
      <div class="modal-head">
        <span class="mh-title" id="cfTitle"></span>
        <button class="mh-close" onclick="closeCf()" aria-label="Cerrar">${icon("x")}</button>
      </div>
      <p class="cf-body" id="cfBody"></p>
      <div id="cfNoteWrap" style="display:none">
        <div id="cfChips" class="cf-chips"></div>
        <textarea id="cfNote" rows="3" class="cf-note" placeholder="Ej: el titular no se entiende, la foto no es de nuestro producto, el tono suena a robot…"></textarea>
      </div>
      <div class="modal-actions">
        <button class="btn-ghost" onclick="closeCf()">Cancelar</button>
        <button class="btn-primary" id="cfOk">Confirmar</button>
      </div>
    </div>
  </div>
  <div id="jobs" class="jobs"></div>

  <div id="lb" onclick="this.style.display='none'"><img id="lbimg" alt=""></div>
  <script>
    function filter(btn,f){
      document.querySelectorAll('.tab').forEach(t=>t.setAttribute('aria-selected', t===btn));
      document.querySelectorAll('.card').forEach(c=>{
        c.classList.toggle('hide', f!=='all' && c.dataset.status!==f);
      });
    }
    // ---- Modal de confirmación genérico (todas las acciones piden confirmar antes de ejecutar) ----
    var cfCb=null;
    // o.note = muestra el campo "motivo" (con atajos). El callback recibe su texto.
    function askConfirm(o,cb){
      cfCb=cb;
      document.getElementById('cfTitle').innerHTML=o.title;
      document.getElementById('cfBody').innerHTML=o.body||'';
      var nw=document.getElementById('cfNoteWrap'),nt=document.getElementById('cfNote');
      nt.value='';
      nw.style.display=o.note?'block':'none';
      if(o.note){
        document.getElementById('cfChips').innerHTML=(o.chips||[]).map(function(c){
          return '<button type="button" class="cf-chip" onclick="cfAddChip(this)">'+ce(c)+'</button>';
        }).join('');
      }
      var ok=document.getElementById('cfOk');
      ok.innerHTML=o.ok||'Confirmar';
      ok.className='btn-primary'+(o.danger?' danger':'');
      document.getElementById('cfModal').classList.add('show');
      setTimeout(function(){(o.note?nt:ok).focus()},50);
    }
    // Los atajos se ACUMULAN en el textarea (se pueden marcar varios motivos y matizar a mano).
    function cfAddChip(el){
      var nt=document.getElementById('cfNote'),t=el.textContent;
      if(nt.value.indexOf(t)>=0)return;
      nt.value=(nt.value.trim()?nt.value.trim()+'. ':'')+t;
      el.classList.add('on');nt.focus();
    }
    function closeCf(){document.getElementById('cfModal').classList.remove('show');cfCb=null}
    document.getElementById('cfOk').addEventListener('click',function(){
      var cb=cfCb,note=document.getElementById('cfNote').value;closeCf();if(cb)cb(note);
    });
    function cardLabel(el){var c=el.closest('.card');return c?ce(c.dataset.label||''):''}

    var REJECT_CHIPS=['El titular no se entiende','La imagen no representa la marca','El tono no es el nuestro',
      'Dato incorrecto o inventado','Demasiado texto','Tema poco relevante','El CTA no encaja','Ya publicamos algo así'];
    function askAct(btn,id,status){
      var ok=status==='approved';
      askConfirm({
        title:(ok?CHECK+' Aprobar pieza':XIC+' Rechazar pieza'),
        body:'<b>'+cardLabel(btn)+'</b><br>'+(ok
          ?'Quedará marcada como aprobada y lista para publicar. Si quieres, deja un comentario de qué te gustó — la IA también aprende de los aciertos.'
          :'<b>Cuéntale a la IA qué falló.</b> Ese motivo se guarda y se convierte en una regla que el bot aplicará en las próximas piezas.'),
        ok:ok?'Sí, aprobar':'Sí, rechazar',danger:!ok,
        note:true,chips:ok?['Buen gancho','Imagen muy on-brand','Tono perfecto']:REJECT_CHIPS
      },function(reason){act(btn,id,status,reason)});
    }
    function act(btn,id,status,reason){
      btn.disabled=true;const sib=btn.parentElement.querySelectorAll('button');sib.forEach(b=>b.disabled=true);
      fetch('/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,status,reason:reason||''})})
        .then(r=>{if(r.status===401){location.reload();return}location.reload()})
        .catch(()=>{sib.forEach(b=>b.disabled=false)});
    }
    function slide(b,d){const t=b.parentElement.querySelector('.track');t.scrollBy({left:d*t.clientWidth,behavior:'smooth'})}
    function zoom(s){document.getElementById('lbimg').src=s;document.getElementById('lb').style.display='flex'}
    function dlAll(urls){urls.forEach((u,i)=>setTimeout(()=>{const a=document.createElement('a');a.href=u;a.download='';document.body.appendChild(a);a.click();a.remove()},i*400))}

    var LOADER=${JSON.stringify(icon("loader"))},CHECK=${JSON.stringify(icon("check"))},XIC=${JSON.stringify(icon("x"))},TRASH=${JSON.stringify(icon("trash"))};
    function ce(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
    function onGenFormat(){
      var f=document.getElementById('genFormat').value;
      var v=(f==='motion');var wf=(f.indexOf('workflow:')===0);
      document.getElementById('genVideoOpts').style.display=(v||wf)?'flex':'none';
      document.getElementById('genAudio').parentElement.style.display=wf?'none':'block';
      document.getElementById('genMusicRow').style.display=v?'block':'none';
    }
    function openGen(){document.getElementById('genErr').textContent='';onGenFormat();document.getElementById('genModal').classList.add('show');setTimeout(function(){document.getElementById('genTopic').focus()},50)}
    function closeGen(){document.getElementById('genModal').classList.remove('show')}
    document.addEventListener('keydown',function(e){if(e.key==='Escape'){closeGen();closeEdit();closeSched();closePub();closeCf()}});
    function submitGen(){
      var topic=document.getElementById('genTopic').value.trim();
      var format=document.getElementById('genFormat').value;
      var platform=document.getElementById('genPlatform').value;
      var aspect=document.getElementById('genAspect').value;
      var audio=document.getElementById('genAudio').value;
      var musicUrl=document.getElementById('genMusicUrl').value.trim();
      var err=document.getElementById('genErr'),btn=document.getElementById('genSubmit');
      if(!topic){err.textContent='Escribe un tema.';return}
      if(musicUrl&&!/^https?:\\/\\//.test(musicUrl)){err.textContent='La URL de música debe empezar por http(s)://';return}
      btn.disabled=true;
      fetch('/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({format:format,topic:topic,platform:platform,aspect:aspect,audio:audio,musicUrl:musicUrl})})
        .then(function(r){return r.json().then(function(d){return{ok:r.ok,d:d}})})
        .then(function(x){btn.disabled=false;if(!x.ok){err.textContent=(x.d&&x.d.error)||'Error al generar';return}closeGen();document.getElementById('genTopic').value='';pollJobs()})
        .catch(function(){btn.disabled=false;err.textContent='Error de red'});
    }
    var editId=null,editFmt='';
    function onEditRegen(){
      var isVid=(editFmt==='motion'||editFmt.indexOf('workflow:')===0);
      var show=document.getElementById('editRegen').checked&&isVid;
      document.getElementById('editVideoOpts').style.display=show?'flex':'none';
      document.getElementById('editAudio').parentElement.style.display=(editFmt==='motion')?'block':'none';
      document.getElementById('editMusicRow').style.display=(show&&editFmt==='motion')?'block':'none';
    }
    function copyCap(btn){
      var t=btn.dataset.copy||'';
      var done=function(){var o=btn.innerHTML;btn.innerHTML='${icon("check")} Copiado';btn.disabled=true;setTimeout(function(){btn.innerHTML=o;btn.disabled=false},1500)};
      if(navigator.clipboard&&navigator.clipboard.writeText){
        navigator.clipboard.writeText(t).then(done).catch(function(){fallbackCopy(t);done()});
      }else{fallbackCopy(t);done()}
    }
    function fallbackCopy(t){
      var ta=document.createElement('textarea');ta.value=t;ta.style.position='fixed';ta.style.opacity='0';
      document.body.appendChild(ta);ta.select();try{document.execCommand('copy')}catch(e){}document.body.removeChild(ta);
    }
    function openEdit(btn,id){
      editId=id;editFmt=(btn.closest('.card')||{dataset:{}}).dataset.format||'';
      document.getElementById('editErr').textContent='';document.getElementById('editPrompt').value='';
      document.getElementById('editRegen').checked=false;onEditRegen();
      document.getElementById('editModal').classList.add('show');
      setTimeout(function(){document.getElementById('editPrompt').focus()},50);
    }
    function closeEdit(){document.getElementById('editModal').classList.remove('show')}
    function submitEdit(){
      var prompt=document.getElementById('editPrompt').value.trim();
      var regen=document.getElementById('editRegen').checked;
      var musicUrl=document.getElementById('editMusicUrl').value.trim();
      var err=document.getElementById('editErr'),btn=document.getElementById('editSubmit');
      if(!prompt){err.textContent='Escribe qué cambiar.';return}
      if(regen&&musicUrl&&!/^https?:\\/\\//.test(musicUrl)){err.textContent='La URL de música debe empezar por http(s)://';return}
      btn.disabled=true;
      fetch('/edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:editId,prompt:prompt,regen:regen,aspect:document.getElementById('editAspect').value,audio:document.getElementById('editAudio').value,musicUrl:musicUrl})})
        .then(function(r){return r.json().then(function(d){return{ok:r.ok,d:d}})})
        .then(function(x){btn.disabled=false;if(!x.ok){err.textContent=(x.d&&x.d.error)||'Error al editar';return}closeEdit();pollJobs()})
        .catch(function(){btn.disabled=false;err.textContent='Error de red'});
    }
    function openSched(){document.getElementById('schedErr').textContent='';fetch('/schedule').then(function(r){return r.json()}).then(function(s){
      document.getElementById('schedEnabled').checked=!!s.enabled;document.getElementById('schedTime').value=s.time||'09:00';
      var sel=document.getElementById('schedAgent');
      sel.innerHTML=(s.users||[]).map(function(u){return '<option value="'+u.id+'">'+ce(u.name)+'</option>'}).join('');
      if(s.userId)sel.value=s.userId;
      document.getElementById('schedModal').classList.add('show');
    }).catch(function(){})}
    function closeSched(){document.getElementById('schedModal').classList.remove('show')}
    function saveSched(){var enabled=document.getElementById('schedEnabled').checked;var time=document.getElementById('schedTime').value||'09:00';var btn=document.getElementById('schedSave');btn.disabled=true;fetch('/schedule',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:enabled,time:time,userId:document.getElementById('schedAgent').value})}).then(function(r){btn.disabled=false;if(r.ok){closeSched()}else{document.getElementById('schedErr').textContent='No se pudo guardar'}}).catch(function(){btn.disabled=false;document.getElementById('schedErr').textContent='Error de red'})}
    var pubId=null;
    function openPub(btn,id){
      pubId=id;document.getElementById('pubErr').textContent='';
      document.querySelectorAll('#pubModal .netopt input:not([disabled])').forEach(function(c){c.checked=true});
      var card=btn.closest('.card'),st=card?card.dataset.status:'',warn=document.getElementById('pubWarn');
      if(st==='pending'){warn.innerHTML='Esta pieza aún está <b>pendiente</b> (sin aprobar). Si publicas, saldrá tal cual está.';warn.classList.add('show')}
      else if(st==='rejected'){warn.innerHTML='Esta pieza está <b>rechazada</b> — apruébala (o edítala) antes de publicar.';warn.classList.add('show')}
      else{warn.classList.remove('show')}
      document.getElementById('pubSubmit').disabled=(st==='rejected');
      document.getElementById('pubModal').classList.add('show');
    }
    function closePub(){document.getElementById('pubModal').classList.remove('show')}
    function submitPub(){
      var nets=[];document.querySelectorAll('#pubModal .netopt input:checked').forEach(function(c){nets.push(c.value)});
      var err=document.getElementById('pubErr'),btn=document.getElementById('pubSubmit');
      if(!nets.length){err.textContent='Elige al menos una red (las grises necesitan configurar su token).';return}
      btn.disabled=true;
      fetch('/publish',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:pubId,networks:nets})})
        .then(function(r){return r.json().then(function(d){return{ok:r.ok,d:d}})})
        .then(function(x){btn.disabled=false;if(!x.ok){err.textContent=(x.d&&x.d.error)||'Error al publicar';return}closePub();pollJobs()})
        .catch(function(){btn.disabled=false;err.textContent='Error de red'});
    }
    function doPlan(){
      askConfirm({
        title:'Plan con IA',
        body:'La IA revisará tu historial (formatos, temas, aprobados y rechazados) y decidirá <b>qué pieza generar hoy</b>. Se usará tu agente configurado y puede tardar varios minutos.',
        ok:'Generar plan'
      },function(){fetch('/plan',{method:'POST'}).then(function(){pollJobs()}).catch(function(){})});
    }
    function doSet(){
      askConfirm({
        title:'Set completo',
        body:'Se generará <b>una pieza de cada formato disponible</b> con tu agente. Es la acción más pesada (varios minutos y consumo de APIs de imagen/voz).',
        ok:'Generar set'
      },function(){fetch('/set',{method:'POST'}).then(function(){pollJobs()}).catch(function(){})});
    }
    function askDelete(btn,id){
      askConfirm({
        title:TRASH+' Eliminar pieza',
        body:'<b>'+cardLabel(btn)+'</b><br>Se eliminará la pieza de la cola y <b>todos sus archivos</b> (imágenes, video, voz). No se puede deshacer.',
        ok:'Eliminar definitivamente',danger:true
      },function(){doDelete(id)});
    }
    function doDelete(id){
      fetch('/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id})})
        .then(function(r){if(r.ok){location.reload()}else{r.json().then(function(d){alert((d&&d.error)||'No se pudo eliminar')})}})
        .catch(function(){alert('Error de red')});
    }
    var jobsSeen={};
    function dismissJob(id){
      fetch('/jobs/dismiss',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id})})
        .then(function(){pollJobs()}).catch(function(){});
    }
    function pollJobs(){
      fetch('/jobs').then(function(r){return r.json()}).then(function(list){
        var box=document.getElementById('jobs');
        box.innerHTML=list.slice(0,5).map(function(j){
          var cls=j.status==='running'?'run':(j.status==='done'?'done':'error');
          var ic=j.status==='running'?LOADER:(j.status==='done'?CHECK:XIC);
          var s=j.status==='running'?(Math.round(j.ms/1000)+'s'):(j.status==='done'?'Listo':'Error');
          var errLine=(j.status==='error'&&j.error)?'<div class="jerr">'+ce(String(j.error).slice(0,220))+'</div>':'';
          var xTitle=j.status==='running'?'Ocultar (la generación sigue en el servidor)':'Descartar';
          return '<div class="job '+cls+'"><span class="js">'+ic+'</span><div class="jb"><span class="jt">'+(j.user?ce(j.user)+' · ':'')+ce(j.format)+' · '+ce(j.topic)+'</span>'+errLine+'</div><b>'+s+'</b><button class="jx" title="'+xTitle+'" onclick="dismissJob(\\''+j.id+'\\')">'+XIC+'</button></div>';
        }).join('');
        var doneNow=list.some(function(j){var was=jobsSeen[j.id];jobsSeen[j.id]=j.status;return was==='running'&&j.status==='done'});
        if(doneNow){setTimeout(function(){location.reload()},900);return}
        if(list.some(function(j){return j.status==='running'})){setTimeout(pollJobs,2500)}
      }).catch(function(){});
    }
    pollJobs();
    if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(function(){})}
  </script></body></html>`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  // ---- PWA (público: manifest, iconos, service worker) ----
  if (url.pathname === "/manifest.webmanifest") {
    res.writeHead(200, { "Content-Type": "application/manifest+json; charset=utf-8" }).end(MANIFEST);
    return;
  }
  if (url.pathname === "/sw.js") {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-cache" }).end(SW_JS);
    return;
  }
  if (url.pathname === "/icon-192.png" || url.pathname === "/icon-512.png") {
    const size = url.pathname.includes("512") ? 512 : 192;
    iconPng(size)
      .then((buf) => res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" }).end(buf))
      .catch((e) => res.writeHead(500).end(String(e?.message ?? e)));
    return;
  }

  // ---- Setup del primer admin (solo cuando NO hay usuarios) ----
  if (req.method === "POST" && url.pathname === "/setup") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (hasUsers()) { res.writeHead(302, { Location: "/" }).end(); return; }
      const form = new URLSearchParams(body);
      const code = form.get("code") ?? "";
      if (SETUP_CODE && code !== SETUP_CODE) {
        res.writeHead(401, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(authPage("setup", "Código de instalación incorrecto."));
        return;
      }
      try {
        const user = createUser(form.get("name") ?? "", form.get("password") ?? "", "admin");
        const sid = createSession(user.id);
        res.writeHead(302, {
          "Set-Cookie": `sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`,
          Location: "/settings",
        }).end();
      } catch (e: any) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(authPage("setup", String(e?.message ?? e)));
      }
    });
    return;
  }

  // ---- Login / logout (públicos) ----
  if (req.method === "POST" && url.pathname === "/login") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const ip = String(req.headers["cf-connecting-ip"] ?? req.socket.remoteAddress ?? "?");
      if (!loginAllowed(ip)) {
        res.writeHead(429, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(authPage("login", "Demasiados intentos. Espera 1 minuto."));
        return;
      }
      const form = new URLSearchParams(body);
      const user = verifyLogin(form.get("name") ?? "", form.get("password") ?? "");
      if (user) {
        loginFails.delete(ip);
        audit(user.name, "inició sesión", `ip ${ip}`);
        const sid = createSession(user.id);
        res.writeHead(302, {
          "Set-Cookie": `sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`,
          Location: "/",
        }).end();
      } else {
        loginFailed(ip);
        audit("(desconocido)", "login fallido", `usuario "${String(form.get("name") ?? "").slice(0, 40)}" · ip ${ip}`);
        res.writeHead(401, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(authPage("login", "Usuario o contraseña incorrectos."));
      }
    });
    return;
  }
  if (url.pathname === "/logout") {
    const sid = parseCookies(req).sid;
    if (sid) { sessions.delete(sid); saveSessions(); }
    res.writeHead(302, { "Set-Cookie": "sid=; HttpOnly; Path=/; Max-Age=0", Location: "/" }).end();
    return;
  }

  // ---- A partir de aquí, requiere sesión de usuario ----
  const user = sessionUser(req);
  if (!user) {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "")) {
      const mode = hasUsers() ? "login" : "setup";
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(authPage(mode));
    } else {
      res.writeHead(401).end("no autorizado");
    }
    return;
  }
  const isAdmin = user.role === "admin";

  if (req.method === "POST" && url.pathname === "/action") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { id, status, reason } = JSON.parse(body);
        if (!STATUSES.includes(status)) { res.writeHead(400).end(JSON.stringify({ error: "estado inválido" })); return; }
        const feedback = typeof reason === "string" ? reason.trim().slice(0, 1000) : "";
        const updated = await updateStatus(id, status, { feedback, by: user.name });
        if (updated) {
          audit(user.name, status === "approved" ? "aprobó pieza" : status === "rejected" ? "rechazó pieza" : `estado → ${status}`,
            feedback ? `${id} · motivo: ${feedback.slice(0, 200)}` : id);
          // El bot aprende: destila las razones en reglas permanentes (config/learnings.md).
          // En segundo plano — la respuesta al panel no espera al LLM.
          if (feedback) {
            refreshLearnings()
              .then((fixes) => {
                // Si la IA corrigió datos del contexto (permiso AI_EDIT_CONTEXT), queda registrado.
                for (const f of fixes) audit("IA (aprendizaje)", "corrigió contexto", `${f.path} · ${f.why}`);
              })
              .catch((e) => console.error("[learnings]", e?.message ?? e));
          }
        }
        res.writeHead(updated ? 200 : 404).end(JSON.stringify({ ok: !!updated }));
      } catch { res.writeHead(400).end(); }
    });
    return;
  }

  // ---- Ajustes: página + APIs (perfil de agente, login de Claude, contexto, usuarios) ----
  if (req.method === "GET" && url.pathname === "/settings") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" })
      .end(settingsPage({ id: user.id, name: user.name, role: user.role }, await ptySupported()));
    return;
  }
  if (url.pathname === "/api/profile" && req.method === "GET") {
    sendJson(res, 200, profileSummary(user.id));
    return;
  }
  if (url.pathname === "/api/profile" && req.method === "POST") {
    try {
      const b = await jsonBody(req);
      updateAgentProfile(user.id, {
        copyProvider: b.copyProvider, copyModel: b.copyModel, copyVision: b.copyVision,
        isolateCli: b.isolateCli, extraEnv: b.extraEnv,
      });
      audit(user.name, "agente actualizado", `${b.copyProvider || "(default servidor)"}${b.copyModel ? " · " + b.copyModel : ""}`);
      sendJson(res, 200, profileSummary(user.id));
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/api/profile/secret" && req.method === "POST") {
    try {
      const b = await jsonBody(req);
      setSecret(user.id, String(b.key ?? ""), String(b.value ?? ""));
      audit(user.name, "credencial guardada", String(b.key ?? ""));
      sendJson(res, 200, { ok: true });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/api/profile/secret/delete" && req.method === "POST") {
    try {
      const b = await jsonBody(req);
      clearSecret(user.id, String(b.key ?? ""));
      audit(user.name, "credencial borrada", String(b.key ?? ""));
      sendJson(res, 200, { ok: true });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/api/profile/test" && req.method === "POST") {
    // Prueba el agente del usuario con una pregunta mínima (timeout corto).
    try {
      const reply = await Promise.race([
        runWithProfile(activeProfileFor(user), () => askLLM("Responde únicamente con la palabra OK")),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout de 90s")), 90_000)),
      ]);
      sendJson(res, 200, { ok: true, reply: String(reply).slice(0, 120) });
    } catch (e: any) { sendJson(res, 200, { ok: false, error: String(e?.message ?? e) }); }
    return;
  }

  if (url.pathname === "/api/profile/models" && req.method === "POST") {
    // Lista modelos del proveedor elegido: en vivo si hay API + credenciales, si no estáticos.
    try {
      const b = await jsonBody(req);
      sendJson(res, 200, await listModels(user.id, String(b.provider ?? "")));
    } catch (e: any) { sendJson(res, 200, { models: [], source: "static", error: String(e?.message ?? e) }); }
    return;
  }

  // Wizard de login de Claude Code (setup-token vía pty).
  if (url.pathname === "/api/claude-login/start" && req.method === "POST") {
    const r = await startLogin(user.id, (token) => {
      setSecret(user.id, "CLAUDE_CODE_OAUTH_TOKEN", token);
      audit(user.name, "Claude Code conectado", "token de setup-token guardado");
    });
    sendJson(res, r.ok ? 200 : 400, r);
    return;
  }
  if (url.pathname === "/api/claude-login/status" && req.method === "GET") {
    sendJson(res, 200, loginStatus(user.id));
    return;
  }
  if (url.pathname === "/api/claude-login/code" && req.method === "POST") {
    try {
      const b = await jsonBody(req);
      const r = submitCode(user.id, String(b.code ?? ""));
      sendJson(res, r.ok ? 200 : 400, r);
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/api/claude-login/cancel" && req.method === "POST") {
    cancelLogin(user.id);
    sendJson(res, 200, { ok: true });
    return;
  }

  // Contexto de empresa (solo admin).
  if (url.pathname === "/api/context/files" && req.method === "GET") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    sendJson(res, 200, listContextFiles());
    return;
  }
  if (url.pathname === "/api/context/file" && req.method === "GET") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const content = readContextFile(url.searchParams.get("path") ?? "");
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end(content);
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/api/context/file" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req);
      writeContextFile(String(b.path ?? ""), String(b.content ?? ""));
      audit(user.name, "contexto editado", String(b.path ?? ""));
      sendJson(res, 200, { ok: true });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/api/context/create" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req);
      createContextFile(String(b.path ?? ""));
      audit(user.name, "contexto creado", String(b.path ?? ""));
      sendJson(res, 200, { ok: true });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/api/context/delete" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req);
      deleteContextFile(String(b.path ?? ""));
      audit(user.name, "contexto eliminado", String(b.path ?? ""));
      sendJson(res, 200, { ok: true });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }

  // Identidad de marca + paleta de colores (solo admin).
  if (url.pathname === "/api/brand/identity" && req.method === "GET") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    sendJson(res, 200, readBrandIdentity());
    return;
  }
  if (url.pathname === "/api/brand/identity" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req);
      saveBrandIdentity({
        name: b.name, tagline: b.tagline, website: b.website, industry: b.industry, language: b.language,
        colors: b.colors && typeof b.colors === "object" ? b.colors : undefined,
      });
      audit(user.name, "identidad de marca", "nombre/colores actualizados");
      sendJson(res, 200, { ok: true });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }

  // Logos / assets de marca (solo admin).
  if (url.pathname === "/api/brand/assets" && req.method === "GET") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    sendJson(res, 200, listBrandAssets());
    return;
  }
  if (url.pathname === "/api/brand/file" && req.method === "GET") {
    if (!isAdmin) { res.writeHead(403).end(); return; }
    try {
      const { buffer, mime } = readBrandAsset(url.searchParams.get("name") ?? "");
      res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-cache" }).end(buffer);
    } catch { res.writeHead(404).end("not found"); }
    return;
  }
  if (url.pathname === "/api/brand/upload" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req, 6 * 1024 * 1024); // logo hasta 3 MB (base64 ≈ ×1.37)
      saveBrandAsset(String(b.name ?? ""), String(b.dataBase64 ?? ""));
      if (b.setAsLogo) setBrandLogo(String(b.name));
      audit(user.name, "logo subido", `${String(b.name ?? "")}${b.setAsLogo ? " (principal)" : ""}`);
      sendJson(res, 200, { ok: true });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/api/brand/logo" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req);
      setBrandLogo(String(b.name ?? ""));
      audit(user.name, "logo principal", String(b.name ?? ""));
      sendJson(res, 200, { ok: true });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }

  // Biblioteca de música (solo admin): pistas libres que la IA asigna a los videos.
  if (url.pathname === "/api/music/list" && req.method === "GET") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    sendJson(res, 200, listMusic());
    return;
  }
  if (url.pathname === "/api/music/upload" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req, 22 * 1024 * 1024); // pista hasta 15 MB (base64 ≈ ×1.37)
      saveMusic(String(b.name ?? ""), String(b.dataBase64 ?? ""));
      audit(user.name, "música subida", String(b.name ?? ""));
      sendJson(res, 200, { ok: true });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/api/music/delete" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req);
      deleteMusic(String(b.name ?? ""));
      audit(user.name, "música eliminada", String(b.name ?? ""));
      sendJson(res, 200, { ok: true });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }

  // Referencias de estilo de marca (solo admin): anclan la identidad de los posts de marca premium.
  if (url.pathname === "/api/references" && req.method === "GET") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    sendJson(res, 200, listBrandReferences());
    return;
  }
  if (url.pathname === "/api/references/file" && req.method === "GET") {
    if (!isAdmin) { res.writeHead(403).end(); return; }
    try {
      const { buffer, mime } = readBrandReference(url.searchParams.get("name") ?? "");
      res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-cache" }).end(buffer);
    } catch { res.writeHead(404).end("not found"); }
    return;
  }
  if (url.pathname === "/api/references/upload" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req, 9 * 1024 * 1024); // referencia hasta 6 MB (base64 ≈ ×1.37)
      saveBrandReference(String(b.name ?? ""), String(b.dataBase64 ?? ""));
      audit(user.name, "referencia de marca subida", String(b.name ?? ""));
      sendJson(res, 200, { ok: true });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/api/references/delete" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req);
      deleteBrandReference(String(b.name ?? ""));
      audit(user.name, "referencia de marca eliminada", String(b.name ?? ""));
      sendJson(res, 200, { ok: true });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }

  // Fotos de producto (solo admin): platos/productos reales que el modelo usa como protagonistas.
  if (url.pathname === "/api/products" && req.method === "GET") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    sendJson(res, 200, listBrandProducts());
    return;
  }
  if (url.pathname === "/api/products/file" && req.method === "GET") {
    if (!isAdmin) { res.writeHead(403).end(); return; }
    try {
      const { buffer, mime } = readBrandProduct(url.searchParams.get("name") ?? "");
      res.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-cache" }).end(buffer);
    } catch { res.writeHead(404).end("not found"); }
    return;
  }
  if (url.pathname === "/api/products/upload" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req, 9 * 1024 * 1024);
      saveBrandProduct(String(b.name ?? ""), String(b.dataBase64 ?? ""));
      audit(user.name, "foto de producto subida", String(b.name ?? ""));
      sendJson(res, 200, { ok: true });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/api/products/delete" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req);
      deleteBrandProduct(String(b.name ?? ""));
      audit(user.name, "foto de producto eliminada", String(b.name ?? ""));
      sendJson(res, 200, { ok: true });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }

  // Estilos de diseño (solo admin): prompt de dirección de arte personalizable.
  if (url.pathname === "/api/style" && req.method === "GET") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    sendJson(res, 200, { override: readStyleOverride(), default: defaultArtDirection() });
    return;
  }
  if (url.pathname === "/api/style" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req);
      saveStyleOverride(String(b.content ?? ""));
      audit(user.name, "estilos de diseño", String(b.content ?? "").trim() ? "personalizados" : "restaurados al default");
      sendJson(res, 200, { ok: true });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }

  // Skills de la IA (solo admin): activar/desactivar, subir propias, eliminar.
  if (url.pathname === "/api/skills" && req.method === "GET") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    sendJson(res, 200, listInstalledSkills());
    return;
  }
  if (url.pathname === "/api/skills/toggle" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req);
      setSkillEnabled(String(b.dir ?? ""), !!b.enabled);
      audit(user.name, "skill " + (b.enabled ? "activada" : "desactivada"), String(b.dir ?? ""));
      sendJson(res, 200, { ok: true });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/api/skills/upload" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req, 1024 * 1024);
      uploadSkill(String(b.slug ?? ""), String(b.content ?? ""));
      audit(user.name, "skill subida", String(b.slug ?? ""));
      sendJson(res, 200, { ok: true });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/api/skills/delete" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req);
      deleteSkill(String(b.dir ?? ""));
      audit(user.name, "skill eliminada", String(b.dir ?? ""));
      sendJson(res, 200, { ok: true });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }

  // Aprendizaje (solo admin): las reglas que el bot destiló de los motivos de rechazo.
  // Se pueden editar a mano y forzar una nueva destilación.
  if (url.pathname === "/api/learnings" && req.method === "GET") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    sendJson(res, 200, { rules: loadLearnings() });
    return;
  }
  if (url.pathname === "/api/learnings" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req, 64 * 1024);
      saveLearnings(String(b.rules ?? ""));
      audit(user.name, "editó reglas aprendidas", "");
      sendJson(res, 200, { ok: true });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/api/learnings/refresh" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      await refreshLearnings();
      audit(user.name, "regeneró reglas aprendidas", "");
      sendJson(res, 200, { rules: loadLearnings() });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }
  // Bucle de rendimiento: mide (o re-mide) las piezas publicadas y devuelve cuántas actualizó.
  if (url.pathname === "/api/insights/refresh" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const { refreshInsights } = await import("../lib/performance.js");
      const n = await refreshInsights();
      audit(user.name, "actualizó métricas de rendimiento", `${n} pieza(s)`);
      sendJson(res, 200, { updated: n });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }

  // Conexiones de empresa (solo admin): tokens de redes sociales y keys de proveedores.
  // Write-only: nunca se devuelven valores, solo si están configuradas y su origen.
  if (url.pathname === "/api/social" && req.method === "GET") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    sendJson(res, 200, listCompanySecrets());
    return;
  }

  // Ajustes no-secretos (solo admin): IMAGE_PROVIDER, etc.
  if (url.pathname === "/api/settings" && req.method === "GET") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    sendJson(res, 200, listAppSettings());
    return;
  }
  if (url.pathname === "/api/settings" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req);
      setAppSetting(String(b.key ?? ""), String(b.value ?? ""));
      audit(user.name, "ajuste", `${String(b.key ?? "")} = ${String(b.value ?? "")}`);
      sendJson(res, 200, { ok: true });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/api/social" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req);
      setCompanySecret(String(b.key ?? ""), String(b.value ?? ""));
      audit(user.name, "credencial de empresa guardada", String(b.key ?? "")); // solo el NOMBRE, jamás el valor
      sendJson(res, 200, { ok: true });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/api/social/delete" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req);
      deleteCompanySecret(String(b.key ?? ""));
      audit(user.name, "credencial de empresa eliminada", String(b.key ?? ""));
      sendJson(res, 200, { ok: true });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }

  // ---- Ads / Campañas de Meta (solo admin) ----
  if (url.pathname === "/api/ads/pieces" && req.method === "GET") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    const q = await listQueue();
    const pieces = q
      .filter((p: any) => (p.assets?.image || p.assets?.images?.[0]) && p.status !== "rejected")
      .map((p: any) => ({ id: p.id, label: (p.caption ?? p.topic ?? p.id).split("\n")[0].slice(0, 70), format: p.format, status: p.status }));
    sendJson(res, 200, pieces);
    return;
  }
  if (url.pathname === "/api/ads/status" && req.method === "GET") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    const ready = adsReady();
    let account: any = null;
    if (ready) { try { account = await accountInfo(); } catch (e: any) { account = { error: String(e?.message ?? e) }; } }
    sendJson(res, 200, { ready, account, campaigns: listAdCampaigns() });
    return;
  }
  if (url.pathname === "/api/ads/propose" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req);
      const ids: string[] = Array.isArray(b.pieceIds) ? b.pieceIds.map(String) : [];
      const q = await listQueue();
      const pieces = ids.map((id) => q.find((i) => i.id === id)).filter(Boolean)
        .map((p: any) => ({ id: p.id, caption: p.caption ?? "", image: p.assets?.image ?? p.assets?.images?.[0] ?? "", format: p.format }))
        .filter((p) => p.image);
      if (!pieces.length) { sendJson(res, 400, { error: "Elige al menos una pieza con imagen (los videos aún no se promocionan)" }); return; }
      const plan = await runWithProfile(activeProfileFor(user), () =>
        proposeAdCampaign({ pieces, objective: b.objective as Objective, goalText: b.goalText ? String(b.goalText) : undefined }));
      audit(user.name, "ads: propuesta", `${plan.name} · ${pieces.length} pieza(s)`);
      sendJson(res, 200, plan);
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/api/ads/launch" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req, 4 * 1024 * 1024);
      const plan = b.plan as AdCampaignPlan;
      const status = b.status === "ACTIVE" ? "ACTIVE" : "PAUSED";
      if (!plan || !Array.isArray(plan.ads) || !plan.ads.length) { sendJson(res, 400, { error: "Plan inválido" }); return; }
      const r = await launchCampaign(plan, { status });
      addAdCampaign({
        campaignId: r.campaignId, adsetId: r.adsetId, adIds: r.adIds, name: plan.name, objective: plan.objective,
        status, dailyBudget: plan.dailyBudget, createdAt: new Date().toISOString(), createdBy: user.name,
        pieceIds: plan.ads.map((a) => a.pieceId ?? "").filter(Boolean),
      });
      audit(user.name, "ads: campaña creada", `${plan.name} (${status}) · ${r.adIds.length} anuncio(s)`);
      sendJson(res, 200, { ok: true, ...r });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/api/ads/optimize" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req);
      const r = await optimizeCampaign(String(b.campaignId ?? ""), !!b.apply);
      audit(user.name, "ads: optimizar", `${String(b.campaignId ?? "")}${b.apply ? " (aplicado)" : " (sugerencias)"}`);
      sendJson(res, 200, r);
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/api/ads/toggle" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req);
      const status = b.status === "ACTIVE" ? "ACTIVE" : "PAUSED";
      await updateObject(String(b.campaignId ?? ""), { status });
      updateAdCampaignStatus(String(b.campaignId ?? ""), status);
      audit(user.name, "ads: " + (status === "ACTIVE" ? "activar" : "pausar") + " campaña", String(b.campaignId ?? ""));
      sendJson(res, 200, { ok: true });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }

  // Workflows de contenido personalizables (lista para todos; edición solo admin).
  if (url.pathname === "/api/workflows" && req.method === "GET") {
    sendJson(res, 200, { workflows: listWorkflows(), template: isAdmin ? workflowTemplate() : undefined });
    return;
  }
  if (url.pathname === "/api/workflows/get" && req.method === "GET") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const def = readWorkflow(String(url.searchParams.get("name") ?? ""));
      sendJson(res, 200, { name: def.name, content: JSON.stringify(def, null, 2) });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/api/workflows/save" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req, 256 * 1024);
      saveWorkflow(String(b.name ?? ""), String(b.content ?? ""));
      audit(user.name, "workflow guardado", String(b.name ?? ""));
      sendJson(res, 200, { ok: true });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/api/workflows/delete" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req);
      deleteWorkflow(String(b.name ?? ""));
      audit(user.name, "workflow eliminado", String(b.name ?? ""));
      sendJson(res, 200, { ok: true });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }

  // Usuarios del panel (solo admin).
  if (url.pathname === "/api/users" && req.method === "GET") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    sendJson(res, 200, listUsers());
    return;
  }
  if (url.pathname === "/api/users" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req);
      const role = b.role === "admin" ? "admin" : "member";
      const u = createUser(String(b.name ?? ""), String(b.password ?? ""), role);
      audit(user.name, "usuario creado", `${u.name} (${role})`);
      sendJson(res, 200, { ok: true, id: u.id });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/api/users/delete" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req);
      const target = getUserById(String(b.id ?? ""));
      deleteUser(String(b.id ?? ""));
      audit(user.name, "usuario eliminado", target?.name ?? String(b.id ?? ""));
      sendJson(res, 200, { ok: true });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }
  if (url.pathname === "/api/users/password" && req.method === "POST") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    try {
      const b = await jsonBody(req);
      setPassword(String(b.id ?? ""), String(b.password ?? ""));
      audit(user.name, "contraseña cambiada", getUserById(String(b.id ?? ""))?.name ?? "");
      sendJson(res, 200, { ok: true });
    } catch (e: any) { sendJson(res, 400, { error: String(e?.message ?? e) }); }
    return;
  }

  // ---- Generación manual: lanzar job ----
  if (req.method === "POST" && url.pathname === "/generate") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { format, topic, platform, aspect, audio, musicUrl } = JSON.parse(body);
        const t = String(topic ?? "").trim();
        if (!t) { res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Falta el tema" })); return; }
        const isWf = typeof format === "string" && format.startsWith("workflow:");
        if (isWf) {
          const wfName = format.slice("workflow:".length);
          if (!listWorkflows().some((w) => w.name === wfName)) { res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Ese workflow no existe" })); return; }
        } else if (!availableFormats().includes(format)) { res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Formato no disponible" })); return; }
        const aspOk = ["reel", "square", "feed"].includes(aspect) ? aspect : undefined;
        const audOk = ["voice", "voice_music", "music", "silent"].includes(audio) ? audio : undefined;
        const mUrl = typeof musicUrl === "string" && /^https?:\/\//.test(musicUrl.trim()) ? musicUrl.trim().slice(0, 500) : undefined;
        const job = startJob(user, format as Format, t, typeof platform === "string" && platform ? platform : undefined, { aspect: aspOk, audio: audOk, musicUrl: mUrl });
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jobId: job.id }));
      } catch { res.writeHead(400).end(); }
    });
    return;
  }
  // ---- Programación automática (leer / guardar) ----
  if (req.method === "GET" && url.pathname === "/schedule") {
    // Dueño del cron visible en el modal; los admin pueden reasignarlo a cualquier usuario.
    const sched = readSched();
    const owner = sched.userId ? getUserById(sched.userId) : null;
    const users = isAdmin
      ? listUsers().map((u) => ({ id: u.id, name: u.name }))
      : [{ id: user.id, name: `${user.name} (tú)` }];
    res.writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ ...sched, ownerName: owner?.name ?? null, users }));
    return;
  }
  if (req.method === "POST" && url.pathname === "/schedule") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { enabled, time, userId } = JSON.parse(body);
        const t = /^\d{1,2}:\d{2}$/.test(String(time)) ? String(time).padStart(5, "0") : "09:00";
        const prev = readSched();
        // Dueño del cron = con el agente de QUIÉN corre la pieza diaria. Los member solo
        // pueden asignarse a sí mismos; los admin a cualquier usuario existente.
        let owner = user.id;
        if (isAdmin && typeof userId === "string" && getUserById(userId)) owner = userId;
        writeSched({ enabled: !!enabled, time: t, lastRun: prev.lastRun, userId: owner });
        audit(user.name, "programación automática", `${enabled ? "ON" : "OFF"} · ${t} · agente de ${getUserById(owner)?.name ?? "?"}`);
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
      } catch { res.writeHead(400).end(); }
    });
    return;
  }

  // ---- Plan / Set manuales ----
  if (req.method === "POST" && url.pathname === "/plan") {
    const job = startPlanJob(user);
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jobId: job.id }));
    return;
  }
  if (req.method === "POST" && url.pathname === "/set") {
    const n = startSet(user);
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ started: n }));
    return;
  }

  // ---- Publicar a redes ----
  if (req.method === "POST" && url.pathname === "/publish") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { id, networks } = JSON.parse(body);
        const nets: Network[] = Array.isArray(networks) ? networks.filter((n: any) => NETWORKS.includes(n)) : [];
        if (!nets.length) { res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Elige al menos una red" })); return; }
        const item = (await listQueue()).find((i) => i.id === id);
        if (!item) { res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Pieza no encontrada" })); return; }
        if (item.status === "rejected") {
          res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "La pieza está RECHAZADA; apruébala (o edítala) antes de publicar" }));
          return;
        }
        const job = startPublishJob(user, item, nets);
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jobId: job.id }));
      } catch { res.writeHead(400).end(); }
    });
    return;
  }

  // ---- Eliminar pieza (borra de la cola + assets de R2/local) ----
  if (req.method === "POST" && url.pathname === "/delete") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { id } = JSON.parse(body);
        const item = (await listQueue()).find((i) => i.id === id);
        if (!item) { res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Pieza no encontrada" })); return; }
        await deleteAssets(item);
        await deleteItem(id);
        audit(user.name, "eliminó pieza", `${id} (${item.format})`);
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
      } catch (e: any) { res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: String(e?.message ?? e) })); }
    });
    return;
  }

  // ---- Editar el copy de una pieza con IA ----
  if (req.method === "POST" && url.pathname === "/edit") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { id, prompt, regen, aspect, audio, musicUrl } = JSON.parse(body);
        const p = String(prompt ?? "").trim();
        if (!p) { res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Falta la instrucción" })); return; }
        const item = (await listQueue()).find((i) => i.id === id);
        if (!item) { res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Pieza no encontrada" })); return; }
        const aspOk = ["reel", "square", "feed"].includes(aspect) ? aspect : undefined;
        const audOk = ["voice", "voice_music", "music", "silent"].includes(audio) ? audio : undefined;
        const mUrl = typeof musicUrl === "string" && /^https?:\/\//.test(musicUrl.trim()) ? musicUrl.trim().slice(0, 500) : undefined;
        const job = regen ? startRegenJob(user, item, p, { aspect: aspOk, audio: audOk, musicUrl: mUrl }) : startEditJob(user, item, p);
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jobId: job.id }));
      } catch { res.writeHead(400).end(); }
    });
    return;
  }

  // ---- Actividad / auditoría (solo admin) ----
  if (url.pathname === "/api/audit" && req.method === "GET") {
    if (!isAdmin) { sendJson(res, 403, { error: "Solo admin" }); return; }
    sendJson(res, 200, readAudit(200));
    return;
  }

  // ---- Descartar una tarjeta de job (la X del panel) ----
  if (url.pathname === "/jobs/dismiss" && req.method === "POST") {
    try {
      const b = await jsonBody(req);
      const i = jobs.findIndex((j) => j.id === String(b.id ?? ""));
      if (i >= 0) jobs.splice(i, 1);
      sendJson(res, 200, { ok: true });
    } catch (e: any) {
      sendJson(res, 400, { error: String(e?.message ?? e) });
    }
    return;
  }

  // ---- Estado de los jobs (polling) ----
  if (req.method === "GET" && url.pathname === "/jobs") {
    const out = jobs.map((j) => ({ id: j.id, format: j.format, topic: j.topic, status: j.status, error: j.error, user: j.user, ms: Date.now() - j.started }));
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(out));
    return;
  }

  // ---- Proxy privado de assets en R2 (autenticado) ----
  if (url.pathname.startsWith("/r2/")) {
    const key = url.pathname.slice("/r2/".length).split("/").map(decodeURIComponent).join("/");
    try {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const obj = await (await s3()).send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
      const headers: Record<string, string> = {
        "Content-Type": obj.ContentType || MIME[extname(key)] || "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      };
      if (url.searchParams.has("dl")) headers["Content-Disposition"] = `attachment; filename="${basename(key)}"`;
      res.writeHead(200, headers);
      (obj.Body as NodeJS.ReadableStream).pipe(res);
    } catch { res.writeHead(404).end("not found"); }
    return;
  }

  const isDownload = url.pathname.startsWith("/download/");
  if (url.pathname.startsWith("/media/") || isDownload) {
    const prefix = isDownload ? "/download/" : "/media/";
    const r = decodeURIComponent(url.pathname.slice(prefix.length));
    const filePath = normalize(join(OUTPUT, r));
    // startsWith con separador: sin él, un directorio hermano "output-x" pasaría el filtro.
    if (!filePath.startsWith(OUTPUT + sep) || !existsSync(filePath)) { res.writeHead(404).end("not found"); return; }
    const st = statSync(filePath);
    const size = st.size;
    const headers: Record<string, string> = {
      "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream",
      "Accept-Ranges": "bytes",
      "Last-Modified": st.mtime.toUTCString(),
      "Cache-Control": "no-cache", // revalidar siempre: el regen reemplaza el archivo en la misma URL
    };
    const ims = req.headers["if-modified-since"];
    if (!req.headers.range && ims && Date.parse(ims) >= Math.floor(st.mtime.getTime() / 1000) * 1000) {
      res.writeHead(304, headers).end();
      return;
    }
    if (isDownload) headers["Content-Disposition"] = `attachment; filename="${basename(filePath)}"`;
    // Soporte de Range (206): imprescindible para hacer scrubbing del video y para iOS Safari.
    const range = req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    if (range && !isDownload) {
      const start = range[1] ? parseInt(range[1], 10) : 0;
      const end = range[2] ? Math.min(parseInt(range[2], 10), size - 1) : size - 1;
      if (start >= size || start > end) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
        return;
      }
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) });
      createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, "Content-Length": String(size) });
    createReadStream(filePath).pipe(res); // stream, no readFileSync: mp4 grandes sin cargar a memoria
    return;
  }

  page(user)
    .then((html) => res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(html))
    .catch((e) => res.writeHead(500).end(String(e?.message ?? e)));
});

// Credenciales de empresa guardadas desde el panel → process.env (el .env del servidor manda).
applyCompanySecrets();
applyAppSettings(); // IMAGE_PROVIDER y demás ajustes no-secretos del panel

server.listen(env.panelPort, () => {
  const auth = hasUsers() ? "(login por usuario activado)" : "(primer arranque: crea el admin en el navegador)";
  console.log(`\nPanel de aprobación → http://localhost:${env.panelPort}  ${auth}\n`);
  startScheduler(); // programación automática in-process (configurable desde el panel)
});
