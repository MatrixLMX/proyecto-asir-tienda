-- =====================================================================
--  Vender sin stock apuntado, sin "agotado", y fotos de los productos
--
--  Hay productos (sobre todo de alimentación) de los que no se lleva la
--  cuenta. Se pueden vender aunque la app crea que no queda: el stock se
--  queda en 0 (nunca negativo) y lo vendido de más se apunta aparte para que
--  anular la venta no invente stock. La web avisa, pero no lo impide.
--  Ya no hay estado "agotado": solo "bajo", y solo en los productos con un
--  mínimo puesto (los que de verdad se cuentan, como las bebidas).
-- =====================================================================

ALTER TABLE productos ADD COLUMN imagen_url TEXT;

CREATE TABLE ventas_sin_stock (
  linea_venta_id INTEGER PRIMARY KEY REFERENCES lineas_venta(id) ON DELETE CASCADE,
  cantidad_milli INTEGER NOT NULL CHECK (cantidad_milli > 0)
);

DROP TRIGGER trg_lv_stock;
DROP TRIGGER trg_merma_stock;

DROP TRIGGER trg_lv_after_insert;
CREATE TRIGGER trg_lv_after_insert AFTER INSERT ON lineas_venta
BEGIN
  -- Lo que se vende sin que la app tenga stock apuntado (p. ej. alimentación
  -- que no se cuenta): se guarda para no "devolverlo" al anular la venta
  INSERT INTO ventas_sin_stock (linea_venta_id, cantidad_milli)
  SELECT NEW.id, NEW.cantidad_milli - stock_milli FROM productos
   WHERE id = NEW.producto_id AND control_stock = 1 AND stock_milli < NEW.cantidad_milli;

  UPDATE productos SET stock_milli = MAX(stock_milli - NEW.cantidad_milli, 0)
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

DROP TRIGGER trg_lv_before_delete;
CREATE TRIGGER trg_lv_before_delete BEFORE DELETE ON lineas_venta
BEGIN
  UPDATE lotes
     SET restante_milli = restante_milli + (
           SELECT SUM(cantidad_milli) FROM lotes_consumidos
            WHERE linea_venta_id = OLD.id AND lote_id = lotes.id)
   WHERE id IN (SELECT lote_id FROM lotes_consumidos WHERE linea_venta_id = OLD.id);
  UPDATE productos
     SET stock_milli = stock_milli + OLD.cantidad_milli
                       - COALESCE((SELECT cantidad_milli FROM ventas_sin_stock WHERE linea_venta_id = OLD.id), 0)
   WHERE id = OLD.producto_id AND control_stock = 1;
  UPDATE ventas
     SET total_cent = total_cent - (OLD.cantidad_milli * OLD.precio_unitario_cent + 500) / 1000
   WHERE id = OLD.venta_id;
END;

DROP TRIGGER trg_merma_after_insert;
CREATE TRIGGER trg_merma_after_insert AFTER INSERT ON mermas
BEGIN
  UPDATE productos SET stock_milli = MAX(stock_milli - NEW.cantidad_milli, 0)
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

DROP VIEW v_alertas_stock;
DROP VIEW v_stock;
CREATE VIEW v_stock AS
SELECT p.id, p.codigo_barras, p.nombre AS producto, c.nombre AS categoria, p.unidad_medida,
       p.precio_venta_cent / 100.0 AS precio_venta,
       p.stock_milli / 1000.0 AS stock_actual,
       p.stock_minimo_milli / 1000.0 AS stock_minimo,
       CASE WHEN p.control_stock = 1 AND p.stock_minimo_milli > 0 AND p.stock_milli <= p.stock_minimo_milli THEN 'BAJO'
            ELSE 'OK' END AS estado,
       p.control_stock, p.precio_libre, p.acceso_rapido, p.imagen_url
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
 WHERE p.activo AND p.control_stock = 1 AND p.stock_minimo_milli > 0 AND p.stock_milli <= p.stock_minimo_milli;

DROP VIEW v_productos_admin;
CREATE VIEW v_productos_admin AS
SELECT p.id, p.codigo_barras, p.nombre, p.categoria_id, p.proveedor_id, p.iva_id, p.unidad_medida,
       p.precio_venta_cent / 100.0 AS precio_venta, p.coste_medio_dm / 10000.0 AS coste_medio,
       p.stock_milli / 1000.0 AS stock_actual, p.stock_minimo_milli / 1000.0 AS stock_minimo,
       p.controla_caducidad, p.vida_util_dias, p.dias_aviso_caducidad, p.activo, p.creado_en,
       p.control_stock, p.precio_libre, p.acceso_rapido, p.imagen_url,
       c.nombre AS categoria, pr.nombre AS proveedor, i.porcentaje_cp / 100.0 AS iva
  FROM productos p
  JOIN categorias c ON c.id = p.categoria_id
  JOIN tipos_iva i ON i.id = p.iva_id
  LEFT JOIN proveedores pr ON pr.id = p.proveedor_id;
