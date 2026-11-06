-- =====================================================================
--  Resto de la tienda: hora española, compras, mermas, cierres de caja,
--  auditoría y vistas de informes. Traducción de sql/01..03 de MariaDB.
-- =====================================================================

-- ---------------------------------------------------------------------
--  Hora de España. D1 solo conoce UTC, y con UTC la caja cambiaría de día
--  a la 1 o las 2 de la madrugada. Regla oficial: horario de verano desde
--  el último domingo de marzo hasta el último de octubre, a las 01:00 UTC.
--  Las fechas se guardan en hora española y con T, como las devolvía FastAPI.
-- ---------------------------------------------------------------------
CREATE VIEW v_ahora AS
SELECT strftime('%Y-%m-%dT%H:%M:%S', utc, desfase) AS ahora,
       date(utc, desfase) AS hoy
  FROM (SELECT utc,
               CASE WHEN utc >= date(strftime('%Y', utc) || '-04-01', 'weekday 0', '-7 days') || ' 01:00:00'
                     AND utc <  date(strftime('%Y', utc) || '-11-01', 'weekday 0', '-7 days') || ' 01:00:00'
                    THEN '+2 hours' ELSE '+1 hours' END AS desfase
          FROM (SELECT datetime('now') AS utc));

-- Lo que había era de la prueba, todo de noviembre (UTC+1)
UPDATE ventas SET fecha = strftime('%Y-%m-%dT%H:%M:%S', fecha, '+1 hours') WHERE fecha LIKE '% %';
UPDATE productos SET creado_en = strftime('%Y-%m-%dT%H:%M:%S', creado_en, '+1 hours') WHERE creado_en LIKE '% %';
UPDATE usuarios_app SET creado_en = strftime('%Y-%m-%dT%H:%M:%S', creado_en, '+1 hours') WHERE creado_en LIKE '% %';

-- ---------------------------------------------------------------------
--  Quién hace el cambio. Sustituye a la variable @usuario_app de MariaDB:
--  la API lo escribe al principio de cada transacción y lo borra al final,
--  y los triggers de auditoría lo leen.
-- ---------------------------------------------------------------------
CREATE TABLE contexto_app (
  id      INTEGER PRIMARY KEY CHECK (id = 1),
  usuario TEXT NOT NULL
);

CREATE TABLE auditoria (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha       TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario     TEXT NOT NULL,
  accion      TEXT NOT NULL,
  tabla       TEXT NOT NULL,
  registro_id INTEGER,
  detalle     TEXT
);
CREATE INDEX idx_auditoria_fecha ON auditoria(fecha);

-- ---------------------------------------------------------------------
--  Compras
-- ---------------------------------------------------------------------
CREATE TABLE compras (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  proveedor_id   INTEGER REFERENCES proveedores(id),
  fecha          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  numero_factura TEXT,
  total_cent     INTEGER NOT NULL DEFAULT 0,
  usuario        TEXT,
  notas          TEXT
);
CREATE INDEX idx_compra_fecha ON compras(fecha);

CREATE TABLE lineas_compra (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  compra_id         INTEGER NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
  producto_id       INTEGER NOT NULL REFERENCES productos(id),
  cantidad_milli    INTEGER NOT NULL CHECK (cantidad_milli > 0),
  coste_unitario_dm INTEGER NOT NULL CHECK (coste_unitario_dm >= 0),
  fecha_caducidad   TEXT
);
CREATE INDEX idx_lcompra_compra ON lineas_compra(compra_id);

