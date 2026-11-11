-- Cómo llama cada proveedor a nuestros productos en sus facturas
-- ("CC LATA 33CL P24" -> Coca-Cola lata 33 cl). Se aprende al guardar una
-- compra leída de una foto, para emparejar sola la siguiente factura.
CREATE TABLE alias_factura (
  proveedor_id INTEGER NOT NULL DEFAULT 0,          -- 0: compra sin proveedor
  texto        TEXT    NOT NULL,                     -- descripción normalizada
  producto_id  INTEGER NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
  PRIMARY KEY (proveedor_id, texto)
);
