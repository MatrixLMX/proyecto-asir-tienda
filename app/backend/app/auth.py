"""Login con usuario y contraseña (bcrypt) y sesiones con JWT."""
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from .config import settings
from .db import consultar

_bearer = HTTPBearer(auto_error=False)


class Usuario(BaseModel):
    usuario: str
    nombre: str
    rol: str  # 'admin' | 'dependiente'


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
