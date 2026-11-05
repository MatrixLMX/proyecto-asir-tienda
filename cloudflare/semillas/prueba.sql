-- Datos FICTICIOS para la prueba. No cargar con datos reales de la tienda.
INSERT INTO productos (codigo_barras, nombre, categoria_id, iva_id, unidad_medida, precio_venta_cent, coste_medio_dm, stock_milli, stock_minimo_milli, controla_caducidad, vida_util_dias) VALUES
  ('5449000000996', 'Coca-Cola lata 33 cl', 2, 3, 'unidad', 120, 5500, 48000, 12000, 0, NULL),
  ('8410000000011', 'Agua mineral 1,5 L', 2, 2, 'unidad', 70, 2500, 40000, 12000, 0, NULL),
  ('8410199000013', 'Patatas fritas 150 g', 1, 2, 'unidad', 180, 9000, 3000, 6000, 0, NULL),
  ('8410000000059', 'Leche entera 1 L', 1, 1, 'unidad', 110, 7000, 24000, 6000, 1, 30),
  ('8410000000066', 'Yogur natural pack 4', 1, 2, 'unidad', 195, 11000, 10000, 3000, 1, 21),
  (NULL, 'Patatas a granel', 3, 1, 'kg', 129, 6000, 25000, 5000, 0, NULL),
  (NULL, 'Cebollas', 3, 1, 'kg', 149, 7000, 15000, 3000, 0, NULL),
  ('8410000000103', 'Helado cono nata', 5, 2, 'unidad', 250, 12000, 20000, 5000, 0, NULL);

INSERT INTO lotes (producto_id, fecha_entrada, fecha_caducidad, inicial_milli, restante_milli)
SELECT id, date('now'), date('now', '+2 days'), 4000, 4000 FROM productos WHERE nombre = 'Yogur natural pack 4';
INSERT INTO lotes (producto_id, fecha_entrada, fecha_caducidad, inicial_milli, restante_milli)
SELECT id, date('now'), date('now', '+20 days'), 6000, 6000 FROM productos WHERE nombre = 'Yogur natural pack 4';
INSERT INTO lotes (producto_id, fecha_entrada, fecha_caducidad, inicial_milli, restante_milli)
SELECT id, date('now'), date('now', '+25 days'), 24000, 24000 FROM productos WHERE nombre = 'Leche entera 1 L';
