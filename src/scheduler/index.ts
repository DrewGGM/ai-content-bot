/**
 * Scheduler diario: deja que Claude (con el historial) decida la pieza de hoy y la genera,
 * dejándola en la cola de aprobación. Lo dispara el Programador de Tareas de Windows / cron.
 *   npm run schedule
 */
import "dotenv/config"; // carga .env ANTES de cualquier lectura de process.env (orden de imports)
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { planNextContent } from "../pipeline/planContent.js";
import { createContent } from "../pipeline/dispatch.js";
import { capabilitiesReport } from "../lib/capabilities.js";

async function main() {
  const stamp = new Date().toISOString();
  // Aviso: si la programación del PANEL (Auto) también está activa, saldrían 2 piezas/día.
  try {
    const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const sched = JSON.parse(readFileSync(join(ROOT, "data", "schedule.json"), "utf8"));
    if (sched?.enabled) {
      console.warn("⚠️  La programación automática del PANEL (Auto) también está activada — con este cron saldrán 2 piezas al día. Desactiva una de las dos.");
    }
  } catch { /* sin schedule.json */ }
  console.log(`[scheduler ${stamp}] capacidades:\n${capabilitiesReport()}\n`);
  console.log(`[scheduler] Claude decidiendo la pieza de hoy...`);

  const plan = await planNextContent();
  console.log(`  Decisión: ${plan.format} · pilar:${plan.pillar} · tema: ${plan.topic}`);
  console.log(`  Razón: ${plan.rationale}`);

  try {
    const item = await createContent({ format: plan.format, topic: plan.topic, platform: plan.platform });
    console.log(`✅ ${item.format} "${item.id}" en cola (pending). Apruébalo en el panel.`);
  } catch (err: any) {
    // Fallback: si el proveedor falla (ej. fal sin saldo), siempre producimos un design (código puro).
    console.error(`⚠️  ${plan.format} falló (${err.message}). Fallback a 'design'...`);
    const item = await createContent({ format: "design", topic: plan.topic, platform: plan.platform });
    console.log(`✅ design "${item.id}" en cola (fallback). Apruébalo en el panel.`);
  }
}

main().catch((err) => {
  console.error("❌ scheduler:", err.message);
  process.exit(1);
});
