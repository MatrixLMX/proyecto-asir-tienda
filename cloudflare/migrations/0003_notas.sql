-- Notas del día a día que comparten quienes llevan la tienda (pantalla Inicio)
CREATE TABLE notas (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  texto   TEXT NOT NULL,
  fecha   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario TEXT NOT NULL
);
CREATE INDEX idx_notas_fecha ON notas(fecha);

CREATE TRIGGER trg_notas_fecha AFTER INSERT ON notas WHEN NEW.fecha LIKE '% %'
BEGIN UPDATE notas SET fecha = (SELECT ahora FROM v_ahora) WHERE id = NEW.id; END;
