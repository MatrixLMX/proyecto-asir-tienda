-- =====================================================================
--  07_datos_ejemplo.sql : datos FICTICIOS para probar el sistema
--
--  Productos con precios inventados, un inventario inicial, dos meses
--  de ventas aleatorias y algunos lotes a punto de caducar.
--  NO cargar en el servidor de producción.
--
--  Usuarios de prueba de la web:
--    admin       / admin1234    (administrador)
--    dependiente / tienda1234   (dependiente)
-- =====================================================================

USE tienda;

INSERT INTO usuarios_app (usuario, nombre, password_hash, rol) VALUES
  ('admin',       'Administrador', '$2b$12$t.jQ9IXBf1QH5YY15PQIo.VJvQnZO/8IjcuQLbfmgAuI7OSf.X64G', 'admin'),
  ('dependiente', 'Dependiente',   '$2b$12$K7MBDZHYt5ylkVWPDcfiXOe.qwv4L1I.sC7jggtyKiPTEFgWFm6Ri', 'dependiente');

-- ---------------------------------------------------------------------
--  Productos
-- ---------------------------------------------------------------------
INSERT INTO productos
  (codigo_barras, nombre, categoria_id, proveedor_id, iva_id, unidad_medida,
   precio_venta, stock_minimo, controla_caducidad, vida_util_dias)
