#!/usr/bin/env bash
# =====================================================================
#  actualizar.sh : instala la última versión de GitHub en producción
#
#  Uso:  cd /opt/tienda && sudo bash scripts/produccion/actualizar.sh
# =====================================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DC=(docker compose -f "$REPO/docker-compose.prod.yml" --env-file "$REPO/.env")

bash "$REPO/scripts/produccion/copia.sh"

ANTES="$(git -C "$REPO" rev-parse HEAD)"
git -C "$REPO" pull --ff-only

"${DC[@]}" up -d --build
docker image prune -f >/dev/null

if ! git -C "$REPO" diff --quiet "$ANTES" HEAD -- sql/; then
  echo -e "\e[1;33mAVISO:\e[0m esta versión cambia ficheros de sql/ y NO se aplican solos a una BD con datos."
  echo "Hay que aplicar esos cambios a mano antes de usar la nueva versión:"
  git -C "$REPO" diff --stat "$ANTES" HEAD -- sql/
fi
echo "Actualizada a $(git -C "$REPO" log -1 --format='%h %s')"
