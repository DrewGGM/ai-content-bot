/**
 * Capa de abstracción del "cerebro" del bot (copy, planner, edición y QA visual).
 * El proveedor se elige con COPY_PROVIDER y puede ser:
 *
 *   CLIs de agentes (usan tu suscripción o su propia config; el binario debe estar en el PATH):
 *     claude    → Claude Code        (claude -p, default)
 *     codex     → OpenAI Codex CLI   (codex exec)
 *     gemini    → Google Gemini CLI  (gemini -p)
 *     qwen      → Qwen Code          (qwen -p)
 *     kimi      → Kimi Code CLI      (kimi --quiet -p)
 *     cursor    → Cursor CLI         (cursor-agent -p)
 *     copilot   → GitHub Copilot CLI (copilot -p)
 *     opencode  → OpenCode           (opencode run)
 *     custom    → cualquier comando definido en AGENT_CMD (prompt por stdin → respuesta por stdout)
 *
 *   APIs directas (con API key, sin CLI):
 *     anthropic → Anthropic Messages API, o cualquier endpoint compatible vía ANTHROPIC_BASE_URL
 *                 (Kimi/Moonshot, GLM/Z.AI, DeepSeek, MiniMax…)
 *     openai    → cualquier endpoint compatible con OpenAI chat/completions vía LLM_BASE_URL
 *                 (OpenAI, OpenRouter, Kimi/Moonshot, DeepSeek, Groq, Ollama local, GLM…)
 *
 * Modelo con COPY_MODEL (opcional; cada proveedor tiene su default). Timeout con COPY_TIMEOUT_MS.
 * COPY_VISION=true|false fuerza si el proveedor puede VER imágenes (QA visual); por defecto
 * cada proveedor tiene un valor razonable.
 */
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
// Config/credenciales del PERFIL ACTIVO (usuario del panel) con fallback a process.env.
// Así cada job corre con el agente/cuenta de quien lo lanzó (multi-cuenta en un servidor).
import { envGet, childEnv } from "../lib/activeProfile.js";

export type CopyProvider =
  | "claude" | "codex" | "gemini" | "qwen" | "kimi" | "cursor" | "copilot" | "opencode" | "custom"
  | "anthropic" | "openai";

const CLI_PROVIDERS = ["claude", "codex", "gemini", "qwen", "kimi", "cursor", "copilot", "opencode", "custom"] as const;

// Se lee perezosamente (no al cargar el módulo) para garantizar que dotenv ya cargó el .env.
export function copyProvider(): CopyProvider {
  const p = (envGet("COPY_PROVIDER") ?? "claude").toLowerCase().trim();
  const all: string[] = [...CLI_PROVIDERS, "anthropic", "openai"];
  return (all.includes(p) ? p : "claude") as CopyProvider;
}

const model = () => envGet("COPY_MODEL")?.trim() || "";
const timeoutMs = () => Number(envGet("COPY_TIMEOUT_MS") ?? 300000); // 5 min default

/** Default de visión por proveedor; COPY_VISION=true|false lo fuerza. */
function visionDefault(p: CopyProvider): boolean {
  switch (p) {
    case "claude":    // lee la imagen con su tool Read
    case "codex":     // tool view_image en sandbox read-only
    case "gemini":    // multimodal, lee archivos con --yolo
    case "cursor":    // soporta imágenes en modo print (documentado)
    case "anthropic": // bloque image base64 (ojo: DeepSeek-compat no soporta visión → COPY_VISION=false)
      return true;
    case "openai":
      return (envGet("LLM_VISION") ?? "true").toLowerCase() !== "false";
    case "custom":
      return (envGet("AGENT_VISION") ?? "false").toLowerCase() === "true";
    default: // qwen (según modelo), kimi (según modelo), copilot, opencode → conservador
      return false;
  }
}

export interface AskOptions {
  /** Ruta absoluta de una imagen que el modelo debe MIRAR (QA visual). */
  image?: string;
}

