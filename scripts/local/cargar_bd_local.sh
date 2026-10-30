#!/usr/bin/env bash
# =====================================================================
#  cargar_bd_local.sh : crea la BD en un MariaDB instalado en Windows
#  (para probar sin Docker y sin máquina virtual)
#
#  Requisitos: MariaDB para Windows con su carpeta "bin" en el PATH, y
#  el fichero .env con MARIADB_ROOT_PASSWORD = contraseña de root que
#  pusiste al instalar MariaDB.
#
#  Uso desde Git Bash, en la carpeta del proyecto:
#     bash scripts/local/cargar_bd_local.sh           # crea la BD
#     bash scripts/local/cargar_bd_local.sh --reset   # la borra y la vuelve a crear
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/../.."

[[ -f .env ]] || { echo "Falta .env: copia .env.example como .env y rellénalo"; exit 1; }
set -a; source <(sed 's/\r$//' .env); set +a
export DB_HOST_PERMITIDO="%"
MYSQL=(mariadb -uroot -p"${MARIADB_ROOT_PASSWORD:?Falta MARIADB_ROOT_PASSWORD en .env}" --default-character-set=utf8mb4)

if [[ "${1:-}" == "--reset" ]]; then
  echo "Borrando la base de datos 'tienda' y sus usuarios..."
  "${MYSQL[@]}" -e "DROP DATABASE IF EXISTS tienda;
    DROP USER IF EXISTS 'tienda_admin'@'%', 'tienda_dependiente'@'%', 'tienda_auth'@'%';
    DROP ROLE IF EXISTS rol_admin; DROP ROLE IF EXISTS rol_dependiente; DROP ROLE IF EXISTS rol_auth;"
fi

for f in sql/01_esquema.sql sql/02_triggers.sql sql/03_vistas.sql sql/04_roles.sql; do
  echo "-> $f"; "${MYSQL[@]}" < "$f"
done
echo "-> sql/05_usuarios.sh"; bash sql/05_usuarios.sh
for f in sql/06_datos_base.sql sql/07_datos_ejemplo.sql; do
  echo "-> $f"; "${MYSQL[@]}" < "$f"
done

"${MYSQL[@]}" -t tienda -e "SELECT (SELECT COUNT(*) FROM productos) AS productos,
  (SELECT COUNT(*) FROM ventas) AS ventas, (SELECT COUNT(*) FROM v_caducidades) AS avisos_caducidad"
echo "Base de datos lista."
