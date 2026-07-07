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
npm run design -- "tema"    # post de diseño por CÓDIGO (SVG+sharp, sin API de imagen)
npm run plan                # Claude elige formato+tema según historial
npm run set                 # una pieza de cada formato
npm run voices              # lista voces ElevenLabs
npm run panel               # panel de aprobación (http://localhost:4321)
npm run schedule            # scheduler diario (usa el planner)
```

## Reglas clave del sistema
- **No hornear texto/logo dentro de la imagen o video generado por IA** — se distorsiona. El
  titular, logo, subtítulos y CTA van como **capa de overlay en post** (ASS + ffmpeg + sharp).
- El **copy/planner/edición/QA** pasan SIEMPRE por `askLLM/askLLMJson` de `src/providers/llm.ts`
  (enruta por `COPY_PROVIDER`). No llamar CLIs ni APIs de LLM directamente desde los pipelines.
  Default: Claude Code (`claude -p`) con la suscripción, sin API key.
- El **QA visual** (`src/providers/vision.ts`) revisa imágenes/frames y regenera si hay problemas;
  se salta limpiamente si el proveedor no soporta visión. Configurable con `QA_ATTEMPTS` y
  `VIDEO_QA_ATTEMPTS`.
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
- **Deploy**: Opción A (VPS + cron + Cloudflare Tunnel) documentada en `DEPLOY.md`.
- **Persistencia**: cola/historial `QUEUE_STORE=local|d1` (`src/queue/queue.ts` async + `d1.ts`);
  assets `ASSET_STORE=local|s3` (`src/lib/assets.ts`). `npm run init-db` crea el esquema D1.
  La API de la cola es **async** — usar `await addToQueue/listQueue/updateStatus`.
- **Diseño**: `src/lib/artDirection.ts` destila las skills de diseño (`high-end-visual-design`,
  `frontend-design`) para imágenes premium, con motor de variación de "vibe" por pieza. Si agregas
  skills de diseño nuevas, refleja sus principios aquí (en lenguaje de imagen, NO CSS).

## Dónde está cada cosa
- `src/providers/` — llm (copy multi-agente/API), vision (QA), fal (imagen+video), elevenlabs (voz), heygen.
- `src/pipeline/` — un generador por formato + `planContent` + `visualQA` + `dispatch`.
- `src/lib/` — `artDirection`, `brand` (logo real), `motionBg`, `srt` (subtítulos/overlay),
  `pronunciation`, `env`.
- `src/web/server.ts` — panel. `src/queue/` — cola. `src/scheduler/` — cron.

## Convenciones
- Contenido final → `assets/output/<slug>/`. Marca (logo) → `assets/brand/`; identidad → `config/brand.json`.
- **Nunca commitear `.env`** ni claves (usar `.env.example`).
- El contexto de la empresa vive en `knowledge/` + `config/`; mantenerlo actualizado si la marca cambia.

## Skills instaladas (`.agents/skills/`)
`social-media-generator`, `social-media`, `agentkits-marketing-automation`, `generate-image`.
(El motor del bot ya implementa la generación; las skills son apoyo opcional.)
