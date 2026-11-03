# 3. Probar la aplicación en tu PC (sin máquina virtual)

Hay dos maneras. La **A** es la más cómoda y la más parecida al servidor real.

Antes de empezar, en la carpeta del proyecto:

```powershell
copy .env.example .env
notepad .env       # cambia las contraseñas; pega tu GOOGLE_API_KEY (gratis en aistudio.google.com/apikey) si quieres el asistente
```

Usuarios de prueba de la web (vienen en los datos de ejemplo):

| Usuario | Contraseña | Perfil |
|---|---|---|
| `admin` | `admin1234` | Administrador |
| `dependiente` | `tienda1234` | Dependiente |

---

## Opción A: Docker Desktop (recomendada)

1. Instala **Docker Desktop**: https://www.docker.com/products/docker-desktop/. Activa WSL 2 si te lo pide y reinicia.
2. En la carpeta del proyecto:

   ```powershell
   docker compose up --build
   ```

   La primera vez tarda unos minutos: descarga MariaDB, crea la BD, genera 2 meses de ventas de ejemplo y compila la web.

3. Abre:
   - Web: **http://localhost:8080**
   - Documentación de la API: http://localhost:8000/api/docs
   - MariaDB para DBeaver: `localhost:3307`, usuario `tienda_admin`

Para pararlo usa `Ctrl+C` o `docker compose down`. Para **borrar la BD y empezar de cero**: `docker compose down -v`.

## Opción B: sin Docker (MariaDB instalado en Windows)

### 1. MariaDB

```powershell
winget install MariaDB.Server
```

(O descarga el instalador MSI de https://mariadb.org/download/.) Durante la instalación pon una contraseña de root y copia esa misma contraseña en `MARIADB_ROOT_PASSWORD` del `.env`. Añade `C:\Program Files\MariaDB 11.8\bin` al PATH.

Carga la base de datos desde **Git Bash**:

```bash
bash scripts/local/cargar_bd_local.sh            # usa --reset para recrearla
```

### 2. Backend (API + asistente)

```powershell
cd app\backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\uvicorn app.main:app --reload
```

La API queda en http://localhost:8000/api/docs.

### 3. Frontend

En otra terminal:

```powershell
cd app\frontend
npm install
npm run dev
```

Abre **http://localhost:5173**.

---

## Pruebas automáticas

Con Docker en marcha:

```powershell
docker compose exec backend pip install -r requirements-dev.txt
docker compose exec backend python -m pytest -q tests
```

Prueban la API contra la base de datos de ejemplo: login y bloqueo por intentos, permisos de cada perfil (también a nivel de MariaDB), ventas sin stock, anulación con devolución de stock y lotes, mermas, cierre de caja, edición de productos, compras, usuarios y auditoría. Dejan la base de datos como estaba.

Si cambias algún fichero de `sql/`, recrea la base de datos (se pierden los datos de prueba):

```powershell
docker compose down -v
docker compose up -d --build
```

## Qué probar

1. Entra como **dependiente**. No verás Compras, Catálogo ni Beneficios. Pregúntale al asistente "¿cuánto ganamos este mes?": te dirá que no tiene acceso.
2. **Vender**: añade unas patatas (por peso) y una Coca-Cola, y cobra. Mira cómo baja el stock.
3. Intenta vender más de lo que hay. La venta se rechaza entera con el mensaje del trigger.
4. **Caducidades**: retira el lote caducado. Desaparece de la lista y queda como merma.
5. Entra como **admin**. En **Beneficios** compara el beneficio real con la estimación del 15 %.
6. **Compras**: registra una compra de yogures sin fecha. La caducidad se calcula sola con la vida útil.
7. **Catálogo**: añade una categoría y un producto nuevos.
8. Asistente (admin): "¿qué 5 productos me dejan menos margen?", "¿qué tengo que pedir a Dulcesol?", "¿cuánto he perdido en mermas este mes?", "¿quién ha cambiado precios esta semana?".
9. **Ventas y caja**: abre un ticket, imprímelo y (como admin) anúlalo. El stock vuelve. Después cierra la caja del día contando el efectivo.
10. **Stock**: registra una merma (por ejemplo, un producto roto) con el botón de la derecha.
11. **Compras → Qué pedir**: pulsa "Registrar esta compra" y la compra se rellena sola con lo que falta.
12. **Usuarios**: crea un dependiente nuevo, entra con él y cambia su contraseña (icono de la llave). En **Registro de cambios** aparece todo.
13. En **Vender**, usa el teclado: **F4** busca, **F2** cobra, **Intro** confirma el cobro.
14. **Escanear**: en Vender pulsa el botón del código de barras (junto al buscador) y enseña a la cámara un código (por ejemplo, el de una caja de cereales). En `http://localhost:8080` la cámara funciona; desde el móvil hace falta el servidor con HTTPS. Sin cámara, escribe `8410188012092` con el cursor fuera del buscador y pulsa Intro: es lo mismo que hace un lector USB.
15. Ese código no existe en el catálogo: pulsa **Crear producto**. El nombre llega de Open Food Facts; rellena precio de compra, de venta y stock inicial y mira el beneficio por unidad.
