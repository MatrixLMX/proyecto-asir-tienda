#!/usr/bin/env bash
# =====================================================================
#  04_monitorizar.sh : comprobación de salud del servidor
#
#  Revisa cada 15 minutos (cron) que todo funciona:
#   * servicios: mariadb, apache2, tienda-api, fail2ban
#   * la API responde y llega a la base de datos (/api/salud)
#   * espacio libre en disco
#   * la última copia de seguridad tiene menos de 26 horas
#   * el certificado HTTPS no caduca en los próximos 30 días
#
#  Los problemas se escriben en el registro del sistema (journalctl -t
#  tienda-monitor) y, si se configura AVISO_EMAIL y hay un programa de
#  correo (msmtp-mta o similar), se envían por email. Solo avisa cuando
#  el estado CAMBIA, para no mandar el mismo correo cada 15 minutos.
#
#  Instalar:  sudo bash scripts/servidor/04_monitorizar.sh --instalar
#  Probar:    sudo tienda-monitor
# =====================================================================
set -uo pipefail

AVISO_EMAIL=""
DISCO_MAX_PCT=85
BACKUP_MAX_HORAS=26
DIR_COPIAS="/var/backups/tienda"
CERT="/etc/ssl/tienda/tienda.crt"
ESTADO="/var/lib/tienda-monitor.estado"
[[ -f /etc/default/tienda-monitor ]] && source /etc/default/tienda-monitor

if [[ "${1:-}" == "--instalar" ]]; then
  [[ $EUID -eq 0 ]] || { echo "Ejecuta este script como root (sudo)."; exit 1; }
  install -m 750 "$0" /usr/local/sbin/tienda-monitor
  if [[ ! -f /etc/default/tienda-monitor ]]; then
    cat > /etc/default/tienda-monitor <<'EOF'
# Configuración de la monitorización de la tienda
# Correo al que avisar (necesita un MTA, p. ej.: apt install msmtp-mta)
AVISO_EMAIL=""
DISCO_MAX_PCT=85
BACKUP_MAX_HORAS=26
EOF
  fi
  cat > /etc/cron.d/tienda-monitor <<'EOF'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
*/15 * * * * root /usr/local/sbin/tienda-monitor >/dev/null 2>&1
EOF
  chmod 644 /etc/cron.d/tienda-monitor
  echo "Monitorización instalada (cada 15 minutos). Primera comprobación:"
  exec /usr/local/sbin/tienda-monitor
fi

problemas=()

for servicio in mariadb apache2 tienda-api fail2ban; do
  systemctl is-active --quiet "$servicio" || problemas+=("El servicio $servicio no está en marcha")
done

if ! curl -fsS --max-time 10 http://127.0.0.1:8000/api/salud >/dev/null; then
  problemas+=("La API no responde o no llega a la base de datos (/api/salud)")
fi

uso=$(df --output=pcent / | tail -1 | tr -dc '0-9')
(( uso >= DISCO_MAX_PCT )) && problemas+=("Disco al ${uso} % (límite ${DISCO_MAX_PCT} %)")

ultima=$(find "$DIR_COPIAS" -name 'tienda_*.sql.gz' -printf '%T@\n' 2>/dev/null | sort -n | tail -1)
if [[ -z "$ultima" ]]; then
  problemas+=("No hay ninguna copia de seguridad en $DIR_COPIAS")
else
  horas=$(( ( $(date +%s) - ${ultima%.*} ) / 3600 ))
  (( horas >= BACKUP_MAX_HORAS )) && problemas+=("La última copia de seguridad es de hace $horas horas")
fi

if [[ -f "$CERT" ]] && ! openssl x509 -in "$CERT" -noout -checkend 2592000 >/dev/null; then
  problemas+=("El certificado HTTPS caduca en menos de 30 días: vuelve a ejecutar 03_desplegar_web.sh")
fi

# --- Resultado ---------------------------------------------------------
if (( ${#problemas[@]} )); then
  resumen=$(printf -- '- %s\n' "${problemas[@]}")
  estado="ERROR"
else
  resumen="Todo correcto"
  estado="OK"
fi
echo "$resumen"
logger -t tienda-monitor -p "user.$([[ $estado == OK ]] && echo info || echo err)" -- "$resumen"

huella_de() { echo "$1:$(echo "$2" | md5sum | cut -c1-8)"; }
huella=$(huella_de "$estado" "$resumen")
anterior=$(cat "$ESTADO" 2>/dev/null || huella_de OK "Todo correcto")
if [[ "$huella" != "$anterior" ]]; then
  echo "$huella" > "$ESTADO"
  if [[ -n "$AVISO_EMAIL" ]] && command -v sendmail >/dev/null; then
    asunto=$([[ $estado == OK ]] && echo "Servidor de la tienda: todo vuelve a funcionar" \
                                 || echo "Servidor de la tienda: hay problemas")
    printf 'To: %s\nSubject: %s\n\n%s\n\n-- %s\n' "$AVISO_EMAIL" "$asunto" "$resumen" "$(hostname)" \
      | sendmail -t
  fi
fi

[[ $estado == OK ]]
