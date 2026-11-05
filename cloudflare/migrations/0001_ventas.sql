-- =====================================================================
--  Tienda en D1 (SQLite). Traducción de sql/01..03 de MariaDB, de momento
--  solo lo necesario para login, productos y ventas.
--
--  SQLite no tiene DECIMAL exacto: para que la caja cuadre al céntimo, todo
--  se guarda en enteros y las vistas lo devuelven en euros y kilos.
--    *_cent   céntimos de euro           *_milli  milésimas (g o 1/1000 u)
--    *_dm     diezmilésimas de euro      *_cp     centésimas de porcentaje
--  Las fechas se guardan en UTC.
-- =====================================================================

CREATE TABLE tipos_iva (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre        TEXT NOT NULL UNIQUE,
  porcentaje_cp INTEGER NOT NULL CHECK (porcentaje_cp BETWEEN 0 AND 10000)
);

CREATE TABLE categorias (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre      TEXT NOT NULL UNIQUE COLLATE NOCASE,
  descripcion TEXT,
  activa      INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE proveedores (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  contacto TEXT,
  telefono TEXT,
  email    TEXT,
  notas    TEXT,
  activo   INTEGER NOT NULL DEFAULT 1
);

-- CHECK de stock: última barrera contra vender de más, aunque dos ventas
-- lleguen a la vez.
CREATE TABLE productos (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo_barras        TEXT UNIQUE,
  nombre               TEXT NOT NULL,
  categoria_id         INTEGER NOT NULL REFERENCES categorias(id),
  proveedor_id         INTEGER REFERENCES proveedores(id) ON DELETE SET NULL,
  iva_id               INTEGER NOT NULL REFERENCES tipos_iva(id),
  unidad_medida        TEXT NOT NULL DEFAULT 'unidad' CHECK (unidad_medida IN ('unidad','kg')),
  precio_venta_cent    INTEGER NOT NULL CHECK (precio_venta_cent >= 0),
  coste_medio_dm       INTEGER NOT NULL DEFAULT 0,
  stock_milli          INTEGER NOT NULL DEFAULT 0 CHECK (stock_milli >= 0),
  stock_minimo_milli   INTEGER NOT NULL DEFAULT 0 CHECK (stock_minimo_milli >= 0),
  controla_caducidad   INTEGER NOT NULL DEFAULT 0,
  vida_util_dias       INTEGER,
  dias_aviso_caducidad INTEGER NOT NULL DEFAULT 5,
  activo               INTEGER NOT NULL DEFAULT 1,
  creado_en            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_prod_nombre ON productos(nombre);

CREATE TABLE lotes (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  producto_id      INTEGER NOT NULL REFERENCES productos(id),
  fecha_entrada    TEXT NOT NULL,
  fecha_caducidad  TEXT NOT NULL,
  inicial_milli    INTEGER NOT NULL,
  restante_milli   INTEGER NOT NULL CHECK (restante_milli >= 0)
);
CREATE INDEX idx_lote_caducidad ON lotes(producto_id, fecha_caducidad);

-- "cerrada" se pone a 1 al final de la venta: es cuando ya se conoce el
-- total y un trigger puede comprobar que el pago mixto cuadra.
CREATE TABLE ventas (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metodo_pago       TEXT NOT NULL DEFAULT 'efectivo' CHECK (metodo_pago IN ('efectivo','tarjeta','bizum','mixto')),
  pago_tarjeta_cent INTEGER NOT NULL DEFAULT 0 CHECK (pago_tarjeta_cent >= 0),
  pago_bizum_cent   INTEGER NOT NULL DEFAULT 0 CHECK (pago_bizum_cent >= 0),
  total_cent        INTEGER NOT NULL DEFAULT 0,
  usuario           TEXT,
  cerrada           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_venta_fecha ON ventas(fecha);

CREATE TABLE lineas_venta (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  venta_id             INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  producto_id          INTEGER NOT NULL REFERENCES productos(id),
  cantidad_milli       INTEGER NOT NULL CHECK (cantidad_milli > 0),
  precio_unitario_cent INTEGER NOT NULL,
  iva_cp               INTEGER NOT NULL,
  coste_unitario_dm    INTEGER NOT NULL
);
CREATE INDEX idx_lv_venta ON lineas_venta(venta_id);
CREATE INDEX idx_lv_producto ON lineas_venta(producto_id);

CREATE TABLE lotes_consumidos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  linea_venta_id INTEGER NOT NULL REFERENCES lineas_venta(id) ON DELETE CASCADE,
  lote_id        INTEGER NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
  cantidad_milli INTEGER NOT NULL
);
CREATE INDEX idx_lc_linea ON lotes_consumidos(linea_venta_id);

CREATE TABLE usuarios_app (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario       TEXT NOT NULL UNIQUE,
  nombre        TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  rol           TEXT NOT NULL CHECK (rol IN ('admin','dependiente')),
  activo        INTEGER NOT NULL DEFAULT 1,
  creado_en     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Sustituye al límite en memoria de la versión FastAPI: un Worker no es un
-- proceso que siga vivo entre peticiones.
CREATE TABLE intentos_login (
  ip    TEXT NOT NULL,
  fecha TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_intentos ON intentos_login(ip, fecha);

-- =====================================================================
--  Reglas de venta. Los códigos en mayúsculas los traduce src/index.ts a
--  mensajes para el usuario. Un RAISE deshace toda la venta.
-- =====================================================================
CREATE TRIGGER trg_lv_baja BEFORE INSERT ON lineas_venta
WHEN (SELECT activo FROM productos WHERE id = NEW.producto_id) = 0
BEGIN SELECT RAISE(ABORT, 'PRODUCTO_BAJA'); END;

CREATE TRIGGER trg_lv_unidades BEFORE INSERT ON lineas_venta
WHEN NEW.cantidad_milli % 1000 <> 0
 AND (SELECT unidad_medida FROM productos WHERE id = NEW.producto_id) = 'unidad'
BEGIN SELECT RAISE(ABORT, 'SOLO_UNIDADES'); END;

CREATE TRIGGER trg_lv_stock BEFORE INSERT ON lineas_venta
WHEN (SELECT stock_milli FROM productos WHERE id = NEW.producto_id) < NEW.cantidad_milli
BEGIN SELECT RAISE(ABORT, 'STOCK_INSUFICIENTE'); END;

-- Resta stock, gasta los lotes del que caduca antes al que caduca después
-- (FEFO), apunta de qué lote salió cada parte y suma al total del ticket.
-- La suma acumulada hace lo mismo que el cursor de consumir_lotes en MariaDB.
CREATE TRIGGER trg_lv_after_insert AFTER INSERT ON lineas_venta
BEGIN
  UPDATE productos SET stock_milli = stock_milli - NEW.cantidad_milli WHERE id = NEW.producto_id;

  INSERT INTO lotes_consumidos (linea_venta_id, lote_id, cantidad_milli)
  SELECT NEW.id, id, MIN(restante_milli, NEW.cantidad_milli - previo)
    FROM (SELECT id, restante_milli,
                 COALESCE(SUM(restante_milli) OVER (
                   ORDER BY fecha_caducidad, id
                   ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS previo
            FROM lotes
           WHERE producto_id = NEW.producto_id AND restante_milli > 0)
   WHERE previo < NEW.cantidad_milli;

  UPDATE lotes
     SET restante_milli = restante_milli - (
           SELECT cantidad_milli FROM lotes_consumidos
            WHERE linea_venta_id = NEW.id AND lote_id = lotes.id)
   WHERE id IN (SELECT lote_id FROM lotes_consumidos WHERE linea_venta_id = NEW.id);

  -- Redondeo al céntimo con enteros, sin pasar por decimales binarios
  UPDATE ventas
     SET total_cent = total_cent + (NEW.cantidad_milli * NEW.precio_unitario_cent + 500) / 1000
   WHERE id = NEW.venta_id;
END;

CREATE TRIGGER trg_lv_no_modificar BEFORE UPDATE ON lineas_venta
BEGIN SELECT RAISE(ABORT, 'LINEA_NO_MODIFICABLE'); END;

CREATE TRIGGER trg_venta_mixto_excede BEFORE UPDATE OF cerrada ON ventas
WHEN NEW.cerrada = 1 AND NEW.metodo_pago = 'mixto'
 AND NEW.pago_tarjeta_cent + NEW.pago_bizum_cent > NEW.total_cent
BEGIN SELECT RAISE(ABORT, 'MIXTO_EXCEDE'); END;

CREATE TRIGGER trg_venta_mixto_partes BEFORE UPDATE OF cerrada ON ventas
WHEN NEW.cerrada = 1 AND NEW.metodo_pago = 'mixto'
 AND (NEW.total_cent - NEW.pago_tarjeta_cent - NEW.pago_bizum_cent > 0)
   + (NEW.pago_tarjeta_cent > 0) + (NEW.pago_bizum_cent > 0) < 2
BEGIN SELECT RAISE(ABORT, 'MIXTO_PARTES'); END;

-- =====================================================================
--  Vistas: mismas columnas y unidades que en MariaDB
-- =====================================================================
CREATE VIEW v_stock AS
SELECT p.id, p.codigo_barras, p.nombre AS producto, c.nombre AS categoria, p.unidad_medida,
       p.precio_venta_cent / 100.0 AS precio_venta,
       p.stock_milli / 1000.0 AS stock_actual,
       p.stock_minimo_milli / 1000.0 AS stock_minimo,
       CASE WHEN p.stock_milli <= 0 THEN 'AGOTADO'
            WHEN p.stock_milli <= p.stock_minimo_milli THEN 'BAJO'
            ELSE 'OK' END AS estado
  FROM productos p JOIN categorias c ON c.id = p.categoria_id
 WHERE p.activo;

CREATE VIEW v_alertas_stock AS
SELECT p.id, p.nombre AS producto, c.nombre AS categoria, pr.nombre AS proveedor, p.unidad_medida,
       p.stock_milli / 1000.0 AS stock_actual,
       p.stock_minimo_milli / 1000.0 AS stock_minimo,
       MAX(p.stock_minimo_milli * 2 - p.stock_milli, 0) / 1000.0 AS cantidad_sugerida
  FROM productos p
  JOIN categorias c ON c.id = p.categoria_id
  LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
 WHERE p.activo AND p.stock_milli <= p.stock_minimo_milli;

CREATE VIEW v_caducidades AS
SELECT l.id AS lote_id, p.id AS producto_id, p.nombre AS producto, c.nombre AS categoria,
       l.fecha_caducidad,
       CAST(julianday(l.fecha_caducidad) - julianday(date('now')) AS INTEGER) AS dias_restantes,
       l.restante_milli / 1000.0 AS cantidad_restante,
       p.unidad_medida,
       CASE WHEN l.fecha_caducidad < date('now') THEN 'CADUCADO'
            WHEN l.fecha_caducidad = date('now') THEN 'CADUCA HOY'
            ELSE 'PROXIMO' END AS estado
  FROM lotes l
  JOIN productos p ON p.id = l.producto_id
  JOIN categorias c ON c.id = p.categoria_id
 WHERE l.restante_milli > 0
   AND l.fecha_caducidad <= date('now', '+' || p.dias_aviso_caducidad || ' days');

CREATE VIEW v_mas_vendidos AS
SELECT lv.producto_id, COUNT(DISTINCT lv.venta_id) AS tickets
  FROM lineas_venta lv
  JOIN ventas v ON v.id = lv.venta_id
  JOIN productos p ON p.id = lv.producto_id
 WHERE v.fecha >= datetime('now', '-60 days') AND p.activo
 GROUP BY lv.producto_id;

-- =====================================================================
--  Datos de partida (sql/06_datos_base.sql)
-- =====================================================================
INSERT INTO tipos_iva (nombre, porcentaje_cp) VALUES
  ('Superreducido', 400), ('Reducido', 1000), ('General', 2100), ('Exento', 0);

INSERT INTO categorias (nombre) VALUES
  ('Alimentación'), ('Bebidas'), ('Fruta y verdura'), ('Charcutería'), ('Helados y congelados'),
  ('Limpieza'), ('Ferretería'), ('Cocina'), ('Útiles'), ('Escolar'), ('Juguetes'), ('Regalos');

INSERT INTO proveedores (nombre, notas) VALUES
  ('Coca-Cola', NULL), ('Don Pin', NULL), ('Matutano', NULL), ('Frigo', NULL), ('Nestlé', NULL),
  ('Bodegas Oviedo', NULL), ('Sándwiches y embutidos', 'Nombre comercial pendiente de confirmar'),
  ('Dulcesol', NULL);
