"""Crea (o cambia la contraseña de) un usuario de la web.

Uso, desde app/backend:
    .venv/bin/python -m app.crear_usuario          (Linux)
    .venv\\Scripts\\python -m app.crear_usuario     (Windows)
"""
from getpass import getpass

from .auth import hash_password

from .db import conexion


def main() -> None:
    usuario = input("Usuario (para iniciar sesión): ").strip()
    nombre = input("Nombre que se mostrará: ").strip() or usuario
    rol = ""
    while rol not in ("admin", "dependiente"):
        rol = input("Perfil [admin/dependiente]: ").strip().lower()
    password = getpass("Contraseña (mínimo 8 caracteres): ")
    if len(password) < 8 or password != getpass("Repite la contraseña: "):
        raise SystemExit("Las contraseñas no coinciden o son demasiado cortas.")

    hash_ = hash_password(password)
    with conexion("admin") as con, con.cursor() as cur:
        cur.execute(
            "INSERT INTO usuarios_app (usuario, nombre, password_hash, rol) VALUES (%s, %s, %s, %s) "
            "ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), password_hash = VALUES(password_hash), "
            "rol = VALUES(rol), activo = TRUE",
            (usuario, nombre, hash_, rol),
        )
    print(f"Usuario '{usuario}' guardado con perfil {rol}.")


if __name__ == "__main__":
    main()