ALTER TABLE lotes ADD COLUMN linea_compra_id INTEGER REFERENCES lineas_compra(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
--  Mermas y cierres de caja
-- ---------------------------------------------------------------------
CREATE TABLE mermas (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  producto_id       INTEGER NOT NULL REFERENCES productos(id),
  lote_id           INTEGER REFERENCES lotes(id) ON DELETE SET NULL,
  cantidad_milli    INTEGER NOT NULL CHECK (cantidad_milli > 0),
  motivo            TEXT NOT NULL CHECK (motivo IN ('caducado','roto','robo','consumo_propio','otro')),
  coste_unitario_dm INTEGER NOT NULL,
  fecha             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario           TEXT,
  notas             TEXT
);
CREATE INDEX idx_merma_fecha ON mermas(fecha);

-- De qué lotes salió una merma sin lote indicado (como lotes_consumidos)
CREATE TABLE mermas_lotes (
  merma_id       INTEGER NOT NULL REFERENCES mermas(id) ON DELETE CASCADE,
  lote_id        INTEGER NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
  cantidad_milli INTEGER NOT NULL
);
CREATE INDEX idx_merma_lote ON mermas_lotes(merma_id);

CREATE TABLE cierres_caja (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha                 TEXT NOT NULL UNIQUE,
  tickets               INTEGER NOT NULL,
  total_efectivo_cent   INTEGER NOT NULL,
  total_tarjeta_cent    INTEGER NOT NULL,
  total_bizum_cent      INTEGER NOT NULL,
  fondo_inicial_cent    INTEGER NOT NULL DEFAULT 0,
  efectivo_contado_cent INTEGER NOT NULL,
  diferencia_cent       INTEGER GENERATED ALWAYS AS (efectivo_contado_cent - fondo_inicial_cent - total_efectivo_cent) STORED,
  usuario               TEXT,
  notas                 TEXT,
  creado_en             TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Memoria del asistente: un Worker no guarda nada entre peticiones
CREATE TABLE conversaciones (
  clave      TEXT PRIMARY KEY,
  mensajes   TEXT NOT NULL,
  actualizado TEXT NOT NULL
);

-- ---------------------------------------------------------------------
--  Fecha automática en hora española. Un DEFAULT no puede leer v_ahora, así
--  que el DEFAULT pone la hora UTC (lleva un espacio) y estos triggers la
--  cambian. Una fecha indicada expresamente (lleva T) se respeta.
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_ventas_fecha AFTER INSERT ON ventas WHEN NEW.fecha LIKE '% %'
BEGIN UPDATE ventas SET fecha = (SELECT ahora FROM v_ahora) WHERE id = NEW.id; END;

CREATE TRIGGER trg_compras_fecha AFTER INSERT ON compras WHEN NEW.fecha LIKE '% %'
BEGIN UPDATE compras SET fecha = (SELECT ahora FROM v_ahora) WHERE id = NEW.id; END;

CREATE TRIGGER trg_mermas_fecha AFTER INSERT ON mermas WHEN NEW.fecha LIKE '% %'
BEGIN UPDATE mermas SET fecha = (SELECT ahora FROM v_ahora) WHERE id = NEW.id; END;

CREATE TRIGGER trg_auditoria_fecha AFTER INSERT ON auditoria WHEN NEW.fecha LIKE '% %'
BEGIN UPDATE auditoria SET fecha = (SELECT ahora FROM v_ahora) WHERE id = NEW.id; END;

CREATE TRIGGER trg_cierres_fecha AFTER INSERT ON cierres_caja WHEN NEW.creado_en LIKE '% %'
BEGIN UPDATE cierres_caja SET creado_en = (SELECT ahora FROM v_ahora) WHERE id = NEW.id; END;

CREATE TRIGGER trg_productos_fecha AFTER INSERT ON productos WHEN NEW.creado_en LIKE '% %'
BEGIN UPDATE productos SET creado_en = (SELECT ahora FROM v_ahora) WHERE id = NEW.id; END;

CREATE TRIGGER trg_usuarios_fecha AFTER INSERT ON usuarios_app WHEN NEW.creado_en LIKE '% %'
BEGIN UPDATE usuarios_app SET creado_en = (SELECT ahora FROM v_ahora) WHERE id = NEW.id; END;

-- ---------------------------------------------------------------------
--  Reglas de compra. El coste medio ponderado usa el stock de antes de la
--  compra: en un UPDATE de SQLite, todo el SET lee los valores antiguos.
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_lc_sin_fecha BEFORE INSERT ON lineas_compra
WHEN NEW.fecha_caducidad IS NULL
 AND (SELECT controla_caducidad FROM productos WHERE id = NEW.producto_id) = 1
BEGIN SELECT RAISE(ABORT, 'CADUCIDAD_SIN_FECHA'); END;

CREATE TRIGGER trg_lc_after_insert AFTER INSERT ON lineas_compra
BEGIN
  UPDATE productos
     SET coste_medio_dm = CASE WHEN stock_milli <= 0 THEN NEW.coste_unitario_dm
           ELSE (stock_milli * coste_medio_dm + NEW.cantidad_milli * NEW.coste_unitario_dm
                 + (stock_milli + NEW.cantidad_milli) / 2) / (stock_milli + NEW.cantidad_milli) END,
         stock_milli = stock_milli + NEW.cantidad_milli
   WHERE id = NEW.producto_id;

  INSERT INTO lotes (producto_id, linea_compra_id, fecha_entrada, fecha_caducidad, inicial_milli, restante_milli)
  SELECT NEW.producto_id, NEW.id, hoy, NEW.fecha_caducidad, NEW.cantidad_milli, NEW.cantidad_milli
    FROM v_ahora WHERE NEW.fecha_caducidad IS NOT NULL;

  UPDATE compras
     SET total_cent = total_cent + (NEW.cantidad_milli * NEW.coste_unitario_dm + 50000) / 100000
   WHERE id = NEW.compra_id;
END;

CREATE TRIGGER trg_lc_no_modificar BEFORE UPDATE ON lineas_compra
BEGIN SELECT RAISE(ABORT, 'LINEA_NO_MODIFICABLE'); END;

-- A diferencia de MariaDB, en SQLite el borrado en cascada sí dispara los
-- triggers de las líneas: basta con deshacer el movimiento aquí.
CREATE TRIGGER trg_lc_before_delete BEFORE DELETE ON lineas_compra
BEGIN
  UPDATE productos SET stock_milli = stock_milli - OLD.cantidad_milli WHERE id = OLD.producto_id;
  DELETE FROM lotes WHERE linea_compra_id = OLD.id;
  UPDATE compras
     SET total_cent = total_cent - (OLD.cantidad_milli * OLD.coste_unitario_dm + 50000) / 100000
   WHERE id = OLD.compra_id;
END;

CREATE TRIGGER trg_compras_before_delete BEFORE DELETE ON compras
BEGIN
  INSERT INTO auditoria (usuario, accion, tabla, registro_id, detalle)
  VALUES (COALESCE((SELECT usuario FROM contexto_app), 'sistema'), 'borrar_compra', 'compras', OLD.id,
          'Compra nº ' || OLD.id || ' del ' || strftime('%d/%m/%Y', OLD.fecha) || ': '
          || replace(printf('%.2f', OLD.total_cent / 100.0), '.', ',') || ' € sin IVA'
          || COALESCE(', factura ' || OLD.numero_factura, ''));
END;

-- ---------------------------------------------------------------------
--  Anular ventas: devuelve el stock y cada parte a su lote
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_lv_before_delete BEFORE DELETE ON lineas_venta
BEGIN
  UPDATE lotes
     SET restante_milli = restante_milli + (
           SELECT SUM(cantidad_milli) FROM lotes_consumidos
            WHERE linea_venta_id = OLD.id AND lote_id = lotes.id)
   WHERE id IN (SELECT lote_id FROM lotes_consumidos WHERE linea_venta_id = OLD.id);
  UPDATE productos SET stock_milli = stock_milli + OLD.cantidad_milli WHERE id = OLD.producto_id;
  UPDATE ventas
     SET total_cent = total_cent - (OLD.cantidad_milli * OLD.precio_unitario_cent + 500) / 1000
   WHERE id = OLD.venta_id;
END;

CREATE TRIGGER trg_ventas_before_delete BEFORE DELETE ON ventas
BEGIN
  INSERT INTO auditoria (usuario, accion, tabla, registro_id, detalle)
  VALUES (COALESCE((SELECT usuario FROM contexto_app), 'sistema'), 'anular_venta', 'ventas', OLD.id,
          'Ticket nº ' || OLD.id || ' del ' || strftime('%d/%m/%Y %H:%M', OLD.fecha) || ': '
          || replace(printf('%.2f', OLD.total_cent / 100.0), '.', ',') || ' € en ' || OLD.metodo_pago
          || ', vendido por ' || COALESCE(OLD.usuario, '?'));
END;

-- ---------------------------------------------------------------------
--  Mermas
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_merma_stock BEFORE INSERT ON mermas
WHEN (SELECT stock_milli FROM productos WHERE id = NEW.producto_id) < NEW.cantidad_milli
BEGIN SELECT RAISE(ABORT, 'MERMA_STOCK'); END;

CREATE TRIGGER trg_merma_lote BEFORE INSERT ON mermas
WHEN NEW.lote_id IS NOT NULL
 AND COALESCE((SELECT producto_id FROM lotes WHERE id = NEW.lote_id), 0) <> NEW.producto_id
BEGIN SELECT RAISE(ABORT, 'MERMA_LOTE'); END;

CREATE TRIGGER trg_merma_after_insert AFTER INSERT ON mermas
BEGIN
  UPDATE productos SET stock_milli = stock_milli - NEW.cantidad_milli WHERE id = NEW.producto_id;

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
--  Auditoría de cambios delicados
-- ---------------------------------------------------------------------
CREATE TRIGGER trg_precio_auditoria AFTER UPDATE OF precio_venta_cent ON productos
WHEN OLD.precio_venta_cent <> NEW.precio_venta_cent
BEGIN
  INSERT INTO auditoria (usuario, accion, tabla, registro_id, detalle)
  VALUES (COALESCE((SELECT usuario FROM contexto_app), 'sistema'), 'cambiar_precio', 'productos', NEW.id,
          NEW.nombre || ': ' || replace(printf('%.2f', OLD.precio_venta_cent / 100.0), '.', ',') || ' € → '
          || replace(printf('%.2f', NEW.precio_venta_cent / 100.0), '.', ',') || ' €');
END;

CREATE TRIGGER trg_activo_auditoria AFTER UPDATE OF activo ON productos
WHEN OLD.activo <> NEW.activo
BEGIN
  INSERT INTO auditoria (usuario, accion, tabla, registro_id, detalle)
  VALUES (COALESCE((SELECT usuario FROM contexto_app), 'sistema'),
          CASE WHEN NEW.activo THEN 'alta_producto' ELSE 'baja_producto' END, 'productos', NEW.id, NEW.nombre);
END;

CREATE TRIGGER trg_usuarios_alta AFTER INSERT ON usuarios_app
BEGIN
  INSERT INTO auditoria (usuario, accion, tabla, registro_id, detalle)
  VALUES (COALESCE((SELECT usuario FROM contexto_app), 'sistema'), 'crear_usuario', 'usuarios_app', NEW.id,
          NEW.usuario || ' (' || NEW.rol || ')');
END;

CREATE TRIGGER trg_usuarios_clave AFTER UPDATE OF password_hash ON usuarios_app
WHEN OLD.password_hash <> NEW.password_hash
BEGIN
  INSERT INTO auditoria (usuario, accion, tabla, registro_id, detalle)
  VALUES (COALESCE((SELECT usuario FROM contexto_app), 'sistema'), 'cambiar_contraseña', 'usuarios_app', NEW.id, NEW.usuario);
END;

CREATE TRIGGER trg_usuarios_cambio AFTER UPDATE OF rol, activo ON usuarios_app
WHEN OLD.rol <> NEW.rol OR OLD.activo <> NEW.activo
BEGIN
  INSERT INTO auditoria (usuario, accion, tabla, registro_id, detalle)
  VALUES (COALESCE((SELECT usuario FROM contexto_app), 'sistema'), 'modificar_usuario', 'usuarios_app', NEW.id,
          NEW.usuario || ': perfil ' || NEW.rol || CASE WHEN NEW.activo THEN ', activo' ELSE ', desactivado' END);
END;

-- ---------------------------------------------------------------------
--  Vistas que dependen del día: ahora con la fecha española
-- ---------------------------------------------------------------------
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
 WHERE l.restante_milli > 0
   AND l.fecha_caducidad <= date(a.hoy, '+' || p.dias_aviso_caducidad || ' days');

DROP VIEW v_mas_vendidos;
CREATE VIEW v_mas_vendidos AS
SELECT lv.producto_id, COUNT(DISTINCT lv.venta_id) AS tickets
  FROM lineas_venta lv
  JOIN ventas v ON v.id = lv.venta_id
  JOIN productos p ON p.id = lv.producto_id
 WHERE v.fecha >= (SELECT date(hoy, '-60 days') FROM v_ahora) AND p.activo
 GROUP BY lv.producto_id;

-- ---------------------------------------------------------------------
--  Vistas operativas: sin costes, las puede leer el dependiente
-- ---------------------------------------------------------------------
CREATE VIEW v_ventas AS
SELECT id, fecha, metodo_pago, pago_tarjeta_cent / 100.0 AS pago_tarjeta, pago_bizum_cent / 100.0 AS pago_bizum,
       total_cent / 100.0 AS total, usuario
  FROM ventas;

CREATE VIEW v_lineas_ticket AS
SELECT lv.venta_id, p.nombre AS producto, p.unidad_medida,
       lv.cantidad_milli / 1000.0 AS cantidad,
       lv.precio_unitario_cent / 100.0 AS precio_unitario,
       lv.iva_cp / 100.0 AS iva_porcentaje,
       ((lv.cantidad_milli * lv.precio_unitario_cent + 500) / 1000) / 100.0 AS importe
  FROM lineas_venta lv JOIN productos p ON p.id = lv.producto_id;

-- Para que la caja de un día no recorra todas las ventas de la historia
CREATE INDEX idx_venta_dia ON ventas(substr(fecha, 1, 10));

CREATE VIEW v_caja_cent AS
SELECT substr(fecha, 1, 10) AS dia, COUNT(*) AS tickets,
       SUM(CASE metodo_pago WHEN 'efectivo' THEN total_cent
                            WHEN 'mixto' THEN total_cent - pago_tarjeta_cent - pago_bizum_cent ELSE 0 END) AS efectivo,
       SUM(CASE metodo_pago WHEN 'tarjeta' THEN total_cent WHEN 'mixto' THEN pago_tarjeta_cent ELSE 0 END) AS tarjeta,
       SUM(CASE metodo_pago WHEN 'bizum' THEN total_cent WHEN 'mixto' THEN pago_bizum_cent ELSE 0 END) AS bizum,
       SUM(total_cent) AS total
  FROM ventas
 GROUP BY substr(fecha, 1, 10);

CREATE VIEW v_caja_diaria AS
SELECT dia, tickets, efectivo / 100.0 AS total_efectivo, tarjeta / 100.0 AS total_tarjeta,
       bizum / 100.0 AS total_bizum, total / 100.0 AS total
  FROM v_caja_cent;

CREATE VIEW v_cierres_caja AS
SELECT id, fecha, tickets, total_efectivo_cent / 100.0 AS total_efectivo, total_tarjeta_cent / 100.0 AS total_tarjeta,
       total_bizum_cent / 100.0 AS total_bizum, fondo_inicial_cent / 100.0 AS fondo_inicial,
       efectivo_contado_cent / 100.0 AS efectivo_contado, diferencia_cent / 100.0 AS diferencia,
       usuario, notas, creado_en
  FROM cierres_caja;

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
 WHERE p.activo AND p.stock_milli > 0
 GROUP BY p.id;

-- ---------------------------------------------------------------------
--  Vistas con costes: solo las usan rutas de administrador
-- ---------------------------------------------------------------------
CREATE VIEW v_productos_admin AS
SELECT p.id, p.codigo_barras, p.nombre, p.categoria_id, p.proveedor_id, p.iva_id, p.unidad_medida,
       p.precio_venta_cent / 100.0 AS precio_venta, p.coste_medio_dm / 10000.0 AS coste_medio,
       p.stock_milli / 1000.0 AS stock_actual, p.stock_minimo_milli / 1000.0 AS stock_minimo,
       p.controla_caducidad, p.vida_util_dias, p.dias_aviso_caducidad, p.activo, p.creado_en,
       c.nombre AS categoria, pr.nombre AS proveedor, i.porcentaje_cp / 100.0 AS iva
  FROM productos p
  JOIN categorias c ON c.id = p.categoria_id
  JOIN tipos_iva i ON i.id = p.iva_id
  LEFT JOIN proveedores pr ON pr.id = p.proveedor_id;

-- Beneficio = cantidad x (precio sin IVA - coste). Se redondea en céntimos, y
-- los informes suman céntimos, igual que MariaDB sumaba importes ya redondeados.
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
SELECT substr(fecha, 1, 10) AS dia, COUNT(*) AS num_ventas,
       SUM(total_cent) / 100.0 AS facturacion,
       ROUND(AVG(total_cent)) / 100.0 AS ticket_medio
  FROM ventas
 GROUP BY substr(fecha, 1, 10);
