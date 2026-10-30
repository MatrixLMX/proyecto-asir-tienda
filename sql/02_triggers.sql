-- =====================================================================
--  02_triggers.sql : stock automático, coste medio, lotes y caducidades
--
--  Reglas de negocio que se aplican solas:
--   * Comprar suma stock y recalcula el coste medio ponderado.
--   * Comprar un producto con caducidad crea un lote. Si no se indica
--     fecha, se calcula con vida_util_dias (p. ej. yogures = 21 días).
--   * Vender resta stock, impide vender más de lo que hay y gasta los
--     lotes empezando por el que caduca antes (FEFO).
--   * Al vender se "congela" el PVP, el IVA y el coste de ese momento
--     para que el beneficio histórico no cambie.
--   * Las líneas no se modifican: se borran y se vuelven a registrar.
--     Al borrar se deshace el movimiento de stock.
--
--  Nota: en MariaDB los borrados en cascada (FOREIGN KEY ... CASCADE)
--  NO disparan triggers, por eso ventas y compras tienen su propio
--  trigger BEFORE DELETE.
-- =====================================================================

USE tienda;

DELIMITER //

-- ---------------------------------------------------------------------
--  Procedimiento auxiliar: descuenta una cantidad de los lotes de un
--  producto, del que caduca antes al que caduca después.
-- ---------------------------------------------------------------------
CREATE PROCEDURE consumir_lotes(IN p_producto INT UNSIGNED, IN p_cantidad DECIMAL(10,3))
BEGIN
  DECLARE v_pendiente DECIMAL(10,3) DEFAULT p_cantidad;
  DECLARE v_lote      INT UNSIGNED;
  DECLARE v_restante  DECIMAL(10,3);
  DECLARE v_fin       BOOLEAN DEFAULT FALSE;
  DECLARE cur CURSOR FOR
    SELECT id, cantidad_restante
      FROM lotes
     WHERE producto_id = p_producto AND cantidad_restante > 0
     ORDER BY fecha_caducidad, id;
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_fin = TRUE;

  OPEN cur;
  bucle: LOOP
    IF v_pendiente <= 0 THEN LEAVE bucle; END IF;
    FETCH cur INTO v_lote, v_restante;
    IF v_fin THEN LEAVE bucle; END IF;

    IF v_restante >= v_pendiente THEN
      UPDATE lotes SET cantidad_restante = cantidad_restante - v_pendiente WHERE id = v_lote;
      SET v_pendiente = 0;
    ELSE
      UPDATE lotes SET cantidad_restante = 0 WHERE id = v_lote;
      SET v_pendiente = v_pendiente - v_restante;
    END IF;
  END LOOP;
  CLOSE cur;
END//

-- =====================================================================
--  COMPRAS
-- =====================================================================
CREATE TRIGGER trg_lc_before_insert
BEFORE INSERT ON lineas_compra
FOR EACH ROW
BEGIN
  DECLARE v_controla BOOLEAN;
  DECLARE v_vida     SMALLINT UNSIGNED;
  DECLARE v_nombre   VARCHAR(100);
  DECLARE v_msg      VARCHAR(255);

  SELECT controla_caducidad, vida_util_dias, nombre
    INTO v_controla, v_vida, v_nombre
    FROM productos WHERE id = NEW.producto_id;

  IF v_controla THEN
    IF NEW.fecha_caducidad IS NULL AND v_vida IS NOT NULL THEN
      SET NEW.fecha_caducidad = CURDATE() + INTERVAL v_vida DAY;
    END IF;
    IF NEW.fecha_caducidad IS NULL THEN
      SET v_msg = CONCAT('"', v_nombre, '" controla caducidad: indica la fecha o configura su vida util');
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
    END IF;
  ELSE
    SET NEW.fecha_caducidad = NULL;
  END IF;
END//

CREATE TRIGGER trg_lc_after_insert
AFTER INSERT ON lineas_compra
FOR EACH ROW
BEGIN
  -- El coste medio se calcula ANTES de sumar el stock (MariaDB evalúa
  -- las asignaciones del SET de izquierda a derecha).
  UPDATE productos
     SET coste_medio = CASE
           WHEN stock_actual <= 0 THEN NEW.coste_unitario
           ELSE (stock_actual * coste_medio + NEW.cantidad * NEW.coste_unitario)
                / (stock_actual + NEW.cantidad)
         END,
         stock_actual = stock_actual + NEW.cantidad
   WHERE id = NEW.producto_id;

  IF NEW.fecha_caducidad IS NOT NULL THEN
    INSERT INTO lotes (producto_id, linea_compra_id, fecha_entrada, fecha_caducidad,
                       cantidad_inicial, cantidad_restante)
    VALUES (NEW.producto_id, NEW.id, CURDATE(), NEW.fecha_caducidad,
            NEW.cantidad, NEW.cantidad);
  END IF;

  UPDATE compras
     SET total_sin_iva = total_sin_iva + ROUND(NEW.cantidad * NEW.coste_unitario, 2)
   WHERE id = NEW.compra_id;
END//

CREATE TRIGGER trg_lc_before_update
BEFORE UPDATE ON lineas_compra
FOR EACH ROW
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Las lineas de compra no se modifican: borra la linea y registrala de nuevo'//

CREATE TRIGGER trg_lc_before_delete
BEFORE DELETE ON lineas_compra
FOR EACH ROW
BEGIN
  UPDATE productos SET stock_actual = stock_actual - OLD.cantidad WHERE id = OLD.producto_id;
  DELETE FROM lotes WHERE linea_compra_id = OLD.id;
  UPDATE compras
     SET total_sin_iva = total_sin_iva - ROUND(OLD.cantidad * OLD.coste_unitario, 2)
   WHERE id = OLD.compra_id;
