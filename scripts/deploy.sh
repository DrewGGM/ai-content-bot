#!/usr/bin/env bash
# Se ejecuta EN EL VPS, invocado por el pipeline de GitHub Actions (ssh 'bash -s').
# Actualiza el codigo de la rama de despliegue, reinstala deps y reinicia el panel.
#
# Variables opcionales (export antes de invocar, o dejar defaults):
#   BOT_DIR  -> ruta del repo en el server   (default: $HOME/content-claude-bot)
#   BRANCH   -> rama a desplegar              (default: main)
#   SERVICE  -> nombre del servicio systemd   (default: content-bot-panel)
set -euo pipefail

BOT_DIR="${BOT_DIR:-$HOME/content-claude-bot}"
BRANCH="${BRANCH:-main}"
SERVICE="${SERVICE:-content-bot-panel}"

echo "→ Deploy en $BOT_DIR (rama $BRANCH)"
cd "$BOT_DIR"

# El .env, queue.json, assets/output y logs son untracked: git reset --hard NO los toca.
git fetch --all --prune
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "→ Instalando dependencias (npm ci)"
npm ci --no-audit --no-fund

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
