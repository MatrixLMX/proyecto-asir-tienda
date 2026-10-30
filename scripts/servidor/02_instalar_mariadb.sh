#!/usr/bin/env bash
# =====================================================================
#  02_instalar_mariadb.sh : instala MariaDB y crea la base de datos
#
#  Uso (como root, con /opt/tienda/.env ya creado):
#     sudo bash scripts/servidor/02_instalar_mariadb.sh          # producción
#     sudo bash scripts/servidor/02_instalar_mariadb.sh --demo   # + datos ficticios
# =====================================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
[[ $EUID -eq 0 ]] || { echo "Ejecuta este script como root (sudo)."; exit 1; }
[[ -f "$REPO/.env" ]] || { echo "Falta $REPO/.env (copia .env.example y rellénalo)."; exit 1; }

paso() { echo -e "\n\e[1;32m==> $*\e[0m"; }

paso "1. Instalando MariaDB"
apt-get -y install mariadb-server mariadb-client
install -m 644 "$REPO/config/mariadb/60-tienda.cnf" /etc/mysql/mariadb.conf.d/60-tienda.cnf
systemctl enable mariadb
systemctl restart mariadb

paso "2. Securización (equivale a mariadb-secure-installation)"
# En Debian root ya entra solo por socket (sudo), sin contraseña remota.
mariadb <<'SQL'
DELETE FROM mysql.global_priv WHERE User = '';
DELETE FROM mysql.global_priv WHERE User = 'root' AND Host NOT IN ('localhost', '127.0.0.1', '::1');
DROP DATABASE IF EXISTS test;
DELETE FROM mysql.db WHERE Db = 'test' OR Db = 'test\\_%';
FLUSH PRIVILEGES;
SQL

if mariadb -e "USE tienda" 2>/dev/null; then
  echo "La base de datos 'tienda' ya existe: no se toca. (Bórrala a mano si quieres recrearla.)"
  exit 0
fi

paso "3. Creando la base de datos"
for f in 01_esquema 02_triggers 03_vistas 04_roles; do
  echo "   $f.sql"
  mariadb < "$REPO/sql/$f.sql"
done

paso "4. Usuarios de la base de datos"
set -a; source "$REPO/.env"; set +a
unset MARIADB_ROOT_PASSWORD     # en el servidor root entra por socket
bash "$REPO/sql/05_usuarios.sh"

paso "5. Datos de partida"
mariadb < "$REPO/sql/06_datos_base.sql"
if [[ "${1:-}" == "--demo" ]]; then
  echo "   Cargando datos de EJEMPLO (puede tardar un minuto)"
  mariadb < "$REPO/sql/07_datos_ejemplo.sql"
fi

paso "Comprobación"
mariadb -t tienda -e "SELECT COUNT(*) AS productos FROM productos;
  SELECT TRIGGER_NAME AS triggers FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = 'tienda';"
echo
echo "Listo. Siguiente paso: scripts/backup/instalar_backup.sh"
