"""API de la tienda (FastAPI)."""
import json
import logging
import re
import urllib.request
from datetime import date
from typing import Literal

import pymysql

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from . import asistente
from .auth import (Usuario, apuntar_fallo, autenticar, cambiar_password, comprobar_bloqueo,
                   crear_token, hash_password, olvidar_fallos, solo_admin, usuario_actual)
from .config import settings
from .db import ErrorNegocio, conexion, consultar

app = FastAPI(title="Tienda - API", docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(ErrorNegocio)
async def _error_negocio(_, exc: ErrorNegocio):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(pymysql.err.IntegrityError)
async def _error_integridad(_, exc: pymysql.err.IntegrityError):
    """Mensajes claros para los errores de datos más habituales."""
    codigo, texto = (exc.args + ("", ""))[:2]
    if codigo == 1062:
        que = ("código de barras" if "codigo_barras" in texto else
               "nombre" if "nombre" in texto or "usuario" in texto else "dato")
        return JSONResponse(status_code=409, content={"detail": f"Ya existe otro registro con ese {que}."})
    if codigo in (1451, 1452):
        return JSONResponse(status_code=400, content={"detail": "Hace referencia a algo que no existe o está en uso."})
    return JSONResponse(status_code=400, content={"detail": "Datos no válidos."})


def _uno(filas: list[dict], que: str) -> dict:
    if not filas:
        raise HTTPException(404, f"{que} no encontrado")
    return filas[0]


# ---------------------------------------------------------------------
#  Estado del servicio y datos públicos
# ---------------------------------------------------------------------
@app.get("/api/salud")
def salud():
    """Lo usa el script de monitorización: comprueba la API y la BD."""
    consultar("auth", "SELECT 1")
    return {"ok": True}


@app.get("/api/tienda")
def tienda():
    return {"nombre": settings.nombre_tienda, "nif": settings.nif_tienda,
            "direccion": settings.direccion_tienda}


# ---------------------------------------------------------------------
#  Sesión
# ---------------------------------------------------------------------
class Login(BaseModel):
    usuario: str
    password: str


@app.post("/api/auth/login")
def login(datos: Login, request: Request):
    ip = request.client.host if request.client else "desconocida"
    comprobar_bloqueo(ip)
    u = autenticar(datos.usuario, datos.password)
    if u is None:
        apuntar_fallo(ip, datos.usuario)
        raise HTTPException(401, "Usuario o contraseña incorrectos")
    olvidar_fallos(ip)
    return {"token": crear_token(u), "usuario": u}


@app.get("/api/auth/yo")
def yo(u: Usuario = Depends(usuario_actual)):
    return {**u.model_dump(), "asistente": asistente.asistente_disponible()}


class CambioPassword(BaseModel):
    actual: str
    nueva: str = Field(min_length=8, max_length=72)


@app.post("/api/auth/cambiar-password")
def cambiar_mi_password(c: CambioPassword, request: Request, u: Usuario = Depends(usuario_actual)):
    ip = request.client.host if request.client else "desconocida"
    comprobar_bloqueo(ip)
    if autenticar(u.usuario, c.actual) is None:
        apuntar_fallo(ip, u.usuario)
        raise HTTPException(400, "La contraseña actual no es correcta")
    cambiar_password(u.usuario, c.nueva)
    return {"ok": True}


# ---------------------------------------------------------------------
#  Stock, alertas y catálogo (todos los perfiles)
# ---------------------------------------------------------------------
@app.get("/api/productos")
def productos(q: str = "", u: Usuario = Depends(usuario_actual)):
    like = f"%{q}%"
    return consultar(
        u.rol,
        "SELECT * FROM v_stock WHERE producto LIKE %s OR categoria LIKE %s "
        "OR codigo_barras = %s ORDER BY producto",
        (like, like, q),
    )


@app.get("/api/categorias")
def categorias(u: Usuario = Depends(usuario_actual)):
    return consultar(u.rol, "SELECT id, nombre FROM categorias WHERE activa ORDER BY nombre")


@app.get("/api/alertas/stock")
def alertas_stock(u: Usuario = Depends(usuario_actual)):
    return consultar(u.rol, "SELECT * FROM v_alertas_stock ORDER BY stock_actual")


@app.get("/api/alertas/caducidades")
def alertas_caducidad(u: Usuario = Depends(usuario_actual)):
    return consultar(u.rol, "SELECT * FROM v_caducidades ORDER BY fecha_caducidad")


@app.get("/api/resumen/hoy")
def resumen_hoy(u: Usuario = Depends(usuario_actual)):
    return consultar(
        u.rol,
        "SELECT COALESCE(SUM(fecha >= CURDATE()), 0) AS tickets, "
        "COALESCE(SUM(IF(fecha >= CURDATE(), total, 0)), 0) AS facturado, "
        # Ayer solo hasta la misma hora, para comparar de forma justa
        "COALESCE(SUM(fecha < NOW() - INTERVAL 1 DAY), 0) AS tickets_ayer, "
        "COALESCE(SUM(IF(fecha < NOW() - INTERVAL 1 DAY, total, 0)), 0) AS facturado_ayer "
        "FROM ventas WHERE fecha >= CURDATE() - INTERVAL 1 DAY",
    )[0]


# ---------------------------------------------------------------------
#  Ventas (todos los perfiles; anular solo el administrador)
# ---------------------------------------------------------------------
class LineaVenta(BaseModel):
    producto_id: int
    cantidad: float = Field(gt=0)


class NuevaVenta(BaseModel):
    metodo_pago: Literal["efectivo", "tarjeta", "bizum"] = "efectivo"
    lineas: list[LineaVenta] = Field(min_length=1)


@app.post("/api/ventas")
def registrar_venta(v: NuevaVenta, u: Usuario = Depends(usuario_actual)):
    # Toda la venta en una transacción: si una línea falla (sin stock),
    # no se guarda nada.
    with conexion(u.rol, u.usuario) as con, con.cursor() as cur:
        cur.execute("INSERT INTO ventas (metodo_pago, usuario) VALUES (%s, %s)",
                    (v.metodo_pago, u.usuario))
        venta_id = cur.lastrowid
        for l in v.lineas:
            cur.execute(
                "INSERT INTO lineas_venta (venta_id, producto_id, cantidad) VALUES (%s, %s, %s)",
                (venta_id, l.producto_id, l.cantidad),
            )
        cur.execute("SELECT id, fecha, total FROM ventas WHERE id = %s", (venta_id,))
        fila = cur.fetchone()
    return {"id": fila["id"], "fecha": fila["fecha"].isoformat(), "total": float(fila["total"])}


@app.get("/api/ventas")
def listar_ventas(desde: date | None = None, hasta: date | None = None,
                  metodo: Literal["efectivo", "tarjeta", "bizum"] | None = None,
                  pagina: int = Query(1, ge=1), por_pagina: int = 50,
                  u: Usuario = Depends(usuario_actual)):
    desde = desde or date.today()
    hasta = hasta or date.today()
    por_pagina = max(1, min(por_pagina, 200))
    filtro = "fecha >= %s AND fecha < %s + INTERVAL 1 DAY" + (" AND metodo_pago = %s" if metodo else "")
    params = (desde, hasta) + ((metodo,) if metodo else ())
    resumen = consultar(
        u.rol,
        f"SELECT COUNT(*) AS tickets, COALESCE(SUM(total), 0) AS total FROM ventas WHERE {filtro}",
        params,
    )[0]
    filas = consultar(
        u.rol,
        "SELECT v.id, v.fecha, v.metodo_pago, v.total, v.usuario, "
        "(SELECT COUNT(*) FROM v_lineas_ticket t WHERE t.venta_id = v.id) AS lineas "
        f"FROM ventas v WHERE {filtro} ORDER BY v.fecha DESC, v.id DESC LIMIT %s OFFSET %s",
        params + (por_pagina, (pagina - 1) * por_pagina),
    )
    return {**resumen, "pagina": pagina, "por_pagina": por_pagina, "ventas": filas}


@app.get("/api/ventas/{venta_id}")
def detalle_venta(venta_id: int, u: Usuario = Depends(usuario_actual)):
    venta = _uno(consultar(u.rol, "SELECT * FROM ventas WHERE id = %s", (venta_id,)), "Ticket")
    venta["lineas"] = consultar(
        u.rol, "SELECT producto, unidad_medida, cantidad, precio_unitario, iva_porcentaje, importe "
               "FROM v_lineas_ticket WHERE venta_id = %s", (venta_id,))
    return venta


@app.delete("/api/ventas/{venta_id}")
def anular_venta(venta_id: int, u: Usuario = Depends(solo_admin)):
    # El trigger devuelve el stock (y los lotes) y lo apunta en auditoría
    with conexion("admin", u.usuario) as con, con.cursor() as cur:
        if not cur.execute("DELETE FROM ventas WHERE id = %s", (venta_id,)):
            raise HTTPException(404, "Ticket no encontrado")
    return {"ok": True}


# ---------------------------------------------------------------------
#  Caja (todos los perfiles)
# ---------------------------------------------------------------------
@app.get("/api/caja")
def caja_del_dia(dia: date | None = None, u: Usuario = Depends(usuario_actual)):
    dia = dia or date.today()
    filas = consultar(u.rol, "SELECT * FROM v_caja_diaria WHERE dia = %s", (dia,))
    caja = filas[0] if filas else {"dia": dia.isoformat(), "tickets": 0, "total_efectivo": 0,
                                   "total_tarjeta": 0, "total_bizum": 0, "total": 0}
    cierre = consultar(u.rol, "SELECT * FROM cierres_caja WHERE fecha = %s", (dia,))
    return {**caja, "cierre": cierre[0] if cierre else None}


class NuevoCierre(BaseModel):
    fecha: date | None = None
    fondo_inicial: float = Field(ge=0, default=0)
    efectivo_contado: float = Field(ge=0)
    notas: str | None = Field(default=None, max_length=255)


@app.post("/api/caja/cierre")
def cerrar_caja(c: NuevoCierre, u: Usuario = Depends(usuario_actual)):
    dia = c.fecha or date.today()
    if dia > date.today():
        raise HTTPException(400, "No se puede cerrar la caja de un día que aún no ha llegado")
    with conexion(u.rol, u.usuario) as con, con.cursor() as cur:
        cur.execute("SELECT id FROM cierres_caja WHERE fecha = %s", (dia,))
        if cur.fetchone():
            raise HTTPException(409, "La caja de ese día ya está cerrada")
        cur.execute("SELECT * FROM v_caja_diaria WHERE dia = %s", (dia,))
        caja = cur.fetchone() or {"tickets": 0, "total_efectivo": 0, "total_tarjeta": 0, "total_bizum": 0}
        cur.execute(
            "INSERT INTO cierres_caja (fecha, tickets, total_efectivo, total_tarjeta, total_bizum, "
            "fondo_inicial, efectivo_contado, usuario, notas) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
            (dia, caja["tickets"], caja["total_efectivo"], caja["total_tarjeta"], caja["total_bizum"],
             c.fondo_inicial, c.efectivo_contado, u.usuario, c.notas or None),
        )
    return consultar(u.rol, "SELECT * FROM cierres_caja WHERE fecha = %s", (dia,))[0]


@app.get("/api/caja/cierres")
def cierres(u: Usuario = Depends(usuario_actual)):
    return consultar(u.rol, "SELECT * FROM cierres_caja ORDER BY fecha DESC LIMIT 60")


# ---------------------------------------------------------------------
#  Mermas (registrar: todos; consultar: administrador)
# ---------------------------------------------------------------------
class NuevaMerma(BaseModel):
    producto_id: int
    cantidad: float = Field(gt=0)
    motivo: Literal["caducado", "roto", "robo", "consumo_propio", "otro"]
    lote_id: int | None = None
    notas: str | None = Field(default=None, max_length=255)


@app.post("/api/mermas")
def registrar_merma(m: NuevaMerma, u: Usuario = Depends(usuario_actual)):
    with conexion(u.rol, u.usuario) as con, con.cursor() as cur:
        cur.execute(
            "INSERT INTO mermas (producto_id, lote_id, cantidad, motivo, usuario, notas) "
            "VALUES (%s, %s, %s, %s, %s, %s)",
            (m.producto_id, m.lote_id, m.cantidad, m.motivo, u.usuario, m.notas or None),
        )
    return {"ok": True}


@app.get("/api/mermas")
def listar_mermas(dias: int = 30, u: Usuario = Depends(solo_admin)):
    return consultar(
        "admin",
        "SELECT m.id, m.fecha, p.nombre AS producto, p.unidad_medida, m.cantidad, m.motivo, "
        "m.usuario, m.notas, ROUND(m.cantidad * m.coste_unitario, 2) AS perdida "
        "FROM mermas m JOIN productos p ON p.id = m.producto_id "
        "WHERE m.fecha >= CURDATE() - INTERVAL %s DAY ORDER BY m.fecha DESC",
        (dias,),
    )


# ---------------------------------------------------------------------
#  Administración: catálogo
# ---------------------------------------------------------------------
@app.get("/api/proveedores")
def proveedores(todos: bool = False, u: Usuario = Depends(solo_admin)):
    return consultar("admin", "SELECT * FROM proveedores "
                              f"{'' if todos else 'WHERE activo '}ORDER BY nombre")


@app.get("/api/categorias/todas")
def categorias_todas(u: Usuario = Depends(solo_admin)):
    return consultar(
        "admin",
        "SELECT c.*, COUNT(p.id) AS productos FROM categorias c "
        "LEFT JOIN productos p ON p.categoria_id = c.id AND p.activo "
        "GROUP BY c.id ORDER BY c.nombre",
    )


@app.get("/api/tipos-iva")
def tipos_iva(u: Usuario = Depends(solo_admin)):
    return consultar("admin", "SELECT * FROM tipos_iva ORDER BY porcentaje")


@app.get("/api/productos/admin")
def productos_admin(u: Usuario = Depends(solo_admin)):
    return consultar(
        "admin",
        "SELECT p.*, c.nombre AS categoria, pr.nombre AS proveedor, i.porcentaje AS iva "
        "FROM productos p JOIN categorias c ON c.id = p.categoria_id "
        "JOIN tipos_iva i ON i.id = p.iva_id "
        "LEFT JOIN proveedores pr ON pr.id = p.proveedor_id ORDER BY p.nombre",
    )


def _actualizar(tabla: str, registro_id: int, cambios: dict, u: Usuario) -> dict:
    """UPDATE con las columnas recibidas. Los nombres de columna vienen
    del modelo Pydantic (nunca del usuario), así que es seguro."""
    if cambios:
        sets = ", ".join(f"{k} = %({k})s" for k in cambios)
        with conexion("admin", u.usuario) as con, con.cursor() as cur:
            cur.execute(f"SELECT id FROM {tabla} WHERE id = %s", (registro_id,))
            if not cur.fetchone():
                raise HTTPException(404, "No encontrado")
            cur.execute(f"UPDATE {tabla} SET {sets} WHERE id = %(id)s", {**cambios, "id": registro_id})
    return {"ok": True}


class NuevoNombre(BaseModel):
    nombre: str = Field(min_length=1, max_length=80)


class CambioCategoria(BaseModel):
    nombre: str | None = Field(default=None, min_length=1, max_length=50)
    activa: bool | None = None


@app.post("/api/categorias")
def crear_categoria(c: NuevoNombre, u: Usuario = Depends(solo_admin)):
    with conexion("admin", u.usuario) as con, con.cursor() as cur:
        cur.execute("INSERT INTO categorias (nombre) VALUES (%s)", (c.nombre.strip(),))
        return {"id": cur.lastrowid, "nombre": c.nombre.strip()}


@app.patch("/api/categorias/{categoria_id}")
def modificar_categoria(categoria_id: int, c: CambioCategoria, u: Usuario = Depends(solo_admin)):
    return _actualizar("categorias", categoria_id, c.model_dump(exclude_unset=True), u)


class DatosProveedor(BaseModel):
    nombre: str = Field(min_length=1, max_length=80)
    contacto: str | None = Field(default=None, max_length=80)
    telefono: str | None = Field(default=None, max_length=20)
    email: str | None = Field(default=None, max_length=120)
    notas: str | None = Field(default=None, max_length=255)


class CambioProveedor(BaseModel):
    nombre: str | None = Field(default=None, min_length=1, max_length=80)
    contacto: str | None = Field(default=None, max_length=80)
    telefono: str | None = Field(default=None, max_length=20)
    email: str | None = Field(default=None, max_length=120)
    notas: str | None = Field(default=None, max_length=255)
    activo: bool | None = None


@app.post("/api/proveedores")
def crear_proveedor(p: DatosProveedor, u: Usuario = Depends(solo_admin)):
    datos = {k: (v.strip() or None) if isinstance(v, str) else v for k, v in p.model_dump().items()}
    with conexion("admin", u.usuario) as con, con.cursor() as cur:
        cur.execute("INSERT INTO proveedores (nombre, contacto, telefono, email, notas) "
                    "VALUES (%(nombre)s, %(contacto)s, %(telefono)s, %(email)s, %(notas)s)", datos)
        return {"id": cur.lastrowid, "nombre": datos["nombre"]}


@app.patch("/api/proveedores/{proveedor_id}")
def modificar_proveedor(proveedor_id: int, c: CambioProveedor, u: Usuario = Depends(solo_admin)):
    cambios = {k: (v.strip() or None) if isinstance(v, str) else v
               for k, v in c.model_dump(exclude_unset=True).items()}
    return _actualizar("proveedores", proveedor_id, cambios, u)


class NuevoProducto(BaseModel):
    nombre: str = Field(min_length=1, max_length=100)
    codigo_barras: str | None = None
    categoria_id: int
    proveedor_id: int | None = None
    iva_id: int
    unidad_medida: Literal["unidad", "kg"] = "unidad"
    precio_venta: float = Field(ge=0)
    stock_minimo: float = Field(ge=0, default=0)
    controla_caducidad: bool = False
    vida_util_dias: int | None = Field(default=None, ge=0)
    dias_aviso_caducidad: int = Field(default=5, ge=0, le=255)
    # Opcionales: lo que cuesta (sin IVA) y lo que ya hay en la tienda
    coste_compra: float | None = Field(default=None, ge=0)
    stock_inicial: float | None = Field(default=None, ge=0)
    fecha_caducidad: date | None = None


@app.post("/api/productos")
def crear_producto(p: NuevoProducto, u: Usuario = Depends(solo_admin)):
    """Da de alta un producto. Si se indica el stock que ya hay, se
    registra como una compra de "stock inicial" (así entran el coste
    medio y, si caduca, el lote) en la misma transacción."""
    datos = p.model_dump(exclude={"coste_compra", "stock_inicial", "fecha_caducidad"})
    datos["codigo_barras"] = (datos["codigo_barras"] or "").strip() or None
    datos["vida_util_dias"] = datos["vida_util_dias"] or None
    datos["coste_medio"] = p.coste_compra or 0
    columnas = ", ".join(datos)
    marcas = ", ".join(f"%({k})s" for k in datos)
    with conexion("admin", u.usuario) as con, con.cursor() as cur:
        cur.execute(f"INSERT INTO productos ({columnas}) VALUES ({marcas})", datos)
        producto_id = cur.lastrowid
        compra_id = None
        if p.stock_inicial:
            cur.execute(
                "INSERT INTO compras (proveedor_id, notas, usuario) VALUES (%s, %s, %s)",
                (p.proveedor_id, f"Stock inicial al dar de alta: {p.nombre}", u.usuario),
            )
            compra_id = cur.lastrowid
            cur.execute(
                "INSERT INTO lineas_compra (compra_id, producto_id, cantidad, coste_unitario, fecha_caducidad) "
                "VALUES (%s, %s, %s, %s, %s)",
                (compra_id, producto_id, p.stock_inicial, p.coste_compra or 0, p.fecha_caducidad),
            )
        return {"id": producto_id, "compra_id": compra_id}


_EAN = re.compile(r"^\d{6,14}$")
log = logging.getLogger("tienda")


def _buscar_off(codigo: str) -> dict | None:
    url = (f"https://world.openfoodfacts.org/api/v2/product/{codigo}.json"
           "?fields=product_name_es,product_name,generic_name_es,brands,quantity,categories")
    req = urllib.request.Request(url, headers={"User-Agent": "TiendaASIR/1.0 (proyecto educativo)"})
    try:
        with urllib.request.urlopen(req, timeout=6) as r:
            datos = json.load(r)
    except Exception as e:  # sin internet, 404, tiempo agotado...
        log.info("Open Food Facts no disponible para %s: %s", codigo, e)
        return None
    if datos.get("status") != 1:
        return None
    pr = datos.get("product", {})
    return {
        "nombre": (pr.get("product_name_es") or pr.get("product_name") or pr.get("generic_name_es") or "").strip(),
        # "KELLOGG ESPAÑA S.L." -> "KELLOGG ESPAÑA"
        "marca": re.sub(r"[\s,]+S\.?\s?[AL]\.?(U\.?)?$", "", (pr.get("brands") or "").split(",")[0].strip(), flags=re.I),
        "cantidad": (pr.get("quantity") or "").strip(),
        "categorias": (pr.get("categories") or "").strip(),
    }


@app.get("/api/codigo/{codigo}")
async def consultar_codigo(codigo: str, u: Usuario = Depends(solo_admin)):
    """Qué se sabe de un código de barras: si ya está en el catálogo y,
    si no, lo que diga la base de datos abierta Open Food Facts (nombre,
    marca y tamaño). Precio, coste, IVA, stock y caducidad no salen nunca
    del código: los pone la tienda."""
    codigo = codigo.strip()
    if not _EAN.match(codigo):
        raise HTTPException(400, "El código debe tener entre 6 y 14 números")
    existe = consultar("admin", "SELECT id, nombre, activo FROM productos WHERE codigo_barras = %s", (codigo,))
    if existe:
        return {"codigo": codigo, "en_catalogo": existe[0], "externo": None}
    return {"codigo": codigo, "en_catalogo": None, "externo": await run_in_threadpool(_buscar_off, codigo)}


class CambioProducto(BaseModel):
    nombre: str | None = Field(default=None, min_length=1, max_length=100)
    codigo_barras: str | None = Field(default=None, max_length=20)
    categoria_id: int | None = None
    proveedor_id: int | None = None
    iva_id: int | None = None
    precio_venta: float | None = Field(default=None, ge=0)
    stock_minimo: float | None = Field(default=None, ge=0)
    controla_caducidad: bool | None = None
    vida_util_dias: int | None = Field(default=None, ge=0)
    dias_aviso_caducidad: int | None = Field(default=None, ge=0, le=255)
    coste_medio: float | None = Field(default=None, ge=0)
    activo: bool | None = None


@app.patch("/api/productos/{producto_id}")
def modificar_producto(producto_id: int, c: CambioProducto, u: Usuario = Depends(solo_admin)):
    # exclude_unset: lo que no se envía no se toca; lo que se envía como
    # null se borra (p. ej. quitar el proveedor o el código de barras)
    cambios = c.model_dump(exclude_unset=True)
    for obligatorio in ("nombre", "categoria_id", "iva_id", "precio_venta", "stock_minimo",
                        "controla_caducidad", "dias_aviso_caducidad", "activo", "coste_medio"):
        if obligatorio in cambios and cambios[obligatorio] is None:
            del cambios[obligatorio]
    if "codigo_barras" in cambios:
        cambios["codigo_barras"] = (cambios["codigo_barras"] or "").strip() or None
    if cambios.get("vida_util_dias") == 0:
        cambios["vida_util_dias"] = None
    resultado = _actualizar("productos", producto_id, cambios, u)
    if "coste_medio" in cambios:
        # El coste medio lo recalculan las compras; si se corrige a mano
        # se apunta (las ventas ya hechas guardan su coste y no cambian)
        consultar(
            "admin",
            "INSERT INTO auditoria (usuario, accion, tabla, registro_id, detalle) "
            "SELECT %s, 'cambiar_coste', 'productos', id, CONCAT(nombre, ': coste ', fmt_euros(coste_medio)) "
            "FROM productos WHERE id = %s",
            (u.usuario, producto_id),
        )
    return resultado


# ---------------------------------------------------------------------
#  Administración: compras y pedidos
# ---------------------------------------------------------------------
class LineaCompra(BaseModel):
    producto_id: int
    cantidad: float = Field(gt=0)
    coste_unitario: float = Field(ge=0)
    fecha_caducidad: date | None = None


class NuevaCompra(BaseModel):
    proveedor_id: int | None = None
    numero_factura: str | None = None
    notas: str | None = None
    lineas: list[LineaCompra] = Field(min_length=1)


@app.post("/api/compras")
def registrar_compra(c: NuevaCompra, u: Usuario = Depends(solo_admin)):
    with conexion("admin", u.usuario) as con, con.cursor() as cur:
        cur.execute(
            "INSERT INTO compras (proveedor_id, numero_factura, notas, usuario) "
            "VALUES (%s, %s, %s, %s)",
            (c.proveedor_id, c.numero_factura, c.notas, u.usuario),
        )
        compra_id = cur.lastrowid
        for l in c.lineas:
            cur.execute(
                "INSERT INTO lineas_compra (compra_id, producto_id, cantidad, coste_unitario, "
                "fecha_caducidad) VALUES (%s, %s, %s, %s, %s)",
                (compra_id, l.producto_id, l.cantidad, l.coste_unitario, l.fecha_caducidad),
            )
        cur.execute("SELECT total_sin_iva FROM compras WHERE id = %s", (compra_id,))
        total = float(cur.fetchone()["total_sin_iva"])
    return {"id": compra_id, "total_sin_iva": total}


@app.get("/api/compras")
def listar_compras(dias: int = 90, u: Usuario = Depends(solo_admin)):
    return consultar(
        "admin",
        "SELECT c.id, c.fecha, c.numero_factura, c.total_sin_iva, c.usuario, c.notas, "
        "pr.nombre AS proveedor, COUNT(lc.id) AS lineas "
        "FROM compras c LEFT JOIN proveedores pr ON pr.id = c.proveedor_id "
        "LEFT JOIN lineas_compra lc ON lc.compra_id = c.id "
        "WHERE c.fecha >= CURDATE() - INTERVAL %s DAY "
        "GROUP BY c.id ORDER BY c.fecha DESC, c.id DESC",
        (dias,),
    )


@app.get("/api/compras/{compra_id}")
def detalle_compra(compra_id: int, u: Usuario = Depends(solo_admin)):
    compra = _uno(consultar(
        "admin",
        "SELECT c.*, pr.nombre AS proveedor FROM compras c "
        "LEFT JOIN proveedores pr ON pr.id = c.proveedor_id WHERE c.id = %s",
        (compra_id,),
    ), "Compra")
    compra["lineas"] = consultar(
        "admin",
        "SELECT lc.id, p.nombre AS producto, p.unidad_medida, lc.cantidad, lc.coste_unitario, "
        "lc.fecha_caducidad, ROUND(lc.cantidad * lc.coste_unitario, 2) AS subtotal "
        "FROM lineas_compra lc JOIN productos p ON p.id = lc.producto_id WHERE lc.compra_id = %s",
        (compra_id,),
    )
    return compra


@app.delete("/api/compras/{compra_id}")
def borrar_compra(compra_id: int, u: Usuario = Depends(solo_admin)):
    with conexion("admin", u.usuario) as con, con.cursor() as cur:
        # Si parte de lo comprado ya se ha vendido, el stock quedaría en
        # negativo: se avisa en vez de borrar
        cur.execute(
            "SELECT p.nombre FROM lineas_compra lc JOIN productos p ON p.id = lc.producto_id "
            "WHERE lc.compra_id = %s GROUP BY p.id, p.nombre, p.stock_actual "
            "HAVING SUM(lc.cantidad) > p.stock_actual",
            (compra_id,),
        )
        vendidos = [f["nombre"] for f in cur.fetchall()]
        if vendidos:
            raise HTTPException(
                400, "No se puede borrar: ya se ha vendido o retirado parte de " + ", ".join(vendidos)
                + ". Corrige con una merma o una nueva compra.")
        if not cur.execute("DELETE FROM compras WHERE id = %s", (compra_id,)):
            raise HTTPException(404, "Compra no encontrada")
    return {"ok": True}


@app.get("/api/pedido-sugerido")
def pedido_sugerido(u: Usuario = Depends(solo_admin)):
    """Lo que conviene pedir (stock bajo), agrupable por proveedor, con
    el coste estimado según el coste medio."""
    return consultar(
        "admin",
        "SELECT a.*, p.proveedor_id, ROUND(p.coste_medio, 2) AS coste_medio, "
        "ROUND(a.cantidad_sugerida * p.coste_medio, 2) AS coste_estimado "
        "FROM v_alertas_stock a JOIN productos p ON p.id = a.id "
        "ORDER BY a.proveedor IS NULL, a.proveedor, a.producto",
    )


# ---------------------------------------------------------------------
#  Administración: informes
# ---------------------------------------------------------------------
@app.get("/api/informes/mensual")
def informe_mensual(u: Usuario = Depends(solo_admin)):
    return consultar("admin", "SELECT * FROM v_beneficio_mensual ORDER BY mes")


@app.get("/api/informes/categorias")
def informe_categorias(u: Usuario = Depends(solo_admin)):
    return consultar("admin", "SELECT * FROM v_beneficio_categoria ORDER BY beneficio DESC")


@app.get("/api/informes/productos")
def informe_productos(u: Usuario = Depends(solo_admin)):
    return consultar("admin", "SELECT * FROM v_beneficio_producto ORDER BY beneficio DESC")


@app.get("/api/informes/diario")
def informe_diario(dias: int = 30, u: Usuario = Depends(solo_admin)):
    return consultar(
        "admin",
        "SELECT * FROM v_ventas_diarias WHERE dia >= CURDATE() - INTERVAL %s DAY ORDER BY dia",
        (dias,),
    )


@app.get("/api/informes/parados")
def productos_parados(dias: int = 30, u: Usuario = Depends(solo_admin)):
    return consultar(
        "admin",
        "SELECT * FROM v_productos_parados WHERE dias_sin_vender >= %s ORDER BY dias_sin_vender DESC",
        (dias,),
    )


# ---------------------------------------------------------------------
#  Administración: usuarios de la web y auditoría
# ---------------------------------------------------------------------
@app.get("/api/usuarios")
def listar_usuarios(u: Usuario = Depends(solo_admin)):
    return consultar("admin", "SELECT id, usuario, nombre, rol, activo, creado_en "
                              "FROM usuarios_app ORDER BY activo DESC, nombre")


class NuevoUsuario(BaseModel):
    usuario: str = Field(min_length=3, max_length=40, pattern=r"^[a-zA-Z0-9._-]+$")
    nombre: str = Field(min_length=1, max_length=80)
    rol: Literal["admin", "dependiente"]
    password: str = Field(min_length=8, max_length=72)


class CambioUsuario(BaseModel):
    nombre: str | None = Field(default=None, min_length=1, max_length=80)
    rol: Literal["admin", "dependiente"] | None = None
    activo: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=72)


