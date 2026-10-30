-- =====================================================================
--  03_vistas.sql : consultas guardadas para el día a día y los informes
--
--  Cálculo del beneficio real de cada línea de venta:
--    base imponible = PVP / (1 + IVA)          (lo que se queda la tienda)
--    beneficio      = cantidad * (base - coste de compra sin IVA)
--
--  Las vistas de stock y caducidades no muestran precios de compra y
--  son las que puede consultar el perfil "dependiente". El resto son
--  solo para el administrador (ver 04_usuarios.sql).
-- =====================================================================

USE tienda;

-- ---------------------------------------------------------------------
--  Vistas operativas (dependiente y administrador)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_stock AS
SELECT p.id,
       p.codigo_barras,
       p.nombre        AS producto,
       c.nombre        AS categoria,
       p.unidad_medida,
       p.precio_venta,
       p.stock_actual,
       p.stock_minimo,
       CASE
         WHEN p.stock_actual <= 0              THEN 'AGOTADO'
         WHEN p.stock_actual <= p.stock_minimo THEN 'BAJO'
         ELSE 'OK'
       END             AS estado
  FROM productos p
  JOIN categorias c ON c.id = p.categoria_id
 WHERE p.activo;

CREATE OR REPLACE VIEW v_alertas_stock AS
SELECT p.id,
       p.nombre        AS producto,
       c.nombre        AS categoria,
       pr.nombre       AS proveedor,
       p.unidad_medida,
       p.stock_actual,
       p.stock_minimo,
       GREATEST(p.stock_minimo * 2 - p.stock_actual, 0) AS cantidad_sugerida
  FROM productos p
  JOIN categorias c       ON c.id  = p.categoria_id
  LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
 WHERE p.activo AND p.stock_actual <= p.stock_minimo;

-- Lotes que ya han caducado o caducan dentro de los días de aviso de
-- su producto. Es la "lista de la mañana": no hay que revisar producto
-- por producto.
CREATE OR REPLACE VIEW v_caducidades AS
SELECT l.id            AS lote_id,
       p.id            AS producto_id,
       p.nombre        AS producto,
       c.nombre        AS categoria,
       l.fecha_caducidad,
       DATEDIFF(l.fecha_caducidad, CURDATE()) AS dias_restantes,
       l.cantidad_restante,
       p.unidad_medida,
       CASE
         WHEN l.fecha_caducidad <  CURDATE() THEN 'CADUCADO'
         WHEN l.fecha_caducidad =  CURDATE() THEN 'CADUCA HOY'
         ELSE 'PROXIMO'
       END             AS estado
  FROM lotes l
  JOIN productos p  ON p.id = l.producto_id
  JOIN categorias c ON c.id = p.categoria_id
 WHERE l.cantidad_restante > 0
   AND l.fecha_caducidad <= CURDATE() + INTERVAL p.dias_aviso_caducidad DAY;

-- ---------------------------------------------------------------------
--  Vistas financieras (solo administrador)
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_lineas_venta_detalle AS
SELECT v.id            AS venta_id,
       v.fecha,
       v.metodo_pago,
       v.usuario,
       p.id            AS producto_id,
       p.nombre        AS producto,
       c.nombre        AS categoria,
       lv.cantidad,
       lv.precio_unitario,
       lv.iva_porcentaje,
       ROUND(lv.cantidad * lv.precio_unitario, 2)                              AS importe,
       ROUND(lv.cantidad * lv.precio_unitario / (1 + lv.iva_porcentaje / 100), 2) AS base_imponible,
       ROUND(lv.cantidad * lv.coste_unitario, 2)                               AS coste,
       ROUND(lv.cantidad * (lv.precio_unitario / (1 + lv.iva_porcentaje / 100)
                            - lv.coste_unitario), 2)                           AS beneficio
  FROM lineas_venta lv
  JOIN ventas v     ON v.id = lv.venta_id
  JOIN productos p  ON p.id = lv.producto_id
  JOIN categorias c ON c.id = p.categoria_id;

CREATE OR REPLACE VIEW v_beneficio_producto AS
SELECT producto_id,
       producto,
       categoria,
       SUM(cantidad)       AS unidades_vendidas,
       SUM(importe)        AS facturacion,
       SUM(base_imponible) AS base_imponible,
       SUM(coste)          AS coste,
       SUM(beneficio)      AS beneficio,
       ROUND(100 * SUM(beneficio) / NULLIF(SUM(base_imponible), 0), 1) AS margen_pct
  FROM v_lineas_venta_detalle
 GROUP BY producto_id, producto, categoria;

CREATE OR REPLACE VIEW v_beneficio_categoria AS
SELECT categoria,
       SUM(importe)        AS facturacion,
       SUM(base_imponible) AS base_imponible,
       SUM(coste)          AS coste,
       SUM(beneficio)      AS beneficio,
       ROUND(100 * SUM(beneficio) / NULLIF(SUM(base_imponible), 0), 1) AS margen_pct
  FROM v_lineas_venta_detalle
 GROUP BY categoria;

-- Resumen mensual. Incluye la estimación antigua (15 % de la
-- facturación) para comparar con el beneficio real.
CREATE OR REPLACE VIEW v_beneficio_mensual AS
SELECT m.mes,
       m.facturacion,
       m.base_imponible,
       m.coste,
       m.beneficio_bruto,
       COALESCE(me.perdidas_mermas, 0)                     AS perdidas_mermas,
       m.beneficio_bruto - COALESCE(me.perdidas_mermas, 0) AS beneficio_neto,
       ROUND(100 * (m.beneficio_bruto - COALESCE(me.perdidas_mermas, 0))
             / NULLIF(m.base_imponible, 0), 1)             AS margen_pct,
       ROUND(m.facturacion * 0.15, 2)                      AS estimacion_15_pct
  FROM (SELECT DATE_FORMAT(fecha, '%Y-%m') AS mes,
               SUM(importe)        AS facturacion,
               SUM(base_imponible) AS base_imponible,
               SUM(coste)          AS coste,
               SUM(beneficio)      AS beneficio_bruto
          FROM v_lineas_venta_detalle
         GROUP BY DATE_FORMAT(fecha, '%Y-%m')) m
  LEFT JOIN (SELECT DATE_FORMAT(fecha, '%Y-%m') AS mes,
                    ROUND(SUM(cantidad * coste_unitario), 2) AS perdidas_mermas
               FROM mermas
              GROUP BY DATE_FORMAT(fecha, '%Y-%m')) me ON me.mes = m.mes;

CREATE OR REPLACE VIEW v_ventas_diarias AS
SELECT DATE(fecha)          AS dia,
       COUNT(*)             AS num_ventas,
       SUM(total)           AS facturacion,
       ROUND(AVG(total), 2) AS ticket_medio
  FROM ventas
 GROUP BY DATE(fecha);
