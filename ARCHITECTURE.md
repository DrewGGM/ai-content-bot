# Arquitectura — Content Bot

Bot de contenido **multicanal** con **aprobación humana**, genérico para cualquier marca. Genera
5 tipos de pieza, escribe el copy con el agente/LLM configurado (COPY_PROVIDER: Claude Code por
defecto; también Codex, Gemini, Qwen, Kimi, Cursor, Copilot, OpenCode, un comando custom o APIs
Anthropic/OpenAI-compatibles), aplica QA visual con el mismo proveedor
(visión), y deja todo en una cola revisable en un panel web. La identidad de la marca (nombre,
colores, logo) sale de `config/brand.json`; el contexto largo (qué hace, productos, tono) de
`knowledge/` + `config/`. **No hay nada de empresa hardcodeado en el código.**

---

## 1. Decisiones de diseño

| Área | Decisión |
|---|---|
| Automatización | Human-in-the-loop: el bot genera, tú apruebas en el panel, luego (Fase 4) publica |
| Plataformas | Instagram, TikTok, Facebook, LinkedIn/X |
| Stack | Node.js + TypeScript (tsx) |
| Copy | **Multi-agente/API** (`src/providers/llm.ts`, env `COPY_PROVIDER`): Claude Code headless por default (suscripción, sin API key); también Codex/Gemini/Qwen/Kimi/Cursor/Copilot/OpenCode/custom o APIs Anthropic/OpenAI-compatibles |
| QA visual | El **mismo proveedor de copy** si soporta visión (`src/providers/vision.ts`); se salta limpiamente si no |
| Imágenes | fal.ai **Nano Banana Pro** (Google Gemini 3 Pro), 2K/4K |
| Video b-roll | fal.ai **Kling 2.5 Turbo Pro** (default) o **Veo 3** (`VIDEO_ENGINE=veo`) |
| Motion-graphics | ffmpeg + fondo de marca (sin IA de imagen, sin fal) |
| UGC | **HeyGen** (avatar hablando) |
| Voz | ElevenLabs (voces de catálogo en español) con pronunciación de marca corregida |
| Contexto | Archivos estructurados en `knowledge/` + `config/` (migrable a RAG) |
| Disparo | On-demand (CLI) o programado (Programador de Tareas de Windows → `npm run schedule`) |

---

## 2. Los 5 formatos y sus pipelines

### Principio rector (anuncios)
> En contenido generado por IA, **NO se hornea texto ni logo dentro de la imagen/video** (se
> distorsiona). El texto, logo, subtítulos y CTA se añaden como **capa de overlay en post**.

### `reel` — b-roll cinematográfico + overlay  ⭐ (el enfoque de anuncio)
```
copy (Claude) → escena fotorrealista SIN texto (Nano Banana Pro) + QA visual
  → animar (Kling/Veo) + QA de frame (re-anima si distorsiona)
  → voz (ElevenLabs, pronunciación) + subtítulos
  → capa overlay nítida (titular + subtítulos + CTA) + LOGO real
  → reel.mp4 (ffmpeg)
```

### `motion` — motion-graphics (sin fal)
```
copy (Claude) → fondo de marca animado (gradiente + orbes + grano)
  → voz + capa overlay kinética (titular + subtítulos + CTA) + logo → reel.mp4
```

### `ugc` — avatar HeyGen
```
guion (Claude) → avatar hablando (HeyGen) → overlay logo + titular/CTA → reel.mp4
```

### `carousel` — 4-6 imágenes 4:5
```
copy (Claude) → por slide: imagen (Nano Banana Pro 4K) + QA visual + logo real → cola
```

### `post` — imagen única 1:1
```
copy (Claude) → imagen (Nano Banana Pro 4K) + QA visual + logo real → cola
```

### `design` — poster por CÓDIGO (sin IA de imagen, sin API de pago)
```
copy (Claude) → render SVG+sharp (src/lib/designPoster.ts: gradiente, glass card, eyebrow,
tipografía, sombras suaves) + logo real → cola
```
Aplica los principios de las design skills 100% por código. Útil cuando no quieres gastar en IA.

---

## 3. QA visual en loop

