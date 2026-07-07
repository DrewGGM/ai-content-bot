/**
 * Panel web de aprobación (sin dependencias, solo node:http).
 * Muestra reels (video), carruseles (galería con flechas) y posts (imagen con zoom).
 * Permite Aprobar / Rechazar / Descargar. Iconografía SVG (Lucide), sin emojis.
 *
 * Seguridad (2 capas): (1) Cloudflare Access a nivel de red; (2) login propio con
 * PANEL_PASSWORD (cookie de sesión). Si PANEL_PASSWORD está vacío, el panel no pide login.
 *   npm run panel  →  http://localhost:4321
 */
import "dotenv/config"; // carga .env ANTES de cualquier lectura de process.env
import { createServer, type IncomingMessage } from "node:http";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { extname, normalize, join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "../lib/env.js";
import { loadBrandConfig } from "../lib/brandConfig.js";
import { listQueue, updateStatus, updateCopy, deleteItem, type QueueItem } from "../queue/queue.js";
import { createContent, type Format } from "../pipeline/dispatch.js";
import { editCopy } from "../pipeline/editCopy.js";
import { planNextContent } from "../pipeline/planContent.js";
import { deleteAssets } from "../lib/assets.js";
import { availableFormats } from "../lib/capabilities.js";
import { publishItem, publishCapabilities, NETWORKS, NETWORK_LABEL, type Network } from "../publish/index.js";

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

// ---- Iconos SVG (Lucide, stroke currentColor) ----
const P: Record<string, string> = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  reel: '<path d="m22 8-6 4 6 4V8Z"/><rect width="14" height="12" x="2" y="6" rx="2"/>',
  carousel: '<rect width="18" height="14" x="3" y="5" rx="2"/><path d="m3 15 4-4 5 5"/><circle cx="9" cy="9" r="1"/>',
  post: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  motion: '<path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/>',
  design: '<path d="M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2"/>',
  ugc: '<circle cx="12" cy="8" r="4"/><path d="M6 21v-1a6 6 0 0 1 12 0v1"/>',
  bot: '<path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2M20 14h2M15 13v2M9 13v2"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  layers: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  spark: '<path d="M9.9 15.5A2 2 0 0 0 8.5 14.1l-6.1-1.6a.5.5 0 0 1 0-1l6.1-1.6A2 2 0 0 0 9.9 8.5l1.6-6.1a.5.5 0 0 1 1 0l1.6 6.1A2 2 0 0 0 15.5 9.9l6.1 1.6a.5.5 0 0 1 0 1l-6.1 1.6a2 2 0 0 0-1.4 1.4l-1.6 6.1a.5.5 0 0 1-1 0z"/>',
  loader: '<path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6M14 11v6"/>',
  wand: '<path d="m3 21 6-6M14 4l6 6M12.5 5.5 5 13l6 6 7.5-7.5M14 4l6 6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4Z"/>',
};
const icon = (n: string, cls = "ic") =>
  `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] ?? ""}</svg>`;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}
const isUrl = (p: string) => /^https?:\/\//i.test(p);
const isR2 = (p: string) => p.startsWith("r2:");           // asset privado en R2 → proxy autenticado
const r2Key = (p: string) => p.slice(3);
const rel = (p: string) => p.slice(OUTPUT.length + 1).replace(/\\/g, "/");
// r2: se sirve por el proxy /r2/ (privado); http(s): URL directa; local: /media//download.
const mediaUrl = (p?: string) => (!p ? "" : isR2(p) ? "/r2/" + r2Key(p).split("/").map(encodeURIComponent).join("/") : isUrl(p) ? p : "/media/" + rel(p));
const dlUrl = (p: string) => (isR2(p) ? "/r2/" + r2Key(p).split("/").map(encodeURIComponent).join("/") + "?dl=1" : isUrl(p) ? p : "/download/" + rel(p));

