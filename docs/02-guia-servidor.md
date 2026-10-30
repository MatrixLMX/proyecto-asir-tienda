# 2. Guía paso a paso: servidor Debian 13 en VirtualBox

Esta guía monta el servidor de la tienda desde cero. Al final tendrás:

- **Debian 13** sin escritorio, con IP fija.
- **SSH** solo con claves, sin root, con **UFW** y **Fail2ban**.
- **MariaDB** con la base de datos, los triggers, las vistas y los perfiles.
- La **web y el asistente** servidos por Apache con HTTPS.
- **Copias de seguridad** diarias automáticas, con la restauración comprobada.

> 💡 Haz una **instantánea** (snapshot) de la máquina virtual al acabar cada fase. Si algo se rompe, vuelves atrás en segundos. Además, las capturas sirven para la memoria.

---

## Fase 0. Lo que necesitas

| Qué | Dónde |
|---|---|
| VirtualBox 7 | https://www.virtualbox.org/wiki/Downloads |
| ISO de Debian 13 "netinst" (amd64) | https://www.debian.org/download |
| Git para Windows (ya lo tienes) | — |

## Fase 1. Crear la máquina virtual

1. VirtualBox → **Nueva**:
   - Nombre: `srv-tienda`, ISO: la de Debian, tipo Linux / Debian (64-bit).
   - Marca **"Omitir instalación desatendida"** (así eliges tú las opciones).
2. Hardware: **2048 MB** de RAM y **2 CPU**.
3. Disco: **25 GB** (VDI, reserva dinámica).
4. Antes de arrancarla → **Configuración → Red → Adaptador 1**: **Adaptador puente** (_bridged_). Así la VM tendrá una IP de tu red como un equipo más, igual que el servidor real en la tienda.

## Fase 2. Instalar Debian 13

Arranca la VM y elige **Install** (el instalador en modo texto):

| Pantalla | Qué poner |
|---|---|
| Idioma / país / teclado | Español / España / Español |
| Nombre de la máquina | `srv-tienda` |
| Dominio | (vacío) |
| Contraseña de root | **Déjala vacía.** Así se desactiva root y tu usuario recibe `sudo` |
| Usuario | tu nombre, p. ej. `linmao`, con una contraseña fuerte |
| Particionado | Guiado, todo el disco, todo en una partición |
| Réplica de red | España, `deb.debian.org` |
| **Selección de programas** | Desmarca **todo** menos **"servidor SSH"** y **"utilidades estándar del sistema"** |
| GRUB | Sí, en `/dev/sda` |

Reinicia y entra con tu usuario. Mira la IP que tiene:

```bash
ip -br a
```

### IP fija

Un servidor necesita una IP que no cambie. Mira `config/red/interfaces.ejemplo` del repositorio y adapta la IP, la puerta de enlace y el nombre de la interfaz a tu red:

```bash
sudo nano /etc/network/interfaces
sudo systemctl restart networking
ip -br a     # comprueba la nueva IP
```

📸 **Snapshot: "debian-instalado"**

## Fase 3. Acceso por SSH con clave (desde Windows)

En **PowerShell de Windows**:

```powershell
# 1. Crea tu par de claves (pulsa Enter para la ruta; pon una frase de paso)
ssh-keygen -t ed25519 -C "linmao@tienda"

# 2. Copia la clave pública al servidor (cambia la IP y el usuario)
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh linmao@192.168.1.10 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"

# 3. Comprueba que entras SIN que te pida la contraseña del usuario
ssh linmao@192.168.1.10
```

A partir de aquí trabaja siempre por SSH desde Windows: puedes copiar y pegar comandos.

## Fase 4. Descargar el proyecto en el servidor

```bash
sudo apt update && sudo apt install -y git
sudo git clone https://github.com/MatrixLMX/proyecto-asir-tienda.git /opt/tienda
cd /opt/tienda
```

## Fase 5. Securizar el servidor

Si tu red no es `192.168.1.x`, indícalo en `RED_LOCAL`:

```bash
sudo RED_LOCAL=192.168.1.0/24 bash scripts/servidor/01_preparar_servidor.sh linmao
```

El script actualiza el sistema, configura SSH, UFW, Fail2ban y las actualizaciones automáticas. Lee los comentarios del script para saber qué hace cada paso.

**Antes de cerrar la sesión actual**, abre **otra** ventana de PowerShell y comprueba que sigues pudiendo entrar:

```powershell
ssh linmao@192.168.1.10
```

Comprobaciones para la memoria:

```bash
sudo ufw status verbose               # puertos abiertos solo para la red local
sudo fail2ban-client status sshd      # la "cárcel" de SSH está activa
sudo sshd -T | grep -Ei 'permitrootlogin|passwordauthentication|allowgroups'
```

Prueba que root y las contraseñas están bloqueados:

