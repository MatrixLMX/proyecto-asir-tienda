-- =====================================================================
--  Productos sin control de stock, ofertas por cantidad, fiado,
--  devoluciones parciales, recuento de inventario y avisos al móvil.
-- =====================================================================

-- ---------------------------------------------------------------------
--  Productos
--   control_stock = 0  no se lleva la cuenta (chuches, barra de pan)
--   precio_libre  = 1  el importe se escribe al vender (chuches a granel)
--   acceso_rapido = 1  sale siempre en el botón de acceso rápido de Vender
-- ---------------------------------------------------------------------
ALTER TABLE productos ADD COLUMN control_stock INTEGER NOT NULL DEFAULT 1;
ALTER TABLE productos ADD COLUMN precio_libre  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE productos ADD COLUMN acceso_rapido INTEGER NOT NULL DEFAULT 0;

-- "Si compra 3, la unidad le sale a tal": el precio se aplica a todas las
-- unidades del ticket en cuanto se llega a la cantidad mínima.
CREATE TABLE ofertas (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  producto_id           INTEGER NOT NULL REFERENCES productos(id),
  cantidad_minima_milli INTEGER NOT NULL CHECK (cantidad_minima_milli > 0),
  precio_cent           INTEGER NOT NULL CHECK (precio_cent >= 0),
  activa                INTEGER NOT NULL DEFAULT 1,
  UNIQUE (producto_id, cantidad_minima_milli)
);

