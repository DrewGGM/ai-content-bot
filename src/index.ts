/**
 * Content Bot — entrypoint
 *
 * Comandos:
 *   npm run voices              lista las voces ElevenLabs de tu cuenta
 *   npm run plan                Claude decide qué pieza toca (según historial) y la genera
 *   npm run generate -- "tema"  genera un REEL animado sobre un tema
 *   npm run carousel -- "tema"  genera un CARRUSEL educativo
 *   npm run post -- "tema"      genera un POST de imagen única
 *   npm run panel               panel web de aprobación
 *   npm run schedule            scheduler diario (usa el planificador)
 *
 * Ver ARCHITECTURE.md para el diseño completo.
 */
import "dotenv/config"; // carga .env ANTES de cualquier lectura de process.env
import { listVoices } from "./providers/elevenlabs.js";
import { createContent, type Format } from "./pipeline/dispatch.js";
import { planNextContent } from "./pipeline/planContent.js";
import { capabilitiesReport, availableFormats } from "./lib/capabilities.js";

const command = process.argv[2] ?? "help";
const arg = process.argv.slice(3).join(" ").trim();

function report(item: { id: string; status: string; format: string; dir: string }) {
  console.log(`\n✅ ${item.format.toUpperCase()} en cola (estado: ${item.status}).`);
  console.log(`   Carpeta: ${item.dir}`);
  console.log(`   Revísalo en el panel: npm run panel`);
}

async function main() {
  switch (command) {
    case "capabilities":
    case "caps": {
      console.log(capabilitiesReport());
      break;
    }
    case "init-db": {
      // Las credenciales D1 pueden estar en los secretos de empresa del panel (cifradas),
      // no solo en el .env. Aplícalas igual que el servidor antes de tocar D1.
      const { applyCompanySecrets } = await import("./lib/companySecrets.js");
      const { applyAppSettings } = await import("./lib/appSettings.js");
      applyCompanySecrets();
      applyAppSettings();
      const { d1InitSchema } = await import("./queue/d1.js");
      await d1InitSchema();
      console.log("✅ D1: tabla 'queue' lista (esquema migrado).");
      break;
    }
    case "voices": {
      const voices = await listVoices();
      console.log(`\nVoces ElevenLabs (${voices.length}):\n`);
      for (const v of voices) {
        const lang = v.labels?.language ?? v.labels?.accent ?? "";
        console.log(`  ${v.voice_id}  —  ${v.name}  ${lang ? `(${lang})` : ""}`);
      }
      break;
    }
    case "set": {
      // Genera un SET completo: una pieza de cada formato del sistema.
      // Temas de ejemplo: edítalos o usa `npm run plan` para que Claude elija según tu estrategia.
      const jobs: { format: Format; topic: string }[] = [
        { format: "reel", topic: "El principal beneficio de tu producto para el cliente" },
        { format: "motion", topic: "Un dato o idea clave de tu sector, explicado simple" },
        { format: "carousel", topic: "3 mitos o errores comunes en tu industria" },
        { format: "post", topic: "Tu propuesta de valor en una frase" },
        { format: "design", topic: "Por qué elegirte (poster por código, sin API)" },
        { format: "ugc", topic: "Un cliente recomienda tu producto y por qué" },
      ];
      console.log(`[content-bot] Generando SET completo (${jobs.length} piezas)...\n`);
      for (const j of jobs) {
        try {
          console.log(`\n=== ${j.format.toUpperCase()} — ${j.topic} ===`);
          const item = await createContent(j);
          console.log(`   ✓ ${item.format} en cola`);
        } catch (e: any) {
          console.log(`   ✗ ${j.format} falló: ${e.message}`);
        }
      }
      console.log(`\nListo. Revisa el set en el panel: npm run panel`);
      break;
    }
    case "campaign": {
      // Un mismo tema en varios formatos (repurpose): 1 idea → reel, carrusel, post, diseño.
      if (!arg) { console.log(`Falta el tema. Ej: npm run campaign -- "vender sin internet"`); break; }
      const wanted = ["reel", "carousel", "post", "design"];
      const avail = availableFormats() as string[];
      const formats = wanted.filter((f) => avail.includes(f));
      console.log(`[content-bot] Campaña sobre "${arg}" → ${formats.join(", ")}\n`);
      for (const f of formats) {
        try {
          console.log(`\n=== ${f.toUpperCase()} ===`);
          const item = await createContent({ format: f as Format, topic: arg });
          console.log(`   ✓ ${item.format} en cola`);
        } catch (e: any) { console.log(`   ✗ ${f} falló: ${e.message}`); }
      }
      console.log(`\nListo. Revisa la campaña en el panel: npm run panel`);
      break;
    }
    case "plan": {
      console.log("[content-bot] Claude está decidiendo qué publicar...\n");
      const plan = await planNextContent();
      console.log(`  Decisión: ${plan.format} · pilar:${plan.pillar}`);
      console.log(`  Tema: ${plan.topic}`);
      console.log(`  Razón: ${plan.rationale}\n`);
      const item = await createContent({ format: plan.format, topic: plan.topic, platform: plan.platform });
      report(item);
      break;
    }
    case "generate":
    case "reel":
    case "motion":
    case "ugc":
    case "carousel":
    case "post":
    case "brandpost":
    case "brandcarousel":
    case "design":
    case "deck": {
      if (!arg) {
        console.log(`Falta el tema. Ej: npm run ${command} -- "vender sin internet"`);
        break;
      }
      const map: Record<string, Format> = {
        carousel: "carousel", post: "post", brandpost: "brandpost", brandcarousel: "brandcarousel", motion: "motion", ugc: "ugc", reel: "reel", generate: "reel", design: "design", deck: "deck",
      };
      const format = map[command];
      if (!(availableFormats() as string[]).includes(format)) {
        console.log(`⚠️  El formato "${format}" no está disponible ahora mismo (falta un proveedor).`);
        console.log(`   Revisa capacidades: npm run capabilities`);
        console.log(`   Alternativa sin API de imagen: npm run design -- "${arg}"`);
        break;
      }
      console.log(`[content-bot] Generando ${format} sobre: "${arg}"\n`);
      const item = await createContent({ format, topic: arg });
      report(item);
      break;
    }
    default:
      console.log(`content-bot — comandos:
  npm run capabilities        qué proveedores/skills/formatos tiene disponibles el bot
  npm run voices              lista voces ElevenLabs
  npm run plan                Claude decide la pieza (según historial) y la genera
  npm run reel -- "tema"      REEL b-roll cinematográfico (escena IA + overlay)  [fal]
  npm run motion -- "tema"    REEL motion-graphics (texto animado, sin fal)
  npm run ugc -- "tema"       REEL UGC (avatar HeyGen)                           [HeyGen]
  npm run carousel -- "tema"  CARRUSEL (4-6 imágenes)                            [fal]
  npm run post -- "tema"      POST de imagen única                               [fal]
  npm run design -- "tema"    POST de diseño por CÓDIGO (SVG+sharp, sin API)

  npm run panel               panel web de aprobación
  npm run schedule            scheduler diario

Ver ARCHITECTURE.md para el diseño completo.`);
  }
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