SELECT p.codigo, p.nombre, c.id, pr.id, i.id, p.unidad, p.pvp, p.minimo, p.cad, p.vida
  FROM (
    SELECT '5449000000996' AS codigo, 'Coca-Cola lata 33 cl' AS nombre, 'Bebidas' AS cat, 'Coca-Cola' AS prov, 'General' AS iva, 'unidad' AS unidad, 1.20 AS pvp, 24 AS minimo, FALSE AS cad, NULL AS vida
    UNION ALL SELECT '5449000133335', 'Coca-Cola Zero 2 L',         'Bebidas',              'Coca-Cola',              'General',       'unidad', 2.60, 6,  FALSE, NULL
    UNION ALL SELECT '8410000000011', 'Agua mineral 1,5 L',         'Bebidas',              NULL,                     'Reducido',      'unidad', 0.70, 12, FALSE, NULL
    UNION ALL SELECT '8410000000028', 'Vino tinto 75 cl',           'Bebidas',              'Bodegas Oviedo',         'General',       'unidad', 4.50, 3,  FALSE, NULL
    UNION ALL SELECT '8410199000013', 'Patatas fritas 150 g',       'Alimentación',         'Matutano',               'Reducido',      'unidad', 1.95, 10, FALSE, NULL
    UNION ALL SELECT '8410199000020', 'Cheetos 75 g',               'Alimentación',         'Matutano',               'Reducido',      'unidad', 1.10, 10, FALSE, NULL
    UNION ALL SELECT '8410000000035', 'Palmera de chocolate',       'Alimentación',         'Dulcesol',               'Reducido',      'unidad', 1.50, 6,  TRUE,  30
    UNION ALL SELECT '8410000000042', 'Magdalenas 12 u',            'Alimentación',         'Dulcesol',               'Reducido',      'unidad', 2.40, 4,  TRUE,  45
    UNION ALL SELECT '8410000000059', 'Leche entera 1 L',           'Alimentación',         NULL,                     'Superreducido', 'unidad', 1.05, 12, TRUE,  90
    UNION ALL SELECT '8410000000066', 'Yogur natural pack 4',       'Alimentación',         'Nestlé',                 'Reducido',      'unidad', 1.80, 4,  TRUE,  21
    UNION ALL SELECT '8410000000073', 'Cacao soluble 390 g',        'Alimentación',         'Nestlé',                 'Reducido',      'unidad', 3.95, 3,  FALSE, NULL
    UNION ALL SELECT '8410000000080', 'Sándwich mixto',             'Charcutería',          'Sándwiches y embutidos', 'Reducido',      'unidad', 2.20, 4,  TRUE,  5
    UNION ALL SELECT '8410000000097', 'Chorizo extra 200 g',        'Charcutería',          'Sándwiches y embutidos', 'Reducido',      'unidad', 3.10, 3,  TRUE,  40
    UNION ALL SELECT '8410000000103', 'Helado cono nata',           'Helados y congelados', 'Frigo',                  'Reducido',      'unidad', 2.10, 10, FALSE, NULL
    UNION ALL SELECT '8410000000110', 'Pan de molde',               'Alimentación',         'Don Pin',                'Superreducido', 'unidad', 1.85, 4,  TRUE,  10
    UNION ALL SELECT NULL,            'Patatas',                    'Fruta y verdura',      NULL,                     'Superreducido', 'kg',     1.49, 10, FALSE, NULL
    UNION ALL SELECT NULL,            'Cebollas',                   'Fruta y verdura',      NULL,                     'Superreducido', 'kg',     1.79, 5,  FALSE, NULL
    UNION ALL SELECT NULL,            'Ajos',                       'Fruta y verdura',      NULL,                     'Superreducido', 'kg',     6.90, 1,  FALSE, NULL
    UNION ALL SELECT '8410000000127', 'Lejía 2 L',                  'Limpieza',             NULL,                     'General',       'unidad', 1.60, 3,  FALSE, NULL
    UNION ALL SELECT '8410000000134', 'Fregasuelos 1,5 L',          'Limpieza',             NULL,                     'General',       'unidad', 2.30, 3,  FALSE, NULL
    UNION ALL SELECT '8410000000141', 'Pilas AA pack 4',            'Ferretería',           NULL,                     'General',       'unidad', 4.50, 3,  FALSE, NULL
    UNION ALL SELECT '8410000000158', 'Cinta americana',            'Ferretería',           NULL,                     'General',       'unidad', 3.20, 2,  FALSE, NULL
    UNION ALL SELECT '8410000000165', 'Bolígrafo azul',             'Escolar',              NULL,                     'General',       'unidad', 0.60, 10, FALSE, NULL
    UNION ALL SELECT '8410000000172', 'Cuaderno A4',                'Escolar',              NULL,                     'General',       'unidad', 2.10, 5,  FALSE, NULL
    UNION ALL SELECT '8410000000189', 'Papel de aluminio 30 m',     'Cocina',               NULL,                     'General',       'unidad', 2.50, 3,  FALSE, NULL
    UNION ALL SELECT '8410000000196', 'Pelota de goma',             'Juguetes',             NULL,                     'General',       'unidad', 1.99, 3,  FALSE, NULL
    UNION ALL SELECT '8410000000202', 'Bolsa de regalo',            'Regalos',              NULL,                     'General',       'unidad', 1.50, 5,  FALSE, NULL
    UNION ALL SELECT '8410000000219', 'Mechero',                    'Útiles',               NULL,                     'General',       'unidad', 1.00, 10, FALSE, NULL
  ) p
  JOIN categorias c       ON c.nombre  = p.cat
  JOIN tipos_iva i        ON i.nombre  = p.iva
  LEFT JOIN proveedores pr ON pr.nombre = p.prov;

-- ---------------------------------------------------------------------
--  Inventario inicial: se registra como una compra para que los
--  triggers calculen stock, coste medio y lotes. Coste de compra
--  aproximado: 55-70 % de la base imponible.
-- ---------------------------------------------------------------------
INSERT INTO compras (fecha, numero_factura, usuario, notas)
VALUES (CURDATE() - INTERVAL 62 DAY, 'INV-INICIAL', 'admin', 'Inventario inicial');
SET @compra = LAST_INSERT_ID();

INSERT INTO lineas_compra (compra_id, producto_id, cantidad, coste_unitario, fecha_caducidad)
SELECT @compra,
       p.id,
       IF(p.unidad_medida = 'kg', 300, 320),
       ROUND(p.precio_venta / (1 + i.porcentaje / 100) * (0.55 + (p.id % 4) * 0.05), 4),
       IF(p.controla_caducidad, CURDATE() + INTERVAL 120 DAY, NULL)
  FROM productos p JOIN tipos_iva i ON i.id = p.iva_id;

