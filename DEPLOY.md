# Deploy — Opción A (self-hosted: VPS + Cloudflare Tunnel)

El bot corre en una máquina **siempre encendida** (VPS Linux o mini-PC). El scheduler genera
por cron; el **panel de aprobación** se expone de forma segura con un **Cloudflare Tunnel**
(gratis) para aprobar desde el celular. El copy usa el agente/API que elijas con `COPY_PROVIDER`
(ver README, "Elige tu agente o API"): un CLI logueado con tu suscripción (Claude Code, Codex,
Gemini, Kimi…) o una API key directa (Anthropic/OpenAI/OpenRouter/DeepSeek/Ollama…).

```
[cron] → npm run schedule → genera pieza → cola (queue.json) + assets/
                                   │
[Cloudflare Tunnel] → panel (localhost:4321) → apruebas/rechazas/descargas
```

---

## 0. Requisitos
- VPS Linux (Ubuntu 22.04+) o mini-PC siempre encendido. 1 vCPU / 2 GB basta (el video usa CPU en ffmpeg).
- Una cuenta de Cloudflare con un dominio (para el Tunnel del panel).
- Tus API keys: ElevenLabs, fal (y opcional OpenAI/Gemini/HeyGen).
- Tu "cerebro" de copy: un agente CLI para loguear en el server (Claude Code por defecto) o una
  API key de LLM (`COPY_PROVIDER=anthropic|openai`) — lo más simple para servidores.

## 1. Dependencias del sistema
```bash
# Node 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs ffmpeg git
# sharp (imágenes) compila nativo — build tools por si acaso:
sudo apt-get install -y build-essential
node -v && ffmpeg -version | head -1
```

## 2. El agente de copy (`COPY_PROVIDER`)

**Opción por defecto — Claude Code con tu suscripción:**
```bash
npm install -g @anthropic-ai/claude-code
claude --version
claude            # inicia sesión con tu suscripción (device auth: abre el link una vez)
```

**Otros agentes CLI** (instala y loguea el que uses; luego pon `COPY_PROVIDER` en `.env`):
```bash
npm i -g @openai/codex           # COPY_PROVIDER=codex   → codex login
npm i -g @google/gemini-cli      # COPY_PROVIDER=gemini
npm i -g @qwen-code/qwen-code    # COPY_PROVIDER=qwen
npm i -g @moonshot-ai/kimi-code  # COPY_PROVIDER=kimi
npm i -g opencode-ai             # COPY_PROVIDER=opencode → opencode auth login
```

**Sin CLI (recomendado para servidores/CI)** — API key directa en `.env`:
```
COPY_PROVIDER=anthropic          # o "openai" para cualquier endpoint OpenAI-compatible
ANTHROPIC_API_KEY=sk-ant-...
```
Ver README → "Elige tu agente o API" para todas las recetas (OpenRouter, Kimi, DeepSeek, Groq,
Ollama local, GLM, agente custom con AGENT_CMD…).

## 3. Clonar y configurar
```bash
git clone https://github.com/DrewGGM/content-claude-bot.git
cd content-claude-bot
git checkout lyroo-demo        # o la rama de tu empresa (main = genérico)
npm install

cp .env.example .env
nano .env                       # ELEVENLABS_API_KEY, FAL_KEY, IMAGE_PROVIDER, etc.
npm run voices                  # copia un voice_id → knowledge/voice.json (default.voiceId)
```

## 4. Verificar capacidades
```bash
npm run capabilities            # muestra proveedores, formatos disponibles y skills
npm run design -- "prueba"      # design NO gasta API (código puro) — debe funcionar siempre
```

## 5. Panel como servicio (systemd)
Crea `/etc/systemd/system/content-bot-panel.service`:
```ini
[Unit]
Description=Content Bot — panel de aprobación
After=network.target

[Service]
WorkingDirectory=/home/USER/content-claude-bot
ExecStart=/usr/bin/npm run panel
Restart=always
User=USER
Environment=PANEL_PORT=4321

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now content-bot-panel
sudo systemctl status content-bot-panel
```

## 6. Exponer el panel con Cloudflare Tunnel (seguro)
```bash
# Instala cloudflared
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared
cloudflared tunnel login
cloudflared tunnel create content-bot
# Enruta un subdominio al panel local:
cloudflared tunnel route dns content-bot panel.tudominio.com
```
`~/.cloudflared/config.yml`:
```yaml
tunnel: content-bot
credentials-file: /home/USER/.cloudflared/<TUNNEL_ID>.json
ingress:
  - hostname: panel.tudominio.com
    service: http://localhost:4321
  - service: http_status:404
```
```bash
sudo cloudflared service install   # corre el tunnel como servicio
```
> **Seguridad (importante):** el panel no tiene login. Protégelo con **Cloudflare Zero Trust →
> Access** creando una policy (solo tu email) para `panel.tudominio.com`. Así solo tú entras.