```powershell
ssh root@192.168.1.10                                          # debe fallar
ssh -o PubkeyAuthentication=no linmao@192.168.1.10             # debe fallar (Permission denied)
```

📸 **Snapshot: "securizado"**

## Fase 6. Base de datos

```bash
cd /opt/tienda
sudo cp .env.example .env
sudo nano .env
```

En `.env`:
- Pon contraseñas **largas y distintas** en `DB_ADMIN_PASSWORD`, `DB_DEPENDIENTE_PASSWORD` y `DB_AUTH_PASSWORD`.
- Pon `DB_HOST_PERMITIDO=127.0.0.1`.
- Genera `JWT_SECRET` con `python3 -c "import secrets; print(secrets.token_urlsafe(48))"`.
- Borra la línea `MARIADB_ROOT_PASSWORD` (en el servidor no hace falta).

```bash
sudo chmod 600 .env
sudo bash scripts/servidor/02_instalar_mariadb.sh --demo    # sin --demo en la tienda real
```

Comprueba los perfiles (te pedirá la contraseña de cada usuario):

```bash
mariadb -h 127.0.0.1 -u tienda_dependiente -p tienda -e "SELECT * FROM v_stock LIMIT 5"     # funciona
mariadb -h 127.0.0.1 -u tienda_dependiente -p tienda -e "SELECT * FROM v_beneficio_mensual" # ERROR 1142: denegado
mariadb -h 127.0.0.1 -u tienda_admin -p tienda -e "SELECT * FROM v_beneficio_mensual"       # funciona
```

### DBeaver desde Windows (túnel SSH)

MariaDB solo escucha en `127.0.0.1`, así que no está expuesto a la red. DBeaver entra a través de SSH:

- Nueva conexión → MariaDB → Host `127.0.0.1`, puerto `3306`, BD `tienda`, usuario `tienda_admin`.
- Pestaña **SSH**: activar, host = IP del servidor, usuario `linmao`, autenticación **clave pública** → `C:\Users\<tú>\.ssh\id_ed25519`.

📸 **Snapshot: "base-de-datos"**

## Fase 7. Copias de seguridad

```bash
sudo bash scripts/backup/instalar_backup.sh
```

Esto programa la copia cada día a las **22:30** y hace una primera copia. Después, **prueba la restauración** (sin tocar los datos reales):

```bash
sudo tienda-restaurar
```

La copia se restaura en una BD aparte, `tienda_prueba`, y se compara el número de registros de cada tabla con producción. Guarda la salida para la memoria.

### Copia fuera del servidor

Una copia que solo está en el propio servidor no protege si se rompe el disco. Edita `/etc/default/tienda-backup` y rellena `DESTINO_EXTERNO`:

- **Disco USB** montado en `/mnt/usb` → `DESTINO_EXTERNO="/mnt/usb/tienda"`
- **Otro equipo** con SSH → `DESTINO_EXTERNO="backup@192.168.1.20:/srv/copias/tienda"`. Root necesita una clave SSH sin frase de paso para ese equipo: `sudo ssh-keygen -t ed25519` y `sudo ssh-copy-id backup@192.168.1.20`.

Revisa el registro de las copias:

```bash
sudo tail /var/log/tienda-backup.log
ls -lh /var/backups/tienda/
```

📸 **Snapshot: "backups"**

## Fase 8. Web y asistente

Si quieres el asistente, crea una clave gratuita en https://console.groq.com/keys y ponla en `GROQ_API_KEY` dentro de `/opt/tienda/.env`. Luego:

```bash
sudo bash scripts/servidor/03_desplegar_web.sh
```

Crea los usuarios reales de la web:

```bash
cd /opt/tienda/app/backend
sudo -u tienda bash -c 'set -a; . /opt/tienda/.env; set +a; .venv/bin/python -m app.crear_usuario'
```

Abre `https://IP-DEL-SERVIDOR` desde Windows. El navegador avisará de que el certificado es autofirmado: es normal en una red interna. Acepta el aviso.

Comandos útiles:

```bash
sudo systemctl status tienda-api        # estado de la API
sudo journalctl -u tienda-api -f        # registros en vivo
sudo tail -f /var/log/apache2/tienda_error.log
```

### Actualizar después de cambios en GitHub

```bash
cd /opt/tienda && sudo git pull && sudo bash scripts/servidor/03_desplegar_web.sh
```

📸 **Snapshot: "web"**

---

## Resumen de puertos y servicios

| Servicio | Puerto | Accesible desde |
|---|---|---|
| SSH | 22 | Solo red local, solo con clave |
| Apache (HTTP → HTTPS) | 80 / 443 | Solo red local |
| API Python | 8000 | Solo el propio servidor (Apache hace de proxy) |
| MariaDB | 3306 | Solo el propio servidor (DBeaver por túnel SSH) |