@app.post("/api/usuarios")
def crear_usuario(n: NuevoUsuario, u: Usuario = Depends(solo_admin)):
    with conexion("admin", u.usuario) as con, con.cursor() as cur:
        cur.execute("SELECT id FROM usuarios_app WHERE usuario = %s", (n.usuario,))
        if cur.fetchone():
            raise HTTPException(409, f"Ya existe el usuario '{n.usuario}'")
        cur.execute(
            "INSERT INTO usuarios_app (usuario, nombre, password_hash, rol) VALUES (%s, %s, %s, %s)",
            (n.usuario, n.nombre.strip(), hash_password(n.password), n.rol),
        )
        return {"id": cur.lastrowid}


@app.patch("/api/usuarios/{usuario_id}")
def modificar_usuario(usuario_id: int, c: CambioUsuario, u: Usuario = Depends(solo_admin)):
    cambios = {k: v for k, v in c.model_dump(exclude_unset=True).items() if v is not None}
    objetivo = _uno(consultar("admin", "SELECT usuario FROM usuarios_app WHERE id = %s",
                              (usuario_id,)), "Usuario")
    # Para no quedarse sin administrador por error
    if objetivo["usuario"] == u.usuario and (cambios.get("activo") is False or cambios.get("rol") == "dependiente"):
        raise HTTPException(400, "No puedes desactivarte ni quitarte el perfil de administrador a ti mismo")
    if "password" in cambios:
        cambios["password_hash"] = hash_password(cambios.pop("password"))
    return _actualizar("usuarios_app", usuario_id, cambios, u)


