# 5. Plan de recuperación ante desastres

Qué hacer si algo falla, cuánto se puede perder y cuánto se tarda en volver a vender.

## Objetivos

| Indicador | Valor | Por qué |
|---|---|---|
| **RPO** (datos que se pueden perder como máximo) | **1 día** | La copia se hace cada noche a las 22:30, después del cierre |
| **RTO** (tiempo hasta volver a funcionar) | **≈ 1 hora** con la copia externa; minutos si solo falla un servicio | Los scripts reinstalan todo sin pasos manuales |

> Mientras el sistema no funcione, la tienda **puede seguir vendiendo**: se apuntan las ventas en papel (como antes) y luego se meten en la web. Las compras se apuntan en el albarán.

## Qué se guarda y dónde

| Qué | Dónde | Cómo se recupera |
|---|---|---|
| Base de datos (ventas, stock, compras, usuarios, auditoría) | `/var/backups/tienda/tienda_FECHA.sql.gz` (30 días) | `restaurar_bd.sh` |
| Copia fuera del servidor | Disco USB u otro equipo (`DESTINO_EXTERNO` en `/etc/default/tienda-backup`) | Copiar el `.sql.gz` al servidor nuevo |
| Código, scripts y configuración | GitHub (este repositorio) | `git clone` |
| Contraseñas y claves (`.env`) | **Solo** en el servidor (`/opt/tienda/.env`) y en una copia en papel o gestor de contraseñas del administrador | Volver a escribirlo |
| CA de la tienda (`/etc/ssl/tienda/`) | Solo en el servidor | Si se pierde, se crea una nueva y se reinstala en los dispositivos |

> **Importante:** guarda una copia del fichero `.env` (y si quieres de `/etc/ssl/tienda/`) en un sitio seguro fuera del servidor. Sin las contraseñas del `.env` se puede reinstalar todo, pero habrá que inventar contraseñas nuevas.

## Escenarios

### 1. La web no carga, pero el servidor está encendido

```bash
ssh admin@IP-DEL-SERVIDOR
sudo tienda-monitor                         # dice qué falla
sudo systemctl restart tienda-api apache2 mariadb
sudo journalctl -u tienda-api -n 50         # si sigue fallando, ver el error
```

Tiempo: minutos. Datos perdidos: ninguno.

### 2. Se ha borrado o estropeado algo en la base de datos

1. **No toques nada más.** Mira en la web **Usuarios → Registro de cambios** qué ha pasado y cuándo.
2. Si es algo puntual (una venta anulada por error), se corrige desde la web (volver a registrar la venta o la compra).
3. Si hay que volver atrás, primero **prueba** la copia en una base de datos aparte:
   ```bash
   sudo tienda-restaurar                          # restaura la última copia en "tienda_prueba" y compara
   ```
4. Si la prueba es correcta, restaura de verdad (el script hace antes una copia de lo que hay ahora):
   ```bash
   sudo tienda-restaurar /var/backups/tienda/tienda_FECHA.sql.gz tienda
   sudo systemctl restart tienda-api
   ```
5. Mete a mano las ventas del día perdidas (las del papel o los tickets).

Datos perdidos: lo hecho desde la copia elegida.

### 3. Se ha roto el disco o la máquina virtual (o el PC servidor)

1. Prepara un servidor nuevo siguiendo [la guía](02-guia-servidor.md), fases 1 a 5 (Debian, IP fija, SSH, `01_preparar_servidor.sh`).
2. Recupera el `.env` guardado y cópialo a `/opt/tienda/.env`.
3. Instala MariaDB **sin** datos de ejemplo: `sudo bash scripts/servidor/02_instalar_mariadb.sh`.
4. Copia la última copia desde el USB u otro equipo a `/var/backups/tienda/` y restaúrala:
   ```bash
   sudo bash scripts/backup/instalar_backup.sh      # instala tienda-restaurar
   sudo tienda-restaurar /var/backups/tienda/tienda_FECHA.sql.gz tienda
   ```
5. Despliega la web y la monitorización:
   ```bash
   sudo bash scripts/servidor/03_desplegar_web.sh
   sudo bash scripts/servidor/04_monitorizar.sh --instalar
   ```
6. Si la CA de la tienda no se guardó, se habrá creado una nueva: reinstala `ca-tienda.crt` en los dispositivos.
7. Comprueba en la web que están las ventas del último día y mete a mano las que falten.

Tiempo: ≈ 1 hora. Datos perdidos: desde la última copia externa.

### 4. Alguien ha entrado sin permiso o se ha filtrado una contraseña

1. Cambia la contraseña del usuario de la web afectado (**Usuarios → editar**) o desactívalo.
2. Revisa **Registro de cambios** y `sudo journalctl -u tienda-api | grep LOGIN`.
3. Si se ha filtrado el `.env`, cambia todas sus contraseñas y la `JWT_SECRET` (cierra todas las sesiones), actualiza los usuarios de MariaDB y reinicia la API:
   ```sql
   ALTER USER 'tienda_admin'@'127.0.0.1' IDENTIFIED BY 'nueva';   -- y igual con los otros dos
   ```
4. Revisa los bloqueos: `sudo fail2ban-client status sshd` y `sudo fail2ban-client status tienda-web`.

### 5. El asistente no responde

No afecta al resto de la web. Suele ser el límite gratuito del proveedor (esperar un minuto) o la clave caducada (crear otra en https://aistudio.google.com/apikey y ponerla en `GOOGLE_API_KEY`). Se puede configurar un modelo de reserva con `LLM_RESERVA_PROVIDER` y `LLM_RESERVA_MODEL` en `.env`.

## Pruebas periódicas

| Cada | Qué | Cómo |
|---|---|---|
| Día | Copia automática | `/etc/cron.d/tienda-backup` (lo vigila `tienda-monitor`) |
| Semana | Mirar que no hay avisos | `journalctl -t tienda-monitor --since "7 days ago" -p err` |
| Mes | **Restauración de prueba** | `sudo tienda-restaurar` (compara las tablas) |
| Mes | Copia externa al día | Mirar las fechas en el USB u otro equipo |
| Año | Simulacro completo (escenario 3) en una máquina virtual nueva | Apuntar cuánto se ha tardado |
