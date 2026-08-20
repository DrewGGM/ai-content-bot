# Content Bot — Instrucciones del agente

Bot **genérico** en **Node.js + TypeScript** que genera contenido de redes para cualquier marca
(5 formatos), escribe el copy con el **agente/LLM configurado** (`COPY_PROVIDER`: Claude Code por
defecto; también Codex, Gemini CLI, Qwen Code, OpenCode, comando custom, o APIs Anthropic/OpenAI-
compatibles) y aplica **QA visual** con el mismo proveedor si soporta visión. Human-in-the-loop:
genera → se aprueba en el panel → se publica. Ver `ARCHITECTURE.md`.

## Idioma
Responde y genera contenido en el idioma de la marca (`config/brand.json` → `language`, por
defecto **español**).

## Antes de generar contenido (SIEMPRE)
Lee `config/brand.json` y el contexto: `knowledge/company.md`, `knowledge/products.md`,
`knowledge/faqs.md`, `config/brand.md`, `config/content-strategy.md`. Mantén el tono y los
mensajes clave definidos ahí. No promociones productos marcados como "en desarrollo".

## Comandos
```
npm run reel -- "tema"      # reel b-roll (escena IA animada + overlay)        [fal]
npm run motion -- "tema"    # reel motion-graphics (texto animado, sin fal)
npm run ugc -- "tema"       # reel UGC (avatar HeyGen)                          [HeyGen]
npm run carousel -- "tema"  # carrusel 4-6 imágenes                            [fal]
npm run post -- "tema"      # post imagen única                                [fal]
npm run brandpost -- "tema" # post de marca premium (Nano Banana Pro edit + logo/referencias) [fal]
npm run brandcarousel -- "tema" # carrusel de marca premium (slides consistentes, slide 1 = ancla) [fal]
npm run design -- "tema"    # post de diseño por CÓDIGO (SVG+sharp, sin API de imagen)
npm run plan                # Claude elige formato+tema según historial
npm run set                 # una pieza de cada formato
npm run campaign -- "tema"  # MISMO tema en varios formatos (reel+carrusel+post+diseño)
npm run voices              # lista voces ElevenLabs
npm run panel               # panel de aprobación (http://localhost:4321)
npm run schedule            # scheduler diario (usa el planner)
```

## Reglas clave del sistema
- **No hornear texto/logo dentro de la imagen o video generado por IA** — se distorsiona. El
  titular, logo, subtítulos y CTA van como **capa de overlay en post** (ASS + ffmpeg + sharp).
  EXCEPCIÓN: el formato **`brandpost`** (post de marca premium) SÍ hornea todo, porque usa
  **Nano Banana Pro (Gemini 3 Pro) en modo edit** con el logo real + imágenes de referencia
  (`assets/brand/references/`) como ancla de estilo — ese modelo escribe texto y reproduce el
  logo con calidad. Genérico por rubro (brand.json `industry`); si hay FOTOS DE PRODUCTO
  (`assets/brand/products/`, `brandProductDataUris`) las pasa al modelo para USARLAS como
  protagonistas (ej. restaurante con sus platos reales) — solo fal/openai. Prompt maestro en
  `artDirection.brandPosterPrompt` (+`brandPosterVisualPrompt` para Leonardo); pipeline
  `generateBrandPost.ts`; referencias/productos `src/lib/brandReferences.ts`. Multi-proveedor por
  `IMAGE_PROVIDER`: `fal` (Nano Banana Pro edit, mejor texto/logo), `openai` (gpt-image-1
  `/images/edits`), `leonardo` (init-image + controlnets Style Reference). `generateImage()` pasa
  `referenceImages` al proveedor; `gemini` aún no. OJO: Leonardo NO escribe texto ni reproduce
  logos → `generateBrandPost` le pide SOLO el visual sin texto (`brandPosterVisualPrompt`) y hornea
  titular/subtítulo/CTA/logo/web por código con `overlayBrandPoster` (SVG+sharp). fal/openai sí lo
  hornean en la propia imagen.
- El **copy/planner/edición/QA** pasan SIEMPRE por `askLLM/askLLMJson` de `src/providers/llm.ts`
  (enruta por `COPY_PROVIDER`). No llamar CLIs ni APIs de LLM directamente desde los pipelines.
  Default: Claude Code (`claude -p`) con la suscripción, sin API key.
- El **QA visual** (`src/providers/vision.ts`) revisa imágenes/frames y regenera si hay problemas;
  se salta limpiamente si el proveedor no soporta visión. Configurable con `QA_ATTEMPTS` y
  `VIDEO_QA_ATTEMPTS`.
