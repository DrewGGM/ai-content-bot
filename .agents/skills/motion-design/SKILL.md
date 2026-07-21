---
name: motion-design
description: Principios de motion design para video de texto animado — jerarquía tipográfica, revelado, easing, stagger, zona segura, contraste y cuándo no animar.
triggers:
  - motion
  - texto animado
  - animación
  - tipografía
  - motion graphics
  - kinetic
---

# Motion design (texto animado)

## Una idea por escena
- Cada escena dice UNA cosa. Dos frases que compiten = dos escenas.
- Máx 7 palabras visibles a la vez. Lo demás se parte en tiempo, no en tamaño.
- La escena vive 1.5-3 s: leerla en voz alta + un respiro.

## Jerarquía tipográfica
- Tres niveles máximo: dato/palabra clave (grande), frase de apoyo (medio), etiqueta (pequeño).
- Salto de tamaño real entre niveles (al menos el doble); las diferencias tímidas se leen como error.
- Una sola familia tipográfica: la jerarquía se hace con peso, tamaño y espacio.
- La palabra que importa se resalta por peso, color o escala — solo UNA por escena.
- Titulares en 1-3 renglones, interlineado ajustado. Nunca justificado.

## Revelado: máscara vs fade
- **Máscara/wipe** (el texto se descubre en la dirección de lectura): intención y control. Default para titulares.
- **Fade puro**: neutro y blando; solo para elementos secundarios o para salir.
- **Escala desde 96-104%** en la entrada: da peso sin caricatura. Nunca desde 0 ni con rebote.
- Nada de rotaciones 3D, flips ni typewriter letra por letra en marcas serias.
- La salida es más rápida que la entrada (aprox. la mitad): fade + desplazamiento mínimo.

## Easing y ritmo
- Entradas: arranque suave y frenado largo al final (ease-out marcado). Nunca lineal.
- Duraciones: 250-450 ms para texto, 600-900 ms para fondos y planos grandes.
- El movimiento acompaña la voz: el texto aparece justo antes de la palabra.
- Un solo tipo de movimiento por pieza: la coherencia se nota más que la variedad.

## Stagger
- Elementos de un grupo entran escalonados 60-120 ms, en orden de lectura.
- Máx 4-5 elementos escalonados; más se vuelve espera.
- Nunca escalones dentro de una frase: la frase entra como bloque.

## Zona segura y contraste
- Evita el ~20% inferior y el ~10% superior de la pantalla: la UI de la app los tapa.
- Márgenes laterales generosos: el texto nunca toca el borde.
- Contraste alto obligatorio: si el fondo es imagen o video, oscurécelo o pon un plano de color detrás del texto. Nada de sombras difusas como parche.
- Color: fondo de marca + un acento. El acento se usa en un solo elemento por escena.

## Cuándo NO animar
- Datos comparables, listas de precios o textos legales: entran de golpe y se quedan quietos.
- El último frame se congela: permite la lectura y el screenshot.
- Si el fondo ya se mueve, el texto se queda fijo. Nunca dos cosas moviéndose a la vez.
- Ante la duda: menos movimiento, mejor tipografía.
