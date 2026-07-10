/**
 * Registro de actividad (auditoría): QUIÉN hizo QUÉ y CUÁNDO en el panel/cron.
 * Formato JSONL en data/audit.jsonl (fuera de git; sobrevive a los deploys), con rotación
 * simple por tamaño. Nunca se registran valores de credenciales — solo el nombre de la clave.
 * Visible para los admin en Ajustes → Actividad.
 */
import { appendFileSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FILE = join(ROOT, "data", "audit.jsonl");
const MAX_BYTES = 2 * 1024 * 1024; // rotación: al superar 2 MB se conserva la mitad más reciente

export interface AuditEntry {
  ts: string;
  user: string; // nombre del usuario, o "cron" / "sistema"
  action: string;
  detail: string;
}

export function audit(user: string, action: string, detail = ""): void {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    const entry: AuditEntry = {
      ts: new Date().toISOString(),
      user: String(user).slice(0, 60),
      action: String(action).slice(0, 60),
      detail: String(detail).slice(0, 300),
    };
    appendFileSync(FILE, JSON.stringify(entry) + "\n");
    if (existsSync(FILE) && statSync(FILE).size > MAX_BYTES) {
      const lines = readFileSync(FILE, "utf8").split("\n").filter(Boolean);
      writeFileSync(FILE, lines.slice(Math.floor(lines.length / 2)).join("\n") + "\n");
    }
  } catch {
    // la auditoría jamás debe tumbar una acción real
  }
}

/** Últimas `limit` entradas, la más reciente primero. */
export function readAudit(limit = 200): AuditEntry[] {
  try {
    const lines = readFileSync(FILE, "utf8").split("\n").filter(Boolean);
    return lines
      .slice(-limit)
      .map((l) => {
        try { return JSON.parse(l) as AuditEntry; } catch { return null; }
      })
      .filter((e): e is AuditEntry => !!e)
      .reverse();
  } catch {
    return [];
  }
}
