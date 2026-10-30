-- =====================================================================
--  06_datos_base.sql : datos reales de partida de la tienda
--
--  IVA: porcentajes vigentes en España para cada tipo. Falta confirmar
--  con la gestoría qué tipo lleva cada producto (orientación general:
--  pan, leche, huevos, fruta y verdura -> 4 %; resto de alimentación y
--  agua -> 10 %; refrescos azucarados, alcohol, limpieza, ferretería,
--  juguetes... -> 21 %).
-- =====================================================================

USE tienda;

INSERT INTO tipos_iva (nombre, porcentaje) VALUES
  ('Superreducido', 4.00),
  ('Reducido',     10.00),
  ('General',      21.00),
  ('Exento',        0.00);

-- Categorías indicadas por la tienda + algunas habituales en
-- alimentación. Se pueden añadir más en cualquier momento.
INSERT INTO categorias (nombre) VALUES
  ('Alimentación'),
  ('Bebidas'),
  ('Fruta y verdura'),
  ('Charcutería'),
  ('Helados y congelados'),
  ('Limpieza'),
  ('Ferretería'),
  ('Cocina'),
  ('Útiles'),
  ('Escolar'),
  ('Juguetes'),
  ('Regalos');

INSERT INTO proveedores (nombre, notas) VALUES
  ('Coca-Cola', NULL),
  ('Don Pin', NULL),
  ('Matutano', NULL),
  ('Frigo', NULL),
  ('Nestlé', NULL),
  ('Bodegas Oviedo', NULL),
  ('Sándwiches y embutidos', 'Nombre comercial pendiente de confirmar'),
  ('Dulcesol', NULL);
