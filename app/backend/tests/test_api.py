"""Pruebas de la API contra la base de datos de ejemplo.

Necesitan la BD con los datos de 07_datos_ejemplo.sql. Con Docker:
    docker compose exec backend pip install -r requirements-dev.txt
    docker compose exec backend python -m pytest -q tests

Cada prueba deja la base de datos como estaba (anula lo que vende,
borra lo que crea), así que se pueden repetir.
"""
from datetime import date, timedelta

import pymysql
import pytest
from fastapi.testclient import TestClient

from app import auth
from app.db import conexion, consultar
from app.main import app

cliente = TestClient(app)


def _token(usuario: str, password: str) -> dict:
    r = cliente.post("/api/auth/login", json={"usuario": usuario, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


ADMIN = _token("admin", "admin1234")
DEPENDIENTE = _token("dependiente", "tienda1234")


def _producto(nombre: str) -> dict:
    return consultar("admin", "SELECT * FROM productos WHERE nombre = %s", (nombre,))[0]


def _lotes(producto_id: int) -> dict:
    return {f["id"]: f["cantidad_restante"] for f in consultar(
        "admin", "SELECT id, cantidad_restante FROM lotes WHERE producto_id = %s", (producto_id,))}


def _ultima_auditoria() -> dict:
    return consultar("admin", "SELECT * FROM auditoria ORDER BY id DESC LIMIT 1")[0]


@pytest.fixture(autouse=True, scope="module")
def _limpiar_auditoria():
    """Las pruebas anulan ventas, borran compras... y eso queda en la
    auditoría. Al acabar se quita, para no ensuciar la BD de ejemplo."""
    desde = consultar("admin", "SELECT COALESCE(MAX(id), 0) AS id FROM auditoria")[0]["id"]
    yield
    with conexion("admin") as con, con.cursor() as cur:
        cur.execute("DELETE FROM auditoria WHERE id > %s", (desde,))


@pytest.fixture(autouse=True)
def _sin_bloqueos():
    auth._fallos.clear()
    yield
    auth._fallos.clear()


# ---------------------------------------------------------------------
#  Sesión y permisos
# ---------------------------------------------------------------------
def test_login_incorrecto():
    r = cliente.post("/api/auth/login", json={"usuario": "admin", "password": "mala"})
    assert r.status_code == 401


def test_login_se_bloquea_tras_varios_fallos():
    for _ in range(auth.settings.login_max_intentos):
        cliente.post("/api/auth/login", json={"usuario": "admin", "password": "mala"})
    r = cliente.post("/api/auth/login", json={"usuario": "admin", "password": "admin1234"})
    assert r.status_code == 429


def test_dependiente_no_ve_lo_del_administrador():
    for ruta in ("/api/informes/mensual", "/api/compras", "/api/mermas", "/api/usuarios", "/api/auditoria"):
        assert cliente.get(ruta, headers=DEPENDIENTE).status_code == 403, ruta
    assert cliente.delete("/api/ventas/1", headers=DEPENDIENTE).status_code == 403


def test_mariadb_niega_costes_al_dependiente():
    # Aunque la web fallase, MariaDB no deja al dependiente leer costes
    with pytest.raises(pymysql.err.OperationalError):
        consultar("dependiente", "SELECT coste_medio FROM productos LIMIT 1")
    with pytest.raises(pymysql.err.OperationalError):
        consultar("dependiente", "SELECT * FROM v_beneficio_mensual")


# ---------------------------------------------------------------------
#  Ventas
# ---------------------------------------------------------------------
def test_vender_y_anular_devuelve_stock_y_lotes():
    yogur = _producto("Yogur natural pack 4")
    lotes_antes = _lotes(yogur["id"])
    r = cliente.post("/api/ventas", headers=DEPENDIENTE, json={
        "metodo_pago": "tarjeta", "lineas": [{"producto_id": yogur["id"], "cantidad": 2}]})
    assert r.status_code == 200, r.text
    venta = r.json()
    assert _producto("Yogur natural pack 4")["stock_actual"] == yogur["stock_actual"] - 2
    assert _lotes(yogur["id"]) != lotes_antes

    # El dependiente puede ver el ticket, pero sin costes
    detalle = cliente.get(f"/api/ventas/{venta['id']}", headers=DEPENDIENTE).json()
    assert detalle["lineas"][0]["cantidad"] == 2
    assert "coste_unitario" not in detalle["lineas"][0]

    assert cliente.delete(f"/api/ventas/{venta['id']}", headers=ADMIN).status_code == 200
    assert _producto("Yogur natural pack 4")["stock_actual"] == yogur["stock_actual"]
    assert _lotes(yogur["id"]) == lotes_antes
    aud = _ultima_auditoria()
    assert aud["accion"] == "anular_venta" and aud["usuario"] == "admin"


def test_venta_sin_stock_no_guarda_nada():
    pilas = _producto("Pilas AA pack 4")
    tickets = consultar("admin", "SELECT COUNT(*) AS n FROM ventas")[0]["n"]
    r = cliente.post("/api/ventas", headers=ADMIN, json={"lineas": [
        {"producto_id": _producto("Pan de molde")["id"], "cantidad": 1},
        {"producto_id": pilas["id"], "cantidad": pilas["stock_actual"] + 1}]})
    assert r.status_code == 400
    assert consultar("admin", "SELECT COUNT(*) AS n FROM ventas")[0]["n"] == tickets


def test_historial_de_ventas():
    r = cliente.get("/api/ventas", headers=DEPENDIENTE,
                    params={"desde": (date.today() - timedelta(days=7)).isoformat()})
    assert r.status_code == 200
    datos = r.json()
    assert datos["tickets"] >= len(datos["ventas"]) > 0


# ---------------------------------------------------------------------
#  Mermas, caja y catálogo
# ---------------------------------------------------------------------
def test_merma_manual_resta_stock_y_queda_registrada():
    cocacola = _producto("Coca-Cola lata 33 cl")
    r = cliente.post("/api/mermas", headers=DEPENDIENTE, json={
        "producto_id": cocacola["id"], "cantidad": 1, "motivo": "roto", "notas": "prueba automática"})
    assert r.status_code == 200, r.text
    assert _producto("Coca-Cola lata 33 cl")["stock_actual"] == cocacola["stock_actual"] - 1
    aud = _ultima_auditoria()
    assert aud["accion"] == "merma" and aud["usuario"] == "dependiente"
    # Deshacer: se devuelve la lata con una compra a coste medio
    with conexion("admin") as con, con.cursor() as cur:
        cur.execute("DELETE FROM mermas WHERE notas = 'prueba automática'")
        cur.execute("UPDATE productos SET stock_actual = stock_actual + 1 WHERE id = %s", (cocacola["id"],))
        cur.execute("DELETE FROM auditoria WHERE id = %s", (aud["id"],))


def test_cierre_de_caja():
    dia = (date.today() - timedelta(days=400)).isoformat()   # un día sin ventas
    try:
        r = cliente.post("/api/caja/cierre", headers=DEPENDIENTE,
                         json={"fecha": dia, "fondo_inicial": 50, "efectivo_contado": 49.5})
        assert r.status_code == 200, r.text
        assert r.json()["diferencia"] == -0.5
        r = cliente.post("/api/caja/cierre", headers=DEPENDIENTE,
                         json={"fecha": dia, "efectivo_contado": 0})
        assert r.status_code == 409
    finally:
        with conexion("admin") as con, con.cursor() as cur:
            cur.execute("DELETE FROM cierres_caja WHERE fecha = %s", (dia,))


def test_editar_producto_completo_y_auditar_precio():
    cheetos = _producto("Cheetos 75 g")
    r = cliente.patch(f"/api/productos/{cheetos['id']}", headers=ADMIN, json={
        "nombre": "Cheetos 75 g (prueba)", "precio_venta": 9.99, "proveedor_id": None})
    assert r.status_code == 200, r.text
    cambiado = consultar("admin", "SELECT * FROM productos WHERE id = %s", (cheetos["id"],))[0]
    assert cambiado["nombre"] == "Cheetos 75 g (prueba)" and cambiado["proveedor_id"] is None
    assert _ultima_auditoria()["accion"] == "cambiar_precio"
    cliente.patch(f"/api/productos/{cheetos['id']}", headers=ADMIN, json={
        "nombre": cheetos["nombre"], "precio_venta": float(cheetos["precio_venta"]),
        "proveedor_id": cheetos["proveedor_id"]})
    assert _producto("Cheetos 75 g")["precio_venta"] == cheetos["precio_venta"]


# ---------------------------------------------------------------------
#  Compras
# ---------------------------------------------------------------------
def test_compra_se_puede_consultar_y_borrar():
    agua = _producto("Agua mineral 1,5 L")
    r = cliente.post("/api/compras", headers=ADMIN, json={
        "numero_factura": "PRUEBA-1", "lineas": [
            {"producto_id": agua["id"], "cantidad": 6, "coste_unitario": 0.3}]})
    compra = r.json()["id"]
    assert cliente.get(f"/api/compras/{compra}", headers=ADMIN).json()["lineas"][0]["cantidad"] == 6
    assert cliente.delete(f"/api/compras/{compra}", headers=ADMIN).status_code == 200
    assert _producto("Agua mineral 1,5 L")["stock_actual"] == agua["stock_actual"]
    assert _ultima_auditoria()["accion"] == "borrar_compra"


def test_no_se_borra_una_compra_ya_vendida():
    cuaderno = _producto("Cuaderno A4")
    compra = cliente.post("/api/compras", headers=ADMIN, json={"lineas": [
        {"producto_id": cuaderno["id"], "cantidad": 1, "coste_unitario": 1}]}).json()["id"]
    # Se vende todo el stock del cuaderno: borrar la compra lo dejaría en negativo
    venta = cliente.post("/api/ventas", headers=ADMIN, json={"lineas": [
        {"producto_id": cuaderno["id"], "cantidad": cuaderno["stock_actual"] + 1}]}).json()["id"]
    try:
        r = cliente.delete(f"/api/compras/{compra}", headers=ADMIN)
        assert r.status_code == 400 and "Cuaderno" in r.json()["detail"]
    finally:
        cliente.delete(f"/api/ventas/{venta}", headers=ADMIN)
        cliente.delete(f"/api/compras/{compra}", headers=ADMIN)
        # Restaurar el coste medio, que la compra de prueba ha movido
        with conexion("admin") as con, con.cursor() as cur:
            cur.execute("UPDATE productos SET coste_medio = %s WHERE id = %s",
                        (cuaderno["coste_medio"], cuaderno["id"]))


# ---------------------------------------------------------------------
#  Usuarios
# ---------------------------------------------------------------------
def test_gestion_de_usuarios_y_cambio_de_contraseña():
    try:
        r = cliente.post("/api/usuarios", headers=ADMIN, json={
            "usuario": "prueba", "nombre": "Prueba", "rol": "dependiente", "password": "prueba1234"})
        assert r.status_code == 200, r.text
        nuevo = r.json()["id"]
        cabecera = _token("prueba", "prueba1234")

        r = cliente.post("/api/auth/cambiar-password", headers=cabecera,
                         json={"actual": "mala", "nueva": "otra12345"})
        assert r.status_code == 400
        r = cliente.post("/api/auth/cambiar-password", headers=cabecera,
                         json={"actual": "prueba1234", "nueva": "otra12345"})
        assert r.status_code == 200
        _token("prueba", "otra12345")

        cliente.patch(f"/api/usuarios/{nuevo}", headers=ADMIN, json={"activo": False})
        r = cliente.post("/api/auth/login", json={"usuario": "prueba", "password": "otra12345"})
        assert r.status_code == 401
    finally:
        with conexion("admin") as con, con.cursor() as cur:
            cur.execute("DELETE FROM usuarios_app WHERE usuario = 'prueba'")
            cur.execute("DELETE FROM auditoria WHERE tabla = 'usuarios_app' AND detalle LIKE 'prueba%%'")


def test_el_admin_no_se_puede_quitar_a_si_mismo():
    admin_id = consultar("admin", "SELECT id FROM usuarios_app WHERE usuario = 'admin'")[0]["id"]
    r = cliente.patch(f"/api/usuarios/{admin_id}", headers=ADMIN, json={"activo": False})
    assert r.status_code == 400


# ---------------------------------------------------------------------
#  Alta de productos con coste, stock inicial y código de barras
# ---------------------------------------------------------------------
def _borrar_producto(producto_id: int):
    with conexion("admin") as con, con.cursor() as cur:
        cur.execute("DELETE FROM compras WHERE id IN (SELECT compra_id FROM lineas_compra WHERE producto_id = %s)",
                    (producto_id,))
        cur.execute("DELETE FROM productos WHERE id = %s", (producto_id,))


def test_alta_con_stock_inicial_crea_compra_lote_y_coste():
    base = _producto("Pan de molde")
    r = cliente.post("/api/productos", headers=ADMIN, json={
        "nombre": "Prueba yogur griego", "codigo_barras": "9990000000017", "categoria_id": base["categoria_id"],
        "iva_id": base["iva_id"], "precio_venta": 1.5, "controla_caducidad": True,
        "coste_compra": 0.8, "stock_inicial": 12, "fecha_caducidad": str(date.today() + timedelta(days=9)),
    })
    assert r.status_code == 200, r.text
    pid = r.json()["id"]
    try:
        p = _producto("Prueba yogur griego")
        assert float(p["stock_actual"]) == 12 and float(p["coste_medio"]) == 0.8
        assert list(_lotes(pid).values()) == [12]
        assert r.json()["compra_id"]
        # El mismo código de barras no se puede repetir: 409 con mensaje claro
        r2 = cliente.post("/api/productos", headers=ADMIN, json={
            "nombre": "Otro", "codigo_barras": "9990000000017", "categoria_id": base["categoria_id"],
            "iva_id": base["iva_id"], "precio_venta": 1})
        assert r2.status_code == 409 and "código de barras" in r2.json()["detail"]
        # Consultar un código que ya está en el catálogo
        c = cliente.get("/api/codigo/9990000000017", headers=ADMIN).json()
        assert c["en_catalogo"]["id"] == pid
        # Corregir el coste a mano queda en la auditoría
        assert cliente.patch(f"/api/productos/{pid}", headers=ADMIN, json={"coste_medio": 0.75}).status_code == 200
        assert _ultima_auditoria()["accion"] == "cambiar_coste"
        assert float(_producto("Prueba yogur griego")["coste_medio"]) == 0.75
    finally:
        _borrar_producto(pid)


def test_alta_sin_fecha_de_un_producto_que_caduca_no_guarda_nada():
    base = _producto("Pan de molde")
    r = cliente.post("/api/productos", headers=ADMIN, json={
        "nombre": "Prueba sin fecha", "categoria_id": base["categoria_id"], "iva_id": base["iva_id"],
        "precio_venta": 1, "controla_caducidad": True, "stock_inicial": 3})
    assert r.status_code == 400
    assert not consultar("admin", "SELECT id FROM productos WHERE nombre = 'Prueba sin fecha'")


def test_codigo_no_valido_y_solo_admin():
    assert cliente.get("/api/codigo/abc", headers=ADMIN).status_code == 400
    assert cliente.get("/api/codigo/8410000000000", headers=DEPENDIENTE).status_code == 403
