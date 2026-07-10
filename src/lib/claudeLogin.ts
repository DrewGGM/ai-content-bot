/**
 * Asistente de login de Claude Code desde el panel.
 *
 * Ejecuta `claude setup-token` en un pseudo-terminal (node-pty, dependencia OPCIONAL):
 *  1. start(userId)  → lanza el proceso y captura la URL de autorización OAuth.
 *  2. El usuario abre la URL, autoriza con SU cuenta de Claude y recibe un código.
 *  3. submitCode()   → se escribe el código en el pty.
 *  4. El CLI imprime un token de 1 año (sk-ant-oat01-…) que se guarda cifrado en el
 *     perfil del usuario (onToken) como CLAUDE_CODE_OAUTH_TOKEN.
 *
 * Si node-pty no está instalado (p. ej. Windows sin build tools), ptySupported() = false y
 * el panel muestra el flujo manual: correr `claude setup-token` en tu máquina y pegar el token.
 *
 * El pty corre con CLAUDE_CONFIG_DIR en un directorio temporal para no tocar las
 * credenciales del servidor.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

export type LoginStatus = "starting" | "waiting_code" | "working" | "done" | "error";

interface LoginSession {
  status: LoginStatus;
  url?: string;
  error?: string;
  buffer: string;
  pty?: any;
  tmp?: string;
  timer?: NodeJS.Timeout;
  onToken: (token: string) => void;
  codeSent: boolean;
  /** Posición del buffer desde la que buscar errores del intercambio (post-código). */
  codeMark: number;
  /** Posición desde la que buscar la URL (el CLI genera una NUEVA con cada reintento). */
  urlMark: number;
}

const sessions = new Map<string, LoginSession>();

