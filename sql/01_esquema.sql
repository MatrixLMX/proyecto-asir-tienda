-- =====================================================================
--  Proyecto ASIR - Gestión de almacén y finanzas de una tienda
--  01_esquema.sql : base de datos, tablas y restricciones
--  SGBD: MariaDB 11.8 (Debian 13)
-- =====================================================================

CREATE DATABASE IF NOT EXISTS tienda
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_spanish_ci;

USE tienda;

-- ---------------------------------------------------------------------
--  Tipos de IVA. Los productos apuntan a un tipo, así que si cambia
--  un porcentaje basta con modificarlo aquí.
-- ---------------------------------------------------------------------
CREATE TABLE tipos_iva (
  id          TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre      VARCHAR(30)  NOT NULL UNIQUE,
  porcentaje  DECIMAL(5,2) NOT NULL,
  CONSTRAINT chk_iva_porcentaje CHECK (porcentaje BETWEEN 0 AND 100)
) ENGINE=InnoDB;

CREATE TABLE categorias (
  id           SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre       VARCHAR(50)  NOT NULL UNIQUE,
  descripcion  VARCHAR(255) NULL,
  activa       BOOLEAN      NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

CREATE TABLE proveedores (
  id         SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre     VARCHAR(80)  NOT NULL UNIQUE,
  contacto   VARCHAR(80)  NULL,
  telefono   VARCHAR(20)  NULL,
  email      VARCHAR(120) NULL,
  notas      VARCHAR(255) NULL,
  activo     BOOLEAN      NOT NULL DEFAULT TRUE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
--  Productos
--   * unidad_medida: 'unidad' o 'kg' (patatas, cebollas, ajos...).
--     Por eso las cantidades son DECIMAL(10,3): 1,250 kg.
--   * precio_venta: PVP con IVA incluido (lo que paga el cliente).
--   * coste_medio: coste de compra SIN IVA, media ponderada. Lo
--     mantiene el trigger de compras; no se escribe a mano.
--   * stock_actual: lo mantienen los triggers; no se escribe a mano.
--   * controla_caducidad / vida_util_dias: ver 02_triggers.sql.
-- ---------------------------------------------------------------------
CREATE TABLE productos (
  id                    INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo_barras         VARCHAR(20)   NULL UNIQUE,
  nombre                VARCHAR(100)  NOT NULL,
  categoria_id          SMALLINT UNSIGNED NOT NULL,
  proveedor_id          SMALLINT UNSIGNED NULL,
  iva_id                TINYINT UNSIGNED  NOT NULL,
  unidad_medida         ENUM('unidad','kg') NOT NULL DEFAULT 'unidad',
  precio_venta          DECIMAL(10,2) NOT NULL,
  coste_medio           DECIMAL(10,4) NOT NULL DEFAULT 0,
  stock_actual          DECIMAL(10,3) NOT NULL DEFAULT 0,
  stock_minimo          DECIMAL(10,3) NOT NULL DEFAULT 0,
  controla_caducidad    BOOLEAN       NOT NULL DEFAULT FALSE,
  vida_util_dias        SMALLINT UNSIGNED NULL,
  dias_aviso_caducidad  TINYINT UNSIGNED  NOT NULL DEFAULT 5,
  activo                BOOLEAN       NOT NULL DEFAULT TRUE,
  creado_en             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_prod_categoria FOREIGN KEY (categoria_id) REFERENCES categorias(id),
  CONSTRAINT fk_prod_proveedor FOREIGN KEY (proveedor_id) REFERENCES proveedores(id)
    ON DELETE SET NULL,
  CONSTRAINT fk_prod_iva       FOREIGN KEY (iva_id)       REFERENCES tipos_iva(id),
  CONSTRAINT chk_prod_precio   CHECK (precio_venta >= 0),
  CONSTRAINT chk_prod_minimo   CHECK (stock_minimo >= 0),
  INDEX idx_prod_nombre (nombre)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
--  Compras a proveedores (cabecera + líneas)
-- ---------------------------------------------------------------------
CREATE TABLE compras (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  proveedor_id    SMALLINT UNSIGNED NULL,
  fecha           DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  numero_factura  VARCHAR(40)  NULL,
  total_sin_iva   DECIMAL(12,2) NOT NULL DEFAULT 0,
  usuario         VARCHAR(40)  NULL,
  notas           VARCHAR(255) NULL,
  CONSTRAINT fk_compra_proveedor FOREIGN KEY (proveedor_id) REFERENCES proveedores(id),
  INDEX idx_compra_fecha (fecha)
) ENGINE=InnoDB;

CREATE TABLE lineas_compra (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  compra_id        INT UNSIGNED  NOT NULL,
  producto_id      INT UNSIGNED  NOT NULL,
  cantidad         DECIMAL(10,3) NOT NULL,
  coste_unitario   DECIMAL(10,4) NOT NULL,          -- sin IVA
  fecha_caducidad  DATE          NULL,
  CONSTRAINT fk_lc_compra   FOREIGN KEY (compra_id)   REFERENCES compras(id) ON DELETE CASCADE,
  CONSTRAINT fk_lc_producto FOREIGN KEY (producto_id) REFERENCES productos(id),
  CONSTRAINT chk_lc_cantidad CHECK (cantidad > 0),
  CONSTRAINT chk_lc_coste    CHECK (coste_unitario >= 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
--  Lotes: una entrada de mercancía con su fecha de caducidad.
--  Solo se crean para productos con controla_caducidad = TRUE.
--  Las ventas los van gastando automáticamente, empezando por el que
--  caduca antes (FEFO: First Expired, First Out).
-- ---------------------------------------------------------------------
CREATE TABLE lotes (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  producto_id        INT UNSIGNED  NOT NULL,
  linea_compra_id    INT UNSIGNED  NULL,
  fecha_entrada      DATE          NOT NULL,
  fecha_caducidad    DATE          NOT NULL,
  cantidad_inicial   DECIMAL(10,3) NOT NULL,
  cantidad_restante  DECIMAL(10,3) NOT NULL,
  CONSTRAINT fk_lote_producto FOREIGN KEY (producto_id)     REFERENCES productos(id),
  CONSTRAINT fk_lote_linea    FOREIGN KEY (linea_compra_id) REFERENCES lineas_compra(id)
    ON DELETE SET NULL,
  CONSTRAINT chk_lote_restante CHECK (cantidad_restante >= 0),
  INDEX idx_lote_caducidad (producto_id, fecha_caducidad)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
--  Ventas (cabecera + líneas)
--   * precio_unitario: PVP con IVA en el momento de la venta.
--   * iva_porcentaje y coste_unitario se copian del producto al vender
--     (trigger), para que el beneficio histórico no cambie si mañana
--     cambian los precios.
-- ---------------------------------------------------------------------
CREATE TABLE ventas (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  fecha        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metodo_pago  ENUM('efectivo','tarjeta','bizum') NOT NULL DEFAULT 'efectivo',
  total        DECIMAL(12,2) NOT NULL DEFAULT 0,
  usuario      VARCHAR(40)   NULL,
  INDEX idx_venta_fecha (fecha)
) ENGINE=InnoDB;

CREATE TABLE lineas_venta (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  venta_id         INT UNSIGNED  NOT NULL,
  producto_id      INT UNSIGNED  NOT NULL,
  cantidad         DECIMAL(10,3) NOT NULL,
  precio_unitario  DECIMAL(10,2) NULL,
  iva_porcentaje   DECIMAL(5,2)  NULL,
  coste_unitario   DECIMAL(10,4) NULL,
  CONSTRAINT fk_lv_venta    FOREIGN KEY (venta_id)    REFERENCES ventas(id) ON DELETE CASCADE,
  CONSTRAINT fk_lv_producto FOREIGN KEY (producto_id) REFERENCES productos(id),
  CONSTRAINT chk_lv_cantidad CHECK (cantidad > 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
--  De qué lote salió cada línea de venta. Sirve para que, al anular
--  una venta, el producto vuelva exactamente a sus lotes (y a su fecha
--  de caducidad).
-- ---------------------------------------------------------------------
CREATE TABLE lotes_consumidos (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  linea_venta_id  INT UNSIGNED  NOT NULL,
  lote_id         INT UNSIGNED  NOT NULL,
  cantidad        DECIMAL(10,3) NOT NULL,
  CONSTRAINT fk_lcons_linea FOREIGN KEY (linea_venta_id) REFERENCES lineas_venta(id) ON DELETE CASCADE,
  CONSTRAINT fk_lcons_lote  FOREIGN KEY (lote_id)        REFERENCES lotes(id)        ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
--  Mermas: producto que sale del almacén sin venderse (caducado, roto).
--  Cuenta como pérdida en los informes de beneficio.
-- ---------------------------------------------------------------------
CREATE TABLE mermas (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  producto_id     INT UNSIGNED  NOT NULL,
  lote_id         INT UNSIGNED  NULL,
  cantidad        DECIMAL(10,3) NOT NULL,
  motivo          ENUM('caducado','roto','robo','consumo_propio','otro') NOT NULL,
  coste_unitario  DECIMAL(10,4) NULL,
  fecha           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario         VARCHAR(40)   NULL,
  notas           VARCHAR(255)  NULL,
  CONSTRAINT fk_merma_producto FOREIGN KEY (producto_id) REFERENCES productos(id),
  CONSTRAINT fk_merma_lote     FOREIGN KEY (lote_id)     REFERENCES lotes(id) ON DELETE SET NULL,
  CONSTRAINT chk_merma_cantidad CHECK (cantidad > 0)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
--  Cierre de caja: al acabar el día se cuenta el efectivo y se compara
--  con lo que dicen las ventas. Un cierre por día.
-- ---------------------------------------------------------------------
CREATE TABLE cierres_caja (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  fecha              DATE          NOT NULL UNIQUE,
  tickets            INT UNSIGNED  NOT NULL,
  total_efectivo     DECIMAL(12,2) NOT NULL,
  total_tarjeta      DECIMAL(12,2) NOT NULL,
  total_bizum        DECIMAL(12,2) NOT NULL,
  fondo_inicial      DECIMAL(12,2) NOT NULL DEFAULT 0,  -- cambio con el que se abrió la caja
  efectivo_contado   DECIMAL(12,2) NOT NULL,
  diferencia         DECIMAL(12,2) AS (efectivo_contado - fondo_inicial - total_efectivo) PERSISTENT,
  usuario            VARCHAR(40)   NULL,
  notas              VARCHAR(255)  NULL,
  creado_en          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
--  Auditoría: registro de cambios delicados (precios, ventas anuladas,
--  compras borradas, mermas, usuarios). La rellenan los triggers.
--  El usuario de la web lo pasa la aplicación en la variable de sesión
--  @usuario_app; si no existe (cambio hecho a mano en el servidor), se
--  guarda el usuario de MariaDB.
-- ---------------------------------------------------------------------
CREATE TABLE auditoria (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  fecha        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  usuario      VARCHAR(80)   NOT NULL,
  accion       VARCHAR(40)   NOT NULL,
  tabla        VARCHAR(40)   NOT NULL,
  registro_id  INT UNSIGNED  NULL,
  detalle      VARCHAR(500)  NULL,
  INDEX idx_auditoria_fecha (fecha)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
--  Usuarios de la aplicación web (login). Las contraseñas se guardan
--  como hash bcrypt, nunca en claro.
-- ---------------------------------------------------------------------
CREATE TABLE usuarios_app (
  id             SMALLINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  usuario        VARCHAR(40)  NOT NULL UNIQUE,
  nombre         VARCHAR(80)  NOT NULL,
  password_hash  VARCHAR(100) NOT NULL,
  rol            ENUM('admin','dependiente') NOT NULL,
  activo         BOOLEAN      NOT NULL DEFAULT TRUE,
  creado_en      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
