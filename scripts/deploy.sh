#!/usr/bin/env bash
# Se ejecuta EN EL VPS, invocado por el pipeline de GitHub Actions (ssh 'bash -s').
# Actualiza el codigo de la rama de despliegue, reinstala deps y reinicia el panel.
#
# Variables opcionales (export antes de invocar, o dejar defaults):
#   BOT_DIR  -> ruta del repo en el server   (default: $HOME/content-claude-bot)
#   BRANCH   -> rama a desplegar              (default: lyroo-demo)
#   SERVICE  -> nombre del servicio systemd   (default: content-bot-panel)
set -euo pipefail

BOT_DIR="${BOT_DIR:-$HOME/content-claude-bot}"
BRANCH="${BRANCH:-main}"
SERVICE="${SERVICE:-content-bot-panel}"

echo "→ Deploy en $BOT_DIR (rama $BRANCH)"
cd "$BOT_DIR"

# El .env, queue.json, assets/output y logs son untracked: git reset --hard NO los toca.
#
# CONTENIDO DE MARCA EDITABLE DESDE EL PANEL (contexto, colores/identidad, logos, workflows,
# skills): estos archivos SÍ están versionados, pero el panel los edita en el server. Para que
# esas ediciones NO se pierdan con `git reset --hard`, se snapshotean antes y se restauran
# después con OVERLAY: lo editado en el server manda, y git solo SIEMBRA los archivos que falten
# (p. ej. una marca nueva o un preset nuevo). git deja de poder pisar/borrar contenido ya editado.
PRESERVE=(knowledge config/brand.json config/brand.md config/content-strategy.md \
          config/calendar.json config/platforms.json config/skills.json config/workflows assets/brand)
SNAP="$(mktemp -d)"
for p in "${PRESERVE[@]}"; do
  if [ -e "$p" ]; then
    mkdir -p "$SNAP/$(dirname "$p")"
    cp -a "$p" "$SNAP/$p" 2>/dev/null || true
  fi
done

git fetch --all --prune
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

# Restaura lo del panel por encima de la versión de git (overlay: no borra lo que git trae nuevo).
for p in "${PRESERVE[@]}"; do
  if [ -d "$SNAP/$p" ]; then
    mkdir -p "$p"
    cp -a "$SNAP/$p/." "$p/" 2>/dev/null || true
  elif [ -e "$SNAP/$p" ]; then
    cp -a "$SNAP/$p" "$p" 2>/dev/null || true
  fi
done
rm -rf "$SNAP"

echo "→ Instalando dependencias (npm ci)"
npm ci --no-audit --no-fund

# Librerías del sistema que necesita el Chromium headless de Remotion. Si faltan, el
# navegador muere con exit 127 ("Failed to launch the browser process"). Idempotente;
# por paquete (en Ubuntu 24 libasound2 es virtual y no debe tumbar el resto); no rompe el deploy.
if command -v apt-get >/dev/null 2>&1; then
  echo "→ Asegurando librerías del sistema para Chromium (Remotion)"
  APT="apt-get"; [ "$(id -u)" != "0" ] && APT="sudo -n apt-get"
  $APT update -qq >/dev/null 2>&1 || true
  for pkg in libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
             libxkbcommon0 libxkbcommon-dev libxcomposite1 libxdamage1 libxfixes3 \
             libxrandr2 libgbm1 libgbm-dev libasound2 libasound2t64 \
             libpango-1.0-0 libcairo2 libglib2.0-0 libstdc++6 libgcc-s1; do
    $APT install -y "$pkg" >/dev/null 2>&1 || true
  done
fi

# Verifica que el ffmpeg del compositor de Remotion EJECUTA (encoding/audio). Si no,
# imprime en el log del deploy exactamente qué librería falta (exit 127 → ldd).
COMP_FFMPEG=$(ls node_modules/@remotion/compositor-*/ffmpeg 2>/dev/null | head -1)
if [ -n "$COMP_FFMPEG" ]; then
  chmod +x "$COMP_FFMPEG" 2>/dev/null || true
  if "$COMP_FFMPEG" -version >/dev/null 2>&1; then
    echo "→ ffmpeg de Remotion OK"
  else
    echo "⚠ El ffmpeg de Remotion NO ejecuta. Librerías faltantes según ldd:"
    ldd "$COMP_FFMPEG" 2>/dev/null | grep "not found" || echo "  (ldd no reporta faltantes: revisa permisos/arquitectura/noexec en la partición)"
  fi
else
  echo "⚠ No se encontró el compositor de Remotion en node_modules (¿npm ci omitió optionalDependencies?)"
fi

# Chromium headless para Remotion (video por código). Idempotente; solo descarga la 1ª vez.
echo "→ Asegurando Chromium de Remotion"
npx remotion browser ensure || echo "⚠ no se pudo asegurar Chromium (Remotion) — el video Remotion podría fallar hasta instalarlo"

# Reinicia el panel. Intenta con y sin sudo; si el servicio no existe todavia,
# no rompe el deploy (solo avisa). Robusto ante PATH/entorno del SSH no interactivo.
echo "→ Reiniciando ${SERVICE}"
if sudo -n systemctl restart "${SERVICE}" 2>/dev/null \
   || systemctl restart "${SERVICE}" 2>/dev/null; then
  echo "  ${SERVICE} reiniciado"
else
  echo "⚠ No se pudo reiniciar ${SERVICE} (¿existe el servicio systemd? ver DEPLOY.md seccion 5)"
fi

echo "✓ Deploy OK: $(git rev-parse --short HEAD)"
