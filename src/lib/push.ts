/**
 * NOTIFICACIONES PUSH (Web Push / VAPID) — avisa al móvil cuando hay una pieza nueva por aprobar.
 *
 * Las claves VAPID salen de env (VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY) o se generan una vez y se
 * guardan en data/push.json (untracked → sobreviven al deploy). Las suscripciones de cada navegador
 * se guardan en data/push-subs.json. Solo tiene sentido para avisos NO atendidos (cron/calendario):
 * el panel las dispara desde la generación automática, no desde la manual (ahí ya estás mirando).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import webpush from "web-push";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const KEYS_PATH = join(ROOT, "data", "push.json");
const SUBS_PATH = join(ROOT, "data", "push-subs.json");

type Keys = { publicKey: string; privateKey: string };
let keys: Keys | null = null;

/** Claves VAPID: env > archivo > generadas y persistidas. Null si web-push no pudo generarlas. */
function getKeys(): Keys | null {
  if (keys) return keys;
  const envPub = process.env.VAPID_PUBLIC_KEY, envPriv = process.env.VAPID_PRIVATE_KEY;
  if (envPub && envPriv) return (keys = { publicKey: envPub, privateKey: envPriv });
  try { return (keys = JSON.parse(readFileSync(KEYS_PATH, "utf8"))); } catch { /* generar */ }
  try {
    const gen = webpush.generateVAPIDKeys();
    keys = { publicKey: gen.publicKey, privateKey: gen.privateKey };
    mkdirSync(dirname(KEYS_PATH), { recursive: true });
    // La clave privada VAPID es sensible → 0600, igual que el resto de secretos en data/.
    writeFileSync(KEYS_PATH, JSON.stringify(keys, null, 2), { mode: 0o600 });
    return keys;
  } catch { return null; }
}

export function pushEnabled(): boolean {
  return !!getKeys();
}

/** Clave pública que el navegador necesita para suscribirse ("" si no hay). */
export function vapidPublicKey(): string {
  return getKeys()?.publicKey ?? "";
}

function readSubs(): any[] {
  try { return JSON.parse(readFileSync(SUBS_PATH, "utf8")); } catch { return []; }
}
function writeSubs(subs: any[]): void {
  try { mkdirSync(dirname(SUBS_PATH), { recursive: true }); } catch { /* ya existe */ }
  writeFileSync(SUBS_PATH, JSON.stringify(subs, null, 2));
}

/** Guarda (o refresca) una suscripción de navegador. Deduplica por endpoint. */
export function addSubscription(sub: any): void {
  if (!sub?.endpoint) return;
  const subs = readSubs().filter((s) => s.endpoint !== sub.endpoint);
  subs.push(sub);
  writeSubs(subs);
}

function applyVapid(k: Keys): void {
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@content-bot.local", k.publicKey, k.privateKey);
}

/**
 * Envía una notificación a todos los navegadores suscritos. Limpia las suscripciones caducadas
 * (404/410). Nunca lanza. Devuelve a cuántos se envió con éxito.
 */
export async function sendPush(title: string, body: string, url = "/"): Promise<number> {
  const k = getKeys();
  if (!k) return 0;
  applyVapid(k);
  const payload = JSON.stringify({ title, body, url });
  const subs = readSubs();
  if (!subs.length) return 0;

  const alive: any[] = [];
  let ok = 0;
  await Promise.all(subs.map(async (s) => {
    try { await webpush.sendNotification(s, payload); alive.push(s); ok++; }
    catch (e: any) {
      const code = e?.statusCode;
      if (code === 404 || code === 410) return; // suscripción muerta: se descarta
      alive.push(s); // otro error (red): la conservamos
    }
  }));
  if (alive.length !== subs.length) writeSubs(alive);
  return ok;
}