@app.get("/api/auditoria")
def auditoria(limite: int = 200, u: Usuario = Depends(solo_admin)):
    return consultar("admin", "SELECT * FROM auditoria ORDER BY fecha DESC, id DESC LIMIT %s",
                     (max(1, min(limite, 1000)),))


# ---------------------------------------------------------------------
#  Asistente virtual
# ---------------------------------------------------------------------
class MensajeChat(BaseModel):
    mensaje: str = Field(min_length=1, max_length=2000)
    conversacion: str = Field(default="principal", max_length=64)


@app.post("/api/asistente")
async def chat(m: MensajeChat, u: Usuario = Depends(usuario_actual)):
    if not asistente.asistente_disponible():
        raise HTTPException(503, "El asistente no está configurado (falta la clave del proveedor en .env)")
    try:
        respuesta = await run_in_threadpool(
            asistente.preguntar, u.rol, u.usuario, m.conversacion, m.mensaje
        )
    except Exception as e:
        # Errores del proveedor (cuota gratuita agotada, modelo saturado...):
        # se avisa con un mensaje claro en vez de un error 500.
        texto = str(e)
        if "429" in texto or "RESOURCE_EXHAUSTED" in texto or "rate" in texto.lower():
            raise HTTPException(429, "Se ha superado el límite gratuito de preguntas por minuto. Espera un momento y vuelve a probar.")
        raise HTTPException(503, "El asistente no está disponible ahora mismo (el proveedor no responde). Prueba de nuevo en un rato.")
    return {"respuesta": respuesta}