// ---- Auth (cookie de sesión) ----
const PW = env.panelPassword;
const sessions = new Set<string>();
function pwMatch(input: string): boolean {
  if (!PW) return true;
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(PW).digest();
  return timingSafeEqual(a, b);
}
function parseCookies(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function isAuthed(req: IncomingMessage): boolean {
  if (!PW) return true;
  const sid = parseCookies(req).sid;
  return !!sid && sessions.has(sid);
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
async function s3() {
  if (_s3) return _s3;
  const { S3Client } = await import("@aws-sdk/client-s3");
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
type Job = { id: string; format: string; topic: string; status: "running" | "done" | "error"; started: number; itemId?: string; error?: string };
const jobs: Job[] = [];
const FORMAT_LABELS: Record<string, string> = {
  design: "Diseño — 1 póster, código sin API",
  deck: "Carrusel (código) — varios pósters, sin fal",
  post: "Post — imagen única (fal)",
  carousel: "Carrusel — imágenes IA (fal)",
  reel: "Reel — video b-roll (fal)",
  motion: "Video (Remotion) — animado por código, sin fal",
  ugc: "UGC — avatar HeyGen",
};
function startJob(format: Format, topic: string, platform?: string, extra?: { aspect?: any; audio?: any }): Job {
  const job: Job = { id: randomBytes(6).toString("hex"), format, topic, status: "running", started: Date.now() };
  jobs.unshift(job);
  if (jobs.length > 20) jobs.length = 20;
  // fire-and-forget: la generación sigue en segundo plano; el front hace polling de /jobs.
  createContent({ format, topic, ...(platform ? { platform } : {}), ...(extra?.aspect ? { aspect: extra.aspect } : {}), ...(extra?.audio ? { audio: extra.audio } : {}) })
    .then((item) => { job.status = "done"; job.itemId = item.id; })
    .catch((e) => { job.status = "error"; job.error = String(e?.message ?? e); });
  return job;
}

function startEditJob(item: QueueItem, instruction: string): Job {
  const job: Job = { id: randomBytes(6).toString("hex"), format: item.format, topic: `editar: ${instruction}`, status: "running", started: Date.now() };
  jobs.unshift(job);
  if (jobs.length > 20) jobs.length = 20;
  editCopy(item, instruction)
    .then((copy) => updateCopy(item.id, copy.caption, copy.hashtags))
    .then(() => { job.status = "done"; job.itemId = item.id; })
    .catch((e) => { job.status = "error"; job.error = String(e?.message ?? e); });
  return job;
}

// Regenera el VISUAL (imagen/video) de una pieza con la instrucción, reusando su id/carpeta.
function startRegenJob(item: QueueItem, instruction: string): Job {
  const slug = item.dir.split(/[\\/]/).filter(Boolean).pop() || item.topic || item.id;
  const job: Job = { id: randomBytes(6).toString("hex"), format: item.format, topic: `regenerar: ${instruction}`, status: "running", started: Date.now() };
  jobs.unshift(job);
  if (jobs.length > 20) jobs.length = 20;
  createContent({
    format: item.format as Format,
    topic: item.topic || slug,
    platform: item.platform,
    instruction,
    reuse: { slug, createdAt: item.createdAt },
  })
    .then((it) => { job.status = "done"; job.itemId = it.id; })
    .catch((e) => { job.status = "error"; job.error = String(e?.message ?? e); });
  return job;
}

// Publica una pieza a las redes seleccionadas; si al menos una funciona, la marca "published".
function startPublishJob(item: QueueItem, networks: Network[]): Job {
  const job: Job = { id: randomBytes(6).toString("hex"), format: item.format, topic: `publicar: ${networks.map((n) => NETWORK_LABEL[n]).join(", ")}`, status: "running", started: Date.now() };
  jobs.unshift(job);
  if (jobs.length > 20) jobs.length = 20;
  publishItem(item, networks)
    .then(async (results) => {
      const fail = results.filter((r) => !r.ok);
      if (results.some((r) => r.ok)) await updateStatus(item.id, "published");
      if (fail.length) { job.status = "error"; job.error = fail.map((f) => `${NETWORK_LABEL[f.network]}: ${f.error}`).join(" · "); }
      else { job.status = "done"; job.itemId = item.id; }
    })
    .catch((e) => { job.status = "error"; job.error = String(e?.message ?? e); });
  return job;
}

// Plan: Claude decide la pieza según el historial y la genera (cae a design si un proveedor falla).
function startPlanJob(): Job {
  const job: Job = { id: randomBytes(6).toString("hex"), format: "plan", topic: "IA decide la pieza…", status: "running", started: Date.now() };
  jobs.unshift(job);
  if (jobs.length > 20) jobs.length = 20;
  (async () => {
    const plan = await planNextContent();
    job.topic = `${plan.format}: ${plan.topic}`;
    try {
      const it = await createContent({ format: plan.format, topic: plan.topic, platform: plan.platform });
      job.status = "done"; job.itemId = it.id;
    } catch {
      const it = await createContent({ format: "design", topic: plan.topic, platform: plan.platform });
      job.status = "done"; job.itemId = it.id;
    }
  })().catch((e) => { job.status = "error"; job.error = String(e?.message ?? e); });
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
function startSet(): number {
  const avail = availableFormats();
  for (const f of avail) startJob(f as Format, SET_TOPICS[f] ?? "Contenido de marca");
  return avail.length;
}

// ---- Programación automática (in-process, configurable desde el panel) ----
// Persistida en data/schedule.json (untracked → sobrevive a los deploys). Reemplaza al cron del SO.
type Sched = { enabled: boolean; time: string; lastRun?: string }; // time = "HH:MM" hora Colombia (UTC-5)
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
    try {
      const plan = await planNextContent();
      try { await createContent({ format: plan.format, topic: plan.topic, platform: plan.platform }); }
      catch { await createContent({ format: "design", topic: plan.topic, platform: plan.platform }); }
      console.log(`[scheduler] pieza automática generada (${now.date})`);
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

// ---- CSS compartido (marca + OLED) ----
function baseCss(): string {
  return `@import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=Fira+Sans:wght@400;500;600;700;800&display=swap');
  :root{--violet:${brand.colors.primary};--violet2:${brand.colors.primaryLight};--mint:${brand.colors.accent};
    --bg:#05060c;--bg2:#0a0b16;--card:#0f1120;--card2:#141733;--line:#20233f;--txt:#f4f5fb;--mut:#9a9cc0;
    --z-header:20;--z-lb:50}
  *{box-sizing:border-box}
  html{color-scheme:dark}
  body{margin:0;font-family:'Fira Sans',Inter,system-ui,Arial,sans-serif;background:
    radial-gradient(1200px 600px at 80% -10%,color-mix(in srgb,var(--violet) 22%,transparent),transparent 60%),
    radial-gradient(1000px 500px at -10% 10%,color-mix(in srgb,var(--mint) 12%,transparent),transparent 55%),
    var(--bg);color:var(--txt);min-height:100vh;-webkit-font-smoothing:antialiased;overflow-x:hidden}
  a{color:inherit}
  .ic{width:18px;height:18px;flex:none} .ic.sm{width:14px;height:14px}
  :focus-visible{outline:2px solid var(--violet2);outline-offset:2px;border-radius:8px}
  @media (prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}`;
}

// ---- Página de login ----
function loginPage(error = false): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(brand.name)} · Acceso</title>
  <style>${baseCss()}
    .wrap{min-height:100vh;display:grid;place-items:center;padding:24px}
    .box{width:100%;max-width:380px;background:linear-gradient(180deg,var(--card2),var(--card));
      border:1px solid var(--line);border-radius:22px;padding:34px 30px;box-shadow:0 30px 80px #000a}
    .logo{display:flex;align-items:center;gap:10px;font-weight:800;font-size:19px;margin-bottom:4px}
    .logo .badge{width:38px;height:38px;border-radius:12px;display:grid;place-items:center;
      background:linear-gradient(135deg,var(--violet),var(--mint));color:#fff}
    .sub{color:var(--mut);font-size:13px;margin:2px 0 22px}
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
  <div class="wrap"><form class="box" method="POST" action="/login">
    <div class="logo"><span class="badge">${icon("bot","ic")}</span> ${esc(brand.name)}</div>
    <div class="sub">Panel de contenido — acceso privado</div>
    <label for="pw">Contraseña</label>
    <div class="field"><span class="lk">${icon("lock","ic")}</span>
      <input id="pw" name="password" type="password" autocomplete="current-password" autofocus placeholder="••••••••"></div>
    <button type="submit">${icon("lock","ic")} Entrar</button>
    <div class="err">${error ? "Contraseña incorrecta." : ""}</div>
  </form></div></body></html>`;
}

// ---- Página principal ----
async function page(): Promise<string> {
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
      const done = it.status === "approved" || it.status === "rejected";
      const fmtIcon = P[it.format] ? it.format : "post";
      return `<article class="card" data-status="${esc(it.status)}">
        <div class="media">${mediaHtml(it)}
          <span class="badge" style="background:${BADGE[it.status] ?? "#555"}">${esc(STATUS_LABEL[it.status] ?? it.status)}</span>
        </div>
        <div class="body">
          <div class="meta">${icon(fmtIcon, "ic sm")}<span>${esc(it.format)}</span><i>·</i><span>${esc(it.platform)}</span>${it.pillar ? `<i>·</i><span>${esc(it.pillar)}</span>` : ""}</div>
          <p class="cap">${esc(it.caption).replace(/\n/g, "<br>")}</p>
          ${tags ? `<div class="tags">${tags}</div>` : ""}
          <div class="actions">
            <button class="ok" ${done ? "disabled" : ""} onclick="act(this,'${it.id}','approved')">${icon("check")} Aprobar</button>
            <button class="no" ${done ? "disabled" : ""} onclick="act(this,'${it.id}','rejected')">${icon("x")} Rechazar</button>
          </div>
          <div class="actions">
            <button class="pub-btn" onclick="openPub('${esc(it.id)}')">${icon("send")} Publicar</button>
          </div>
          <div class="actions">
            <button class="edit-btn" onclick="openEdit('${esc(it.id)}')">${icon("edit")} Editar con IA</button>
            ${downloadBtn(it)}
            <button class="del-btn" title="Eliminar pieza y sus assets" onclick="doDelete('${esc(it.id)}')">${icon("trash")}</button>
          </div>
        </div>
      </article>`;
    })
    .join("");

  const logoutBtn = PW
    ? `<a class="logout" href="/logout" title="Cerrar sesión">${icon("logout")}<span>Salir</span></a>`
    : "";

  const genFormats = availableFormats();
  const fmtOptions = genFormats.map((f) => `<option value="${f}">${esc(FORMAT_LABELS[f] ?? f)}</option>`).join("");
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
    .hbar{max-width:1560px;margin:0 auto;padding:14px 26px;display:flex;align-items:center;gap:14px}
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
      padding:8px 26px 40px;max-width:1560px;margin:0 auto}
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
    video{aspect-ratio:9/16;object-fit:cover;background:#000}
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
    .cap{font-size:13px;line-height:1.6;color:#dcdcec;margin:0;max-height:150px;overflow:auto}
    .tags{display:flex;flex-wrap:wrap;gap:5px} .tag{font-size:11px;color:var(--mint);font-family:'Fira Code',monospace}
    .actions{display:flex;gap:9px;flex-wrap:wrap}
    .actions button,.actions .dl{min-width:0}
    button,.dl{flex:1;padding:11px;border:0;border-radius:11px;font-weight:700;cursor:pointer;color:#fff;
      font-size:14px;font-family:inherit;display:inline-flex;align-items:center;justify-content:center;gap:7px;
      text-decoration:none;transition:filter .2s,transform .12s}
    .ok{background:#00a578} .no{background:#c0392b} .dl{background:#1a1d33;border:1px solid var(--line);color:var(--txt)}
    .edit-btn{background:#1a1d33;border:1px solid var(--line);color:var(--txt)} .edit-btn:hover{border-color:var(--violet2)}
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
    @media (max-width:640px){.hbtn span{display:none}}
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
    .jobs{position:fixed;right:16px;bottom:16px;z-index:var(--z-lb);display:flex;flex-direction:column;gap:8px;max-width:340px}
    .job{display:flex;align-items:center;gap:10px;padding:11px 13px;border-radius:12px;border:1px solid var(--line);background:var(--card2);box-shadow:0 12px 30px #0009;font-size:12.5px}
    .job .jt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-transform:capitalize}
    .job .js{flex:none;display:inline-flex} .job b{flex:none;font-family:'Fira Code',monospace;font-size:11px}
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
        <small>Content Bot · ${items.length} piezas</small></span>
      <span class="spacer"></span>
      <button class="hbtn" onclick="doPlan()" title="Claude decide y genera una pieza">${icon("wand")}<span>Plan</span></button>
      <button class="hbtn" onclick="doSet()" title="Una pieza de cada formato disponible">${icon("layers")}<span>Set</span></button>
      <button class="hbtn" onclick="openSched()" title="Programación automática">${icon("clock")}<span>Auto</span></button>
      <button class="gen-btn" onclick="openGen()">${icon("spark")}<span>Generar</span></button>
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
          <option value="voice">Con voz + subtítulos</option><option value="music">Sin voz + música</option><option value="silent">Silencioso</option>
        </select></div>
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
      <label class="check"><input type="checkbox" id="editRegen"> <span>También regenerar el visual (imagen/video). Más lento; reemplaza la pieza.</span></label>
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
      <div class="modal-err" id="pubErr"></div>
      <div class="modal-actions">
        <button class="btn-ghost" onclick="closePub()">Cancelar</button>
        <button class="btn-primary" id="pubSubmit" onclick="submitPub()">${icon("send")} Publicar</button>
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
    function act(btn,id,status){
      btn.disabled=true;const sib=btn.parentElement.querySelectorAll('button');sib.forEach(b=>b.disabled=true);
      fetch('/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,status})})
        .then(r=>{if(r.status===401){location.reload();return}location.reload()})
        .catch(()=>{sib.forEach(b=>b.disabled=false)});
    }
    function slide(b,d){const t=b.parentElement.querySelector('.track');t.scrollBy({left:d*t.clientWidth,behavior:'smooth'})}
    function zoom(s){document.getElementById('lbimg').src=s;document.getElementById('lb').style.display='flex'}
    function dlAll(urls){urls.forEach((u,i)=>setTimeout(()=>{const a=document.createElement('a');a.href=u;a.download='';document.body.appendChild(a);a.click();a.remove()},i*400))}

    var LOADER=${JSON.stringify(icon("loader"))},CHECK=${JSON.stringify(icon("check"))},XIC=${JSON.stringify(icon("x"))};
    function ce(s){return String(s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
    function onGenFormat(){document.getElementById('genVideoOpts').style.display=(document.getElementById('genFormat').value==='motion')?'flex':'none'}
    function openGen(){document.getElementById('genErr').textContent='';onGenFormat();document.getElementById('genModal').classList.add('show');setTimeout(function(){document.getElementById('genTopic').focus()},50)}
    function closeGen(){document.getElementById('genModal').classList.remove('show')}
    document.addEventListener('keydown',function(e){if(e.key==='Escape'){closeGen();closeEdit();closeSched();closePub()}});
    function submitGen(){
      var topic=document.getElementById('genTopic').value.trim();
      var format=document.getElementById('genFormat').value;
      var platform=document.getElementById('genPlatform').value;
      var aspect=document.getElementById('genAspect').value;
      var audio=document.getElementById('genAudio').value;
      var err=document.getElementById('genErr'),btn=document.getElementById('genSubmit');
      if(!topic){err.textContent='Escribe un tema.';return}
      btn.disabled=true;
      fetch('/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({format:format,topic:topic,platform:platform,aspect:aspect,audio:audio})})
        .then(function(r){return r.json().then(function(d){return{ok:r.ok,d:d}})})
        .then(function(x){btn.disabled=false;if(!x.ok){err.textContent=(x.d&&x.d.error)||'Error al generar';return}closeGen();document.getElementById('genTopic').value='';pollJobs()})
        .catch(function(){btn.disabled=false;err.textContent='Error de red'});
    }
    var editId=null;
    function openEdit(id){editId=id;document.getElementById('editErr').textContent='';document.getElementById('editPrompt').value='';document.getElementById('editRegen').checked=false;document.getElementById('editModal').classList.add('show');setTimeout(function(){document.getElementById('editPrompt').focus()},50)}
    function closeEdit(){document.getElementById('editModal').classList.remove('show')}
    function submitEdit(){
      var prompt=document.getElementById('editPrompt').value.trim();
      var regen=document.getElementById('editRegen').checked;
      var err=document.getElementById('editErr'),btn=document.getElementById('editSubmit');
      if(!prompt){err.textContent='Escribe qué cambiar.';return}
      btn.disabled=true;
      fetch('/edit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:editId,prompt:prompt,regen:regen})})
        .then(function(r){return r.json().then(function(d){return{ok:r.ok,d:d}})})
        .then(function(x){btn.disabled=false;if(!x.ok){err.textContent=(x.d&&x.d.error)||'Error al editar';return}closeEdit();pollJobs()})
        .catch(function(){btn.disabled=false;err.textContent='Error de red'});
    }
    function openSched(){document.getElementById('schedErr').textContent='';fetch('/schedule').then(function(r){return r.json()}).then(function(s){document.getElementById('schedEnabled').checked=!!s.enabled;document.getElementById('schedTime').value=s.time||'09:00';document.getElementById('schedModal').classList.add('show')}).catch(function(){})}
    function closeSched(){document.getElementById('schedModal').classList.remove('show')}
    function saveSched(){var enabled=document.getElementById('schedEnabled').checked;var time=document.getElementById('schedTime').value||'09:00';var btn=document.getElementById('schedSave');btn.disabled=true;fetch('/schedule',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({enabled:enabled,time:time})}).then(function(r){btn.disabled=false;if(r.ok){closeSched()}else{document.getElementById('schedErr').textContent='No se pudo guardar'}}).catch(function(){btn.disabled=false;document.getElementById('schedErr').textContent='Error de red'})}
    var pubId=null;
    function openPub(id){pubId=id;document.getElementById('pubErr').textContent='';document.querySelectorAll('#pubModal .netopt input:not([disabled])').forEach(function(c){c.checked=true});document.getElementById('pubModal').classList.add('show')}
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
    function doPlan(){fetch('/plan',{method:'POST'}).then(function(){pollJobs()}).catch(function(){})}
    function doSet(){if(!confirm('¿Generar una pieza de cada formato disponible? Puede tardar.'))return;fetch('/set',{method:'POST'}).then(function(){pollJobs()}).catch(function(){})}
    function doDelete(id){
      if(!confirm('¿Eliminar esta pieza y todos sus assets? No se puede deshacer.'))return;
      fetch('/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id})})
        .then(function(r){if(r.ok){location.reload()}else{r.json().then(function(d){alert((d&&d.error)||'No se pudo eliminar')})}})
        .catch(function(){alert('Error de red')});
    }
    var jobsSeen={};
    function pollJobs(){
      fetch('/jobs').then(function(r){return r.json()}).then(function(list){
        var box=document.getElementById('jobs');
        box.innerHTML=list.slice(0,5).map(function(j){
          var cls=j.status==='running'?'run':(j.status==='done'?'done':'error');
          var ic=j.status==='running'?LOADER:(j.status==='done'?CHECK:XIC);
          var s=j.status==='running'?(Math.round(j.ms/1000)+'s'):(j.status==='done'?'Listo':'Error');
          return '<div class="job '+cls+'"><span class="js">'+ic+'</span><span class="jt">'+ce(j.format)+' · '+ce(j.topic)+'</span><b>'+s+'</b></div>';
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

  // ---- Login / logout (públicos) ----
  if (req.method === "POST" && url.pathname === "/login") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const pw = new URLSearchParams(body).get("password") ?? "";
      if (pwMatch(pw)) {
        const sid = randomBytes(24).toString("hex");
        sessions.add(sid);
        res.writeHead(302, {
          "Set-Cookie": `sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400`,
          Location: "/",
        }).end();
      } else {
        res.writeHead(401, { "Content-Type": "text/html; charset=utf-8" }).end(loginPage(true));
      }
    });
    return;
  }
  if (url.pathname === "/logout") {
    const sid = parseCookies(req).sid;
    if (sid) sessions.delete(sid);
    res.writeHead(302, { "Set-Cookie": "sid=; HttpOnly; Path=/; Max-Age=0", Location: "/" }).end();
    return;
  }

  // ---- A partir de aquí, requiere sesión ----
  if (!isAuthed(req)) {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(loginPage());
    } else {
      res.writeHead(401).end("no autorizado");
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/action") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      try {
        const { id, status } = JSON.parse(body);
        const updated = await updateStatus(id, status);
        res.writeHead(updated ? 200 : 404).end(JSON.stringify({ ok: !!updated }));
      } catch { res.writeHead(400).end(); }
    });
    return;
  }

  // ---- Generación manual: lanzar job ----
  if (req.method === "POST" && url.pathname === "/generate") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { format, topic, platform, aspect, audio } = JSON.parse(body);
        const t = String(topic ?? "").trim();
        if (!t) { res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Falta el tema" })); return; }
        if (!availableFormats().includes(format)) { res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Formato no disponible" })); return; }
        const aspOk = ["reel", "square", "feed"].includes(aspect) ? aspect : undefined;
        const audOk = ["voice", "music", "silent"].includes(audio) ? audio : undefined;
        const job = startJob(format as Format, t, typeof platform === "string" && platform ? platform : undefined, { aspect: aspOk, audio: audOk });
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jobId: job.id }));
      } catch { res.writeHead(400).end(); }
    });
    return;
  }
  // ---- Programación automática (leer / guardar) ----
  if (req.method === "GET" && url.pathname === "/schedule") {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(readSched()));
    return;
  }
  if (req.method === "POST" && url.pathname === "/schedule") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const { enabled, time } = JSON.parse(body);
        const t = /^\d{1,2}:\d{2}$/.test(String(time)) ? String(time).padStart(5, "0") : "09:00";
        const prev = readSched();
        writeSched({ enabled: !!enabled, time: t, lastRun: prev.lastRun });
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
      } catch { res.writeHead(400).end(); }
    });
    return;
  }

  // ---- Plan / Set manuales ----
  if (req.method === "POST" && url.pathname === "/plan") {
    const job = startPlanJob();
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jobId: job.id }));
    return;
  }
  if (req.method === "POST" && url.pathname === "/set") {
    const n = startSet();
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
        const job = startPublishJob(item, nets);
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
        const { id, prompt, regen } = JSON.parse(body);
        const p = String(prompt ?? "").trim();
        if (!p) { res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Falta la instrucción" })); return; }
        const item = (await listQueue()).find((i) => i.id === id);
        if (!item) { res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Pieza no encontrada" })); return; }
        const job = regen ? startRegenJob(item, p) : startEditJob(item, p);
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ jobId: job.id }));
      } catch { res.writeHead(400).end(); }
    });
    return;
  }

  // ---- Estado de los jobs (polling) ----
  if (req.method === "GET" && url.pathname === "/jobs") {
    const out = jobs.map((j) => ({ id: j.id, format: j.format, topic: j.topic, status: j.status, error: j.error, ms: Date.now() - j.started }));
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
    if (!filePath.startsWith(OUTPUT) || !existsSync(filePath)) { res.writeHead(404).end("not found"); return; }
    const headers: Record<string, string> = { "Content-Type": MIME[extname(filePath)] ?? "application/octet-stream" };
    if (isDownload) headers["Content-Disposition"] = `attachment; filename="${basename(filePath)}"`;
    res.writeHead(200, headers).end(readFileSync(filePath));
    return;
  }

  page()
    .then((html) => res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(html))
    .catch((e) => res.writeHead(500).end(String(e?.message ?? e)));
});

server.listen(env.panelPort, () => {
  console.log(`\nPanel de aprobación → http://localhost:${env.panelPort}${PW ? "  (login activado)" : "  (sin login — define PANEL_PASSWORD)"}\n`);
  startScheduler(); // programación automática in-process (configurable desde el panel)
});
