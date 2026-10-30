#!/usr/bin/env bash
# =====================================================================
#  instalar_backup.sh : programa la copia diaria con cron
#
#  Uso: sudo bash scripts/backup/instalar_backup.sh
# =====================================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
[[ $EUID -eq 0 ]] || { echo "Ejecuta este script como root (sudo)."; exit 1; }

install -m 750 "$REPO/scripts/backup/backup_bd.sh"    /usr/local/sbin/tienda-backup
install -m 750 "$REPO/scripts/backup/restaurar_bd.sh" /usr/local/sbin/tienda-restaurar

if [[ ! -f /etc/default/tienda-backup ]]; then
  cat > /etc/default/tienda-backup <<'EOF'
# Configuración de las copias de seguridad de la tienda
RETENCION_DIAS=30
# Copia fuera del servidor (déjalo vacío para desactivarlo):
#   otro equipo por SSH:  DESTINO_EXTERNO="backup@192.168.1.20:/srv/copias/tienda"
#   disco USB montado:    DESTINO_EXTERNO="/mnt/usb/tienda"
DESTINO_EXTERNO=""
EOF
fi

# Todos los días a las 22:30 (después del cierre)
cat > /etc/cron.d/tienda-backup <<'EOF'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 22 * * * root /usr/local/sbin/tienda-backup >/dev/null 2>&1
EOF
chmod 644 /etc/cron.d/tienda-backup

echo "Copia programada a las 22:30. Haciendo una primera copia de prueba..."
/usr/local/sbin/tienda-backup
echo
echo "Ahora prueba la restauración:  sudo tienda-restaurar"
