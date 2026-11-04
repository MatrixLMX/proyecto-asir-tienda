#!/usr/bin/env bash
# =====================================================================
#  restaurar.sh : restaura una copia en la BD de producción (Docker)
#
#    sudo bash restaurar.sh                  # PRUEBA con la última copia
#    sudo bash restaurar.sh <copia.sql.gz>   # PRUEBA con esa copia
#    sudo bash restaurar.sh <copia.sql.gz> real   # SUSTITUYE los datos
#
#  La prueba restaura en "tienda_prueba", compara los registros de cada
#  tabla con los actuales y la borra: no toca los datos de la tienda.
# =====================================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DIR_COPIAS="${DIR_COPIAS:-/var/backups/tienda}"
DC=(docker compose -f "$REPO/docker-compose.prod.yml" --env-file "${ENV_FILE:-$REPO/.env}")
COPIA="${1:-$(ls -1t "$DIR_COPIAS"/tienda_*.sql.gz 2>/dev/null | head -n 1)}"
MODO="${2:-prueba}"

[[ -f "$COPIA" ]] || { echo "No encuentro la copia: '$COPIA'"; exit 1; }
gzip -t "$COPIA" || { echo "La copia está dañada."; exit 1; }

sql() { "${DC[@]}" exec -T db sh -c 'exec mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -N "$@"' _ "$@"; }
cargar() {
  sql -e "DROP DATABASE IF EXISTS \`$1\`; CREATE DATABASE \`$1\` CHARACTER SET utf8mb4 COLLATE utf8mb4_spanish_ci;"
  gzip -dc "$COPIA" | sql "$1"
}

echo "Copia: $COPIA"
if [[ "$MODO" == "real" ]]; then
  echo -e "\e[1;31mATENCIÓN:\e[0m se van a SUSTITUIR todos los datos actuales de la tienda."
  read -rp "Escribe RESTAURAR para continuar: " ok
  [[ "$ok" == "RESTAURAR" ]] || { echo "Cancelado."; exit 1; }
  # Antes de sustituir nada, copia de lo que hay ahora
  bash "$REPO/scripts/produccion/copia.sh"
  "${DC[@]}" stop backend
  cargar tienda
  "${DC[@]}" start backend
  echo "Restaurada."
  exit 0
fi

cargar tienda_prueba
printf "%-20s %12s %12s\n" TABLA ACTUAL COPIA
DISTINTAS=0
for t in $(sql -e "SELECT table_name FROM information_schema.tables WHERE table_schema='tienda' AND table_type='BASE TABLE' ORDER BY 1" | tr -d '\r'); do
  a="$(sql -e "SELECT COUNT(*) FROM tienda.\`$t\`" | tr -d '\r')"
  b="$(sql -e "SELECT COUNT(*) FROM tienda_prueba.\`$t\`" | tr -d '\r')"
  [[ "$a" == "$b" ]] || DISTINTAS=$((DISTINTAS + 1))
  printf "%-20s %12s %12s\n" "$t" "$a" "$b"
done
echo "Triggers en la copia: $(sql -e "SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema='tienda_prueba'" | tr -d '\r')"
echo "Vistas en la copia:   $(sql -e "SELECT COUNT(*) FROM information_schema.views WHERE table_schema='tienda_prueba'" | tr -d '\r')"
sql -e "DROP DATABASE tienda_prueba"
echo "Prueba terminada: $DISTINTAS tablas con distinto número de registros (es normal si ha habido ventas después de la copia)."
