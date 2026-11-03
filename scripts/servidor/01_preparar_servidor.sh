#!/usr/bin/env bash
# =====================================================================
#  01_preparar_servidor.sh : configuración básica y securización
#
#  Uso (como root, con el repositorio en /opt/tienda):
#     sudo bash scripts/servidor/01_preparar_servidor.sh <usuario_admin>
#
#  Qué hace:
#   1. Actualiza el sistema e instala las herramientas necesarias.
#   2. Nombre del servidor y zona horaria.
#   3. Grupo "ssh-tienda" y usuario administrador con sudo.
#   4. Endurece SSH (solo claves, sin root), SOLO si el usuario ya tiene
#      una clave pública copiada, para no quedarse fuera.
#   5. Cortafuegos UFW: todo cerrado salvo SSH y web desde la red local.
#   6. Fail2ban contra ataques de fuerza bruta.
#   7. Actualizaciones de seguridad automáticas.
# =====================================================================
set -euo pipefail

USUARIO="${1:?Indica el usuario administrador. Ej: sudo bash $0 linmao}"
RED_LOCAL="${RED_LOCAL:-192.168.1.0/24}"
NOMBRE_SERVIDOR="${NOMBRE_SERVIDOR:-srv-tienda}"
REPO="$(cd "$(dirname "$0")/../.." && pwd)"

[[ $EUID -eq 0 ]] || { echo "Ejecuta este script como root (sudo)."; exit 1; }
id "$USUARIO" &>/dev/null || { echo "El usuario $USUARIO no existe."; exit 1; }

paso() { echo -e "\n\e[1;32m==> $*\e[0m"; }

paso "1. Actualizando el sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get -y install sudo openssh-server ufw fail2ban python3-systemd \
  unattended-upgrades apt-listchanges git curl rsync ca-certificates htop

paso "2. Nombre del servidor y zona horaria"
hostnamectl set-hostname "$NOMBRE_SERVIDOR"
grep -q "$NOMBRE_SERVIDOR" /etc/hosts || sed -i "s/^127\.0\.1\.1.*/127.0.1.1\t$NOMBRE_SERVIDOR/" /etc/hosts
timedatectl set-timezone Europe/Madrid

paso "3. Usuario administrador ($USUARIO)"
groupadd -f ssh-tienda
usermod -aG sudo,ssh-tienda "$USUARIO"

paso "4. SSH"
CLAVES="$(getent passwd "$USUARIO" | cut -d: -f6)/.ssh/authorized_keys"
if [[ -s "$CLAVES" ]]; then
  install -m 644 "$REPO/config/ssh/99-tienda.conf" /etc/ssh/sshd_config.d/99-tienda.conf
  sshd -t                       # comprueba la sintaxis antes de reiniciar
  systemctl restart ssh
  echo "SSH endurecido: solo claves, sin root, solo grupo ssh-tienda."
else
  echo -e "\e[1;33mAVISO:\e[0m $USUARIO no tiene clave pública en $CLAVES."
  echo "No se desactivan las contraseñas para no perder el acceso."
  echo "Copia tu clave (ver docs/02-guia-servidor.md) y vuelve a ejecutar este script."
fi

paso "5. Cortafuegos UFW (red local: $RED_LOCAL)"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow from "$RED_LOCAL" to any port 22  proto tcp comment 'SSH red local'
ufw allow from "$RED_LOCAL" to any port 80  proto tcp comment 'Web (redirige a HTTPS)'
ufw allow from "$RED_LOCAL" to any port 443 proto tcp comment 'Web HTTPS'
ufw --force enable
ufw status verbose

paso "6. Fail2ban"
install -m 644 "$REPO/config/fail2ban/jail.local" /etc/fail2ban/jail.local
install -m 644 "$REPO/config/fail2ban/filter.d/tienda-web.conf" /etc/fail2ban/filter.d/tienda-web.conf
systemctl enable --now fail2ban
systemctl restart fail2ban
sleep 2
fail2ban-client status

paso "7. Actualizaciones de seguridad automáticas"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
systemctl enable --now unattended-upgrades

paso "Listo. Siguiente paso: scripts/servidor/02_instalar_mariadb.sh"
