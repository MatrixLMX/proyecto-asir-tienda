"""Acceso a MariaDB.

Cada perfil de la web se conecta con SU usuario de base de datos, así
los permisos los controla MariaDB y no solo la aplicación: aunque
hubiera un fallo en la web (o el asistente intentara algo indebido),
un dependiente no podría leer costes ni beneficios.
"""
from contextlib import contextmanager
from decimal import Decimal
from datetime import date, datetime

import pymysql
import pymysql.cursors

from .config import settings

_CREDENCIALES = {
    "admin": ("tienda_admin", lambda: settings.db_admin_password),
    "dependiente": ("tienda_dependiente", lambda: settings.db_dependiente_password),
    "auth": ("tienda_auth", lambda: settings.db_auth_password),
}


class ErrorNegocio(Exception):
    """Error lanzado por un trigger (SIGNAL SQLSTATE '45000')."""


@contextmanager
def conexion(rol: str):
    usuario, password = _CREDENCIALES[rol]
    con = pymysql.connect(
        host=settings.db_host,
        port=settings.db_port,
        user=usuario,
        password=password(),
        database=settings.db_name,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
    )
    try:
        yield con
        con.commit()
    except pymysql.err.MySQLError as e:
        con.rollback()
        # 1644 = SIGNAL de un trigger: es un mensaje para el usuario
        if e.args and e.args[0] == 1644:
            raise ErrorNegocio(e.args[1]) from e
        raise
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def _limpiar(fila: dict) -> dict:
    """Convierte Decimal y fechas a tipos que se pasan bien a JSON."""
    out = {}
    for k, v in fila.items():
        if isinstance(v, Decimal):
            v = float(v)
        elif isinstance(v, (date, datetime)):
            v = v.isoformat()
        out[k] = v
    return out


def consultar(rol: str, sql: str, params: tuple | dict = ()) -> list[dict]:
    with conexion(rol) as con, con.cursor() as cur:
        cur.execute(sql, params)
        return [_limpiar(f) for f in cur.fetchall()]