-- ---------------------------------------------------------------------
--  Fiado
-- ---------------------------------------------------------------------
CREATE TABLE clientes (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  telefono TEXT,
  notas    TEXT,
  activo   INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE pagos_fiado (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  cliente_id  INTEGER NOT NULL REFERENCES clientes(id),
  fecha       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  importe_cent INTEGER NOT NULL CHECK (importe_cent > 0),
  metodo      TEXT NOT NULL CHECK (metodo IN ('efectivo','tarjeta','bizum')),
  usuario     TEXT,
  notas       TEXT
);
CREATE INDEX idx_pago_cliente ON pagos_fiado(cliente_id);
CREATE INDEX idx_pago_dia ON pagos_fiado(substr(fecha, 1, 10));

CREATE TRIGGER trg_pagos_fecha AFTER INSERT ON pagos_fiado WHEN NEW.fecha LIKE '% %'
BEGIN UPDATE pagos_fiado SET fecha = (SELECT ahora FROM v_ahora) WHERE id = NEW.id; END;

-- ---------------------------------------------------------------------
--  Ventas: SQLite no permite cambiar un CHECK, así que para admitir el
--  fiado hay que rehacer la tabla. Se borran antes las tablas hijas, porque
--  borrar una tabla madre lanzaría su borrado en cascada.
-- ---------------------------------------------------------------------
DROP VIEW v_stock;
DROP VIEW v_alertas_stock;
DROP VIEW v_mas_vendidos;
DROP VIEW v_ventas;
DROP VIEW v_lineas_ticket;
DROP VIEW v_caja_diaria;
DROP VIEW v_caja_cent;
DROP VIEW v_productos_parados;
DROP VIEW v_productos_admin;
DROP VIEW v_beneficio_mensual;
DROP VIEW v_beneficio_categoria;
DROP VIEW v_beneficio_producto;
DROP VIEW v_lineas_detalle;
DROP VIEW v_ventas_diarias;

CREATE TABLE _copia_ventas AS SELECT * FROM ventas;
CREATE TABLE _copia_lineas AS SELECT * FROM lineas_venta;
CREATE TABLE _copia_consumidos AS SELECT * FROM lotes_consumidos;
DROP TABLE lotes_consumidos;
DROP TABLE lineas_venta;
DROP TABLE ventas;

CREATE TABLE ventas (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metodo_pago       TEXT NOT NULL DEFAULT 'efectivo' CHECK (metodo_pago IN ('efectivo','tarjeta','bizum','mixto','fiado')),
  pago_tarjeta_cent INTEGER NOT NULL DEFAULT 0 CHECK (pago_tarjeta_cent >= 0),
  pago_bizum_cent   INTEGER NOT NULL DEFAULT 0 CHECK (pago_bizum_cent >= 0),
  pago_fiado_cent   INTEGER NOT NULL DEFAULT 0 CHECK (pago_fiado_cent >= 0),
  cliente_id        INTEGER REFERENCES clientes(id),
  total_cent        INTEGER NOT NULL DEFAULT 0,
  usuario           TEXT,
  cerrada           INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_venta_fecha ON ventas(fecha);
CREATE INDEX idx_venta_dia ON ventas(substr(fecha, 1, 10));
CREATE INDEX idx_venta_cliente ON ventas(cliente_id);

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
  cantidad_milli INTEGER NOT NULL,
  devuelto_milli INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_lc_linea ON lotes_consumidos(linea_venta_id);

INSERT INTO ventas (id, fecha, metodo_pago, pago_tarjeta_cent, pago_bizum_cent, total_cent, usuario, cerrada)
SELECT id, fecha, metodo_pago, pago_tarjeta_cent, pago_bizum_cent, total_cent, usuario, cerrada FROM _copia_ventas;
INSERT INTO lineas_venta (id, venta_id, producto_id, cantidad_milli, precio_unitario_cent, iva_cp, coste_unitario_dm)
SELECT id, venta_id, producto_id, cantidad_milli, precio_unitario_cent, iva_cp, coste_unitario_dm FROM _copia_lineas;
INSERT INTO lotes_consumidos (id, linea_venta_id, lote_id, cantidad_milli)
SELECT id, linea_venta_id, lote_id, cantidad_milli FROM _copia_consumidos;
DROP TABLE _copia_consumidos;
DROP TABLE _copia_lineas;
DROP TABLE _copia_ventas;

-- ---------------------------------------------------------------------
--  Devoluciones. "repuesto" dice si el producto vuelve a la estantería; si
--  estaba roto no vuelve, y su coste sigue contando en el beneficio.
-- ---------------------------------------------------------------------
CREATE TABLE devoluciones (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  venta_id     INTEGER NOT NULL REFERENCES ventas(id),
  fecha        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metodo       TEXT NOT NULL CHECK (metodo IN ('efectivo','tarjeta','bizum','fiado')),
  importe_cent INTEGER NOT NULL DEFAULT 0,
  usuario      TEXT,
  notas        TEXT
);
CREATE INDEX idx_dev_venta ON devoluciones(venta_id);
CREATE INDEX idx_dev_fecha ON devoluciones(fecha);
CREATE INDEX idx_dev_dia ON devoluciones(substr(fecha, 1, 10));

CREATE TABLE lineas_devolucion (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  devolucion_id  INTEGER NOT NULL REFERENCES devoluciones(id),
  linea_venta_id INTEGER NOT NULL REFERENCES lineas_venta(id),
  cantidad_milli INTEGER NOT NULL CHECK (cantidad_milli > 0),
  importe_cent   INTEGER NOT NULL,
  repuesto       INTEGER NOT NULL
);
CREATE INDEX idx_ld_linea ON lineas_devolucion(linea_venta_id);

CREATE TABLE devoluciones_lotes (
  linea_devolucion_id INTEGER NOT NULL REFERENCES lineas_devolucion(id),
  lote_consumido_id   INTEGER NOT NULL REFERENCES lotes_consumidos(id) ON DELETE CASCADE,
  cantidad_milli      INTEGER NOT NULL
);
CREATE INDEX idx_dl_linea ON devoluciones_lotes(linea_devolucion_id);

CREATE TRIGGER trg_dev_fecha AFTER INSERT ON devoluciones WHEN NEW.fecha LIKE '% %'
BEGIN UPDATE devoluciones SET fecha = (SELECT ahora FROM v_ahora) WHERE id = NEW.id; END;

CREATE TRIGGER trg_ld_excede BEFORE INSERT ON lineas_devolucion
WHEN COALESCE((SELECT SUM(cantidad_milli) FROM lineas_devolucion WHERE linea_venta_id = NEW.linea_venta_id), 0) + NEW.cantidad_milli
     > (SELECT cantidad_milli FROM lineas_venta WHERE id = NEW.linea_venta_id)
BEGIN SELECT RAISE(ABORT, 'DEVOLUCION_EXCEDE'); END;

-- Devuelve primero a los lotes de los que se gastó lo último, es decir, a los
-- que caducan más tarde: si queda algo en un lote, es en el que más dura.
CREATE TRIGGER trg_ld_after_insert AFTER INSERT ON lineas_devolucion
BEGIN
  UPDATE devoluciones SET importe_cent = importe_cent + NEW.importe_cent WHERE id = NEW.devolucion_id;

  UPDATE productos SET stock_milli = stock_milli + NEW.cantidad_milli
   WHERE NEW.repuesto = 1 AND control_stock = 1
     AND id = (SELECT producto_id FROM lineas_venta WHERE id = NEW.linea_venta_id);

  INSERT INTO devoluciones_lotes (linea_devolucion_id, lote_consumido_id, cantidad_milli)
  SELECT NEW.id, id, MIN(queda, NEW.cantidad_milli - previo)
    FROM (SELECT id, cantidad_milli - devuelto_milli AS queda,
                 COALESCE(SUM(cantidad_milli - devuelto_milli) OVER (
                   ORDER BY id DESC ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS previo
            FROM lotes_consumidos
           WHERE linea_venta_id = NEW.linea_venta_id AND cantidad_milli > devuelto_milli AND NEW.repuesto = 1)
   WHERE previo < NEW.cantidad_milli;

  UPDATE lotes_consumidos
     SET devuelto_milli = devuelto_milli + (
           SELECT cantidad_milli FROM devoluciones_lotes
            WHERE linea_devolucion_id = NEW.id AND lote_consumido_id = lotes_consumidos.id)
   WHERE id IN (SELECT lote_consumido_id FROM devoluciones_lotes WHERE linea_devolucion_id = NEW.id);

  UPDATE lotes
     SET restante_milli = restante_milli + (
           SELECT SUM(d.cantidad_milli) FROM devoluciones_lotes d
             JOIN lotes_consumidos c ON c.id = d.lote_consumido_id
            WHERE d.linea_devolucion_id = NEW.id AND c.lote_id = lotes.id)
   WHERE id IN (SELECT c.lote_id FROM devoluciones_lotes d
                  JOIN lotes_consumidos c ON c.id = d.lote_consumido_id
                 WHERE d.linea_devolucion_id = NEW.id);
END;

-- ---------------------------------------------------------------------
--  Reglas de venta, ahora con productos sin control de stock y fiado
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_lv_baja BEFORE INSERT ON lineas_venta
WHEN (SELECT activo FROM productos WHERE id = NEW.producto_id) = 0
BEGIN SELECT RAISE(ABORT, 'PRODUCTO_BAJA'); END;

CREATE TRIGGER trg_lv_unidades BEFORE INSERT ON lineas_venta
WHEN NEW.cantidad_milli % 1000 <> 0
 AND (SELECT unidad_medida FROM productos WHERE id = NEW.producto_id) = 'unidad'
BEGIN SELECT RAISE(ABORT, 'SOLO_UNIDADES'); END;

CREATE TRIGGER trg_lv_stock BEFORE INSERT ON lineas_venta
WHEN (SELECT control_stock = 1 AND stock_milli < NEW.cantidad_milli FROM productos WHERE id = NEW.producto_id)
BEGIN SELECT RAISE(ABORT, 'STOCK_INSUFICIENTE'); END;

CREATE TRIGGER trg_lv_after_insert AFTER INSERT ON lineas_venta
BEGIN
  UPDATE productos SET stock_milli = stock_milli - NEW.cantidad_milli
   WHERE id = NEW.producto_id AND control_stock = 1;

  INSERT INTO lotes_consumidos (linea_venta_id, lote_id, cantidad_milli)
  SELECT NEW.id, id, MIN(restante_milli, NEW.cantidad_milli - previo)
    FROM (SELECT l.id, l.restante_milli,
                 COALESCE(SUM(l.restante_milli) OVER (
                   ORDER BY l.fecha_caducidad, l.id
                   ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS previo
            FROM lotes l JOIN productos p ON p.id = l.producto_id
           WHERE l.producto_id = NEW.producto_id AND l.restante_milli > 0 AND p.control_stock = 1)
   WHERE previo < NEW.cantidad_milli;

  UPDATE lotes
     SET restante_milli = restante_milli - (
           SELECT cantidad_milli FROM lotes_consumidos
            WHERE linea_venta_id = NEW.id AND lote_id = lotes.id)
   WHERE id IN (SELECT lote_id FROM lotes_consumidos WHERE linea_venta_id = NEW.id);

  UPDATE ventas
     SET total_cent = total_cent + (NEW.cantidad_milli * NEW.precio_unitario_cent + 500) / 1000
   WHERE id = NEW.venta_id;
END;

CREATE TRIGGER trg_lv_no_modificar BEFORE UPDATE ON lineas_venta
BEGIN SELECT RAISE(ABORT, 'LINEA_NO_MODIFICABLE'); END;

CREATE TRIGGER trg_lv_before_delete BEFORE DELETE ON lineas_venta
BEGIN
  UPDATE lotes
     SET restante_milli = restante_milli + (
           SELECT SUM(cantidad_milli) FROM lotes_consumidos
            WHERE linea_venta_id = OLD.id AND lote_id = lotes.id)
   WHERE id IN (SELECT lote_id FROM lotes_consumidos WHERE linea_venta_id = OLD.id);
  UPDATE productos SET stock_milli = stock_milli + OLD.cantidad_milli
   WHERE id = OLD.producto_id AND control_stock = 1;
  UPDATE ventas
     SET total_cent = total_cent - (OLD.cantidad_milli * OLD.precio_unitario_cent + 500) / 1000
   WHERE id = OLD.venta_id;
END;

CREATE TRIGGER trg_ventas_fecha AFTER INSERT ON ventas WHEN NEW.fecha LIKE '% %'
BEGIN UPDATE ventas SET fecha = (SELECT ahora FROM v_ahora) WHERE id = NEW.id; END;

CREATE TRIGGER trg_venta_mixto_excede BEFORE UPDATE OF cerrada ON ventas
WHEN NEW.cerrada = 1 AND NEW.metodo_pago = 'mixto'
 AND NEW.pago_tarjeta_cent + NEW.pago_bizum_cent + NEW.pago_fiado_cent > NEW.total_cent
BEGIN SELECT RAISE(ABORT, 'MIXTO_EXCEDE'); END;

CREATE TRIGGER trg_venta_mixto_partes BEFORE UPDATE OF cerrada ON ventas
WHEN NEW.cerrada = 1 AND NEW.metodo_pago = 'mixto'
 AND (NEW.total_cent - NEW.pago_tarjeta_cent - NEW.pago_bizum_cent - NEW.pago_fiado_cent > 0)
   + (NEW.pago_tarjeta_cent > 0) + (NEW.pago_bizum_cent > 0) + (NEW.pago_fiado_cent > 0) < 2
BEGIN SELECT RAISE(ABORT, 'MIXTO_PARTES'); END;

CREATE TRIGGER trg_venta_fiado_cliente BEFORE UPDATE OF cerrada ON ventas
WHEN NEW.cerrada = 1 AND (NEW.metodo_pago = 'fiado' OR NEW.pago_fiado_cent > 0) AND NEW.cliente_id IS NULL
BEGIN SELECT RAISE(ABORT, 'FIADO_SIN_CLIENTE'); END;

-- Con devoluciones hechas, anular devolvería dos veces el stock y el dinero
CREATE TRIGGER trg_ventas_con_devolucion BEFORE DELETE ON ventas
WHEN EXISTS (SELECT 1 FROM devoluciones WHERE venta_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'VENTA_CON_DEVOLUCIONES'); END;

CREATE TRIGGER trg_ventas_before_delete BEFORE DELETE ON ventas
BEGIN
  INSERT INTO auditoria (usuario, accion, tabla, registro_id, detalle)
  VALUES (COALESCE((SELECT usuario FROM contexto_app), 'sistema'), 'anular_venta', 'ventas', OLD.id,
          'Ticket nº ' || OLD.id || ' del ' || strftime('%d/%m/%Y %H:%M', OLD.fecha) || ': '
          || replace(printf('%.2f', OLD.total_cent / 100.0), '.', ',') || ' € en ' || OLD.metodo_pago
          || ', vendido por ' || COALESCE(OLD.usuario, '?'));
END;

-- ---------------------------------------------------------------------
--  Compras y mermas de productos sin control de stock: el coste se guarda,
--  pero la cantidad no se suma ni se resta.
-- ---------------------------------------------------------------------
DROP TRIGGER trg_lc_after_insert;
CREATE TRIGGER trg_lc_after_insert AFTER INSERT ON lineas_compra
BEGIN
  UPDATE productos
     SET coste_medio_dm = CASE WHEN stock_milli <= 0 OR control_stock = 0 THEN NEW.coste_unitario_dm
           ELSE (stock_milli * coste_medio_dm + NEW.cantidad_milli * NEW.coste_unitario_dm
                 + (stock_milli + NEW.cantidad_milli) / 2) / (stock_milli + NEW.cantidad_milli) END,
         stock_milli = stock_milli + CASE WHEN control_stock = 1 THEN NEW.cantidad_milli ELSE 0 END
   WHERE id = NEW.producto_id;

  INSERT INTO lotes (producto_id, linea_compra_id, fecha_entrada, fecha_caducidad, inicial_milli, restante_milli)
  SELECT NEW.producto_id, NEW.id, hoy, NEW.fecha_caducidad, NEW.cantidad_milli, NEW.cantidad_milli
    FROM v_ahora WHERE NEW.fecha_caducidad IS NOT NULL;

  UPDATE compras
     SET total_cent = total_cent + (NEW.cantidad_milli * NEW.coste_unitario_dm + 50000) / 100000
   WHERE id = NEW.compra_id;
END;

DROP TRIGGER trg_lc_before_delete;
CREATE TRIGGER trg_lc_before_delete BEFORE DELETE ON lineas_compra
BEGIN
  UPDATE productos SET stock_milli = stock_milli - OLD.cantidad_milli
   WHERE id = OLD.producto_id AND control_stock = 1;
  DELETE FROM lotes WHERE linea_compra_id = OLD.id;
  UPDATE compras
     SET total_cent = total_cent - (OLD.cantidad_milli * OLD.coste_unitario_dm + 50000) / 100000
   WHERE id = OLD.compra_id;
END;

DROP TRIGGER trg_merma_stock;
CREATE TRIGGER trg_merma_stock BEFORE INSERT ON mermas
WHEN (SELECT control_stock = 1 AND stock_milli < NEW.cantidad_milli FROM productos WHERE id = NEW.producto_id)
BEGIN SELECT RAISE(ABORT, 'MERMA_STOCK'); END;

DROP TRIGGER trg_merma_after_insert;
CREATE TRIGGER trg_merma_after_insert AFTER INSERT ON mermas
BEGIN
  UPDATE productos SET stock_milli = stock_milli - NEW.cantidad_milli
   WHERE id = NEW.producto_id AND control_stock = 1;

  UPDATE lotes SET restante_milli = MAX(restante_milli - NEW.cantidad_milli, 0) WHERE id = NEW.lote_id;

  INSERT INTO mermas_lotes (merma_id, lote_id, cantidad_milli)
  SELECT NEW.id, id, MIN(restante_milli, NEW.cantidad_milli - previo)
    FROM (SELECT id, restante_milli,
                 COALESCE(SUM(restante_milli) OVER (
                   ORDER BY fecha_caducidad, id
                   ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS previo
            FROM lotes
           WHERE producto_id = NEW.producto_id AND restante_milli > 0 AND NEW.lote_id IS NULL)
   WHERE previo < NEW.cantidad_milli;

  UPDATE lotes
     SET restante_milli = restante_milli - (
           SELECT cantidad_milli FROM mermas_lotes WHERE merma_id = NEW.id AND lote_id = lotes.id)
   WHERE id IN (SELECT lote_id FROM mermas_lotes WHERE merma_id = NEW.id);

  INSERT INTO auditoria (usuario, accion, tabla, registro_id, detalle)
  SELECT COALESCE((SELECT usuario FROM contexto_app), 'sistema'), 'merma', 'mermas', NEW.id,
         replace(rtrim(rtrim(printf('%.3f', NEW.cantidad_milli / 1000.0), '0'), '.'), '.', ',')
         || CASE p.unidad_medida WHEN 'kg' THEN ' kg' ELSE ' u' END || ' de ' || p.nombre
         || ' (' || replace(NEW.motivo, '_', ' ') || ')' || COALESCE(': ' || NEW.notas, '')
    FROM productos p WHERE p.id = NEW.producto_id;
END;

-- ---------------------------------------------------------------------
--  Recuento: lo que sobra respecto a lo apuntado. Lo que falta se registra
--  como merma, para que cuente como pérdida y gaste lotes como cualquier otra.
-- ---------------------------------------------------------------------
CREATE TABLE ajustes_stock (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  producto_id     INTEGER NOT NULL REFERENCES productos(id),
  antes_milli     INTEGER NOT NULL,
  contado_milli   INTEGER NOT NULL CHECK (contado_milli >= 0),
  fecha_caducidad TEXT,
  fecha           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario         TEXT
);

CREATE TRIGGER trg_ajustes_fecha AFTER INSERT ON ajustes_stock WHEN NEW.fecha LIKE '% %'
BEGIN UPDATE ajustes_stock SET fecha = (SELECT ahora FROM v_ahora) WHERE id = NEW.id; END;

CREATE TRIGGER trg_ajuste_after_insert AFTER INSERT ON ajustes_stock
BEGIN
  UPDATE productos SET stock_milli = NEW.contado_milli WHERE id = NEW.producto_id;

  INSERT INTO lotes (producto_id, fecha_entrada, fecha_caducidad, inicial_milli, restante_milli)
  SELECT NEW.producto_id, hoy, NEW.fecha_caducidad, NEW.contado_milli - NEW.antes_milli, NEW.contado_milli - NEW.antes_milli
    FROM v_ahora WHERE NEW.fecha_caducidad IS NOT NULL;

  INSERT INTO auditoria (usuario, accion, tabla, registro_id, detalle)
  SELECT COALESCE((SELECT usuario FROM contexto_app), 'sistema'), 'recuento', 'productos', NEW.producto_id,
         nombre || ': apuntado ' || replace(rtrim(rtrim(printf('%.3f', NEW.antes_milli / 1000.0), '0'), '.'), '.', ',')
         || ', contado ' || replace(rtrim(rtrim(printf('%.3f', NEW.contado_milli / 1000.0), '0'), '.'), '.', ',')
    FROM productos WHERE id = NEW.producto_id;
END;

-- ---------------------------------------------------------------------
--  Avisos al móvil y notas
-- ---------------------------------------------------------------------
CREATE TABLE suscripciones_push (
  endpoint TEXT PRIMARY KEY,
  p256dh   TEXT NOT NULL,
  auth     TEXT NOT NULL,
  usuario  TEXT NOT NULL
);

ALTER TABLE notas ADD COLUMN fijada INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notas ADD COLUMN hecha  INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------
--  Vistas
-- ---------------------------------------------------------------------
CREATE VIEW v_stock AS
SELECT p.id, p.codigo_barras, p.nombre AS producto, c.nombre AS categoria, p.unidad_medida,
       p.precio_venta_cent / 100.0 AS precio_venta,
       p.stock_milli / 1000.0 AS stock_actual,
       p.stock_minimo_milli / 1000.0 AS stock_minimo,
       CASE WHEN p.control_stock = 0 THEN 'OK'
            WHEN p.stock_milli <= 0 THEN 'AGOTADO'
            WHEN p.stock_milli <= p.stock_minimo_milli THEN 'BAJO'
            ELSE 'OK' END AS estado,
       p.control_stock, p.precio_libre, p.acceso_rapido
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
 WHERE p.activo AND p.control_stock = 1 AND p.stock_milli <= p.stock_minimo_milli;

DROP VIEW v_caducidades;
CREATE VIEW v_caducidades AS
SELECT l.id AS lote_id, p.id AS producto_id, p.nombre AS producto, c.nombre AS categoria,
       l.fecha_caducidad,
       CAST(julianday(l.fecha_caducidad) - julianday(a.hoy) AS INTEGER) AS dias_restantes,
       l.restante_milli / 1000.0 AS cantidad_restante,
       p.unidad_medida,
       CASE WHEN l.fecha_caducidad < a.hoy THEN 'CADUCADO'
            WHEN l.fecha_caducidad = a.hoy THEN 'CADUCA HOY'
            ELSE 'PROXIMO' END AS estado
  FROM lotes l
  JOIN productos p ON p.id = l.producto_id
  JOIN categorias c ON c.id = p.categoria_id
  CROSS JOIN v_ahora a
 WHERE l.restante_milli > 0 AND p.control_stock = 1
   AND l.fecha_caducidad <= date(a.hoy, '+' || p.dias_aviso_caducidad || ' days');

CREATE VIEW v_mas_vendidos AS
SELECT lv.producto_id, COUNT(DISTINCT lv.venta_id) AS tickets
  FROM lineas_venta lv
  JOIN ventas v ON v.id = lv.venta_id
  JOIN productos p ON p.id = lv.producto_id
 WHERE v.fecha >= (SELECT date(hoy, '-60 days') FROM v_ahora) AND p.activo
 GROUP BY lv.producto_id;

CREATE VIEW v_ofertas AS
SELECT o.id, o.producto_id, p.nombre AS producto, p.unidad_medida, o.cantidad_minima_milli / 1000.0 AS cantidad_minima,
       o.precio_cent / 100.0 AS precio, p.precio_venta_cent / 100.0 AS precio_normal, o.activa
  FROM ofertas o JOIN productos p ON p.id = o.producto_id;

CREATE VIEW v_ventas AS
SELECT v.id, v.fecha, v.metodo_pago, v.pago_tarjeta_cent / 100.0 AS pago_tarjeta, v.pago_bizum_cent / 100.0 AS pago_bizum,
       v.pago_fiado_cent / 100.0 AS pago_fiado, v.cliente_id, c.nombre AS cliente, v.total_cent / 100.0 AS total, v.usuario,
       COALESCE((SELECT SUM(d.importe_cent) FROM devoluciones d WHERE d.venta_id = v.id), 0) / 100.0 AS devuelto
  FROM ventas v LEFT JOIN clientes c ON c.id = v.cliente_id;

CREATE VIEW v_lineas_ticket AS
SELECT lv.id AS linea_id, lv.venta_id, p.nombre AS producto, p.unidad_medida,
       lv.cantidad_milli / 1000.0 AS cantidad,
       lv.precio_unitario_cent / 100.0 AS precio_unitario,
       lv.iva_cp / 100.0 AS iva_porcentaje,
       ((lv.cantidad_milli * lv.precio_unitario_cent + 500) / 1000) / 100.0 AS importe,
       COALESCE((SELECT SUM(d.cantidad_milli) FROM lineas_devolucion d WHERE d.linea_venta_id = lv.id), 0) / 1000.0 AS devuelto
  FROM lineas_venta lv JOIN productos p ON p.id = lv.producto_id;

-- Lo que entra y sale de la caja cada día. Vender a fiado no mete dinero:
-- entra cuando el cliente paga. Se escribe con una subconsulta por dato para
-- que la caja de un día use los índices y no recorra toda la historia.
CREATE VIEW v_caja_cent AS
SELECT d.dia,
       (SELECT COUNT(*) FROM ventas WHERE substr(fecha, 1, 10) = d.dia) AS tickets,
       COALESCE((SELECT SUM(CASE metodo_pago WHEN 'efectivo' THEN total_cent
                                             WHEN 'mixto' THEN total_cent - pago_tarjeta_cent - pago_bizum_cent - pago_fiado_cent ELSE 0 END)
                   FROM ventas WHERE substr(fecha, 1, 10) = d.dia), 0)
       - COALESCE((SELECT SUM(importe_cent) FROM devoluciones WHERE substr(fecha, 1, 10) = d.dia AND metodo = 'efectivo'), 0)
       + COALESCE((SELECT SUM(importe_cent) FROM pagos_fiado WHERE substr(fecha, 1, 10) = d.dia AND metodo = 'efectivo'), 0) AS efectivo,
       COALESCE((SELECT SUM(CASE metodo_pago WHEN 'tarjeta' THEN total_cent WHEN 'mixto' THEN pago_tarjeta_cent ELSE 0 END)
                   FROM ventas WHERE substr(fecha, 1, 10) = d.dia), 0)
       - COALESCE((SELECT SUM(importe_cent) FROM devoluciones WHERE substr(fecha, 1, 10) = d.dia AND metodo = 'tarjeta'), 0)
       + COALESCE((SELECT SUM(importe_cent) FROM pagos_fiado WHERE substr(fecha, 1, 10) = d.dia AND metodo = 'tarjeta'), 0) AS tarjeta,
       COALESCE((SELECT SUM(CASE metodo_pago WHEN 'bizum' THEN total_cent WHEN 'mixto' THEN pago_bizum_cent ELSE 0 END)
                   FROM ventas WHERE substr(fecha, 1, 10) = d.dia), 0)
       - COALESCE((SELECT SUM(importe_cent) FROM devoluciones WHERE substr(fecha, 1, 10) = d.dia AND metodo = 'bizum'), 0)
       + COALESCE((SELECT SUM(importe_cent) FROM pagos_fiado WHERE substr(fecha, 1, 10) = d.dia AND metodo = 'bizum'), 0) AS bizum,
       COALESCE((SELECT SUM(pago_fiado_cent) FROM ventas WHERE substr(fecha, 1, 10) = d.dia), 0)
       - COALESCE((SELECT SUM(importe_cent) FROM devoluciones WHERE substr(fecha, 1, 10) = d.dia AND metodo = 'fiado'), 0) AS fiado,
       COALESCE((SELECT SUM(total_cent) FROM ventas WHERE substr(fecha, 1, 10) = d.dia), 0)
       - COALESCE((SELECT SUM(importe_cent) FROM devoluciones WHERE substr(fecha, 1, 10) = d.dia), 0) AS total,
       COALESCE((SELECT SUM(importe_cent) FROM pagos_fiado WHERE substr(fecha, 1, 10) = d.dia), 0) AS cobros
  FROM (SELECT substr(fecha, 1, 10) AS dia FROM ventas
        UNION SELECT substr(fecha, 1, 10) FROM devoluciones
        UNION SELECT substr(fecha, 1, 10) FROM pagos_fiado) d;

CREATE VIEW v_caja_diaria AS
SELECT dia, tickets, efectivo / 100.0 AS total_efectivo, tarjeta / 100.0 AS total_tarjeta,
       bizum / 100.0 AS total_bizum, fiado / 100.0 AS total_fiado, total / 100.0 AS total, cobros / 100.0 AS cobros_fiado
  FROM v_caja_cent;

CREATE VIEW v_clientes AS
SELECT c.id, c.nombre, c.telefono, c.notas, c.activo,
       (COALESCE((SELECT SUM(pago_fiado_cent) FROM ventas v WHERE v.cliente_id = c.id), 0)
        - COALESCE((SELECT SUM(d.importe_cent) FROM devoluciones d JOIN ventas v ON v.id = d.venta_id
                     WHERE v.cliente_id = c.id AND d.metodo = 'fiado'), 0)
        - COALESCE((SELECT SUM(p.importe_cent) FROM pagos_fiado p WHERE p.cliente_id = c.id), 0)) / 100.0 AS deuda
  FROM clientes c;

-- La deuda nunca puede quedar en negativo: si ya pagó, se le devuelve dinero
CREATE TRIGGER trg_pago_excede AFTER INSERT ON pagos_fiado
WHEN (SELECT deuda FROM v_clientes WHERE id = NEW.cliente_id) < 0
BEGIN SELECT RAISE(ABORT, 'PAGO_EXCEDE'); END;

CREATE TRIGGER trg_dev_fiado_excede AFTER UPDATE OF importe_cent ON devoluciones
WHEN NEW.metodo = 'fiado'
 AND (SELECT deuda FROM v_clientes WHERE id = (SELECT cliente_id FROM ventas WHERE id = NEW.venta_id)) < 0
BEGIN SELECT RAISE(ABORT, 'DEVOLUCION_FIADO'); END;

CREATE TRIGGER trg_anular_fiado_pagado AFTER DELETE ON ventas
WHEN OLD.cliente_id IS NOT NULL AND (SELECT deuda FROM v_clientes WHERE id = OLD.cliente_id) < 0
BEGIN SELECT RAISE(ABORT, 'ANULAR_FIADO_PAGADO'); END;

CREATE VIEW v_productos_parados AS
SELECT p.id, p.nombre AS producto, c.nombre AS categoria, p.unidad_medida,
       p.stock_milli / 1000.0 AS stock_actual,
       MAX(v.fecha) AS ultima_venta,
       CAST(julianday((SELECT hoy FROM v_ahora))
            - julianday(substr(COALESCE(MAX(v.fecha), p.creado_en), 1, 10)) AS INTEGER) AS dias_sin_vender
  FROM productos p
  JOIN categorias c ON c.id = p.categoria_id
  LEFT JOIN lineas_venta lv ON lv.producto_id = p.id
  LEFT JOIN ventas v ON v.id = lv.venta_id
 WHERE p.activo AND p.control_stock = 1 AND p.stock_milli > 0
 GROUP BY p.id;

CREATE VIEW v_productos_admin AS
SELECT p.id, p.codigo_barras, p.nombre, p.categoria_id, p.proveedor_id, p.iva_id, p.unidad_medida,
       p.precio_venta_cent / 100.0 AS precio_venta, p.coste_medio_dm / 10000.0 AS coste_medio,
       p.stock_milli / 1000.0 AS stock_actual, p.stock_minimo_milli / 1000.0 AS stock_minimo,
       p.controla_caducidad, p.vida_util_dias, p.dias_aviso_caducidad, p.activo, p.creado_en,
       p.control_stock, p.precio_libre, p.acceso_rapido,
       c.nombre AS categoria, pr.nombre AS proveedor, i.porcentaje_cp / 100.0 AS iva
  FROM productos p
  JOIN categorias c ON c.id = p.categoria_id
  JOIN tipos_iva i ON i.id = p.iva_id
  LEFT JOIN proveedores pr ON pr.id = p.proveedor_id;

-- Las devoluciones restan el día en que se hacen, no el de la venta
CREATE VIEW v_lineas_detalle AS
SELECT v.id AS venta_id, v.fecha, p.id AS producto_id, p.nombre AS producto, c.nombre AS categoria,
       lv.cantidad_milli,
       (lv.cantidad_milli * lv.precio_unitario_cent + 500) / 1000 AS importe,
       CAST(ROUND(lv.cantidad_milli / 1000.0 * lv.precio_unitario_cent / (1 + lv.iva_cp / 10000.0)) AS INTEGER) AS base,
       (lv.cantidad_milli * lv.coste_unitario_dm + 50000) / 100000 AS coste,
       CAST(ROUND(lv.cantidad_milli / 1000.0 * (lv.precio_unitario_cent / (1 + lv.iva_cp / 10000.0)
                                               - lv.coste_unitario_dm / 100.0)) AS INTEGER) AS beneficio
  FROM lineas_venta lv
  JOIN ventas v ON v.id = lv.venta_id
  JOIN productos p ON p.id = lv.producto_id
  JOIN categorias c ON c.id = p.categoria_id
UNION ALL
SELECT lv.venta_id, d.fecha, p.id, p.nombre, c.nombre,
       -ld.cantidad_milli,
       -ld.importe_cent,
       -CAST(ROUND(ld.importe_cent / (1 + lv.iva_cp / 10000.0)) AS INTEGER),
       CASE WHEN ld.repuesto = 1 THEN -(ld.cantidad_milli * lv.coste_unitario_dm + 50000) / 100000 ELSE 0 END,
       -CAST(ROUND(ld.importe_cent / (1 + lv.iva_cp / 10000.0)
                   - CASE WHEN ld.repuesto = 1 THEN ld.cantidad_milli * lv.coste_unitario_dm / 100000.0 ELSE 0 END) AS INTEGER)
  FROM lineas_devolucion ld
  JOIN devoluciones d ON d.id = ld.devolucion_id
  JOIN lineas_venta lv ON lv.id = ld.linea_venta_id
  JOIN productos p ON p.id = lv.producto_id
  JOIN categorias c ON c.id = p.categoria_id;

CREATE VIEW v_beneficio_producto AS
SELECT producto_id, producto, categoria,
       SUM(cantidad_milli) / 1000.0 AS unidades_vendidas,
       SUM(importe) / 100.0 AS facturacion,
       SUM(base) / 100.0 AS base_imponible,
       SUM(coste) / 100.0 AS coste,
       SUM(beneficio) / 100.0 AS beneficio,
       ROUND(100.0 * SUM(beneficio) / NULLIF(SUM(base), 0), 1) AS margen_pct
  FROM v_lineas_detalle
 GROUP BY producto_id;

CREATE VIEW v_beneficio_categoria AS
SELECT categoria,
       SUM(importe) / 100.0 AS facturacion,
       SUM(base) / 100.0 AS base_imponible,
       SUM(coste) / 100.0 AS coste,
       SUM(beneficio) / 100.0 AS beneficio,
       ROUND(100.0 * SUM(beneficio) / NULLIF(SUM(base), 0), 1) AS margen_pct
  FROM v_lineas_detalle
 GROUP BY categoria;

CREATE VIEW v_beneficio_mensual AS
SELECT m.mes,
       m.importe / 100.0 AS facturacion,
       m.base / 100.0 AS base_imponible,
       m.coste / 100.0 AS coste,
       m.beneficio / 100.0 AS beneficio_bruto,
       COALESCE(me.perdidas, 0) / 100.0 AS perdidas_mermas,
       (m.beneficio - COALESCE(me.perdidas, 0)) / 100.0 AS beneficio_neto,
       ROUND(100.0 * (m.beneficio - COALESCE(me.perdidas, 0)) / NULLIF(m.base, 0), 1) AS margen_pct,
       ROUND(m.importe * 0.15) / 100.0 AS estimacion_15_pct
  FROM (SELECT substr(fecha, 1, 7) AS mes, SUM(importe) AS importe, SUM(base) AS base,
               SUM(coste) AS coste, SUM(beneficio) AS beneficio
          FROM v_lineas_detalle GROUP BY substr(fecha, 1, 7)) m
  LEFT JOIN (SELECT substr(fecha, 1, 7) AS mes,
                    CAST(ROUND(SUM(cantidad_milli * coste_unitario_dm) / 100000.0) AS INTEGER) AS perdidas
               FROM mermas GROUP BY substr(fecha, 1, 7)) me ON me.mes = m.mes;

CREATE VIEW v_ventas_diarias AS
SELECT dia, SUM(n) AS num_ventas, SUM(total) / 100.0 AS facturacion,
       COALESCE(ROUND(SUM(total) * 1.0 / NULLIF(SUM(n), 0)), 0) / 100.0 AS ticket_medio
  FROM (SELECT substr(fecha, 1, 10) AS dia, 1 AS n, total_cent AS total FROM ventas
        UNION ALL
        SELECT substr(fecha, 1, 10), 0, -importe_cent FROM devoluciones)
 GROUP BY dia;