END//

CREATE TRIGGER trg_compras_before_delete
BEFORE DELETE ON compras
FOR EACH ROW
BEGIN
  UPDATE productos p
    JOIN (SELECT producto_id, SUM(cantidad) AS cantidad
            FROM lineas_compra WHERE compra_id = OLD.id
           GROUP BY producto_id) lc ON lc.producto_id = p.id
     SET p.stock_actual = p.stock_actual - lc.cantidad;

  DELETE FROM lotes
   WHERE linea_compra_id IN (SELECT id FROM lineas_compra WHERE compra_id = OLD.id);
END//

-- =====================================================================
--  VENTAS
-- =====================================================================
CREATE TRIGGER trg_lv_before_insert
BEFORE INSERT ON lineas_venta
FOR EACH ROW
BEGIN
  DECLARE v_nombre  VARCHAR(100);
  DECLARE v_precio  DECIMAL(10,2);
  DECLARE v_coste   DECIMAL(10,4);
  DECLARE v_stock   DECIMAL(10,3);
  DECLARE v_unidad  VARCHAR(10);
  DECLARE v_activo  BOOLEAN;
  DECLARE v_iva     DECIMAL(5,2);
  DECLARE v_msg     VARCHAR(255);

  SELECT p.nombre, p.precio_venta, p.coste_medio, p.stock_actual, p.unidad_medida,
         p.activo, i.porcentaje
    INTO v_nombre, v_precio, v_coste, v_stock, v_unidad, v_activo, v_iva
    FROM productos p JOIN tipos_iva i ON i.id = p.iva_id
   WHERE p.id = NEW.producto_id;

  IF NOT v_activo THEN
    SET v_msg = CONCAT('"', v_nombre, '" esta dado de baja');
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
  END IF;

  IF v_unidad = 'unidad' AND NEW.cantidad <> FLOOR(NEW.cantidad) THEN
    SET v_msg = CONCAT('"', v_nombre, '" se vende por unidades, no por peso');
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
  END IF;

  IF v_stock < NEW.cantidad THEN
    SET v_msg = CONCAT('Stock insuficiente de "', v_nombre, '": quedan ', v_stock + 0);
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
  END IF;

  IF NEW.precio_unitario IS NULL THEN
    SET NEW.precio_unitario = v_precio;
  END IF;
  SET NEW.iva_porcentaje = v_iva;
  SET NEW.coste_unitario = v_coste;
END//

CREATE TRIGGER trg_lv_after_insert
AFTER INSERT ON lineas_venta
FOR EACH ROW
BEGIN
  UPDATE productos SET stock_actual = stock_actual - NEW.cantidad WHERE id = NEW.producto_id;
  CALL consumir_lotes(NEW.producto_id, NEW.cantidad);
  UPDATE ventas
     SET total = total + ROUND(NEW.cantidad * NEW.precio_unitario, 2)
   WHERE id = NEW.venta_id;
END//

CREATE TRIGGER trg_lv_before_update
BEFORE UPDATE ON lineas_venta
FOR EACH ROW
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Las lineas de venta no se modifican: borra la linea y registrala de nuevo'//

CREATE TRIGGER trg_lv_after_delete
AFTER DELETE ON lineas_venta
FOR EACH ROW
BEGIN
  UPDATE productos SET stock_actual = stock_actual + OLD.cantidad WHERE id = OLD.producto_id;
  UPDATE ventas
     SET total = total - ROUND(OLD.cantidad * OLD.precio_unitario, 2)
   WHERE id = OLD.venta_id;
END//

CREATE TRIGGER trg_ventas_before_delete
BEFORE DELETE ON ventas
FOR EACH ROW
BEGIN
  UPDATE productos p
    JOIN (SELECT producto_id, SUM(cantidad) AS cantidad
            FROM lineas_venta WHERE venta_id = OLD.id
           GROUP BY producto_id) lv ON lv.producto_id = p.id
     SET p.stock_actual = p.stock_actual + lv.cantidad;
END//

-- =====================================================================
--  MERMAS (caducado, roto...)
-- =====================================================================
CREATE TRIGGER trg_merma_before_insert
BEFORE INSERT ON mermas
FOR EACH ROW
BEGIN
  DECLARE v_coste  DECIMAL(10,4);
  DECLARE v_stock  DECIMAL(10,3);
  DECLARE v_lote_producto INT UNSIGNED;

  SELECT coste_medio, stock_actual INTO v_coste, v_stock
    FROM productos WHERE id = NEW.producto_id;

  IF v_stock < NEW.cantidad THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La merma es mayor que el stock disponible';
  END IF;

  IF NEW.lote_id IS NOT NULL THEN
    SELECT producto_id INTO v_lote_producto FROM lotes WHERE id = NEW.lote_id;
    IF v_lote_producto IS NULL OR v_lote_producto <> NEW.producto_id THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'El lote no corresponde a ese producto';
    END IF;
  END IF;

  SET NEW.coste_unitario = v_coste;
END//

CREATE TRIGGER trg_merma_after_insert
AFTER INSERT ON mermas
FOR EACH ROW
BEGIN
  UPDATE productos SET stock_actual = stock_actual - NEW.cantidad WHERE id = NEW.producto_id;
  IF NEW.lote_id IS NOT NULL THEN
    UPDATE lotes SET cantidad_restante = GREATEST(cantidad_restante - NEW.cantidad, 0)
     WHERE id = NEW.lote_id;
  ELSE
    CALL consumir_lotes(NEW.producto_id, NEW.cantidad);
  END IF;
END//

DELIMITER ;
