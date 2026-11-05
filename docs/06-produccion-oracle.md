# Publicar la tienda en Internet (Oracle Cloud, sin dominio propio)

La web queda en un servidor encendido las 24 horas, sin depender de tu PC:

```
móvil / PC → https://1-2-3-4.sslip.io → Caddy (HTTPS) → web y API → MariaDB
```

Solo se abren los puertos 80 y 443 (web) y 22 (SSH con clave). MariaDB y la API
no se pueden alcanzar desde Internet. No se cargan los datos de ejemplo.

> Esta instalación usa Docker, la forma ya probada con la aplicación. La
> instalación de `02-guia-servidor.md` sigue siendo la del
> servidor de la tienda que se describe en el proyecto.

## 1. Crear el servidor en Oracle Cloud

1. Regístrate en <https://www.oracle.com/cloud/free/>. Pide tarjeta para
   verificar tu identidad. La **región** no se puede cambiar después: elige una
   cercana.
2. Ve a **Compute → Instances → Create instance**:
   - **Image:** Canonical Ubuntu 24.04.
   - **Shape:** Ampere `VM.Standard.A1.Flex`, 1 o 2 OCPU y 6 a 12 GB de RAM.
     Comprueba que aparece como *Always Free-eligible*.
   - **SSH keys:** descarga la clave privada y guárdala bien.
   - Si sale *Out of capacity*, prueba otro *availability domain* o inténtalo
     más tarde.
3. Apunta la **Public IP** de la instancia.
4. Abre los puertos: entra en la subred de la instancia → **Security Lists** →
   **Add Ingress Rules** y añade dos reglas con origen `0.0.0.0/0`, protocolo TCP
   y puerto de destino `80` y `443`.

## 2. La dirección web

No hay que registrar nada. La dirección sale de la IP del servidor con
[sslip.io](https://sslip.io): si la IP es `1.2.3.4`, la web será
`https://1-2-3-4.sslip.io`. El script te la propone al instalar.

Si más adelante quieres una dirección con nombre, usa un dominio propio o un
subdominio gratuito (por ejemplo, de DuckDNS), cambia `DOMINIO` en `.env` y
aplícalo con `sudo docker compose -f docker-compose.prod.yml up -d`.

## 3. Instalar la aplicación

Desde PowerShell en tu PC. Si SSH se queja de los permisos de la clave, ejecuta antes
`icacls C:\ruta\clave-oracle.key /inheritance:r /grant:r "$($env:USERNAME):R"`.

```powershell
ssh -i C:\ruta\clave-oracle.key ubuntu@IP-PUBLICA
```

Ya en el servidor:

```bash
sudo apt-get update && sudo apt-get install -y git
sudo git clone https://github.com/MatrixLMX/proyecto-asir-tienda.git /opt/tienda
cd /opt/tienda
sudo bash scripts/produccion/instalar.sh
```

El script te pregunta la dirección web, los datos de la tienda, la clave de
Gemini y el usuario administrador. Las demás contraseñas las genera solo y las
guarda en `/opt/tienda/.env`. Al terminar te muestra la dirección de la web.

Después entra en la web y crea el resto: usuarios, proveedores y productos.

## 4. Copias de seguridad

Cada noche se guarda una copia en `/var/backups/tienda` (se conservan 30 días).
**Esa copia está en el mismo servidor**: si Oracle borra la máquina, se pierde.
Bájala a tu PC cada pocos días:

```powershell
.\scripts\produccion\descargar_copias.ps1 -Servidor IP-PUBLICA -Clave C:\ruta\clave-oracle.key
```

Guarda también una copia de `/opt/tienda/.env` en un lugar seguro.

Comprueba de vez en cuando que las copias funcionan (no toca los datos):

```bash
sudo bash /opt/tienda/scripts/produccion/restaurar.sh
```

Para recuperar los datos de una copia:

```bash
sudo bash /opt/tienda/scripts/produccion/restaurar.sh /var/backups/tienda/COPIA.sql.gz real
```

### Si pierdes el servidor

1. Crea otro servidor (paso 1). Tendrá otra IP y, por tanto, otra dirección web.
2. Instala (paso 3). Si conservas el `.env`, cópialo antes a `/opt/tienda/.env`
   y cambia en él `DOMINIO` por la dirección nueva.
3. Sube la última copia con `scp` y restáurala con el comando anterior.

## 5. Mantenimiento

| Para | Comando en el servidor (desde `/opt/tienda`) |
|---|---|
| Instalar la última versión | `sudo bash scripts/produccion/actualizar.sh` |
| Ver si todo funciona | `sudo docker compose -f docker-compose.prod.yml ps` |
| Ver errores | `sudo docker compose -f docker-compose.prod.yml logs --tail 50` |
| Cambiar datos de `.env` | `sudo nano .env` y `sudo docker compose -f docker-compose.prod.yml up -d` |
| Olvido de contraseña de la web | `sudo docker compose -f docker-compose.prod.yml exec backend python -m app.crear_usuario` |

La aplicación arranca sola si se reinicia el servidor.

`actualizar.sh` no aplica cambios de `sql/`: si los hay, te avisa para aplicarlos
a mano.

## Limitaciones

- **Oracle puede reclamar máquinas gratuitas con poco uso** y puede haber caídas
  sin soporte. Por eso son imprescindibles las copias en tu PC.
- **sslip.io es un servicio gratuito sin garantías.** Si falla, la web no se
  encuentra aunque el servidor esté bien.
- **Si cambia la IP del servidor, cambia la dirección web.** Actualiza `DOMINIO`
  en `.env`. Para evitarlo, usa una IP reservada de Oracle.
- **El certificado HTTPS depende de un dominio compartido.** Si Let's Encrypt lo
  rechaza por exceso de peticiones, los registros de Caddy lo indican; reintenta
  más tarde o usa un subdominio de DuckDNS.
- **Fiscalidad:** antes de cobrar de verdad, confirma con la gestoría el IVA y
  si la aplicación debe adaptarse a Veri\*factu.
