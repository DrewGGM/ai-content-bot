# assets/brand — Logo de tu marca

Pon aquí el **logo de tu empresa**. El bot lo superpone (con un degradado suave) en la parte
superior de cada pieza.

## Qué reemplazar
- **`logo-horizontal-white.svg`** — logo horizontal **en blanco**, fondo transparente. Es el que
  usa el bot por defecto (placeholder incluido — reemplázalo por el tuyo).

## Configuración
El nombre del archivo se define en `config/brand.json` → `logoFile`. Si tu logo se llama distinto
(ej. `mi-logo.svg`), pon ese nombre ahí.

## Recomendaciones
- Formato **SVG** (se rasteriza nítido a cualquier tamaño). PNG transparente también sirve.
- Versión **blanca** (los fondos de las piezas son de color/oscuros).
- Proporción horizontal (~2.3:1). El bot lo escala a ~28% del ancho de la imagen.
