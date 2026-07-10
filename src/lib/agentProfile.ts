/**
 * Perfil de agente IA por usuario del panel: qué proveedor de copy usa, con qué modelo,
 * y sus credenciales (cifradas en reposo con secretBox). Persistido en data/agents/<id>.json.
 *
 * Los secretos son WRITE-ONLY hacia la UI: el panel solo ve si están configurados.
 * `buildProfileEnv` convierte el perfil en overrides de entorno para runWithProfile.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { seal, unseal } from "./secretBox.js";
import type { ActiveProfile } from "./activeProfile.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const AGENTS_DIR = join(ROOT, "data", "agents");

export const COPY_PROVIDERS = [
  "", "claude", "codex", "gemini", "qwen", "kimi", "cursor", "copilot", "opencode", "custom", "anthropic", "openai",
] as const;

/** Claves de secreto que el panel permite guardar (una allowlist, no campos libres). */
export const SECRET_KEYS = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "LLM_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "DASHSCOPE_API_KEY",
] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

// Variables que un usuario NUNCA puede sobrescribir vía extraEnv (seguridad del proceso).
const ENV_DENYLIST = /^(PATH|HOME|USERPROFILE|NODE_OPTIONS|LD_PRELOAD|LD_LIBRARY_PATH|SHELL|COMSPEC|PANEL_|S3_|CF_|QUEUE_STORE|ASSET_STORE)$|^PANEL_/;
const ENV_KEY_RE = /^[A-Z][A-Z0-9_]{1,63}$/;

export interface AgentProfile {
  copyProvider: string; // "" = el default del servidor (.env)
  copyModel: string;
  copyVision: "" | "true" | "false";
  isolateCli: boolean; // aísla credenciales de CLIs (CLAUDE_CONFIG_DIR/CODEX_HOME propios)
  extraEnv: Record<string, string>; // overrides no secretos (ANTHROPIC_BASE_URL, LLM_BASE_URL, ...)
  secrets: Record<string, string>; // clave → valor sellado (seal)
}

const DEFAULTS: AgentProfile = {
  copyProvider: "",
  copyModel: "",
  copyVision: "",
  isolateCli: false,
  extraEnv: {},
  secrets: {},
};

function profilePath(userId: string): string {
  if (!/^[a-f0-9]{6,32}$/.test(userId)) throw new Error("userId inválido");
  return join(AGENTS_DIR, `${userId}.json`);
}

