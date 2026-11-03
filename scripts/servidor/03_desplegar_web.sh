#!/usr/bin/env bash
# =====================================================================
#  03_desplegar_web.sh : instala la aplicación web y el asistente
#
#  Apache (HTTPS) sirve la web y redirige /api a la API en Python, que
#  corre como servicio systemd con un usuario sin privilegios ("tienda").
#
#  Uso:  sudo bash scripts/servidor/03_desplegar_web.sh
#  También sirve para actualizar la web después de un "git pull".
# =====================================================================
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
[[ $EUID -eq 0 ]] || { echo "Ejecuta este script como root (sudo)."; exit 1; }
[[ "$REPO" == "/opt/tienda" ]] || { echo "El repositorio debe estar en /opt/tienda"; exit 1; }

paso() { echo -e "\n\e[1;32m==> $*\e[0m"; }

paso "1. Paquetes"
apt-get -y install apache2 python3-venv nodejs npm openssl

paso "2. Usuario de servicio 'tienda' (sin shell ni login)"
id tienda &>/dev/null || useradd --system --home /opt/tienda --shell /usr/sbin/nologin tienda
chown root:tienda "$REPO/.env"
chmod 640 "$REPO/.env"

paso "3. Backend (Python)"
cd "$REPO/app/backend"
[[ -d .venv ]] || python3 -m venv .venv
.venv/bin/pip install --quiet --upgrade pip
.venv/bin/pip install --quiet -r requirements.txt
install -m 644 "$REPO/config/systemd/tienda-api.service" /etc/systemd/system/tienda-api.service
systemctl daemon-reload
systemctl enable tienda-api
systemctl restart tienda-api

paso "4. Frontend (React)"
cd "$REPO/app/frontend"
npm ci --no-audit --no-fund
npm run build
mkdir -p /var/www/tienda
rsync -a --delete dist/ /var/www/tienda/

paso "5. Certificado HTTPS con autoridad (CA) propia de la tienda"
# Se crea una CA propia y con ella se firma el certificado del servidor.
# Instalando ca-tienda.crt una sola vez en cada ordenador o móvil de la
# tienda, el navegador deja de avisar de "conexión no segura".
# (Let's Encrypt no sirve: el servidor no es accesible desde Internet.)
SSL=/etc/ssl/tienda
IP_SERVIDOR=$(hostname -I | awk '{print $1}')
mkdir -p "$SSL"
if [[ ! -f $SSL/ca-tienda.crt ]]; then
  openssl req -x509 -nodes -newkey rsa:3072 -days 3650 \
    -keyout "$SSL/ca-tienda.key" -out "$SSL/ca-tienda.crt" \
    -subj "/CN=CA de la tienda" -addext "basicConstraints=critical,CA:TRUE" \
    -addext "keyUsage=critical,keyCertSign,cRLSign"
  chmod 600 "$SSL/ca-tienda.key"
fi
# El del servidor se (re)crea si no existe, si cambia la IP o si le
# quedan menos de 30 días
if [[ ! -f $SSL/tienda.crt ]] \
   || ! openssl x509 -in "$SSL/tienda.crt" -noout -checkend 2592000 >/dev/null \
   || ! openssl x509 -in "$SSL/tienda.crt" -noout -ext subjectAltName | grep -q "$IP_SERVIDOR"; then
  openssl req -new -nodes -newkey rsa:2048 -subj "/CN=tienda.local" \
    -keyout "$SSL/tienda.key" -out "$SSL/tienda.csr"
  printf 'subjectAltName=DNS:tienda.local,DNS:%s,IP:%s\nextendedKeyUsage=serverAuth\n' \
    "$(hostname)" "$IP_SERVIDOR" > "$SSL/ext.cnf"
  openssl x509 -req -in "$SSL/tienda.csr" -CA "$SSL/ca-tienda.crt" -CAkey "$SSL/ca-tienda.key" \
    -CAcreateserial -days 825 -sha256 -extfile "$SSL/ext.cnf" -out "$SSL/tienda.crt"
  chmod 600 "$SSL/tienda.key"
  rm -f "$SSL/tienda.csr" "$SSL/ext.cnf"
fi
# Para instalarlo en los dispositivos: http://<IP del servidor>/ca-tienda.crt
install -m 644 "$SSL/ca-tienda.crt" /var/www/tienda/ca-tienda.crt

paso "6. Apache"
a2enmod -q ssl proxy proxy_http headers rewrite
install -m 644 "$REPO/config/apache/tienda.conf" /etc/apache2/sites-available/tienda.conf
a2dissite -q 000-default || true
a2ensite -q tienda
apache2ctl configtest
systemctl reload apache2

paso "Comprobación"
sleep 2
systemctl --no-pager --lines=0 status tienda-api apache2 || true
curl -sk -o /dev/null -w "API: HTTP %{http_code}\n" https://127.0.0.1/api/docs
echo
echo "Listo. Abre https://$(hostname -I | awk '{print $1}') desde un equipo de la tienda."
