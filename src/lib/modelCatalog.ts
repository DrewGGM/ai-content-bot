/**
 * Catálogo de modelos para el selector del panel.
 * Si el proveedor tiene API de listado y el usuario ya guardó credenciales, se consulta
 * EN VIVO (Anthropic /v1/models, OpenAI-compatible /models, Gemini). Para CLIs sin API de
 * listado se devuelven sugerencias estáticas (el campo sigue siendo de texto libre).
 */
import { buildProfileEnv } from "./agentProfile.js";

const STATIC_MODELS: Record<string, string[]> = {
  "": ["sonnet", "opus", "haiku"],
  claude: ["sonnet", "opus", "haiku", "sonnet[1m]", "opusplan"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
  qwen: ["qwen3-coder-plus", "qwen3-coder-flash"],
  kimi: [],
  codex: [],
  cursor: [],
  copilot: [],
  opencode: [],
  custom: [],
};

async function fetchJson(url: string, headers: Record<string, string>): Promise<any> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  try {
    const res = await fetch(url, { headers, signal: ctl.signal });
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(json?.error ?? json).slice(0, 160)}`);
    return json;
  } finally {
    clearTimeout(timer);
  }
}

export interface ModelList {
  models: string[];
  source: "api" | "static";
  error?: string;
}

export async function listModels(userId: string, provider: string): Promise<ModelList> {
  const env = buildProfileEnv(userId);
  const get = (k: string): string | undefined => {
    if (k in env) return env[k] === null ? undefined : (env[k] as string);
    return process.env[k];
  };

  try {
    if (provider === "anthropic") {
      const key = get("ANTHROPIC_API_KEY") || get("ANTHROPIC_AUTH_TOKEN");
      if (!key) return { models: [], source: "api", error: "Guarda primero tu ANTHROPIC_API_KEY" };
      const base = (get("ANTHROPIC_BASE_URL") || "https://api.anthropic.com").replace(/\/$/, "");
      const json = await fetchJson(`${base}/v1/models?limit=100`, {
        "x-api-key": key,
        Authorization: `Bearer ${key}`,
        "anthropic-version": "2023-06-01",
      });
      const models = (json.data ?? []).map((m: any) => String(m.id)).filter(Boolean);
      if (!models.length) throw new Error("el endpoint no devolvió modelos");
      return { models, source: "api" };
    }

    if (provider === "openai") {
      const key = get("LLM_API_KEY") || get("OPENAI_API_KEY");
      if (!key) return { models: [], source: "api", error: "Guarda primero tu LLM_API_KEY" };
      const base = (get("LLM_BASE_URL") || "https://api.openai.com/v1").replace(/\/$/, "");
      const json = await fetchJson(`${base}/models`, { Authorization: `Bearer ${key}` });
      const models = (json.data ?? []).map((m: any) => String(m.id)).filter(Boolean).sort();
      if (!models.length) throw new Error("el endpoint no devolvió modelos");
      return { models, source: "api" };
    }

    if (provider === "gemini") {
      const key = get("GEMINI_API_KEY") || get("GOOGLE_API_KEY");
      if (key) {
        const json = await fetchJson(
          `https://generativelanguage.googleapis.com/v1beta/models?pageSize=100&key=${encodeURIComponent(key)}`,
          {}
        );
        const models = (json.models ?? [])
          .map((m: any) => String(m.name ?? "").replace(/^models\//, ""))
          .filter((n: string) => n.startsWith("gemini"));
        if (models.length) return { models, source: "api" };
      }
      return { models: STATIC_MODELS.gemini, source: "static" };
    }
  } catch (e: any) {
    return { models: STATIC_MODELS[provider] ?? [], source: "static", error: String(e?.message ?? e) };
  }

  return { models: STATIC_MODELS[provider] ?? [], source: "static" };
}