-- ---------------------------------------------------------------------
--  Dos meses de ventas aleatorias
-- ---------------------------------------------------------------------
DELIMITER //
CREATE PROCEDURE generar_ventas_ejemplo(IN p_dias INT)
BEGIN
  DECLARE d INT DEFAULT p_dias;
  DECLARE t INT;
  DECLARE n_tickets INT;
  DECLARE n_lineas INT;
  DECLARE l INT;
  DECLARE v_venta INT UNSIGNED;
  DECLARE v_prod INT UNSIGNED;
  DECLARE v_unidad VARCHAR(10);
  DECLARE v_cant DECIMAL(10,3);
  -- Si una línea falla (p. ej. sin stock) se ignora y se sigue
  DECLARE CONTINUE HANDLER FOR SQLSTATE '45000' BEGIN END;

  WHILE d > 0 DO
    SET n_tickets = 15 + FLOOR(RAND() * 20);
    SET t = 0;
    WHILE t < n_tickets DO
      INSERT INTO ventas (fecha, metodo_pago, usuario)
      VALUES (CURDATE() - INTERVAL d DAY + INTERVAL (9 * 3600 + FLOOR(RAND() * 12 * 3600)) SECOND,
              ELT(1 + FLOOR(RAND() * 3), 'efectivo', 'tarjeta', 'bizum'),
              'dependiente');
      SET v_venta = LAST_INSERT_ID();
      SET n_lineas = 1 + FLOOR(RAND() * 3);
      SET l = 0;
      WHILE l < n_lineas DO
        SELECT id, unidad_medida INTO v_prod, v_unidad FROM productos ORDER BY RAND() LIMIT 1;
        SET v_cant = IF(v_unidad = 'kg', ROUND(0.3 + RAND() * 2, 3), 1 + FLOOR(RAND() * 2));
        INSERT INTO lineas_venta (venta_id, producto_id, cantidad) VALUES (v_venta, v_prod, v_cant);
        SET l = l + 1;
      END WHILE;
      SET t = t + 1;
    END WHILE;
    SET d = d - 1;
  END WHILE;

  DELETE FROM ventas WHERE total = 0;
END//
DELIMITER ;

CALL generar_ventas_ejemplo(60);
DROP PROCEDURE generar_ventas_ejemplo;

-- ---------------------------------------------------------------------
--  Lotes para ver los avisos de caducidad
-- ---------------------------------------------------------------------
INSERT INTO compras (fecha, numero_factura, usuario, notas)
VALUES (NOW(), 'DEMO-CAD', 'admin', 'Compra de ejemplo con caducidades cercanas');
SET @compra = LAST_INSERT_ID();

INSERT INTO lineas_compra (compra_id, producto_id, cantidad, coste_unitario, fecha_caducidad)
SELECT @compra, id, 6, coste_medio,
       CASE nombre
         WHEN 'Sándwich mixto'       THEN CURDATE() + INTERVAL 1 DAY
         WHEN 'Yogur natural pack 4' THEN CURDATE() + INTERVAL 3 DAY
         WHEN 'Pan de molde'         THEN CURDATE()
         WHEN 'Palmera de chocolate' THEN CURDATE() - INTERVAL 1 DAY
       END
  FROM productos
 WHERE nombre IN ('Sándwich mixto', 'Yogur natural pack 4', 'Pan de molde', 'Palmera de chocolate');

-- Un producto en stock bajo para ver la alerta
INSERT INTO mermas (producto_id, cantidad, motivo, usuario, notas)
SELECT id, stock_actual - 2, 'otro', 'admin', 'Ajuste para la demo de stock bajo'
  FROM productos WHERE nombre = 'Pilas AA pack 4';
