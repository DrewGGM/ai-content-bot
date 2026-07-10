/**
 * Perfil activo por job (AsyncLocalStorage): permite que cada generación lanzada desde el
 * panel corra con las credenciales/config del usuario que la pidió, sin pasar parámetros
 * por todos los pipelines. `envGet` reemplaza a process.env.X en la capa LLM; `childEnv`
 * construye el entorno de los procesos hijos (CLIs de agentes).
 *
 * Un override con valor `null` significa "eliminar la variable" (p. ej. quitar
 * ANTHROPIC_API_KEY del servidor para que el CLI de Claude use el token OAuth del usuario).
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface ActiveProfile {
  userId: string;
  userName: string;
  env: Record<string, string | null>;
}

const als = new AsyncLocalStorage<ActiveProfile>();

export function runWithProfile<T>(profile: ActiveProfile | null, fn: () => T): T {
  if (!profile) return fn();
  return als.run(profile, fn);
}

export function activeProfile(): ActiveProfile | undefined {
  return als.getStore();
}

/** Valor efectivo de una variable: override del perfil activo o process.env. */
export function envGet(name: string): string | undefined {
  const p = als.getStore();
  if (p && name in p.env) {
    const v = p.env[name];
    return v === null ? undefined : v;
  }
  return process.env[name];
}

/** Entorno completo para procesos hijos (spawn de CLIs). */
export function childEnv(): NodeJS.ProcessEnv {
  const p = als.getStore();
  if (!p) return process.env;
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(p.env)) {
    if (v === null) delete env[k];
    else env[k] = v;
  }
  return env;
}