## 7. Generación diaria (cron)
```bash
crontab -e
# Todos los días a las 9:00 — el planner decide y genera (cae a 'design' si un proveedor falla):
0 9 * * * cd /home/USER/content-claude-bot && /usr/bin/npm run schedule >> logs/schedule.log 2>&1
```
En Windows usa `scripts/install-schedule.ps1` (Programador de Tareas).

## 8. Persistencia en la nube (opcional pero recomendado para deploy)
Por defecto todo es local (`queue.json` + `assets/output/`). Para durabilidad/escala, mueve la
**cola/historial a Cloudflare D1** y los **assets a R2** (o cualquier S3). Se activa por env.

### 8.1 Cola/historial → Cloudflare D1
```bash
# Crea la base D1 (con wrangler o en el dashboard)
npx wrangler d1 create content-bot   # anota el database_id
```
En `.env`:
```
QUEUE_STORE=d1
CF_ACCOUNT_ID=...
CF_D1_DATABASE_ID=...
CF_API_TOKEN=...        # token con permiso D1:Edit
```
```bash
npm run init-db          # crea la tabla 'queue' en D1
```

### 8.2 Assets → Cloudflare R2 (S3-compatible)
Crea un bucket R2 y una API token S3 (Access Key / Secret). En `.env`:
```
ASSET_STORE=s3
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_BUCKET=content-bot-assets
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
S3_REGION=auto
S3_PUBLIC_BASE=https://assets.tudominio.com   # dominio público del bucket (o deja vacío para endpoint/bucket)
```
Con esto, cada pieza sube su media a R2 y el panel sirve las URLs públicas directamente.
Para S3 de AWS: usa el endpoint/región de AWS y un bucket con acceso público o dominio CDN en `S3_PUBLIC_BASE`.

> Local sigue siendo el default (no configures nada para correr en tu máquina). D1+R2 hacen el
> deploy **stateless**: puedes reiniciar/reemplazar el servidor sin perder historial ni assets.

---

## 9. CI/CD — auto-deploy en cada push (GitHub Actions)

El repo trae `.github/workflows/deploy.yml` + `scripts/deploy.sh`. Al hacer **push a
`lyroo-demo`**, GitHub entra por SSH al VPS, hace `git reset --hard origin/lyroo-demo`,
`npm ci` y reinicia el panel. El `.env`, `queue.json`, `assets/` y `logs/` son untracked →
**no se tocan** en el deploy.

### 9.1 Llave SSH dedicada para el CI (en el VPS)
```bash
# como el mismo usuario que corre el bot (root o el usuario de systemd):
ssh-keygen -t ed25519 -f ~/.ssh/ci_deploy -N ""       # sin passphrase (uso automatizado)
cat ~/.ssh/ci_deploy.pub >> ~/.ssh/authorized_keys     # autoriza al runner a entrar
chmod 600 ~/.ssh/authorized_keys
cat ~/.ssh/ci_deploy                                    # COPIA esta clave privada -> secret de GitHub
```

### 9.2 Secrets en GitHub (repo → Settings → Secrets and variables → Actions)
| Secret | Valor |
|---|---|
| `DEPLOY_HOST` | IP pública del VPS |
| `DEPLOY_USER` | usuario que corre el bot (`root` o `deploy`) |
| `DEPLOY_SSH_KEY` | contenido completo de `~/.ssh/ci_deploy` (clave privada) |
| `DEPLOY_PORT` | *(opcional)* puerto SSH, default `22` |

### 9.3 Reinicio sin password (solo si `DEPLOY_USER` NO es root)
Si el bot corre bajo un usuario no-root, dale permiso puntual para reiniciar el panel:
```bash
echo 'deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart content-bot-panel' \
  | sudo tee /etc/sudoers.d/content-bot-deploy
```
Con `DEPLOY_USER=root` no hace falta (root no usa sudo).

### 9.4 Probarlo
- Push a `lyroo-demo`, o dispáralo a mano en **Actions → Deploy to VPS (lyroo) → Run workflow**.
- El primer deploy omite el restart si el servicio aún no existe (crea el systemd de la sección 5 primero).

> El cron (`npm run schedule`) lee el working dir en cada ejecución, así que tras el `git reset`
> ya usa el código nuevo sin reiniciar nada. Solo el **panel** (proceso largo) necesita el restart.

---

## Resumen operativo
| Qué | Cómo |
|---|---|
| Ver qué puede hacer | `npm run capabilities` |
| Generar bajo demanda | `npm run design\|post\|carousel\|reel\|motion -- "tema"` |
| Dejar que decida | `npm run plan` |
| Automático diario | cron → `npm run schedule` (con fallback a `design`) |
| Aprobar | panel en `panel.tudominio.com` (tras Cloudflare Access) |

El bot es **consciente de sus capacidades**: si falta un proveedor (o fal se queda sin saldo),
el planner solo elige formatos viables y el scheduler cae a `design` — nunca se rompe.