/** Información del proveedor activo, para `npm run capabilities` y el gating de features. */
export function copyProviderInfo(): {
  provider: CopyProvider;
  kind: "cli" | "api";
  model: string;
  vision: boolean;
  ready: boolean;
  detail: string;
} {
  const p = copyProvider();
  const kind = (CLI_PROVIDERS as readonly string[]).includes(p) ? "cli" : "api";
  const forced = envGet("COPY_VISION")?.trim().toLowerCase();
  const vision = forced === "true" ? true : forced === "false" ? false : visionDefault(p);
  const m = model();
  switch (p) {
    case "anthropic":
      return {
        provider: p, kind, model: m || "claude-sonnet-4-5", vision,
        ready: !!(envGet("ANTHROPIC_API_KEY") || envGet("ANTHROPIC_AUTH_TOKEN")),
        detail: `API ${envGet("ANTHROPIC_BASE_URL") || "api.anthropic.com"}`,
      };
    case "openai":
      return {
        provider: p, kind, model: m || "gpt-4o-mini", vision,
        ready: !!(envGet("LLM_API_KEY") || envGet("OPENAI_API_KEY")),
        detail: `API ${envGet("LLM_BASE_URL") || "https://api.openai.com/v1"}`,
      };
    case "custom":
      return {
        provider: p, kind, model: m || "(el del agente)", vision,
        ready: !!envGet("AGENT_CMD"),
        detail: envGet("AGENT_CMD") ? `cmd: ${envGet("AGENT_CMD")}` : "falta AGENT_CMD",
      };
    case "codex":    return { provider: p, kind, model: m || "(config de codex)", vision, ready: true, detail: "CLI codex exec" };
    case "gemini":   return { provider: p, kind, model: m || "(config de gemini)", vision, ready: true, detail: "CLI gemini -p" };
    case "qwen":     return { provider: p, kind, model: m || "(config de qwen)", vision, ready: true, detail: "CLI qwen -p" };
    case "kimi":     return { provider: p, kind, model: m || "(config de kimi)", vision, ready: true, detail: "CLI kimi --quiet" };
    case "cursor":   return { provider: p, kind, model: m || "(config de cursor)", vision, ready: true, detail: "CLI cursor-agent -p" };
    case "copilot":  return { provider: p, kind, model: m || "(config de copilot)", vision, ready: true, detail: "CLI copilot -p" };
    case "opencode": return { provider: p, kind, model: m || "(config de opencode)", vision, ready: true, detail: "CLI opencode run" };
    default:         return { provider: "claude", kind: "cli", model: m || "sonnet", vision, ready: true, detail: "CLI claude -p (suscripción)" };
  }
}

/** ¿El proveedor activo puede VER imágenes? (para saltarse el QA visual si no). */
export function visionAvailable(): boolean {
  return copyProviderInfo().vision;
}

// ---------------------------------------------------------------------------
// Ejecución de CLIs
// ---------------------------------------------------------------------------

interface RunResult { stdout: string; stderr: string; code: number | null }

/** Ejecuta un binario con el prompt por STDIN (evita ENAMETOOLONG con prompts largos) y timeout. */
function runCli(cmd: string, args: string[], stdin: string, opts: { shell?: boolean } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // childEnv(): entorno con los overrides del perfil activo (token OAuth del usuario,
    // CLAUDE_CONFIG_DIR aislado, etc.). Sin perfil activo = process.env normal.
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], shell: opts.shell ?? false, env: childEnv() });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`'${cmd}' superó el timeout de ${timeoutMs()}ms (COPY_TIMEOUT_MS)`));
    }, timeoutMs());
    child.stdin.on("error", () => {}); // ignora EPIPE si el proceso muere antes
    child.stdin.write(stdin);
    child.stdin.end();
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`No se pudo ejecutar '${cmd}': ${err.message}. ¿Está instalado y en el PATH?`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

/** Prefijo estándar para que un agente CLI "vea" una imagen leyéndola del disco con sus tools. */
function imageInstruction(imagePath: string, prompt: string): string {
  return `Lee y MIRA la imagen en esta ruta absoluta usando tus herramientas: ${imagePath.replace(/\\/g, "/")}\n\n${prompt}`;
}

function failCli(name: string, r: RunResult): never {
  throw new Error(`${name} salió con código ${r.code}: ${(r.stderr || r.stdout).slice(0, 300)}`);
}

