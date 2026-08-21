/** Carga .env y expone las variables tipadas. */
import "dotenv/config";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name} en .env`);
  return v;
}

export const env = {
  falKey: () => required("FAL_KEY"),
  elevenLabsKey: () => required("ELEVENLABS_API_KEY"),
  anthropicKey: () => process.env.ANTHROPIC_API_KEY ?? "", // opcional (copy automatico/cron)
  panelPort: Number(process.env.PANEL_PORT ?? 4321),
  // Interfaz donde escucha el panel. Default 127.0.0.1 (SOLO localhost): así el Cloudflare Tunnel
  // —que corre en el mismo host— llega, pero NADIE puede pegarle directo por la IP publica del VPS
  // saltandose Cloudflare. Pon PANEL_HOST=0.0.0.0 solo si de verdad necesitas exponerlo en la LAN.
  panelHost: process.env.PANEL_HOST ?? "127.0.0.1",
  // Login del panel (2ª capa sobre Cloudflare Access). Si esta vacio, el panel no pide login.
  panelPassword: process.env.PANEL_PASSWORD ?? "",
};