- El **QA de texto** (`src/pipeline/textQA.ts`, `reviewCopy`) revisa el caption contra la voz de
  marca + reglas aprendidas y lo PULE en sitio antes de encolar (`createContent` lo llama tras
  generar y aplica con `updateCopy`; el caption es independiente del visual, no lo desperdicia).
  Ajuste `TEXT_QA` (bool, default on). Nunca rompe: si falla, deja el copy original.
- **Variantes de hook (A/B)** (`src/pipeline/variants.ts`): `generateHookVariants` propone 2-3
  captions alternativos (distinto gancho); `createContent` los guarda en `QueueItem.variants` (col D1
  auto-migrada). El panel los muestra en un `<details>` con "Usar esta" → `/api/variant` intercambia
  el caption por la variante (reversible: el caption viejo pasa a variante). Ajuste `AB_HOOKS`.
- Motor de video b-roll: `VIDEO_ENGINE=kling` (default) o `veo`.
- **Identidad de marca** (nombre, colores, logo) en `config/brand.json`; el código la lee con
  `src/lib/brandConfig.ts`. No hardcodear nombres/colores de empresa en el código.
- **Imágenes**: usar siempre `generateImage()` de `src/providers/images.ts` (enruta por
  `IMAGE_PROVIDER`: fal/openai/gemini y aplica la dirección de arte). Para agregar un proveedor:
  un archivo `src/providers/<x>Image.ts` + un `case` en `images.ts`.
- **Community manager**: el copy y el planner inyectan el conocimiento de `.agents/skills/` vía
  `src/lib/skills.ts` (`loadSkillGuidance` + `listInstalledSkills`). Toggle `USE_CM_SKILLS`.
- **Capacidades**: `src/lib/capabilities.ts` detecta proveedores + skills → formatos disponibles.
  El planner solo elige formatos viables; el scheduler cae a `design` si algo falla. `npm run capabilities`.
- **Panel multi-usuario + multi-agente**: login por usuario (`src/lib/users.ts`); cada usuario
  tiene su perfil de agente con credenciales cifradas (`src/lib/agentProfile.ts` + `secretBox.ts`)
  y sus jobs corren con ese perfil vía AsyncLocalStorage (`src/lib/activeProfile.ts` —
  `llm.ts` lee env con `envGet()`/`childEnv()`, NUNCA process.env directo para config de copy).
  Asistente de login de Claude Code (`claude setup-token` + node-pty): `src/lib/claudeLogin.ts`.
  Contexto de empresa editable desde el panel (allowlist): `src/lib/contextFiles.ts`.
- **Workflows personalizables**: `src/workflows/engine.ts` (JSON en `config/workflows/*.json`,
  referencias `$paso.salida`) + `steps.ts` (copy/image/animate/tts/subtitles/music/avatar/assemble
  — SIEMPRE envuelven providers existentes, no llaman APIs directo). Se despachan como formato
  `workflow:<nombre>` vía `dispatch.ts` y se editan desde el panel.
- **Música de fondo**: `src/lib/musicLibrary.ts` — biblioteca en `assets/music/` (la IA elige por
  nombre), auto-descarga CC0 de Openverse si está vacía (OJO: sin `category=music`, ese filtro
  devuelve 0), descarga por URL del usuario (`downloadMusicFromUrl`), créditos en `credits.json`.
- **Credenciales de empresa** (tokens de redes + keys de proveedores): `src/lib/companySecrets.ts`,
  cifradas y aplicadas a process.env al arrancar server/scheduler; el `.env` del servidor manda.
