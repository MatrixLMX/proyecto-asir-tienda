/** Acciones que el asistente puede PREPARAR: una compra, un producto nuevo,
 *  un cambio de precio, una merma o una nota.
 *
 *  Aquí no se escribe nada en la base de datos. Cada herramienta comprueba lo
 *  que pide el modelo (que el producto existe, el IVA, la categoría...) y deja
 *  una propuesta que la web enseña en una tarjeta. Solo si la persona pulsa
 *  Confirmar, la web la envía a la ruta normal (POST /compras, POST /productos,
 *  PATCH /productos/:id, POST /mermas, POST /notas), que vuelve a validarlo
 *  todo y comprueba los permisos. Así una frase mal entendida nunca cambia el
 *  stock ni los precios por su cuenta. */
import { type C, type Datos, filas, normalizar, palabras, parecido } from "./comun";

export type Accion =
  | { tipo: "compra"; proveedor_id: number | null; proveedor: string | null;
      lineas: { producto_id: number; nombre: string; unidad_medida: string; cantidad: number; coste_unitario: number; necesita_fecha: boolean }[] }
  | { tipo: "producto"; nombre: string; categoria_id: number | null; iva_id: number | null; unidad_medida: "unidad" | "kg";
      precio_venta: number | null; coste_compra: number | null; stock_inicial: number; codigo_barras: string | null }
  | { tipo: "precio"; producto_id: number; nombre: string; antes: number; precio_venta: number }
  | { tipo: "merma"; producto_id: number; nombre: string; unidad_medida: string; cantidad: number; motivo: string }
  | { tipo: "nota"; texto: string };

export interface Herramienta {
  descripcion: string;
  parametros?: Record<string, unknown>;
  requeridos?: string[];
  /** Devuelve filas (consultas) o un texto para el modelo; las propuestas van a `acciones`. */
  ejecutar: (c: C, a: Datos, acciones: Accion[]) => Promise<unknown[] | string>;
}

const MAX_ACCIONES = 10;
const PENDIENTE = "PREPARADO, PENDIENTE DE CONFIRMAR: el usuario lo ve en una tarjeta y tiene que pulsar Confirmar. Todavía NO está hecho.";
const MOTIVOS = ["caducado", "roto", "robo", "consumo_propio", "otro"];

const numero = (v: unknown, max = 1e6) => {
  const n = typeof v === "string" ? Number(v.replace(",", ".")) : Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isFinite(n) && n >= 0 && n < max ? n : null;
};
const redondeo = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

interface Prod { id: number; nombre: string; unidad_medida: string; precio_venta: number; coste_medio: number; controla_caducidad: number; vida_util_dias: number | null; proveedor_id: number | null }
const productoPorId = async (c: C, id: unknown) => {
  const n = Number(id);
  if (!Number.isInteger(n)) return null;
  const [p] = await filas<Prod>(c, `
    SELECT id, nombre, unidad_medida, precio_venta_cent / 100.0 AS precio_venta, coste_medio_dm / 10000.0 AS coste_medio,
           controla_caducidad, vida_util_dias, proveedor_id
      FROM productos WHERE id = ? AND activo`, n);
  return p ?? null;
};
const noEncontrado = (id: unknown) => `No hay ningún producto activo con id ${String(id)}. Búscalo antes con buscar_productos y usa su id.`;

/** Lo más parecido de una tabla pequeña (categorías, proveedores) a lo que se ha dicho. */
function elegir<T extends { id: number; nombre: string }>(lista: T[], dicho: unknown): T | null {
  const q = normalizar(dicho).trim();
  if (!q) return null;
  const exacto = lista.find((x) => normalizar(x.nombre) === q);
  if (exacto) return exacto;
  const contiene = lista.filter((x) => normalizar(x.nombre).includes(q) || q.includes(normalizar(x.nombre)));
  if (contiene.length === 1) return contiene[0]!;
  const puntos = lista.map((x) => ({ x, s: Math.max(parecido(String(dicho), x.nombre), parecido(x.nombre, String(dicho))) })).sort((a, b) => b.s - a.s);
  return puntos[0] && puntos[0].s >= 0.5 && (puntos[1]?.s ?? 0) < puntos[0].s ? puntos[0].x : null;
}

