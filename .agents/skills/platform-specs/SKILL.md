---
name: platform-specs
description: Límites duros y formatos por plataforma (Instagram, Facebook, TikTok, LinkedIn) — caracteres, hashtags, relación de aspecto, duración y señales de ranking. Datos oficiales separados de la práctica recomendada.
triggers:
  - límites
  - specs
  - hashtags
  - caracteres
  - duración
  - relación de aspecto
  - algoritmo
---

# Specs por plataforma (jul-2026)

`[OFICIAL]` = límite o declaración de la plataforma. `[PRÁCTICA]` = consenso, no garantizado.
No inventes números fuera de esta lista.

## Instagram
- `[OFICIAL]` Caption: 2.200 caracteres máx (Graph API). Menciones @: 20 máx.
- `[OFICIAL]` **Hashtags: 5 máx por post o reel** desde dic-2025 (anuncio de Instagram). La doc vieja de la API todavía dice 30 — manda el 5. Nunca superes 5.
- `[OFICIAL]` Recomendación de Instagram: pocos hashtags específicos, no muchos genéricos. Mosseri: los hashtags NO aumentan el alcance de forma significativa.
- `[OFICIAL]` Mosseri: los captions largos NO aumentan el alcance. Escribe por claridad.
- `[OFICIAL]` Feed: relación de aspecto entre 4:5 y 1.91:1. Recomendado 1080x1350 (4:5).
- `[OFICIAL]` Carrusel: 10 slides máx vía API (20 en la app). TODAS las slides se recortan a la relación de aspecto de la PRIMERA → diseña la slide 1 con la proporción final.
- `[OFICIAL]` Reels: 3 s mín, 15 min máx (API). 9:16, 1080x1920. Reels de más de 3 minutos NO se recomiendan a no-seguidores.
- `[PRÁCTICA]` Punto dulce de alcance: 7-30 s.
- `[OFICIAL]` Ranking de Reels: predice si lo vas a RECOMPARTIR, verlo completo, darle like e ir a la página del audio → optimiza para que se comparta y se termine. Fotos y carruseles CON audio entran al feed de Reels.

## Facebook
- `[OFICIAL]` Reels: 3-90 segundos. 9:16, 1080x1920 recomendado.
- `[PRÁCTICA]` Los hashtags casi no aportan descubrimiento: 0-2 o ninguno.

## TikTok
- `[OFICIAL]` Caption: 2.200 caracteres vía API (en la app son 4.000, pero publicando por API manda 2.200).
- `[OFICIAL]` Ranking: pondera interacciones del usuario, información del video (captions, sonidos, hashtags) y ajustes de dispositivo (menos peso). Ni el número de seguidores ni el rendimiento previo son factores directos → cada video parte casi de cero. Terminar un video largo pesa más que señales débiles.
- `[PRÁCTICA]` Sin tope documentado de hashtags: usa 3-5 relevantes. #fyp / #foryou no sirven.
- `[OFICIAL]` 9:16, 1080x1920. `[PRÁCTICA]` Punto dulce: 21-34 s.

## LinkedIn
- `[OFICIAL]` Texto: 3.000 caracteres. Video: 3 s a 10 min, relación de 1:2.4 a 2.4:1.
- `[PRÁCTICA]` Punto dulce: 30-90 s. Subtítulos quemados siempre: arranca en silencio.
- `[PRÁCTICA]` Hashtags: 3-5.

## Transversal
- `[OFICIAL/regla de diseño]` En video vertical evita el ~20% inferior y el ~10% superior de la pantalla: la UI de la app los tapa.
