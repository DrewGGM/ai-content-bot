/**
 * RASTREO DE COSTO por pieza. Los providers llaman a `track()` cuando gastan API; el dispatcher
 * envuelve la generación con `withUsage()` para acumular y adjuntar el costo a la pieza.
 *
 * Los precios son ESTIMADOS (tarifas públicas aproximadas, varían por plan/proveedor) — sirven
 * para dar una idea del gasto por pieza en el panel, no como factura exacta. El copy vía CLI con
 * suscripción (Claude Code, etc.) es efectivamente gratis, por eso `llm` cuesta 0 y solo cuenta
 * las llamadas. Ajusta `PRICES` si tus tarifas difieren.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface UsageLine { calls: number; usd: number }
export interface Usage { usd: number; byProvider: Record<string, UsageLine>; estimated: true }

/** Precios estimados en USD por unidad (imagen/video/avatar = por pieza; tts = por carácter). */
const PRICES: Record<string, number> = {
  image: 0.04,   // Nano Banana Pro / gpt-image-1 (aprox por imagen)
  video: 0.40,   // image-to-video ~5s (Kling/Veo, aprox)
  avatar: 0.60,  // OmniHuman / HeyGen (aprox por clip corto)
  tts: 0.0003,   // ElevenLabs ~$0.30 / 1000 caracteres
  llm: 0,        // copy vía CLI con suscripción = gratis; API se puede ajustar aquí
};

const store = new AsyncLocalStorage<Usage>();

/** Registra un gasto en el acumulador activo. `units` = imágenes/videos (1) o caracteres (tts). */
export function track(kind: keyof typeof PRICES | string, units = 1): void {
  const u = store.getStore();
  if (!u) return; // fuera de un withUsage() (ej. un job manual suelto): no-op
  const price = PRICES[kind] ?? 0;
  const line = (u.byProvider[kind] ??= { calls: 0, usd: 0 });
  line.calls += 1;
  line.usd += price * units;
  u.usd += price * units;
}

/** Ejecuta `fn` acumulando lo que gasten los providers dentro; devuelve el resultado y el gasto. */
export async function withUsage<T>(fn: () => Promise<T>): Promise<{ result: T; usage: Usage }> {
  const usage: Usage = { usd: 0, byProvider: {}, estimated: true };
  const result = await store.run(usage, fn);
  return { result, usage };
}

/** ¿Hubo algún gasto registrado? (para no adjuntar un costo vacío). */
export function hasCost(u: Usage): boolean {
  return Object.keys(u.byProvider).length > 0;
}