function añadir(acciones: Accion[], a: Accion) {
  if (acciones.length >= MAX_ACCIONES) return false;
  acciones.push(a);
  return true;
}
const DEMASIADAS = `No se pueden preparar más de ${MAX_ACCIONES} cosas de una vez. Pide al usuario que confirme estas primero.`;

const idProducto = { type: "INTEGER", description: "id del producto (el que devuelve buscar_productos)" };

export const ACCIONES_COMUNES: Record<string, Herramienta> = {
  proponer_merma: {
    descripcion: "Prepara la retirada de stock de un producto que se tira o se pierde (caducado, roto, robo, consumo propio). El usuario la confirma en una tarjeta.",
    parametros: {
      producto_id: idProducto,
      cantidad: { type: "NUMBER", description: "Unidades, o kg si el producto se vende por kg" },
      motivo: { type: "STRING", enum: MOTIVOS, description: "Por qué se retira" },
    },
    requeridos: ["producto_id", "cantidad", "motivo"],
    ejecutar: async (c, a, acciones) => {
      const p = await productoPorId(c, a.producto_id);
      if (!p) return noEncontrado(a.producto_id);
      const cantidad = numero(a.cantidad);
      if (!cantidad) return "Falta la cantidad (mayor que cero). Pregúntasela al usuario.";
      const motivo = MOTIVOS.includes(String(a.motivo)) ? String(a.motivo) : "otro";
      if (!añadir(acciones, { tipo: "merma", producto_id: p.id, nombre: p.nombre, unidad_medida: p.unidad_medida, cantidad: redondeo(cantidad, 3), motivo })) return DEMASIADAS;
      return `${PENDIENTE} Merma: ${p.nombre}, ${cantidad} ${p.unidad_medida === "kg" ? "kg" : "uds."}, motivo ${motivo}.`;
    },
  },
  proponer_nota: {
    descripcion: "Prepara una nota para el tablón de notas de la tienda (recordatorios, encargos, avisos). El usuario la confirma en una tarjeta.",
    parametros: { texto: { type: "STRING", description: "Texto de la nota, redactado de forma clara y breve" } },
    requeridos: ["texto"],
    ejecutar: async (_c, a, acciones) => {
      const texto = String(a.texto ?? "").trim().slice(0, 1000);
      if (!texto) return "Falta el texto de la nota.";
      if (!añadir(acciones, { tipo: "nota", texto })) return DEMASIADAS;
      return `${PENDIENTE} Nota: "${texto}".`;
    },
  },
};

