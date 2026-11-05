#!/usr/bin/env bash
# =====================================================================
#  instalar.sh : pone la tienda en marcha en un servidor Ubuntu/Debian
#                con IP pública (por ejemplo, Oracle Cloud)
#
#  Uso:  cd /opt/tienda && sudo bash scripts/produccion/instalar.sh
#
#  Se puede repetir: no cambia las contraseñas de un .env que ya exista
#  ni borra datos. Guía completa: docs/06-produccion-oracle.md
# =====================================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
ENV="$REPO/.env"
USUARIO="${SUDO_USER:-root}"
DC=(docker compose -f "$REPO/docker-compose.prod.yml" --env-file "$ENV")

paso() { echo -e "\n\e[1;32m==> $*\e[0m"; }
[[ $EUID -eq 0 ]] || { echo "Ejecuta este script como root (sudo)."; exit 1; }

# ---------------------------------------------------------------------
paso "1. Datos de la tienda"
IP_PUBLICA="$(curl -4fsS --max-time 10 https://api.ipify.org || true)"
if [[ -f "$ENV" ]]; then
  echo "Ya existe $ENV: se conserva."
else
  # Sin dominio propio: sslip.io convierte 1-2-3-4.sslip.io en la IP 1.2.3.4
  POR_DEFECTO=""
  [[ -n "$IP_PUBLICA" ]] && POR_DEFECTO="${IP_PUBLICA//./-}.sslip.io"
  read -rp "Dirección web (Intro para usar ${POR_DEFECTO:-la tuya}): " DOMINIO
  DOMINIO="${DOMINIO:-$POR_DEFECTO}"
  [[ "$DOMINIO" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || { echo "Dirección no válida."; exit 1; }
  read -rp "Nombre de la tienda: " NOMBRE
  read -rp "NIF para el ticket (Intro para dejarlo para luego): " NIF
  read -rp "Dirección para el ticket (Intro para dejarlo para luego): " DIRECCION
  read -rsp "Clave de Gemini (no se ve al escribir; Intro para desactivar el asistente): " GEMINI
  echo
  limpiar() { local v="${1//\'/’}"; printf '%s' "$v"; }   # el valor va entre comillas simples
  umask 077
  cat > "$ENV" <<EOF
# Generado por instalar.sh. No lo subas a ningún sitio: contiene los secretos.
DOMINIO=$DOMINIO
MARIADB_ROOT_PASSWORD=$(openssl rand -hex 24)
DB_ADMIN_PASSWORD=$(openssl rand -hex 24)
DB_DEPENDIENTE_PASSWORD=$(openssl rand -hex 24)
DB_AUTH_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$(openssl rand -hex 48)
GOOGLE_API_KEY='$(limpiar "$GEMINI")'
NOMBRE_TIENDA='$(limpiar "${NOMBRE:-Mi Tienda}")'
NIF_TIENDA='$(limpiar "$NIF")'
DIRECCION_TIENDA='$(limpiar "$DIRECCION")'
EOF
  umask 022
  echo "Contraseñas aleatorias guardadas en $ENV"
fi
chmod 600 "$ENV"
DOMINIO="$(sed -n 's/^DOMINIO=//p' "$ENV")"
[[ -n "$DOMINIO" ]] || { echo "$ENV no tiene DOMINIO: no es un .env de producción."; exit 1; }

# ---------------------------------------------------------------------
paso "2. Comprobando que $DOMINIO apunta a este servidor"
IP_DOMINIO="$(getent ahostsv4 "$DOMINIO" | awk 'NR==1{print $1}' || true)"
echo "IP de este servidor: ${IP_PUBLICA:-desconocida} | IP de $DOMINIO: ${IP_DOMINIO:-ninguna}"
if [[ -z "$IP_PUBLICA" || "$IP_PUBLICA" != "$IP_DOMINIO" ]]; then
  echo "No coinciden. Corrige DOMINIO en $ENV (o la IP de tu subdominio) y repite este script."
  echo "Sin esto no se puede obtener el certificado HTTPS."
  exit 1
fi

# ---------------------------------------------------------------------
paso "3. Preparando el servidor"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get -y -qq install ca-certificates curl gzip fail2ban unattended-upgrades
timedatectl set-timezone Europe/Madrid || true
# Instalador oficial de Docker (incluye Compose y Buildx; admite ARM)
docker compose version >/dev/null 2>&1 || curl -fsSL https://get.docker.com | sh
docker compose version
systemctl enable --now docker fail2ban
[[ "$USUARIO" != root ]] && usermod -aG docker "$USUARIO"

# Las imágenes de Oracle traen un cortafuegos propio que solo deja pasar SSH
for p in 80 443; do
  iptables -C INPUT -p tcp --dport "$p" -m conntrack --ctstate NEW -j ACCEPT 2>/dev/null \
    || iptables -I INPUT 1 -p tcp --dport "$p" -m conntrack --ctstate NEW -j ACCEPT
done
{ command -v netfilter-persistent >/dev/null && netfilter-persistent save >/dev/null 2>&1; } || true

# Máquinas pequeñas: memoria de intercambio para poder compilar la web
if (( $(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo) < 3000 )) && ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ---------------------------------------------------------------------
paso "4. Construyendo y arrancando la aplicación (puede tardar varios minutos)"
"${DC[@]}" up -d --build --wait --wait-timeout 300 db
"${DC[@]}" up -d

# ---------------------------------------------------------------------
paso "5. Copia de seguridad diaria (03:30)"
install -d -m 700 -o "$USUARIO" /var/backups/tienda
cat > /etc/cron.d/tienda-copia <<EOF
30 3 * * * root bash $REPO/scripts/produccion/copia.sh >> /var/log/tienda-copia.log 2>&1
EOF
chmod 644 /etc/cron.d/tienda-copia
bash "$REPO/scripts/produccion/copia.sh"

# ---------------------------------------------------------------------
paso "6. Usuario administrador de la web"
USUARIOS="$("${DC[@]}" exec -T db sh -c 'mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" -N -e "SELECT COUNT(*) FROM tienda.usuarios_app"')"
if [[ "$USUARIOS" == "0" ]]; then
  until "${DC[@]}" exec backend python -m app.crear_usuario; do echo "Vuelve a intentarlo."; done
else
  echo "Ya hay usuarios creados."
fi

# ---------------------------------------------------------------------
paso "7. Comprobando https://$DOMINIO"
for _ in $(seq 1 30); do
  if curl -fsS --max-time 10 -o /dev/null "https://$DOMINIO/"; then
    echo -e "\n\e[1;32mLista: https://$DOMINIO\e[0m"
    echo "Importante: descarga las copias a tu PC (docs/06-produccion-oracle.md)."
    exit 0
  fi
  sleep 10
done
echo "La web no responde por HTTPS. Revisa que los puertos 80 y 443 estén abiertos"
echo "en Oracle y mira el motivo con:"
echo "  sudo docker compose -f $REPO/docker-compose.prod.yml logs caddy"
exit 1
