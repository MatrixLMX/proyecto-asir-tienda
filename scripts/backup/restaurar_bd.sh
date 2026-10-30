#!/usr/bin/env bash
# =====================================================================
#  restaurar_bd.sh : restaura una copia de seguridad
#
#  Uso:
#    sudo bash restaurar_bd.sh                       # PRUEBA: última copia en "tienda_prueba"
#    sudo bash restaurar_bd.sh <copia.sql.gz>        # PRUEBA con una copia concreta
#    sudo bash restaurar_bd.sh <copia.sql.gz> tienda # RESTAURACIÓN REAL (pide confirmación)
#
#  En modo prueba no se toca la BD de producción: se restaura en otra
#  base de datos y se comparan los registros de cada tabla.
# =====================================================================
set -euo pipefail

DIR_COPIAS="/var/backups/tienda"
COPIA="${1:-$(ls -1t "$DIR_COPIAS"/tienda_*.sql.gz 2>/dev/null | head -n 1)}"
DESTINO="${2:-tienda_prueba}"

[[ $EUID -eq 0 ]] || { echo "Ejecuta este script como root (sudo)."; exit 1; }
[[ -f "$COPIA" ]] || { echo "No encuentro la copia: '$COPIA'"; exit 1; }
gzip -t "$COPIA" || { echo "La copia está dañada"; exit 1; }

echo "Copia:   $COPIA"
echo "Destino: base de datos '$DESTINO'"

if [[ "$DESTINO" == "tienda" ]]; then
  echo -e "\e[1;31mATENCIÓN:\e[0m se van a SUSTITUIR todos los datos actuales de la tienda."
  read -rp "Escribe RESTAURAR para continuar: " ok
  [[ "$ok" == "RESTAURAR" ]] || { echo "Cancelado."; exit 1; }
  # Antes de machacar nada, copia de lo que hay ahora
  if command -v tienda-backup >/dev/null; then tienda-backup; else bash "$(dirname "$0")/backup_bd.sh"; fi
  systemctl stop tienda-api 2>/dev/null || true
fi

INICIO=$(date +%s)
mariadb -e "DROP DATABASE IF EXISTS \`$DESTINO\`;
            CREATE DATABASE \`$DESTINO\` CHARACTER SET utf8mb4 COLLATE utf8mb4_spanish_ci;"
zcat "$COPIA" | mariadb "$DESTINO"
echo "Restaurada en $(( $(date +%s) - INICIO )) s"

[[ "$DESTINO" == "tienda" ]] && systemctl start tienda-api 2>/dev/null || true

if [[ "$DESTINO" != "tienda" ]]; then
  echo
  echo "Comparación con producción (registros por tabla):"
  printf "%-16s %12s %12s\n" "TABLA" "PRODUCCIÓN" "RESTAURADA"
  for t in $(mariadb -N -e "SELECT table_name FROM information_schema.tables
                            WHERE table_schema='tienda' AND table_type='BASE TABLE' ORDER BY 1"); do
    a=$(mariadb -N -e "SELECT COUNT(*) FROM tienda.\`$t\`")
    b=$(mariadb -N -e "SELECT COUNT(*) FROM \`$DESTINO\`.\`$t\`")
    printf "%-16s %12s %12s %s\n" "$t" "$a" "$b" "$([[ $a == "$b" ]] && echo OK || echo '<- distinto (ventas posteriores a la copia)')"
  done
  echo
  echo "Triggers restaurados: $(mariadb -N -e "SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema='$DESTINO'")"
  echo "Vistas restauradas:   $(mariadb -N -e "SELECT COUNT(*) FROM information_schema.views WHERE table_schema='$DESTINO'")"
  echo
  echo "Cuando acabes de revisar:  sudo mariadb -e 'DROP DATABASE $DESTINO'"
fi