export const ACCIONES_ADMIN: Record<string, Herramienta> = {
  proponer_compra: {
    descripcion: "Prepara la entrada de mercancía (una compra a un proveedor) que suma stock a productos que YA existen. Un solo proveedor por compra. El usuario la confirma en una tarjeta.",
    parametros: {
      lineas: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            producto_id: idProducto,
            cantidad: { type: "NUMBER", description: "Unidades sueltas que entran (2 cajas de 12 = 24), o kg" },
            coste_unitario: { type: "NUMBER", description: "Precio de compra de UNA unidad (o kg) SIN IVA. Omítelo si no lo dicen: se usa el coste habitual." },
          },
          required: ["producto_id", "cantidad"],
        },
      },
      proveedor: { type: "STRING", description: "Nombre del proveedor, si lo dicen" },
    },
    requeridos: ["lineas"],
    ejecutar: async (c, a, acciones) => {
      if (!Array.isArray(a.lineas) || !a.lineas.length) return "La compra no tiene productos.";
      const lineas: Extract<Accion, { tipo: "compra" }>["lineas"] = [];
      const fallos: string[] = [];
      const deProveedor: (number | null)[] = [];
      for (const l of a.lineas.slice(0, 50) as Datos[]) {
        const p = await productoPorId(c, l?.producto_id);
        if (!p) { fallos.push(noEncontrado(l?.producto_id)); continue; }
        const cantidad = numero(l.cantidad);
        if (!cantidad) { fallos.push(`Falta la cantidad de ${p.nombre}.`); continue; }
        const coste = numero(l.coste_unitario, 1e5) ?? p.coste_medio;
        lineas.push({ producto_id: p.id, nombre: p.nombre, unidad_medida: p.unidad_medida, cantidad: redondeo(cantidad, 3), coste_unitario: redondeo(coste, 4),
          necesita_fecha: !!p.controla_caducidad && !p.vida_util_dias });
        deProveedor.push(p.proveedor_id);
      }
      if (!lineas.length) return fallos.join(" ");
      const proveedores = await filas<{ id: number; nombre: string }>(c, "SELECT id, nombre FROM proveedores WHERE activo");
      let prov = elegir(proveedores, a.proveedor);
      // Si no lo dicen y todos los productos son del mismo proveedor, ese
      if (!a.proveedor && deProveedor.every((x) => x && x === deProveedor[0])) prov = proveedores.find((x) => x.id === deProveedor[0]) ?? null;
      if (!añadir(acciones, { tipo: "compra", proveedor_id: prov?.id ?? null, proveedor: prov?.nombre ?? (a.proveedor ? String(a.proveedor).slice(0, 100) : null), lineas })) return DEMASIADAS;
      const resumen = lineas.map((l) => `${l.nombre} +${l.cantidad} a ${l.coste_unitario} €`).join("; ");
      return `${PENDIENTE} Compra${prov ? ` a ${prov.nombre}` : a.proveedor ? ` (el proveedor "${String(a.proveedor)}" no está dado de alta: lo elegirá en la tarjeta)` : ""}: ${resumen}.`
        + (lineas.some((l) => l.necesita_fecha) ? " Alguno controla caducidad: tendrá que poner la fecha en la tarjeta." : "")
        + (fallos.length ? ` No se ha podido añadir: ${fallos.join(" ")}` : "");
    },
  },
  proponer_producto_nuevo: {
    descripcion: "Prepara el alta de un producto que NO existe todavía en el catálogo (compruébalo antes con buscar_productos). Puede llevar el stock que entra ya. El usuario lo confirma en una tarjeta.",
    parametros: {
      nombre: { type: "STRING", description: "Nombre corto y claro como se verá en la tienda, p. ej. \"Galletas de chocolate 500 g\"" },
      precio_venta: { type: "NUMBER", description: "Precio de venta al público CON IVA" },
      coste_compra: { type: "NUMBER", description: "Precio de compra SIN IVA" },
      iva: { type: "NUMBER", description: "Porcentaje de IVA (4, 10, 21...), si lo dicen o es evidente por el tipo de producto" },
      categoria: { type: "STRING", description: "Categoría del catálogo a la que pertenece" },
      por_kg: { type: "BOOLEAN", description: "true si se vende a peso" },
      stock_inicial: { type: "NUMBER", description: "Unidades (o kg) que entran ahora, si las dicen" },
      codigo_barras: { type: "STRING", description: "EAN, si lo dicen" },
    },
    requeridos: ["nombre"],
    ejecutar: async (c, a, acciones) => {
      const nombre = String(a.nombre ?? "").trim().slice(0, 100);
      if (!nombre) return "Falta el nombre del producto.";
      const iguales = await filas<{ id: number; nombre: string }>(c, "SELECT id, nombre FROM productos");
      const repetido = iguales.find((p) => normalizar(p.nombre) === normalizar(nombre));
      if (repetido) return `Ya existe un producto llamado "${repetido.nombre}" (id ${repetido.id}). Si quiere sumar stock usa proponer_compra; si quiere otro distinto, usa otro nombre.`;
      const categorias = await filas<{ id: number; nombre: string }>(c, "SELECT id, nombre FROM categorias WHERE activa");
      const ivas = await filas<{ id: number; porcentaje: number }>(c, "SELECT id, porcentaje_cp / 100.0 AS porcentaje FROM tipos_iva");
      const pct = numero(a.iva, 100);
      const cat = elegir(categorias, a.categoria);
      const iva = pct === null ? null : ivas.find((i) => i.porcentaje === pct) ?? null;
      const codigo = String(a.codigo_barras ?? "").replace(/\D/g, "");
      const pvp = numero(a.precio_venta, 1e5), coste = numero(a.coste_compra, 1e5);
      const accion: Accion = {
        tipo: "producto", nombre, categoria_id: cat?.id ?? null, iva_id: iva?.id ?? null, unidad_medida: a.por_kg === true ? "kg" : "unidad",
        precio_venta: pvp === null ? null : redondeo(pvp, 2), coste_compra: coste === null ? null : redondeo(coste, 4),
        stock_inicial: redondeo(numero(a.stock_inicial) ?? 0, 3), codigo_barras: codigo.length >= 8 && codigo.length <= 14 ? codigo : null,
      };
      if (!añadir(acciones, accion)) return DEMASIADAS;
      const faltan = [!cat && "la categoría", !iva && "el IVA", pvp === null && "el precio de venta"].filter(Boolean);
      return `${PENDIENTE} Producto nuevo: ${nombre}${cat ? `, categoría ${cat.nombre}` : ""}${iva ? `, IVA ${iva.porcentaje} %` : ""}.`
        + (faltan.length ? ` Falta ${faltan.join(", ")}: puede ponerlo en la tarjeta. Categorías que hay: ${categorias.map((x) => x.nombre).join(", ")}.` : "");
    },
  },
  proponer_cambio_precio: {
    descripcion: "Prepara el cambio del precio de venta (con IVA) de un producto que ya existe. El usuario lo confirma en una tarjeta.",
    parametros: { producto_id: idProducto, precio_venta: { type: "NUMBER", description: "Nuevo precio de venta CON IVA" } },
    requeridos: ["producto_id", "precio_venta"],
    ejecutar: async (c, a, acciones) => {
      const p = await productoPorId(c, a.producto_id);
      if (!p) return noEncontrado(a.producto_id);
      const pvp = numero(a.precio_venta, 1e5);
      if (!pvp) return "Falta el precio nuevo (mayor que cero).";
      if (!añadir(acciones, { tipo: "precio", producto_id: p.id, nombre: p.nombre, antes: p.precio_venta, precio_venta: redondeo(pvp, 2) })) return DEMASIADAS;
      return `${PENDIENTE} Precio de ${p.nombre}: de ${p.precio_venta} € a ${redondeo(pvp, 2)} €.`
        + (p.coste_medio && pvp < p.coste_medio ? " OJO: es menor que lo que cuesta comprarlo; avísale." : "");
    },
  },
};

/** Busca productos por lo que se ha dicho: el nombre contiene el texto, o se
 *  parece (plurales, abreviaturas, palabras en otro orden). */
export function buscarParecidos<T extends { producto: string; categoria: string }>(todos: T[], dicho: unknown, max = 25) {
  const q = normalizar(dicho).trim();
  if (!q) return todos.slice(0, max);
  const clave = palabras(String(dicho));
  return todos
    .map((p) => {
      const n = normalizar(p.producto);
      const s = n.includes(q) ? 2 : normalizar(p.categoria).includes(q) ? 1.5 : clave.length ? parecido(String(dicho), p.producto) : 0;
      return { p, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, max)
    .map((x) => x.p);
}