const TOKEN_RE = /sk-ant-oat01-[A-Za-z0-9_-]{20,}/;
const URL_RE = /https:\/\/[^\s"'\])>]+/g;
const ESC = String.fromCharCode(27);
// Ancho del pty. La URL de OAuth (~600 chars con state + code_challenge) es más larga que
// cualquier ancho razonable: el terminal la PARTE en varias líneas y hay que re-unirlas.
const PTY_COLS = 500;

// Quita secuencias ANSI/control para poder parsear la salida del CLI.
function stripAnsi(s: string): string {
  const csi = new RegExp(`${ESC}\\[[0-9;?]*[a-zA-Z]`, "g"); // colores/cursor
  const osc = new RegExp(`${ESC}\\][^\\x07${ESC}]*(\\x07|${ESC}\\\\)`, "g"); // títulos/hyperlinks
  return s.replace(csi, "").replace(osc, "").replace(/\r/g, "");
}

/**
 * Re-une las líneas que el terminal partió por ancho (hard wrap): una línea que llega
 * EXACTAMENTE al ancho del pty continúa en la siguiente. Sin esto, la URL de autorización
 * se corta a mitad (p. ej. sin `state=` → "Invalid OAuth Request" en claude.ai).
 */
function unwrapLines(s: string, cols: number): string {
  const out: string[] = [];
  let carry = "";
  for (const line of s.split("\n")) {
    carry += line;
    if (line.length < cols) {
      out.push(carry);
      carry = "";
    }
  }
  if (carry) out.push(carry);
  return out.join("\n");
}

// node-pty necesita la RUTA REAL del ejecutable (en Windows no resuelve por PATH/extensión).
let _claudeBin: string | null = null;
function claudeBin(): string {
  if (_claudeBin) return _claudeBin;
  if (process.platform === "win32") {
    try {
      const lines = execSync("where claude", { encoding: "utf8" }).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      // Preferimos el binario real (.exe) o el shim .cmd; "claude" a secas no sirve en conpty.
      _claudeBin = lines.find((l) => /\.(exe|cmd|bat)$/i.test(l)) ?? lines[0] ?? "claude.exe";
    } catch {
      _claudeBin = "claude.exe";
    }
  } else {
    try {
      _claudeBin = execSync("command -v claude", { encoding: "utf8", shell: "/bin/sh" }).trim() || "claude";
    } catch {
      _claudeBin = "claude";
    }
  }
  return _claudeBin;
}

let _pty: any | null | undefined;
async function ptyModule(): Promise<any | null> {
  if (_pty !== undefined) return _pty;
  try {
    _pty = await import("node-pty");
  } catch {
    _pty = null;
  }
  return _pty;
}

export async function ptySupported(): Promise<boolean> {
  return (await ptyModule()) !== null;
}

function cleanup(userId: string): void {
  const s = sessions.get(userId);
  if (!s) return;
  if (s.timer) clearTimeout(s.timer);
  try { s.pty?.kill(); } catch { /* ya murió */ }
  if (s.tmp) try { rmSync(s.tmp, { recursive: true, force: true }); } catch { /* temp */ }
  s.pty = undefined;
}

/** Lanza `claude setup-token`. onToken se llama UNA vez con el token capturado. */
export async function startLogin(userId: string, onToken: (token: string) => void): Promise<{ ok: boolean; error?: string }> {
  const pty = await ptyModule();
  if (!pty) return { ok: false, error: "node-pty no está disponible en este servidor (usa el método manual)" };

  cancelLogin(userId); // sesión previa fuera

  const tmp = mkdtempSync(join(tmpdir(), "claude-login-"));
  const session: LoginSession = { status: "starting", buffer: "", tmp, onToken, codeSent: false, codeMark: 0, urlMark: 0 };
  sessions.set(userId, session);

  try {
    const proc = pty.spawn(claudeBin(), ["setup-token"], {
      name: "xterm-256color",
      cols: PTY_COLS,
      rows: 50,
      cwd: tmp,
      env: { ...process.env, CLAUDE_CONFIG_DIR: join(tmp, "config"), BROWSER: "true" },
    });
    session.pty = proc;

    proc.onData((data: string) => {
      session.buffer += stripAnsi(data);
      if (session.buffer.length > 100_000) session.buffer = session.buffer.slice(-50_000);
      // Se parsea sobre el buffer DES-ENVUELTO (las líneas partidas por el ancho, re-unidas).
      const plain = unwrapLines(session.buffer, PTY_COLS);

      const token = plain.match(TOKEN_RE)?.[0];
      if (token && session.status !== "done") {
        session.status = "done";
        session.buffer = "(token capturado)";
        try { session.onToken(token); } catch (e: any) { session.status = "error"; session.error = String(e?.message ?? e); }
        cleanup(userId);
        return;
      }
      if (session.status === "starting") {
        // Se busca solo a partir de urlMark: en un reintento el CLI genera una URL NUEVA
        // (nuevo state) y la vieja ya no sirve.
        const scan = unwrapLines(session.buffer.slice(session.urlMark), PTY_COLS);
        const urls = scan.match(URL_RE) ?? [];
        // La URL de autorización real lleva state y code_challenge; exigir `state=` evita
        // capturar una URL a medias (wrap raro) que claude.ai rechazaría.
        const authUrl = urls.find((u) => /oauth|authorize/i.test(u) && /[?&]state=/.test(u));
        if (authUrl) {
          session.url = authUrl.replace(/[.,]$/, "");
          session.status = "waiting_code";
        }
      }
      // Si el intercambio del código falla, el CLI muestra "OAuth error … Press Enter to
      // retry": pulsamos Enter (el CLI reinicia el flujo con un ENLACE NUEVO) y volvemos a
      // "starting" para capturar esa URL nueva, con el error visible para el usuario.
      if (session.status === "working") {
        const idx = session.buffer.indexOf("OAuth error", session.codeMark);
        if (idx >= 0) {
          const line = unwrapLines(session.buffer.slice(idx), PTY_COLS).split("\n")[0].slice(0, 160);
          session.codeMark = session.buffer.length;
          session.urlMark = session.buffer.length;
          session.status = "starting";
          session.error = `${line}. Se generó un ENLACE NUEVO: ábrelo otra vez, autoriza y pega el código nuevo.`;
          try { session.pty?.write("\r"); } catch { /* ya salió */ }
        }
      }
    });

    proc.onExit(({ exitCode }: { exitCode: number }) => {
      if (session.status !== "done" && session.status !== "error") {
        session.status = "error";
        session.error = `claude setup-token terminó (código ${exitCode}) sin entregar token. Salida: …${session.buffer.slice(-300)}`;
      }
      cleanup(userId);
    });

    session.timer = setTimeout(() => {
      if (session.status !== "done") {
        session.status = "error";
        session.error = "Tiempo agotado (10 min). Vuelve a intentarlo.";
        cleanup(userId);
      }
    }, 10 * 60_000);

    return { ok: true };
  } catch (e: any) {
    session.status = "error";
    session.error = `No se pudo lanzar 'claude setup-token': ${e?.message ?? e}. ¿Está Claude Code instalado en el servidor?`;
    cleanup(userId);
    return { ok: false, error: session.error };
  }
}

export function submitCode(userId: string, code: string): { ok: boolean; error?: string } {
  const s = sessions.get(userId);
  if (!s || !s.pty) return { ok: false, error: "No hay un login en curso; vuelve a iniciarlo" };
  if (s.status !== "waiting_code") return { ok: false, error: `Estado inesperado: ${s.status}` };
  const clean = code.trim();
  if (!clean || clean.length > 400) return { ok: false, error: "Código inválido" };
  s.status = "working";
  s.error = undefined;
  s.codeMark = s.buffer.length; // los errores de OAuth se buscan a partir de este intento
  // El Enter va DESPUÉS, en un write separado: los inputs interactivos (Ink) tratan un
  // paste largo + \r en el mismo chunk como parte del texto pegado y no envían el submit.
  s.pty.write(clean);
  setTimeout(() => { try { s.pty?.write("\r"); } catch { /* ya salió */ } }, 400);
  return { ok: true };
}

/** Cola visible del CLI (para mostrar en la UI qué está pasando); enmascara cualquier token. */
function bufferTail(s: LoginSession): string {
  return unwrapLines(s.buffer, PTY_COLS)
    .replace(TOKEN_RE, "sk-ant-oat01-…")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(-280);
}

export function loginStatus(userId: string): { status: LoginStatus | "none"; url?: string; error?: string; tail?: string } {
  const s = sessions.get(userId);
  if (!s) return { status: "none" };
  return { status: s.status, url: s.url, error: s.error, tail: bufferTail(s) };
}

export function cancelLogin(userId: string): void {
  cleanup(userId);
  sessions.delete(userId);
}
