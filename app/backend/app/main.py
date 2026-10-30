"""API de la tienda (FastAPI)."""
from datetime import date
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from . import asistente
from .auth import Usuario, autenticar, crear_token, solo_admin, usuario_actual
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


# ---------------------------------------------------------------------
#  Sesión
# ---------------------------------------------------------------------
class Login(BaseModel):
    usuario: str
    password: str


@app.post("/api/auth/login")
def login(datos: Login):
    u = autenticar(datos.usuario, datos.password)
    if u is None:
        raise HTTPException(401, "Usuario o contraseña incorrectos")
    return {"token": crear_token(u), "usuario": u}


@app.get("/api/auth/yo")
def yo(u: Usuario = Depends(usuario_actual)):
    return {**u.model_dump(), "asistente": asistente.asistente_disponible()}


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
        "SELECT COUNT(*) AS tickets, COALESCE(SUM(total), 0) AS facturado "
        "FROM ventas WHERE fecha >= CURDATE()",
    )[0]


# ---------------------------------------------------------------------
#  Ventas y mermas (todos los perfiles)
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
    with conexion(u.rol) as con, con.cursor() as cur:
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


class NuevaMerma(BaseModel):
    producto_id: int
    cantidad: float = Field(gt=0)
    motivo: Literal["caducado", "roto", "robo", "consumo_propio", "otro"]
    lote_id: int | None = None
    notas: str | None = None


@app.post("/api/mermas")
def registrar_merma(m: NuevaMerma, u: Usuario = Depends(usuario_actual)):
    with conexion(u.rol) as con, con.cursor() as cur:
        cur.execute(
            "INSERT INTO mermas (producto_id, lote_id, cantidad, motivo, usuario, notas) "
            "VALUES (%s, %s, %s, %s, %s, %s)",
            (m.producto_id, m.lote_id, m.cantidad, m.motivo, u.usuario, m.notas),
        )
    return {"ok": True}


# ---------------------------------------------------------------------
#  Administración: compras, catálogo e informes
# ---------------------------------------------------------------------
@app.get("/api/proveedores")
def proveedores(u: Usuario = Depends(solo_admin)):
    return consultar("admin", "SELECT * FROM proveedores WHERE activo ORDER BY nombre")


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


class NuevoNombre(BaseModel):
    nombre: str = Field(min_length=1, max_length=80)


@app.post("/api/categorias")
def crear_categoria(c: NuevoNombre, u: Usuario = Depends(solo_admin)):
    with conexion("admin") as con, con.cursor() as cur:
        cur.execute("INSERT INTO categorias (nombre) VALUES (%s)", (c.nombre.strip(),))
        return {"id": cur.lastrowid, "nombre": c.nombre.strip()}


@app.post("/api/proveedores")
def crear_proveedor(p: NuevoNombre, u: Usuario = Depends(solo_admin)):
    with conexion("admin") as con, con.cursor() as cur:
        cur.execute("INSERT INTO proveedores (nombre) VALUES (%s)", (p.nombre.strip(),))
        return {"id": cur.lastrowid, "nombre": p.nombre.strip()}


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
    vida_util_dias: int | None = None
    dias_aviso_caducidad: int = 5


@app.post("/api/productos")
def crear_producto(p: NuevoProducto, u: Usuario = Depends(solo_admin)):
    datos = p.model_dump()
    datos["codigo_barras"] = datos["codigo_barras"] or None
    columnas = ", ".join(datos)
    marcas = ", ".join(f"%({k})s" for k in datos)
    with conexion("admin") as con, con.cursor() as cur:
        cur.execute(f"INSERT INTO productos ({columnas}) VALUES ({marcas})", datos)
        return {"id": cur.lastrowid}


class CambioProducto(BaseModel):
    precio_venta: float | None = Field(default=None, ge=0)
    stock_minimo: float | None = Field(default=None, ge=0)
    activo: bool | None = None


@app.patch("/api/productos/{producto_id}")
def modificar_producto(producto_id: int, c: CambioProducto, u: Usuario = Depends(solo_admin)):
    cambios = c.model_dump(exclude_none=True)
    if not cambios:
        return {"ok": True}
    sets = ", ".join(f"{k} = %({k})s" for k in cambios)
    with conexion("admin") as con, con.cursor() as cur:
        cur.execute(f"UPDATE productos SET {sets} WHERE id = %(id)s", {**cambios, "id": producto_id})
    return {"ok": True}


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
    with conexion("admin") as con, con.cursor() as cur:
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


# ---------------------------------------------------------------------
#  Asistente virtual
# ---------------------------------------------------------------------
class MensajeChat(BaseModel):
    mensaje: str = Field(min_length=1, max_length=2000)
    conversacion: str = Field(default="principal", max_length=64)


@app.post("/api/asistente")
async def chat(m: MensajeChat, u: Usuario = Depends(usuario_actual)):
    if not asistente.asistente_disponible():
        raise HTTPException(503, "El asistente no está configurado (falta ANTHROPIC_API_KEY en .env)")
    respuesta = await run_in_threadpool(
        asistente.preguntar, u.rol, u.usuario, m.conversacion, m.mensaje
    )
    return {"respuesta": respuesta}