- **Ajustes no-secretos** (ej. `IMAGE_PROVIDER`, `ASSET_STORE`, `META_AD_ACCOUNT_ID`,
  `ADS_MAX_DAILY_BUDGET`): `src/lib/appSettings.ts` (tipos enum/text/number/**bool**) —
  configurables desde el panel (Ajustes → Conexiones), `data/app-settings.json` sin cifrar,
  aplicados a process.env con la prioridad del `.env`. Endpoints `/api/settings`. El tipo `bool`
  se pinta como checkbox.
- **Almacenamiento local ↔ R2 desde el panel**: `ASSET_STORE` (local|s3) + `S3_BUCKET`/
  `S3_ENDPOINT`/`S3_REGION`/`S3_PUBLIC_BASE` son ajustes; las llaves (`S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`) van cifradas en `companySecrets.ts`. `setAppSetting` NO deja activar
  `s3` si falta bucket/endpoint/llaves. Los clientes S3 de `lib/assets.ts` y `web/server.ts` se
  cachean **por huella de config** para que un cambio en caliente reconstruya el cliente.
- **Aprendizaje del rechazo** (`src/lib/learnings.ts`): al rechazar en el panel se escribe el
  MOTIVO → se guarda en `QueueItem.feedback` (+`reviewedBy`/`reviewedAt`; en D1 son columnas con
  migración incremental). `learningGuidance()` = reglas destiladas (`config/learnings.md`) +
  motivos crudos recientes, y se inyecta en `generateCopy`, `editCopy` y `planContent`.
  `refreshLearnings()` destila los motivos en reglas permanentes con el LLM (se dispara sola tras
  cada rechazo, en segundo plano, serializada). Editable en el panel (`/api/learnings`).
- **Bucle de rendimiento** (`src/lib/performance.ts`): el bot también aprende de lo que rindió DE
  VERDAD, no solo del rechazo humano. Al publicar se guardan `QueueItem.posts` (id por red); D1
  añade columnas `posts`/`insights` (auto-migradas por `ensureSchema`). `refreshInsights()` jala las
  métricas orgánicas de Meta (IG media insights + FB post; tolerante: cae a like/comments si no hay
  permiso `instagram_manage_insights`), calcula un `score` (guardados/compartidos pesan más) y lo
  guarda. Corre en el cron diario y por botón (`/api/insights/refresh`). `performanceGuidance()` =
  top/peores por engagement, inyectado en `planContent` y `generateCopy` junto a `learningGuidance`.
  Espera `INSIGHTS_MIN_AGE_HOURS` (ajuste, default 48) antes de medir. Solo Meta por ahora.
- **Costo por pieza** (`src/lib/usage.ts`): `track(kind, units)` acumula gasto estimado en un store
  AsyncLocalStorage; `createContent` envuelve la generación con `withUsage()` y adjunta el costo a
  `QueueItem.cost` (col D1 auto-migrada). Instrumentados: `generateImage` (imagen), `askLLM` (copy/QA,
  gratis en CLI), TTS de ElevenLabs (por carácter), `generateVideoFromImage`/`generateTalkingAvatar`.
  Precios ESTIMADOS en `PRICES` (ajustables). Se muestra `≈ $X` en cada card con desglose en tooltip.
- **Permiso de autoedición** (`AI_EDIT_CONTEXT`, checkbox, **off** por defecto): si se activa, la
  IA puede corregir DATOS equivocados en `knowledge/`/`config/` que el feedback demuestre —
  mediante reemplazos puntuales que deben casar **exactamente una vez**, con respaldo `.bak` y
  registro en Actividad (`aiWriteContextFile` en `contextFiles.ts`). Nunca reescribe archivos
  enteros ni toca el estilo.
- **Ads / campañas de Meta**: `src/lib/metaAds.ts` (Graph Marketing API: campaign→adset→creative→ad
  + insights + updates) y `src/pipeline/adsCampaign.ts` (la IA PROPONE con `askBrandJson`, luego
  `launchCampaign` crea en Meta y `optimizeCampaign` ajusta por métricas). Human-in-the-loop:
  se crea PAUSED por defecto, gasto topado por `ADS_MAX_DAILY_BUDGET`. Registro `src/lib/adsStore.ts`
  (`data/ads.json`). Panel: card "Campañas de ads" + endpoints `/api/ads/*`. Guía: `ADS.md`.
  Requiere `META_ADS_TOKEN` (ads_management) + `META_AD_ACCOUNT_ID` + `FACEBOOK_PAGE_ID`.
- **Estilos**: `config/art-direction.md` (si existe) reemplaza la dirección de arte por defecto —
  editable en el panel. Skills activables/subibles desde el panel (`config/skills.json`).
- **Deploy**: Opción A (VPS + cron + Cloudflare Tunnel) documentada en `DEPLOY.md`.
- **Video por código (Remotion)**: `remotion/theme.tsx` (fondo con parallax + grano + viñeta,
  zona segura del móvil, revelado por máscara), `remotion/scenes.tsx` (librería de escenas:
  `hook`/`stat`/`list`/`quote`/`compare`/`cta`) y `remotion/Video.tsx` (reparte la duración por
  peso y aplica la transición entre escenas). **La IA arma la SECUENCIA de escenas**
  (`generateRemotionCopy` → `scenes[]`, saneado por `normalizeScenes`), no un titular fijo: por
  eso dos videos del mismo formato ya no se ven iguales. Regla: nada entra con fade plano, todo
  entra por máscara; el texto vive dentro de la zona segura (la UI de IG/TikTok tapa el ~20%
  inferior). Si añades una escena: tipo en `scenes.tsx` + peso en `WEIGHT` + rama en
  `normalizeScenes` + descripción en el prompt.
- **Subtítulos**: `src/lib/srt.ts` genera ASS **karaoke** (un evento por palabra; la que suena se
  resalta en el color de acento) para los subtítulos y para el overlay del reel b-roll. El
  titular del overlay se retira al ~42% del reel para no competir con los subtítulos.
- **Respuestas a comentarios** (`src/lib/comments.ts`): lee los comentarios de los posts publicados
  (IG/FB, usando `QueueItem.posts`) y la IA REDACTA respuestas en la voz de marca. Solo borrador
  (el humano copia y publica — nunca auto-responde). Endpoint `/api/comments?id=` + botón/modal
  "Responder comentarios" en las cards publicadas. Tolerante: [] si falta permiso de comentarios.
- **Push al móvil** (`src/lib/push.ts`, dep `web-push`): Web Push/VAPID. Claves de env o
  auto-generadas en `data/push.json`; suscripciones en `data/push-subs.json`. El SW (`SW_JS`) maneja
  `push`/`notificationclick`; el panel expone `/api/push/{key,subscribe,test}` y un botón "Avisos".
  Se dispara SOLO desde generación NO atendida (cron/calendario), no la manual. Limpia subs 404/410.
- **Calendario de contenido** (`src/lib/calendar.ts`): slots programados (fecha+hora Colombia,
  formato/tema/plataforma opcionales) en `data/calendar.json`. `planWeek()` llena N días con el LLM
  repartiendo por `BEST_TIMES` (mejores horarios por red). El scheduler in-process de `server.ts`
  procesa `dueSlots()` cada minuto (genera; si el slot no trae tema, usa el planner). Endpoints
  `/api/calendar*` + card en Ajustes. Convive con el "Auto" de una-pieza-al-día (`schedule.json`).
- **Publicar en TikTok** (`src/publish/tiktok.ts`): Content Posting API Direct Post (video + fotos
  por PULL_FROM_URL, polling de estado). Requiere `TIKTOK_ACCESS_TOKEN`; `TIKTOK_PRIVACY` (ajuste).
  El resto de redes en `publish/index.ts` sigue pendiente (LinkedIn/X).
- **Persistencia**: cola/historial `QUEUE_STORE=local|d1` (`src/queue/queue.ts` async + `d1.ts`);
  assets `ASSET_STORE=local|s3` (`src/lib/assets.ts`). `npm run init-db` crea el esquema D1.
  La API de la cola es **async** — usar `await addToQueue/listQueue/updateStatus`.
- **Diseño**: `src/lib/artDirection.ts` destila las skills de diseño (`high-end-visual-design`,
  `frontend-design`) para imágenes premium, con motor de variación de "vibe" por pieza. Si agregas
  skills de diseño nuevas, refleja sus principios aquí (en lenguaje de imagen, NO CSS).

## Dónde está cada cosa
- `src/providers/` — llm (copy multi-agente/API), vision (QA), fal (imagen + image-to-video +
  avatar OmniHuman), elevenlabs (voz), heygen.
- `src/pipeline/` — un generador por formato + `planContent` + `visualQA` + `dispatch`.
- `src/workflows/` — motor de workflows personalizables (engine + steps).
- `src/lib/` — `artDirection`, `brand` (logo real), `musicLibrary`, `skills`, `companySecrets`,
  `users`/`agentProfile`/`activeProfile`, `auditLog`, `contextFiles`, `srt`, `pronunciation`, `env`.
- `src/web/server.ts` — panel. `src/queue/` — cola. `src/scheduler/` — cron.

## Convenciones
- Contenido final → `assets/output/<slug>/`. Marca (logo) → `assets/brand/`; identidad → `config/brand.json`.
- **Nunca commitear `.env`** ni claves (usar `.env.example`).
- El contexto de la empresa vive en `knowledge/` + `config/`; mantenerlo actualizado si la marca cambia.

## Skills instaladas (`.agents/skills/`)
Propias (cortas y densas, van primero en `PRIORITY_FILES`): `platform-specs` (límites duros por
red, con `[OFICIAL]` vs `[PRÁCTICA]`), `hook-writing`, `caption-craft`, `short-form-video`,
`motion-design`.
De terceros: `social-media-generator`, `social-media`, `agentkits-marketing-automation`,
`generate-image`, `high-end-visual-design`, `frontend-design`.

OJO con el presupuesto: `loadSkillGuidance` corta por `PER_FILE` (3500) y `TOTAL_CAP` (26000) y
**descarta el archivo entero si no cabe** (no lo trunca). Si añades skills, revisa el orden de
`PRIORITY_FILES` o suben las nuevas nunca llegarán al prompt.
(El motor del bot ya implementa la generación; las skills son apoyo opcional.)
