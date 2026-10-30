#!/usr/bin/env bash
# =====================================================================
#  backup_bd.sh : copia de seguridad diaria de la base de datos
#
#  1. Vuelca la BD "tienda" con mariadb-dump (en caliente, sin bloquear
#     las ventas gracias a --single-transaction) y la comprime.
#  2. Comprueba que el fichero no está corrupto.
#  3. Borra las copias más antiguas que RETENCION_DIAS (rotación).
#  4. Sincroniza la carpeta con una ubicación externa (otro equipo por
#     SSH o un disco USB montado), si se ha configurado.
#
#  Lo ejecuta cron cada noche como root (ver instalar_backup.sh).
#  Configuración opcional en /etc/default/tienda-backup
# =====================================================================
set -euo pipefail

DIR_COPIAS="/var/backups/tienda"
RETENCION_DIAS=30
DESTINO_EXTERNO=""          # ej: "backup@192.168.1.20:/srv/copias/tienda"  o  "/mnt/usb/tienda"
LOG="/var/log/tienda-backup.log"
[[ -f /etc/default/tienda-backup ]] && source /etc/default/tienda-backup

FECHA="$(date +%Y-%m-%d_%H%M)"
FICHERO="$DIR_COPIAS/tienda_$FECHA.sql.gz"

log() { echo "$(date '+%F %T') $*" | tee -a "$LOG"; }
fallo() { log "ERROR: $*"; exit 1; }

umask 077                    # las copias solo las puede leer root
mkdir -p "$DIR_COPIAS"

log "Inicio de la copia -> $FICHERO"

# Sin --databases: así la copia se puede restaurar con otro nombre de BD
# (necesario para la prueba de restauración).
mariadb-dump --single-transaction --routines --triggers --events \
  --default-character-set=utf8mb4 tienda | gzip -9 > "$FICHERO" \
  || fallo "mariadb-dump ha fallado"

gzip -t "$FICHERO" || fallo "el fichero comprimido está dañado"
zcat "$FICHERO" | tail -n 1 | grep -q "Dump completed" || fallo "el volcado está incompleto"
log "Copia correcta ($(du -h "$FICHERO" | cut -f1))"

BORRADAS=$(find "$DIR_COPIAS" -name 'tienda_*.sql.gz' -mtime +"$RETENCION_DIAS" -print -delete | wc -l)
log "Rotación: $BORRADAS copias de más de $RETENCION_DIAS días borradas"

if [[ -n "$DESTINO_EXTERNO" ]]; then
  if rsync -a --delete "$DIR_COPIAS/" "$DESTINO_EXTERNO/"; then
    log "Sincronizado con $DESTINO_EXTERNO"
  else
    fallo "no se ha podido copiar a $DESTINO_EXTERNO"
  fi
else
  log "AVISO: no hay DESTINO_EXTERNO configurado; la copia solo está en este servidor"
fi

log "Fin"
