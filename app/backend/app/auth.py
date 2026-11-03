"""Login con usuario y contraseña (bcrypt) y sesiones con JWT."""
import logging
import time
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from .config import settings
from .db import conexion, consultar

_bearer = HTTPBearer(auto_error=False)

# Los intentos fallidos se escriben en el registro del servicio
# (journalctl -u tienda-api). Fail2ban los lee y bloquea la IP en el
# cortafuegos: ver config/fail2ban/filter.d/tienda-web.conf
registro = logging.getLogger("tienda.auth")
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


class Usuario(BaseModel):
    usuario: str
    nombre: str
    rol: str  # 'admin' | 'dependiente'


# ---------------------------------------------------------------------
#  Límite de intentos de login por IP (segunda barrera, además de
#  Fail2ban). Vive en memoria: por eso la API corre con un solo proceso.
# ---------------------------------------------------------------------
_VENTANA = 15 * 60
_fallos: dict[str, deque] = defaultdict(deque)


def _limpiar_fallos(ip: str) -> deque:
    fallos = _fallos[ip]
    while fallos and fallos[0] < time.monotonic() - _VENTANA:
        fallos.popleft()
    return fallos


def comprobar_bloqueo(ip: str) -> None:
    if len(_limpiar_fallos(ip)) >= settings.login_max_intentos:
        registro.warning("LOGIN BLOQUEADO ip=%s", ip)
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS,
                            "Demasiados intentos fallidos. Espera 15 minutos y vuelve a probar.")


def apuntar_fallo(ip: str, usuario: str) -> None:
    _limpiar_fallos(ip).append(time.monotonic())
    registro.warning("LOGIN FALLIDO usuario=%r ip=%s", usuario, ip)


def olvidar_fallos(ip: str) -> None:
    _fallos.pop(ip, None)


# ---------------------------------------------------------------------
#  Contraseñas y sesiones
# ---------------------------------------------------------------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(12)).decode()


def autenticar(usuario: str, password: str) -> Usuario | None:
    filas = consultar(
        "auth",
        "SELECT usuario, nombre, password_hash, rol FROM usuarios_app "
        "WHERE usuario = %s AND activo",
        (usuario,),
    )
    if not filas or not bcrypt.checkpw(password.encode(), filas[0]["password_hash"].encode()):
        return None
    f = filas[0]
    return Usuario(usuario=f["usuario"], nombre=f["nombre"], rol=f["rol"])


def cambiar_password(usuario: str, nueva: str) -> None:
    # rol_auth solo puede tocar la columna password_hash
    with conexion("auth", usuario) as con, con.cursor() as cur:
        cur.execute("UPDATE usuarios_app SET password_hash = %s WHERE usuario = %s",
                    (hash_password(nueva), usuario))


def crear_token(u: Usuario) -> str:
    payload = {
        "sub": u.usuario,
        "nombre": u.nombre,
        "rol": u.rol,
        "exp": datetime.now(timezone.utc) + timedelta(hours=settings.jwt_horas),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def usuario_actual(cred: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> Usuario:
    if cred is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Inicia sesión")
    try:
        p = jwt.decode(cred.credentials, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sesión caducada o no válida")
    return Usuario(usuario=p["sub"], nombre=p["nombre"], rol=p["rol"])


def solo_admin(u: Usuario = Depends(usuario_actual)) -> Usuario:
    if u.rol != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Solo para el administrador")
    return u
