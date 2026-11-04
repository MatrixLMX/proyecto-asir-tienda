#!/usr/bin/env bash
# =====================================================================
#  copia.sh : copia de seguridad de la BD de producción (Docker)
#
#  Vuelca la BD en caliente, comprueba que está completa y borra las
#  copias de más de 30 días. Lo ejecuta cron cada noche. Las copias se
#  quedan en este servidor: hay que bajarlas con descargar_copias.ps1.
# =====================================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DIR_COPIAS="${DIR_COPIAS:-/var/backups/tienda}"
RETENCION_DIAS="${RETENCION_DIAS:-30}"
DC=(docker compose -f "$REPO/docker-compose.prod.yml" --env-file "${ENV_FILE:-$REPO/.env}")
FICHERO="$DIR_COPIAS/tienda_$(date +%Y-%m-%d_%H%M).sql.gz"

log() { echo "$(date '+%F %T') $*"; }
fallo() { log "ERROR: $*"; rm -f "$FICHERO"; exit 1; }

umask 077
mkdir -p "$DIR_COPIAS"

# Sin --databases: se puede restaurar con otro nombre (prueba de restauración)
"${DC[@]}" exec -T db sh -c 'exec mariadb-dump -uroot -p"$MARIADB_ROOT_PASSWORD" --single-transaction --routines --triggers --events --default-character-set=utf8mb4 tienda' \
  | gzip -9 > "$FICHERO" || fallo "mariadb-dump ha fallado"

gzip -t "$FICHERO" || fallo "el fichero está dañado"
gzip -dc "$FICHERO" | tail -n 1 | grep -q "Dump completed" || fallo "el volcado está incompleto"

# Que la pueda descargar el dueño de la carpeta, sin usar root
chown "$(stat -c %u "$DIR_COPIAS")" "$FICHERO" 2>/dev/null || true
find "$DIR_COPIAS" -name 'tienda_*.sql.gz' -mtime +"$RETENCION_DIAS" -delete
log "Copia correcta: $FICHERO ($(du -h "$FICHERO" | cut -f1))"