`src/providers/vision.ts` → `reviewImage()` usa el proveedor de copy (COPY_PROVIDER) para que el
modelo **vea** la imagen (los CLIs la leen del disco con sus tools; las APIs la reciben en base64)
y devuelva `{ ok, score, issues, improvedPrompt }`. Si el proveedor no soporta visión, el QA se
salta y las imágenes se aceptan.
`src/pipeline/visualQA.ts` → `generateReviewedImage()` hace **generar → revisar → regenerar** con el
prompt mejorado (hasta `QA_ATTEMPTS`). Los reels además revisan un frame del clip y **re-animan**
si hay distorsión (`VIDEO_QA_ATTEMPTS`). Esto corrige: costuras/bandas, texto garabateado,
tachados a medias, logos falsos incrustados, composición amontonada, distorsión de movimiento.

---

## 4. Marca, voz y overlay

- **Logo real** (`src/lib/brand.ts`): rasteriza `logo-horizontal-white.svg` y lo compone con un
  *scrim* degradado suave (sin banda dura). En imágenes vía sharp; en video vía overlay de ffmpeg.
- **Dirección de arte** (`src/lib/artDirection.ts`): se inyecta en todos los prompts de imagen.
- **Overlay de texto** (`src/lib/srt.ts` → `buildReelOverlayAss`): titular + subtítulos
  sincronizados (timestamps de ElevenLabs) + CTA, en `.ass` a 1080×1920, posición controlada.
- **Pronunciación** (`knowledge/voice.json` + `src/lib/pronunciation.ts`): si tu marca se lee
  distinto a como se escribe, mapea `say` (escritura→fonética para el TTS) y `show`
  (fonética→marca real para el subtítulo).

---

## 5. Planificador y cola

- **Planner** (`src/pipeline/planContent.ts`): Claude lee el historial + un **análisis** (`historyAnalysis`
  en `src/history.ts`: formatos/pilares usados, qué se **aprobó** vs **rechazó**, temas recientes) y
  elige el próximo **formato + tema** — reforzando lo aprobado y evitando ángulos rechazados.
- **Design poster**: 4 variantes de layout (`checklist | stat | quote | feature`), elegidas por Claude
  según el mensaje; renderizadas por código en `src/lib/designPoster.ts`.
- **Cola / historial** (`src/queue/queue.ts`, API async): backend configurable por `QUEUE_STORE` —
  `local` (`queue.json`) o `d1` (**Cloudflare D1** vía REST, `src/queue/d1.ts`; `npm run init-db`
  crea la tabla). Cada pieza con estado `pending | approved | rejected | published`. Es la **única
  fuente de verdad** del historial (el análisis del planner se deriva de aquí).
- **Assets** (`src/lib/assets.ts`): `local` (`assets/output/`) o `s3` (**S3 / Cloudflare R2**) según
  `ASSET_STORE`. En S3 cada pieza sube su media y el item guarda URLs públicas; el panel las sirve
  directo. Con D1 + R2 el deploy queda **stateless**.
- **Panel** (`src/web/server.ts`): lista la cola con video/carrusel/imagen, botones
  Aprobar/Rechazar y **Descargar**; iconografía SVG (sin emojis en la UI).

---

## 5b. Usuarios del panel y multi-cuenta de agentes IA

- **Login por usuario** (`src/lib/users.ts`, `data/users.json`, scrypt): el primer arranque pide
  crear el admin (si `PANEL_PASSWORD` existe, se exige como código de instalación). Los admin
  gestionan usuarios y el contexto de empresa; todos configuran su propio agente.
- **Perfil de agente por usuario** (`src/lib/agentProfile.ts`, `data/agents/<id>.json`):
  `COPY_PROVIDER/COPY_MODEL/COPY_VISION` propios + credenciales **cifradas en reposo**
  (`src/lib/secretBox.ts`, AES-256-GCM con `PANEL_SECRET` o `data/.secret-key`). Los secretos
  son write-only hacia la UI.
- **Perfil activo por job** (`src/lib/activeProfile.ts`, AsyncLocalStorage): cada job del panel
  corre con `runWithProfile(perfil del usuario)`; `llm.ts` lee la config vía `envGet()` y lanza
  los CLIs con `childEnv()`. La pieza automática diaria usa el perfil de quien guardó la
  programación. Sin perfil (CLI/scheduler clásico) todo cae a `process.env` como antes.
- **Multi-cuenta de Claude Code en un servidor**: cada usuario guarda su
  `CLAUDE_CODE_OAUTH_TOKEN` (token de 1 año de su suscripción). El **asistente del panel**
  (`src/lib/claudeLogin.ts`) corre `claude setup-token` en un pseudo-terminal (node-pty,
  dependencia opcional): muestra la URL OAuth, el usuario autoriza y pega el código, y el token
  queda cifrado en su perfil. Fallback manual: correr `claude setup-token` en tu máquina y pegar
  el token. Al usar token de usuario se limpian `ANTHROPIC_API_KEY/AUTH_TOKEN` del entorno hijo
  (tienen prioridad sobre el token en el CLI). `isolateCli` da además `CLAUDE_CONFIG_DIR` y
  `CODEX_HOME` propios bajo `data/agents/<id>/`.