export function loadAgentProfile(userId: string): AgentProfile {
  try {
    const raw = JSON.parse(readFileSync(profilePath(userId), "utf8"));
    return { ...DEFAULTS, ...raw, extraEnv: raw.extraEnv ?? {}, secrets: raw.secrets ?? {} };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(userId: string, profile: AgentProfile): void {
  mkdirSync(AGENTS_DIR, { recursive: true });
  writeFileSync(profilePath(userId), JSON.stringify(profile, null, 2), { mode: 0o600 });
}

export function updateAgentProfile(
  userId: string,
  patch: Partial<Pick<AgentProfile, "copyProvider" | "copyModel" | "copyVision" | "isolateCli" | "extraEnv">>
): AgentProfile {
  const profile = loadAgentProfile(userId);
  if (patch.copyProvider !== undefined) {
    if (!(COPY_PROVIDERS as readonly string[]).includes(patch.copyProvider)) throw new Error("Proveedor no soportado");
    profile.copyProvider = patch.copyProvider;
  }
  if (patch.copyModel !== undefined) profile.copyModel = String(patch.copyModel).slice(0, 120).trim();
  if (patch.copyVision !== undefined) {
    if (!["", "true", "false"].includes(patch.copyVision)) throw new Error("copyVision inválido");
    profile.copyVision = patch.copyVision;
  }
  if (patch.isolateCli !== undefined) profile.isolateCli = !!patch.isolateCli;
  if (patch.extraEnv !== undefined) {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(patch.extraEnv)) {
      const key = k.trim();
      if (!ENV_KEY_RE.test(key)) throw new Error(`Variable inválida: ${key}`);
      if (ENV_DENYLIST.test(key)) throw new Error(`Variable no permitida: ${key}`);
      clean[key] = String(v).slice(0, 2000);
    }
    profile.extraEnv = clean;
  }
  save(userId, profile);
  return profile;
}

export function setSecret(userId: string, key: string, value: string): void {
  if (!(SECRET_KEYS as readonly string[]).includes(key)) throw new Error(`Secreto no permitido: ${key}`);
  const v = value.trim();
  if (!v) throw new Error("Valor vacío");
  const profile = loadAgentProfile(userId);
  profile.secrets[key] = seal(v);
  save(userId, profile);
}

export function clearSecret(userId: string, key: string): void {
  const profile = loadAgentProfile(userId);
  delete profile.secrets[key];
  save(userId, profile);
}

/** Vista para la UI: nunca expone los valores de los secretos. */
export function profileSummary(userId: string): {
  copyProvider: string;
  copyModel: string;
  copyVision: string;
  isolateCli: boolean;
  extraEnv: Record<string, string>;
  secrets: Record<string, boolean>;
} {
  const p = loadAgentProfile(userId);
  const secrets: Record<string, boolean> = {};
  for (const k of SECRET_KEYS) secrets[k] = !!p.secrets[k];
  return {
    copyProvider: p.copyProvider,
    copyModel: p.copyModel,
    copyVision: p.copyVision,
    isolateCli: p.isolateCli,
    extraEnv: p.extraEnv,
    secrets,
  };
}

/**
 * Overrides de entorno del perfil (valores ya descifrados) para runWithProfile.
 * - Si el usuario tiene token OAuth de Claude Code y su proveedor es claude (o el default),
 *   se ELIMINAN ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN del entorno hijo (tienen prioridad
 *   sobre el token en el CLI y usarían la cuenta del servidor en vez de la del usuario),
 *   salvo que el propio usuario haya definido las suyas.
 * - isolateCli: cada usuario tiene su propio CLAUDE_CONFIG_DIR/CODEX_HOME bajo data/agents/<id>/.
 */
export function buildProfileEnv(userId: string): Record<string, string | null> {
  const p = loadAgentProfile(userId);
  const env: Record<string, string | null> = {};

  if (p.copyProvider) env.COPY_PROVIDER = p.copyProvider;
  if (p.copyModel) env.COPY_MODEL = p.copyModel;
  if (p.copyVision) env.COPY_VISION = p.copyVision;
  for (const [k, v] of Object.entries(p.extraEnv)) env[k] = v;
  for (const [k, sealed] of Object.entries(p.secrets)) {
    try {
      env[k] = unseal(sealed);
    } catch {
      console.error(`[agentProfile] no se pudo descifrar ${k} de ${userId} (¿cambió PANEL_SECRET?)`);
    }
  }

  const provider = p.copyProvider || (process.env.COPY_PROVIDER ?? "claude");
  if (env.CLAUDE_CODE_OAUTH_TOKEN && provider === "claude") {
    if (!("ANTHROPIC_API_KEY" in env)) env.ANTHROPIC_API_KEY = null;
    if (!("ANTHROPIC_AUTH_TOKEN" in env)) env.ANTHROPIC_AUTH_TOKEN = null;
  }

  if (p.isolateCli) {
    const base = join(AGENTS_DIR, userId);
    const claudeDir = join(base, "claude-config");
    const codexDir = join(base, "codex-home");
    mkdirSync(claudeDir, { recursive: true });
    mkdirSync(codexDir, { recursive: true });
    env.CLAUDE_CONFIG_DIR = claudeDir;
    env.CODEX_HOME = codexDir;
  }

  return env;
}

/** Perfil activo listo para runWithProfile. */
export function activeProfileFor(user: { id: string; name: string }): ActiveProfile {
  return { userId: user.id, userName: user.name, env: buildProfileEnv(user.id) };
}