// ---- Adaptadores CLI ----

async function askClaudeCli(prompt: string, opts: AskOptions): Promise<string> {
  const args = ["-p", "--output-format", "json", "--model", model() || "sonnet"];
  let full = prompt;
  if (opts.image) {
    args.push("--allowedTools", "Read"); // Claude Code "ve" la imagen leyéndola con Read
    full = imageInstruction(opts.image, prompt);
  }
  const r = await runCli("claude", args, full);
  if (r.code !== 0 && !r.stdout) failCli("claude", r);
  try {
    const envelope = JSON.parse(r.stdout);
    if (envelope.is_error) throw new Error(`Claude error: ${envelope.result}`);
    return String(envelope.result ?? "");
  } catch (e: any) {
    if (e.message?.startsWith("Claude error:")) throw e;
    throw new Error(`Respuesta no-JSON de claude: ${r.stdout.slice(0, 300)}`);
  }
}

async function askCodexCli(prompt: string, opts: AskOptions): Promise<string> {
  // `codex exec` = modo no-interactivo (sandbox read-only por defecto: puede LEER la imagen).
  // El mensaje final se recoge limpio con --output-last-message.
  const tmp = mkdtempSync(join(tmpdir(), "codex-"));
  const outFile = join(tmp, "last.txt");
  try {
    const args = ["exec", "--skip-git-repo-check", "--output-last-message", outFile];
    if (model()) args.push("-m", model());
    args.push("-"); // prompt por stdin
    const full = opts.image ? imageInstruction(opts.image, prompt) : prompt;
    const r = await runCli("codex", args, full);
    let out = "";
    try { out = readFileSync(outFile, "utf8").trim(); } catch { /* sin archivo → usa stdout */ }
    if (!out) out = r.stdout.trim();
    if (r.code !== 0 && !out) failCli("codex", r);
    return out;
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

async function askGeminiCli(prompt: string, opts: AskOptions): Promise<string> {
  // Gemini CLI en modo no-interactivo: prompt por stdin (no-TTY). --approval-mode yolo
  // permite usar herramientas (leer la imagen del disco) sin pedir aprobación.
  const args: string[] = [];
  if (model()) args.push("-m", model());
  let full = prompt;
  if (opts.image) {
    args.push("--approval-mode", "yolo");
    full = imageInstruction(opts.image, prompt);
  }
  const r = await runCli("gemini", args, full);
  if (r.code !== 0 && !r.stdout.trim()) failCli("gemini", r);
  return r.stdout.trim();
}

async function askQwenCli(prompt: string, opts: AskOptions): Promise<string> {
  // Qwen Code (fork de Gemini CLI): stdin → stdout. Auth: OPENAI_API_KEY/OPENAI_BASE_URL/OPENAI_MODEL
  // o DASHSCOPE_API_KEY. Visión solo si el modelo configurado es VL (COPY_VISION=true).
  const args: string[] = [];
  if (model()) args.push("-m", model());
  let full = prompt;
  if (opts.image) {
    args.push("--approval-mode", "yolo");
    full = imageInstruction(opts.image, prompt);
  }
  const r = await runCli("qwen", args, full);
  if (r.code !== 0 && !r.stdout.trim()) failCli("qwen", r);
  return r.stdout.trim();
}

async function askKimiCli(prompt: string, opts: AskOptions): Promise<string> {
  // Kimi Code CLI: --quiet = print + texto plano + solo el mensaje final. Prompt por stdin.
  // En modo print las tools se auto-aprueban (puede leer la imagen si el modelo es multimodal).
  const args = ["--quiet"];
  if (model()) args.push("--model", model());
  const full = opts.image ? imageInstruction(opts.image, prompt) : prompt;
  const r = await runCli("kimi", args, full);
  if (r.code !== 0 && !r.stdout.trim()) failCli("kimi", r);
  return r.stdout.trim();
}

async function askCursorCli(prompt: string, opts: AskOptions): Promise<string> {
  // Cursor CLI en modo print: cursor-agent -p (prompt por stdin), salida texto.
  const args = ["-p", "--output-format", "text"];
  if (model()) args.push("--model", model());
  const full = opts.image ? imageInstruction(opts.image, prompt) : prompt;
  const r = await runCli("cursor-agent", args, full);
  if (r.code !== 0 && !r.stdout.trim()) failCli("cursor-agent", r);
  return r.stdout.trim();
}

async function askCopilotCli(prompt: string, opts: AskOptions): Promise<string> {
  // GitHub Copilot CLI: copilot -p "..." con tools auto-aprobadas. El prompt va como
  // ARGUMENTO y los del bot son enormes (contexto de marca + skills) → en Windows la línea
  // de comandos tiene límite (~32K): si es largo, va a un archivo temporal que el agente lee.
  let full = opts.image ? imageInstruction(opts.image, prompt) : prompt;
  let tmp: string | null = null;
  try {
    if (full.length > 8000) {
      tmp = mkdtempSync(join(tmpdir(), "copilot-"));
      const f = join(tmp, "prompt.md");
      writeFileSync(f, full);
      full = `Lee el archivo ${f.replace(/\\/g, "/")} y sigue EXACTAMENTE las instrucciones que contiene. Responde únicamente lo que pide.`;
    }
    const r = await runCli("copilot", ["-p", full, "--allow-all-tools"], "");
    if (r.code !== 0 && !r.stdout.trim()) failCli("copilot", r);
    return r.stdout.trim();
  } finally {
    if (tmp) try { rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

async function askOpencodeCli(prompt: string, opts: AskOptions): Promise<string> {
  // `opencode run "mensaje"` (argumento posicional). Los prompts del bot son largos (contexto de
  // marca + skills) y en Windows la línea de comandos tiene límite → si es muy largo, se escribe
  // a un archivo temporal y se le pide al agente leerlo con sus tools.
  const args = ["run"];
  if (model()) args.push("-m", model());
  let message = opts.image ? imageInstruction(opts.image, prompt) : prompt;
  let tmp: string | null = null;
  try {
    if (message.length > 24000) {
      tmp = mkdtempSync(join(tmpdir(), "opencode-"));
      const f = join(tmp, "prompt.md");
      writeFileSync(f, message);
      message = `Lee el archivo ${f.replace(/\\/g, "/")} y sigue EXACTAMENTE las instrucciones que contiene. Responde únicamente lo que pide.`;
    }
    args.push(message);
    const r = await runCli("opencode", args, "");
    if (r.code !== 0 && !r.stdout.trim()) failCli("opencode", r);
    return r.stdout.trim();
  } finally {
    if (tmp) try { rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ }
  }
}

async function askCustomCli(prompt: string, opts: AskOptions): Promise<string> {
  // Agente arbitrario: AGENT_CMD recibe el prompt por STDIN y responde por STDOUT.
  // Si tu agente puede leer archivos locales, pon AGENT_VISION=true para habilitar el QA visual.
  const cmd = envGet("AGENT_CMD");
  if (!cmd) throw new Error("COPY_PROVIDER=custom requiere AGENT_CMD en .env (comando que lee el prompt por stdin)");
  const full = opts.image ? imageInstruction(opts.image, prompt) : prompt;
  const r = await runCli(cmd, [], full, { shell: true });
  if (r.code !== 0 && !r.stdout.trim()) failCli("AGENT_CMD", r);
  return r.stdout.trim();
}

// ---------------------------------------------------------------------------
// APIs directas
// ---------------------------------------------------------------------------

function imageMime(path: string): string {
  const e = extname(path).toLowerCase();
  return e === ".jpg" || e === ".jpeg" ? "image/jpeg" : e === ".webp" ? "image/webp" : "image/png";
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs());
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function askAnthropicApi(prompt: string, opts: AskOptions): Promise<string> {
  const key = envGet("ANTHROPIC_API_KEY") || envGet("ANTHROPIC_AUTH_TOKEN");
  if (!key) throw new Error("COPY_PROVIDER=anthropic requiere ANTHROPIC_API_KEY en .env");
  const base = (envGet("ANTHROPIC_BASE_URL") || "https://api.anthropic.com").replace(/\/$/, "");
  const content: any[] = [];
  // La imagen va ANTES del texto (recomendación oficial para visión).
  if (opts.image) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: imageMime(opts.image), data: readFileSync(opts.image).toString("base64") },
    });
  }
  content.push({ type: "text", text: prompt });

  const res = await fetchWithTimeout(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": key,
      Authorization: `Bearer ${key}`, // algunos endpoints compatibles usan Bearer
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model() || "claude-sonnet-4-5",
      max_tokens: 8192,
      messages: [{ role: "user", content }],
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Anthropic API (${base}) ${res.status}: ${JSON.stringify(json?.error ?? json).slice(0, 300)}`);
  const text = (json?.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
  if (!text) throw new Error(`Anthropic API (${base}) no devolvió texto`);
  return text;
}

async function askOpenAiApi(prompt: string, opts: AskOptions): Promise<string> {
  const key = envGet("LLM_API_KEY") || envGet("OPENAI_API_KEY");
  if (!key) throw new Error("COPY_PROVIDER=openai requiere LLM_API_KEY (u OPENAI_API_KEY) en .env");
  const base = (envGet("LLM_BASE_URL") || "https://api.openai.com/v1").replace(/\/$/, "");
  // Visión en formato OpenAI: data-URI base64 (compatible con OpenAI, OpenRouter, Groq, Moonshot,
  // Ollama…; Moonshot NO acepta URLs http, solo base64 — por eso siempre mandamos base64).
  const content: any = opts.image
    ? [
        { type: "image_url", image_url: { url: `data:${imageMime(opts.image)};base64,${readFileSync(opts.image).toString("base64")}` } },
        { type: "text", text: prompt },
      ]
    : prompt;

  const res = await fetchWithTimeout(`${base}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model() || "gpt-4o-mini",
      max_tokens: 8192,
      messages: [{ role: "user", content }],
    }),
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`LLM API (${base}) ${res.status}: ${JSON.stringify(json?.error ?? json).slice(0, 300)}`);
  const text = json?.choices?.[0]?.message?.content;
  if (!text) throw new Error(`LLM API (${base}) no devolvió texto`);
  return String(text);
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Pregunta al proveedor configurado y devuelve el TEXTO de la respuesta.
 * `opts.image` añade una imagen que el modelo debe mirar (QA visual); si el proveedor
 * no soporta visión, lanza error — usa visionAvailable() para el gating.
 */
