#!/usr/bin/env bash
# =====================================================================
#  05_usuarios.sh : crea los usuarios de MariaDB y les asigna su rol
#
#  Las contraseñas vienen de variables de entorno (fichero .env), nunca
#  del repositorio:
#    DB_ADMIN_PASSWORD, DB_DEPENDIENTE_PASSWORD, DB_AUTH_PASSWORD
#    DB_HOST_PERMITIDO  -> desde dónde se pueden conectar
#                          ('127.0.0.1' en el servidor, '%' en Docker)
#
#  En el servidor lo ejecuta scripts/servidor/02_instalar_mariadb.sh
#  En Docker:        lo ejecuta solo el contenedor al crear la BD.
# =====================================================================
# Sin "set -e/-u": en Docker este fichero se puede ejecutar con "source"
# dentro del script de arranque del contenedor y no debe alterarlo.

: "${DB_ADMIN_PASSWORD:?Falta DB_ADMIN_PASSWORD}"
: "${DB_DEPENDIENTE_PASSWORD:?Falta DB_DEPENDIENTE_PASSWORD}"
: "${DB_AUTH_PASSWORD:?Falta DB_AUTH_PASSWORD}"
HOST="${DB_HOST_PERMITIDO:-%}"

# Dentro del contenedor oficial se entra con la contraseña de root;
# en Debian, root entra por socket (sudo) sin contraseña.
if [[ -n "${MARIADB_ROOT_PASSWORD:-}" ]]; then
  MYSQL=(mariadb -uroot -p"${MARIADB_ROOT_PASSWORD}")
else
  MYSQL=(mariadb)
fi

"${MYSQL[@]}" <<SQL
CREATE USER IF NOT EXISTS 'tienda_admin'@'${HOST}'       IDENTIFIED BY '${DB_ADMIN_PASSWORD}';
CREATE USER IF NOT EXISTS 'tienda_dependiente'@'${HOST}' IDENTIFIED BY '${DB_DEPENDIENTE_PASSWORD}';
CREATE USER IF NOT EXISTS 'tienda_auth'@'${HOST}'        IDENTIFIED BY '${DB_AUTH_PASSWORD}';

GRANT rol_admin       TO 'tienda_admin'@'${HOST}';
GRANT rol_dependiente TO 'tienda_dependiente'@'${HOST}';
GRANT rol_auth        TO 'tienda_auth'@'${HOST}';

SET DEFAULT ROLE rol_admin       FOR 'tienda_admin'@'${HOST}';
SET DEFAULT ROLE rol_dependiente FOR 'tienda_dependiente'@'${HOST}';
SET DEFAULT ROLE rol_auth        FOR 'tienda_auth'@'${HOST}';
SQL

echo "Usuarios de MariaDB creados para el host '${HOST}'."
