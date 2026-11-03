-- =====================================================================
--  04_roles.sql : perfiles de acceso (roles de MariaDB)
--
--  rol_admin       -> responsable del negocio: todo, incluidos costes
--                     y beneficios. No puede cambiar la estructura
--                     (eso se hace como root desde el servidor).
--  rol_dependiente -> registra ventas y mermas, consulta stock y
--                     caducidades. NO ve precios de compra ni beneficios.
--  rol_auth        -> solo lo usa la web para comprobar el login.
--
--  Los usuarios concretos se crean con 05_usuarios.sh, que lee las
--  contraseñas del fichero .env (así no se suben a GitHub).
-- =====================================================================

USE tienda;

CREATE ROLE IF NOT EXISTS rol_admin;
CREATE ROLE IF NOT EXISTS rol_dependiente;
CREATE ROLE IF NOT EXISTS rol_auth;

-- Administrador
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE, SHOW VIEW ON tienda.* TO rol_admin;

-- Dependiente: consultas (sin columnas de coste)
GRANT SELECT ON tienda.v_stock         TO rol_dependiente;
GRANT SELECT ON tienda.v_alertas_stock TO rol_dependiente;
GRANT SELECT ON tienda.v_caducidades   TO rol_dependiente;
GRANT SELECT ON tienda.categorias      TO rol_dependiente;
GRANT SELECT ON tienda.ventas          TO rol_dependiente;
GRANT SELECT ON tienda.v_lineas_ticket TO rol_dependiente;
GRANT SELECT ON tienda.v_caja_diaria   TO rol_dependiente;
GRANT SELECT ON tienda.v_productos_parados TO rol_dependiente;
GRANT SELECT ON tienda.v_mas_vendidos  TO rol_dependiente;
GRANT SELECT ON tienda.cierres_caja    TO rol_dependiente;

-- Dependiente: cerrar la caja del día
GRANT INSERT (fecha, tickets, total_efectivo, total_tarjeta, total_bizum,
              fondo_inicial, efectivo_contado, usuario, notas)
  ON tienda.cierres_caja TO rol_dependiente;

-- Dependiente: registrar ventas. Solo puede indicar qué y cuánto; el
-- precio, el IVA y el coste los pone el trigger.
GRANT INSERT (metodo_pago, pago_tarjeta, pago_bizum, usuario) ON tienda.ventas TO rol_dependiente;
GRANT INSERT (venta_id, producto_id, cantidad) ON tienda.lineas_venta TO rol_dependiente;

-- Dependiente: registrar productos tirados (caducados, rotos...)
GRANT INSERT (producto_id, lote_id, cantidad, motivo, usuario, notas)
  ON tienda.mermas TO rol_dependiente;

-- Login de la aplicación web. Puede cambiar SOLO la contraseña (la
-- web comprueba antes la contraseña actual), no el perfil.
GRANT SELECT ON tienda.usuarios_app TO rol_auth;
GRANT UPDATE (password_hash) ON tienda.usuarios_app TO rol_auth;