export async function askLLM(prompt: string, opts: AskOptions = {}): Promise<string> {
  const p = copyProvider();
  if (opts.image && !copyProviderInfo().vision) {
    throw new Error(`El proveedor de copy "${p}" no soporta visión (QA visual)`);
  }
  switch (p) {
    case "codex": return askCodexCli(prompt, opts);
    case "gemini": return askGeminiCli(prompt, opts);
    case "qwen": return askQwenCli(prompt, opts);
    case "kimi": return askKimiCli(prompt, opts);
    case "cursor": return askCursorCli(prompt, opts);
    case "copilot": return askCopilotCli(prompt, opts);
    case "opencode": return askOpencodeCli(prompt, opts);
    case "custom": return askCustomCli(prompt, opts);
    case "anthropic": return askAnthropicApi(prompt, opts);
    case "openai": return askOpenAiApi(prompt, opts);
    default: return askClaudeCli(prompt, opts);
  }
}

/** Extrae un objeto JSON de un texto que puede venir con ```json ... ``` o prosa alrededor. */
export function extractJson<T = any>(text: string): T {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1) s = s.slice(start, end + 1);
  return JSON.parse(s) as T;
}

/**
 * askLLM + extractJson con UN reintento: si la respuesta no trae JSON parseable,
 * se lo vuelve a pedir recordándole el formato. Da mucha estabilidad con CLIs/modelos variados.
 */
export async function askLLMJson<T = any>(prompt: string, opts: AskOptions = {}): Promise<T> {
  const first = await askLLM(prompt, opts);
  try {
    return extractJson<T>(first);
  } catch {
    const retry = await askLLM(
      `${prompt}\n\nIMPORTANTE: tu respuesta anterior no fue JSON válido. Responde ÚNICAMENTE el objeto JSON pedido, sin markdown ni texto alrededor.`,
      opts
    );
    return extractJson<T>(retry);
  }
}
