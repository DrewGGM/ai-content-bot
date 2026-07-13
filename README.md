# Content Bot

Bot de creación de contenido **multicanal** (Instagram, TikTok, Facebook, LinkedIn/X) para
**cualquier marca** — y con **cualquier agente de IA o API**. Genera reels, carruseles, posts y
videos animados; el copy y el QA visual los hace el **agente/LLM que tú elijas** (Claude Code,
Codex, Gemini CLI, Qwen Code, Kimi, Cursor, Copilot, OpenCode, un comando propio, o una API key
directa de Anthropic/OpenAI/OpenRouter/Kimi/DeepSeek/Groq/Ollama…). Todo queda en una **cola de
aprobación** con panel web y se puede publicar a Meta con un clic.

> Flujo: genera → tú apruebas en el panel → publica. Human-in-the-loop.

---

## Índice

1. [Requisitos](#requisitos)
2. [Instalación rápida](#instalación-rápida)
3. [Elige tu agente o API (`COPY_PROVIDER`)](#elige-tu-agente-o-api-copy_provider)
4. [Configura tu marca](#configura-tu-marca)
5. [Proveedores de media (voz, imagen, video, avatar)](#proveedores-de-media)
6. [Uso](#uso)
7. [Panel de aprobación](#panel-de-aprobación)
8. [Workflows de contenido (personalizables)](#workflows-de-contenido-personalizables)
9. [Publicación en redes](#publicación-en-redes)
10. [Persistencia en la nube (opcional)](#persistencia-en-la-nube-opcional)
11. [Deploy](#deploy)
12. [Estructura del proyecto](#estructura-del-proyecto)
13. [Solución de problemas](#solución-de-problemas)

---

## Requisitos

| Qué | Para qué | Obligatorio |
|---|---|---|
| **Node.js 20+** | ejecutar el bot | ✅ |
| **ffmpeg** (y ffprobe) en el PATH | ensamblar videos y subtítulos | ✅ (solo para formatos de video) |
| **Un "cerebro"**: agente CLI instalado **o** una API key de LLM | copy, planner, edición y QA visual | ✅ (ver [sección 3](#elige-tu-agente-o-api-copy_provider)) |
| ElevenLabs API key | voz / locución de los reels | opcional |
| fal.ai key (o OpenAI/Gemini) | imágenes y video IA | opcional |
| HeyGen key | reels UGC con avatar | opcional |

> Sin ninguna key de media el bot **igual funciona**: los formatos `design`, `deck` y `motion`
> (silencioso) se renderizan 100% por código (SVG + sharp + Remotion), gratis.

Instalar ffmpeg: `winget install ffmpeg` (Windows) · `brew install ffmpeg` (macOS) ·
`sudo apt install ffmpeg` (Linux).

## Instalación rápida

```bash
git clone <este-repo>
cd content-bot
npm install

cp .env.example .env        # y rellena lo que vayas a usar
# 1) elige tu agente/API:      COPY_PROVIDER en .env (default: claude)
# 2) pon tu marca:             config/brand.json + knowledge/* + tu logo en assets/brand/
# 3) (opcional) voz e imagen:  ELEVENLABS_API_KEY, FAL_KEY

npm run capabilities        # ✔ te dice qué puede producir el bot con lo que configuraste
npm run design -- "prueba"  # primer post — no gasta ninguna API de imagen
npm run panel               # http://localhost:4321 para aprobar
```

## Elige tu agente o API (`COPY_PROVIDER`)

El bot habla con su "cerebro" a través de una capa única (`src/providers/llm.ts`). Elige el
proveedor en `.env` con `COPY_PROVIDER` y, opcionalmente, el modelo con `COPY_MODEL`.

### Opción A — Agentes CLI (usa tu suscripción; no necesitas API key)

El binario debe estar instalado y logueado en la máquina donde corre el bot.

| `COPY_PROVIDER` | Agente | Instalación | Login / Auth | QA visual* |
|---|---|---|---|---|
| `claude` *(default)* | **Claude Code** | `npm i -g @anthropic-ai/claude-code` | `claude` → login con tu suscripción | ✅ |
| `codex` | **OpenAI Codex CLI** | `npm i -g @openai/codex` | `codex login` (ChatGPT) o `CODEX_API_KEY` | ✅ |
| `gemini` | **Google Gemini CLI** | `npm i -g @google/gemini-cli` | login Google (gratis) o `GEMINI_API_KEY` | ✅ |
| `qwen` | **Qwen Code** | `npm i -g @qwen-code/qwen-code` | `OPENAI_API_KEY` + `OPENAI_BASE_URL` o `DASHSCOPE_API_KEY` | ⚙️ si el modelo es VL (`COPY_VISION=true`) |
| `kimi` | **Kimi Code CLI** (Moonshot) | `npm i -g @moonshot-ai/kimi-code` | `/login` (suscripción Kimi) o API key en su config | ⚙️ según modelo (`COPY_VISION=true`) |
| `cursor` | **Cursor CLI** | `curl https://cursor.com/install -fsS \| bash` | login Cursor o `CURSOR_API_KEY` | ✅ |
| `copilot` | **GitHub Copilot CLI** | `npm i -g @github/copilot` | login GitHub (suscripción Copilot) | ⚙️ (`COPY_VISION=true` para probar) |
| `opencode` | **OpenCode** | `npm i -g opencode-ai` | `opencode auth login` (multi-proveedor, incl. Ollama local) | ❌ |
| `custom` | **el que quieras** | — | define `AGENT_CMD` | ⚙️ `AGENT_VISION=true` |

\* *QA visual = el agente "mira" cada imagen generada y la regenera si tiene defectos. Si el
proveedor no soporta visión, el QA se salta limpiamente (el bot sigue funcionando).*

**Agente custom (`COPY_PROVIDER=custom`)** — cualquier programa que lea el prompt por **stdin** y
responda por **stdout** sirve. Ejemplos:

```bash
# Aider (headless):
AGENT_CMD=aider --message-file - --yes --no-auto-commits

# Un script tuyo:
AGENT_CMD=python mi_agente.py
```

### Opción B — API key directa (sin instalar ningún CLI)

| `COPY_PROVIDER` | Sirve para | Variables |
|---|---|---|
| `anthropic` | API de Anthropic **y cualquier endpoint compatible** | `ANTHROPIC_API_KEY` + opcional `ANTHROPIC_BASE_URL` + `COPY_MODEL` |
| `openai` | **cualquier endpoint compatible con OpenAI** | `LLM_API_KEY` + `LLM_BASE_URL` + `COPY_MODEL` |

Recetas listas para copiar en `.env`:

```bash
# — Anthropic directo —
COPY_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...

# — Kimi K2 (Moonshot) por su endpoint compatible con Anthropic —
COPY_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-...              # tu key de platform.kimi.ai
ANTHROPIC_BASE_URL=https://api.moonshot.ai/anthropic
COPY_MODEL=kimi-k2.7-code

# — GLM (Z.AI) —
COPY_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
ANTHROPIC_BASE_URL=https://api.z.ai/api/anthropic

# — DeepSeek (sin visión → desactiva el QA visual) —
COPY_PROVIDER=anthropic
ANTHROPIC_API_KEY=...                 # tu key de DeepSeek
ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic
COPY_VISION=false

# — OpenAI directo —
COPY_PROVIDER=openai
LLM_API_KEY=sk-...
COPY_MODEL=gpt-4o-mini

# — OpenRouter (acceso a cientos de modelos con una sola key) —
COPY_PROVIDER=openai
LLM_API_KEY=sk-or-...
LLM_BASE_URL=https://openrouter.ai/api/v1
COPY_MODEL=moonshotai/kimi-k2.5       # o anthropic/claude-sonnet-4.5, etc.

# — Groq (rápido y barato) —
COPY_PROVIDER=openai
LLM_API_KEY=gsk_...
LLM_BASE_URL=https://api.groq.com/openai/v1

# — Ollama (100% local y gratis) —
COPY_PROVIDER=openai
LLM_API_KEY=ollama
LLM_BASE_URL=http://localhost:11434/v1
COPY_MODEL=qwen3-vl                   # un modelo con visión mantiene el QA visual
```

Ajustes generales del cerebro:

| Variable | Qué hace |
|---|---|
| `COPY_MODEL` | modelo a usar (vacío = default del proveedor) |
| `COPY_VISION` | `true`/`false` fuerza el QA visual (vacío = default del proveedor) |
| `COPY_TIMEOUT_MS` | timeout por llamada (default 5 min) |

## Configura tu marca

El bot es genérico; lo personalizas rellenando estos archivos (sin tocar código):

| Archivo / carpeta | Qué poner |
|---|---|
| **`config/brand.json`** | Nombre, eslogan, **colores** (primary/accent/dark), idioma, CTA y archivo de logo |
| **`assets/brand/`** | Tu **logo** horizontal en blanco (SVG) |
| **`knowledge/company.md`** | Quién eres, misión, audiencia, diferenciadores, mensajes clave |
| **`knowledge/products.md`** | Productos/servicios y beneficios (marca lo que esté "en desarrollo") |
| **`knowledge/processes.md`** | Procesos / datos para contenido educativo |
| **`knowledge/faqs.md`** | Preguntas frecuentes |
| **`knowledge/voice.json`** | Voz de ElevenLabs (`voiceId`) y pronunciación de tu marca |
| **`config/brand.md`** | Tono de voz, estilo visual, redes |
| **`config/content-strategy.md`** | Objetivos, pilares y calendario de contenido |

El bot concatena `config/` + `knowledge/` y se lo pasa a tu agente como contexto en **cada**
generación — por eso el copy siempre suena a tu marca, uses el modelo que uses.

## Proveedores de media

| Variable | Para qué |
|---|---|
| `ELEVENLABS_API_KEY` | voz de los reels + música de fondo |
| `IMAGE_PROVIDER` | `fal` (default) · `openai` (gpt-image-1) · `gemini` (Nano Banana) |
| `FAL_KEY` | imágenes (Nano Banana Pro) y video image-to-video (Kling/Veo) |
| `VIDEO_ENGINE` | `kling` (default) o `veo` para el b-roll |
| `HEYGEN_API_KEY` / `HEYGEN_AVATAR_ID` / `HEYGEN_VOICE_ID` | reels UGC con avatar |
| `QA_ATTEMPTS` / `VIDEO_QA_ATTEMPTS` | intentos del QA visual (control de costo, default 2) |
| `USE_CM_SKILLS` | `true`: inyecta las skills de community manager en el copy |

## Uso

```bash
npm run capabilities          # qué proveedores/formatos tiene disponibles AHORA
npm run design   -- "tema"    # póster por código (sin API de imagen) — siempre disponible
npm run deck     -- "tema"    # carrusel por código (varios pósters)   — siempre disponible
npm run motion   -- "tema"    # video animado por código (Remotion)    — siempre disponible
npm run post     -- "tema"    # post imagen única IA           [fal/openai/gemini]
npm run brandpost -- "tema"   # post de marca premium: logo + referencias [fal · Nano Banana Pro]
npm run brandcarousel -- "tema" # carrusel de marca premium (slides consistentes) [fal]
npm run carousel -- "tema"    # carrusel 4-6 imágenes IA       [fal/openai/gemini]
npm run reel     -- "tema"    # reel b-roll cinematográfico    [fal + ElevenLabs]
npm run ugc      -- "tema"    # reel UGC con avatar            [HeyGen]

npm run plan                  # la IA elige formato+tema según tu historial y lo genera
npm run set                   # una pieza de cada formato disponible
npm run voices                # lista tus voces de ElevenLabs
npm run schedule              # una pieza al día (para cron / Programador de tareas)
```

El planner (`plan`/`schedule`) analiza tu historial: refuerza lo que **aprobaste**, evita ángulos
**rechazados**, no repite temas y **solo elige formatos viables** con tus keys actuales. Si un
proveedor falla, cae a `design` (código puro) — nunca se rompe.

## Panel de aprobación

```bash
npm run panel                 # http://localhost:4321
```

- Revisa cada pieza (video, carrusel con flechas, imagen con zoom), **aprueba/rechaza/descarga**.
- **Generar** desde el panel (formato o workflow, tema, plataforma; en video: aspecto 9:16/1:1/4:5,
  audio voz+música/voz/música/silencio y **URL de música** opcional).
- **Editar con IA**: reescribe el caption con una instrucción, o regenera el visual completo —
  incluyendo cambiar aspecto, **poner/quitar música** o pasarle **la URL de una pista**.
- **Plan** y **Set** con un clic; **Auto**: pieza diaria con la cuenta/agente del usuario que elijas.
- **Publicar** a las redes configuradas. Toasts de progreso descartables y confirmación para toda acción.
- Es una **PWA**: ábrelo desde el celular y "Agregar a pantalla de inicio".

### Multi-usuario y multi-agente

- **Login por usuario** (admin/miembro), sesiones persistentes y rate-limit de intentos.
- Cada usuario conecta **su propio agente de IA** en Ajustes: asistente guiado de **Claude Code**
  (`setup-token`: link + código, sin tocar la terminal) o API keys — **cifradas** (AES-256-GCM),
  de solo escritura, aisladas por usuario (los jobs corren con el perfil de quien los lanza).
- **Registro de actividad** (`data/audit.jsonl`): quién generó/aprobó/publicó/configuró qué.

### Todo configurable desde Ajustes (admin)

- **Contexto de empresa**: edita/crea/elimina los `.md` de `knowledge/` y `config/` (prompts propios incluidos).
- **Marca y logos**: sube logos y elige el principal.
- **Estilos de diseño**: personaliza el prompt de dirección de arte de las imágenes (`config/art-direction.md`).
- **Skills de la IA**: activa/desactiva las instaladas y **sube las tuyas** (un `.md` con tu playbook).
- **Música de fondo**: biblioteca de pistas libres; si está vacía, la IA **busca y descarga sola** una
  pista **CC0** (Openverse) acorde al tema, con créditos guardados.
- **Workflows**: crea/edita los pipelines de pasos (ver sección siguiente).
- **Conexiones**: tokens de redes sociales y keys de proveedores, cifradas y write-only.

## Workflows de contenido (personalizables)

Pipelines que **encadenan IAs paso a paso** (estilo ElevenLabs Flows / fal.ai Workflows), definidos
en JSON (`config/workflows/*.json`) y editables desde el panel. Cada paso conecta su salida con la
entrada de otro usando referencias `$paso.salida`:

| Paso | Qué hace |
|---|---|
| `copy` | el agente escribe titular/guion/caption/prompts con TODO el contexto de marca |
| `image` | imagen IA premium con QA visual y dirección de arte |
| `animate` | anima la imagen (image-to-video Kling/Veo vía fal) |
| `tts` | voz ElevenLabs con timestamps |
| `subtitles` | subtítulos .ass sincronizados + titular/CTA |
| `music` | música de la biblioteca o descarga CC0 automática |
| `avatar` | personaje que habla: retrato+voz → **OmniHuman** (fal) o guion → HeyGen |
| `assemble` | ensamblado ffmpeg: aspecto, subtítulos, logo de marca, mezcla voz+música |

Incluye dos presets listos: **Reel: imagen IA animada** (imagen → animarla → voz → subs → música →
marca) y **Personaje presentador** (la IA crea un personaje, le pone tu guion con voz y lo anima
hablando). Aparecen como formatos al Generar, y se regeneran/editan como cualquier pieza.

## Posts de marca premium (imágenes consistentes con tu logo)

El formato **`brandpost`** produce posts 1:1 estilo agencia (logo, titular, subtítulo, visual del
producto, iconos, CTA y web — todo en la imagen) para **cualquier rubro** (restaurante, tienda, gym,
software…). Dos tipos de imágenes de marca, gestionadas en Ajustes:

- **Referencias de estilo** (`assets/brand/references/`, 1-4): ejemplos del look que quieres (un post
  que te encantó). El modelo **copia la línea gráfica** — igual que darle referencias a ChatGPT.
- **Fotos de producto** (`assets/brand/products/`, hasta 8): platos, productos o artículos **reales**.
  El modelo los **usa como protagonistas** de la imagen — p. ej. un restaurante sube fotos de sus
  platos y el bot genera los posts **con esos platos reales**. (Solo fal / OpenAI; Leonardo no
  reproduce productos con fidelidad.)

Ambas carpetas son contenido de marca privado (no se versiona). El rubro se puede fijar en
`config/brand.json` (`industry`) y el prompt maestro se afina desde Ajustes → *Estilos de diseño*.

También existe **`brandcarousel`**: un **carrusel** donde cada slide es una imagen de marca premium
con la **misma línea gráfica** (el slide 1 se pasa como referencia a los demás para que sean
consistentes entre sí). Slide 1 = portada/gancho, intermedios = valor, último = CTA.

Funciona con tres proveedores (`IMAGE_PROVIDER`), con distinta calidad de **texto/logo**:

| Proveedor | Modelo | Texto y logo | Recomendado para |
|---|---|---|---|
| `fal` | Nano Banana Pro (Gemini 3 Pro) edit | ✅ texto+logo horneados por la IA | **posts de marca** (default) |
| `openai` | gpt-image-1 (edits) | ✅ texto+logo horneados por la IA | alternativa a fal |
| `leonardo` | image guidance (controlnets) | estética fotográfica; **texto+logo por código encima** | look fotográfico |

Como Leonardo no sabe escribir texto ni reproducir logos, con `IMAGE_PROVIDER=leonardo` el bot le
pide **solo el visual sin texto** y luego **hornea el titular, subtítulo, CTA, logo y web por código**
(SVG + sharp, nítido) — `overlayBrandPoster()`.

## Publicación en redes

Implementado: **Instagram** (Business) y **Facebook** (Página) vía Meta Graph API.
LinkedIn/TikTok/X: enchufables (la estructura ya existe en `src/publish/`).

Requisitos para Meta:
1. Cuenta de Instagram **Business** ligada a una Página de Facebook.
2. App en [Meta for Developers](https://developers.facebook.com) con permisos
   `instagram_content_publish`, `pages_manage_posts`.
3. Credenciales: `INSTAGRAM_ACCESS_TOKEN` (token de página de larga duración),
   `INSTAGRAM_BUSINESS_ACCOUNT_ID`, `FACEBOOK_PAGE_ID` — en el `.env` **o directamente desde el
   panel** (Ajustes → Conexiones; se guardan cifradas, el `.env` tiene prioridad).
4. Para publicar, los assets deben estar en R2/S3 (`ASSET_STORE=s3`) — Meta descarga la media
   desde una URL temporal firmada.

## Persistencia en la nube (opcional)

Por defecto todo es local (`queue.json` + `assets/output/`). Para un deploy **stateless**:

- **Cola/historial → Cloudflare D1**: `QUEUE_STORE=d1` + `CF_ACCOUNT_ID`, `CF_D1_DATABASE_ID`,
  `CF_API_TOKEN`; luego `npm run init-db`.
- **Assets → R2/S3**: `ASSET_STORE=s3` + `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`. El bucket puede quedar **privado** (el panel los sirve por proxy
  autenticado) o público con `S3_PUBLIC_BASE`.

## Deploy

Guía completa en **[`DEPLOY.md`](DEPLOY.md)**. Resumen (VPS Linux):

```bash
# 1. Sistema: Node 20+, ffmpeg, git (+ build-essential para sharp)
# 2. Tu agente: instala y loguea el CLI que elegiste (o usa COPY_PROVIDER=anthropic/openai con key)
# 3. App:
git clone <repo> && cd content-bot && npm install
cp .env.example .env && nano .env
# 4. Panel como servicio (systemd) + Cloudflare Tunnel para acceder desde el celular
# 5. Cron diario:
0 9 * * * cd /home/USER/content-bot && npm run schedule >> logs/schedule.log 2>&1
```

En Windows: `scripts/install-schedule.ps1` registra la tarea diaria en el Programador de tareas.

> Consejo: si no quieres depender de un CLI logueado en el servidor, usa `COPY_PROVIDER=anthropic`
> o `openai` con una API key — es lo más simple para servidores/CI.

## Estructura del proyecto

```
content-bot/
├── config/              # brand.json (identidad), brand.md, content-strategy.md, calendar.json,
│   └── workflows/       # workflows personalizables (JSON de pasos encadenados)
├── knowledge/           # company, products, processes, faqs, voice.json  ← tu contexto
├── assets/brand/        # tu logo         assets/music/  ← biblioteca de pistas (auto-descarga CC0)
├── remotion/            # composición React del video por código (motion)
├── src/
│   ├── index.ts         # CLI
│   ├── providers/       # llm (⭐ multi-agente/API), vision (QA), images (fal/openai/gemini),
│   │                    # fal (imagen/i2v/OmniHuman), elevenlabs, heygen, music
│   ├── pipeline/        # un generador por formato + planner + visualQA + dispatch
│   ├── workflows/       # motor de workflows (engine + pasos)
│   ├── lib/             # brandConfig, artDirection, skills, musicLibrary, users, agentProfile,
│   │                    # companySecrets, auditLog, contextFiles, srt, capabilities…
│   ├── publish/         # meta (IG/FB) + orquestador
│   ├── queue/ web/ scheduler/
├── ARCHITECTURE.md · DEPLOY.md · CLAUDE.md · .env.example
```

## Solución de problemas

| Síntoma | Causa / solución |
|---|---|
| `No se pudo ejecutar 'claude'` (o `codex`, `gemini`…) | El CLI de tu `COPY_PROVIDER` no está instalado o no está en el PATH. Instálalo (tabla de la sección 3) o cambia a `COPY_PROVIDER=anthropic`/`openai` con API key. |
| `El formato "X" no está disponible` | Falta una key de media. `npm run capabilities` te dice exactamente qué falta. |
| El QA visual dice "no soporta visión" | Tu proveedor no puede ver imágenes: usa uno con visión, pon `COPY_VISION=true` si tu modelo sí es multimodal, o ignóralo (las imágenes se aceptan sin revisión). |
| Respuestas JSON inválidas del modelo | El bot reintenta una vez automáticamente. Si persiste, usa un modelo más capaz (`COPY_MODEL`). |
| `ffmpeg falló` | Instala ffmpeg y verifica `ffmpeg -version`. |
| Publicar falla con "asset local" | Para publicar en redes necesitas `ASSET_STORE=s3` (Meta descarga la media por URL). |
| Timeout del agente | Sube `COPY_TIMEOUT_MS` (default 300000 = 5 min). |

## Documentación

- [`DEPLOY.md`](DEPLOY.md) — deploy completo: VPS + systemd + Cloudflare Tunnel + cron + CI/CD.
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — diseño, pipelines y decisiones.
- [`CLAUDE.md`](CLAUDE.md) — instrucciones para trabajar en este repo con un agente.