- **Editor de contexto** (`src/lib/contextFiles.ts`, solo admin): edita `knowledge/*` y
  `config/*` (allowlist estricta, JSON validado) desde el panel; `brand.json` aplica en caliente
  (la config de marca se lee fresca en cada generación). Ojo: en deploys por `git pull`, las
  ediciones del servidor pueden chocar con cambios del repo en esos archivos.

---

## 6. Proveedores externos (env)

| Proveedor | Uso | Variables |
|---|---|---|
| ElevenLabs | Voz | `ELEVENLABS_API_KEY` |
| **Imagen (intercambiable)** | `src/providers/images.ts` enruta por `IMAGE_PROVIDER` | `IMAGE_PROVIDER` |
| · fal.ai | Nano Banana Pro (default) + video Kling/Veo | `FAL_KEY`, `VIDEO_ENGINE` |
| · OpenAI | gpt-image-1 | `OPENAI_API_KEY` |
| · Gemini | gemini-2.5-flash-image (Nano Banana) | `GEMINI_API_KEY` |
| HeyGen | UGC avatar | `HEYGEN_API_KEY`, `HEYGEN_AVATAR_ID`, `HEYGEN_VOICE_ID` |
| Claude Code | Copy + QA visual | (suscripción, sin key) |
| Meta/TikTok/LinkedIn/X | Publicación (Fase 4) | tokens respectivos |

**Proveedor de imagen:** `generateImage()` en `src/providers/images.ts` aplica la dirección de arte
y enruta a `falImage` / `openaiImage` / `geminiImage`. Agregar otro proveedor = un archivo + un `case`.

**Conciencia de capacidades:** `src/lib/capabilities.ts` (`detectCapabilities`) detecta qué
proveedores hay (voz=ElevenLabs+voiceId, imagen=fal/openai/gemini, video=fal, ugc=HeyGen) y qué
**skills** están instaladas, y deriva los **formatos disponibles**. El planner solo ofrece esos
formatos; el scheduler cae a `design` si la generación falla. `npm run capabilities` lo reporta.

**Conocimiento de community manager:** `src/lib/skills.ts` — `listInstalledSkills()` enumera las
skills de `.agents/skills/` (nombre+descripción); `loadSkillGuidance()` inyecta el conocimiento CM
(playbook, engagement, mecánicas virales, algoritmos, formatos) en los prompts de copy y del
planner. Las skills de diseño alimentan la dirección de arte. Toggle `USE_CM_SKILLS` (default true).

**Dirección de arte (diseño):** `src/lib/artDirection.ts` destila las skills de diseño instaladas
(`high-end-visual-design`, `frontend-design`) en lenguaje apto para modelos de imagen (no CSS), con
un motor de variación que rota el "vibe" por pieza (ethereal glass / soft / editorial / cinematic
3D) dentro de la paleta de marca. Se aplica a TODA imagen vía `images.ts` → `withArtDirection`.

fal se llama por **REST directo** (`fal.run` síncrono ≤2K, `queue.fal.run` submit/poll para 4K y
video) con reintentos (`fetchRetry`).

---

## 7. Roadmap por fases

- **Fase 0-3 (hecho):** contexto, generación de los 5 formatos, QA visual, panel, planner, scheduler.
- **Fase 4 (pendiente):** publicación automática (empezar por Instagram, Meta Graph API) tras aprobación.
- **Fase 5:** métricas, A/B de variantes, migrar contexto a RAG.

---

## 8. Personalización por marca (config/brand.json)

Toda la identidad sale de `config/brand.json` (leído por `src/lib/brandConfig.ts`) e inyectada en:
- prompts de copy (nombre de marca) y de imagen (`paleta = primary → accent`),
- dirección de arte (`src/lib/artDirection.ts`),
- subtítulos `.ass` (borde = primary, CTA = accent),
- fondo de motion-graphics (`src/lib/motionBg.ts`),
- scrim del logo y fondo del avatar HeyGen,
- tema y título del panel.

El contexto de negocio (tono, productos, datos) va en `knowledge/*` y `config/*.md`, que el bot
concatena y pasa a Claude como CONTEXTO DE MARCA en cada generación. **Rellena esos archivos para
adaptar el bot a tu empresa** — no se toca código.
