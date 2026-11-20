-- =====================================================================
--  Precios de compra con el IVA incluido
--
--  La tienda paga a sus proveedores el IVA (y el recargo de equivalencia)
--  y no lo descuenta después: el precio de compra que importa es el que se
--  paga, IVA incluido. Por eso:
--    - el coste de los productos y de las compras se apunta tal cual viene
--      en la factura, con IVA;
--    - el beneficio real es lo cobrado (con IVA) menos lo pagado (con IVA), y
--      el margen se calcula sobre lo cobrado.
--  El IVA de cada producto se sigue guardando, pero solo para el ticket de
--  venta: lo pone la categoría y ya no hay que elegirlo al dar de alta.
-- =====================================================================

ALTER TABLE categorias ADD COLUMN iva_id INTEGER REFERENCES tipos_iva(id);

-- IVA de venta habitual de cada categoría (se puede cambiar en cada producto)
UPDATE categorias SET iva_id = (SELECT id FROM tipos_iva WHERE porcentaje_cp = 400)
 WHERE nombre IN ('Fruta y verdura');
UPDATE categorias SET iva_id = (SELECT id FROM tipos_iva WHERE porcentaje_cp = 1000)
 WHERE nombre IN ('Alimentación', 'Bebidas', 'Charcutería', 'Helados y congelados');
UPDATE categorias SET iva_id = (SELECT id FROM tipos_iva WHERE porcentaje_cp = 2100)
 WHERE iva_id IS NULL;

DROP VIEW v_beneficio_mensual;
DROP VIEW v_beneficio_categoria;
DROP VIEW v_beneficio_producto;
DROP VIEW v_lineas_detalle;

-- Las devoluciones restan el día en que se hacen, no el de la venta.
-- base: lo vendido sin IVA (para los impuestos); beneficio: cobrado − coste.
CREATE VIEW v_lineas_detalle AS
SELECT v.id AS venta_id, v.fecha, p.id AS producto_id, p.nombre AS producto, c.nombre AS categoria,
       lv.cantidad_milli,
       (lv.cantidad_milli * lv.precio_unitario_cent + 500) / 1000 AS importe,
       CAST(ROUND(lv.cantidad_milli / 1000.0 * lv.precio_unitario_cent / (1 + lv.iva_cp / 10000.0)) AS INTEGER) AS base,
       (lv.cantidad_milli * lv.coste_unitario_dm + 50000) / 100000 AS coste,
       (lv.cantidad_milli * lv.precio_unitario_cent + 500) / 1000
         - (lv.cantidad_milli * lv.coste_unitario_dm + 50000) / 100000 AS beneficio
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
       -ld.importe_cent
         + CASE WHEN ld.repuesto = 1 THEN (ld.cantidad_milli * lv.coste_unitario_dm + 50000) / 100000 ELSE 0 END
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
       ROUND(100.0 * SUM(beneficio) / NULLIF(SUM(importe), 0), 1) AS margen_pct
  FROM v_lineas_detalle
 GROUP BY producto_id;

CREATE VIEW v_beneficio_categoria AS
SELECT categoria,
       SUM(importe) / 100.0 AS facturacion,
       SUM(base) / 100.0 AS base_imponible,
       SUM(coste) / 100.0 AS coste,
       SUM(beneficio) / 100.0 AS beneficio,
       ROUND(100.0 * SUM(beneficio) / NULLIF(SUM(importe), 0), 1) AS margen_pct
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
       ROUND(100.0 * (m.beneficio - COALESCE(me.perdidas, 0)) / NULLIF(m.importe, 0), 1) AS margen_pct,
       ROUND(m.importe * 0.15) / 100.0 AS estimacion_15_pct
  FROM (SELECT substr(fecha, 1, 7) AS mes, SUM(importe) AS importe, SUM(base) AS base,
               SUM(coste) AS coste, SUM(beneficio) AS beneficio
          FROM v_lineas_detalle GROUP BY substr(fecha, 1, 7)) m
  LEFT JOIN (SELECT substr(fecha, 1, 7) AS mes,
                    CAST(ROUND(SUM(cantidad_milli * coste_unitario_dm) / 100000.0) AS INTEGER) AS perdidas
               FROM mermas GROUP BY substr(fecha, 1, 7)) me ON me.mes = m.mes;
