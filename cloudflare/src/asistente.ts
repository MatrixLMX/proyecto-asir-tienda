/** Asistente virtual. Hace lo mismo que el agente de LangGraph de la versión
 *  FastAPI, llamando directamente a Gemini: el modelo pide una herramienta, se
 *  ejecuta y se le devuelve el resultado, hasta que responde.
 *
 *  Las herramientas son consultas fijas (el modelo no escribe SQL) y solo leen.
 *  Un dependiente no recibe las de costes, y si las pidiera no se ejecutarían. */
import { Hono } from "hono";
import { type C, type Ctx, type Datos, cuerpo, fallo, filas, hoy, normalizar } from "./comun";

export const asistente = new Hono<Ctx>();

const MODELO = "gemini-flash-lite-latest";
const MAX_VUELTAS = 6;
const MAX_MENSAJES = 20;

type Propiedad = { type: "STRING" | "INTEGER"; description: string; enum?: string[] };
interface Herramienta {
  descripcion: string;
  parametros?: Record<string, Propiedad>;
  ejecutar: (c: C, a: Datos) => Promise<unknown[]>;
}

const dias = (defecto: number): Record<string, Propiedad> => ({ dias: { type: "INTEGER", description: `Días hacia atrás (por defecto ${defecto})` } });
const limitado = (v: unknown, defecto: number, max: number) => {
  const n = Math.trunc(Number(v ?? defecto));
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), max) : defecto;
};
const desde = "(SELECT date(hoy, '-' || ? || ' days') FROM v_ahora)";

const COMUNES: Record<string, Herramienta> = {
  buscar_productos: {
    descripcion: "Busca productos por nombre o categoría y devuelve precio de venta, stock y estado.",
    parametros: { texto: { type: "STRING", description: "Texto a buscar" } },
    ejecutar: async (c, a) => {
      const q = normalizar(a.texto);
      const todas = await filas<{ producto: string; categoria: string }>(c, `
        SELECT producto, categoria, unidad_medida, precio_venta, stock_actual, stock_minimo, estado FROM v_stock`);
      return todas.filter((p) => normalizar(p.producto).includes(q) || normalizar(p.categoria).includes(q)).slice(0, 25);
    },
  },
  productos_con_stock_bajo: {
    descripcion: "Productos agotados o por debajo del stock mínimo, con su proveedor y cantidad sugerida a pedir.",
    ejecutar: (c) => filas(c, "SELECT * FROM v_alertas_stock ORDER BY stock_actual"),
  },
  productos_que_caducan: {
    descripcion: "Lotes caducados o que caducan en los próximos días, con la cantidad que queda.",
    ejecutar: (c) => filas(c, "SELECT * FROM v_caducidades ORDER BY fecha_caducidad"),
  },
  ventas_de_hoy: {
    descripcion: "Número de tickets y total facturado hoy, ya descontadas las devoluciones.",
    ejecutar: (c) => filas(c, `SELECT num_ventas AS tickets, facturacion AS facturado FROM v_ventas_diarias
                                WHERE dia = (SELECT hoy FROM v_ahora)`),
  },
  productos_sin_vender: {
    descripcion: "Productos con stock que llevan al menos esos días sin venderse (género parado).",
    parametros: dias(30),
    ejecutar: (c, a) => filas(c, `
      SELECT producto, categoria, unidad_medida, stock_actual, ultima_venta, dias_sin_vender
        FROM v_productos_parados WHERE dias_sin_vender >= ? ORDER BY dias_sin_vender DESC LIMIT 30`, limitado(a.dias, 30, 3650)),
  },
  clientes_con_fiado: {
    descripcion: "Clientes que deben dinero (fiado) y cuánto debe cada uno.",
    ejecutar: (c) => filas(c, "SELECT nombre, deuda FROM v_clientes WHERE deuda <> 0 ORDER BY deuda DESC LIMIT 50"),
  },
  ofertas_activas: {
    descripcion: "Ofertas por cantidad activas: producto, a partir de cuántas unidades y a qué precio sale la unidad.",
    ejecutar: (c) => filas(c, "SELECT producto, unidad_medida, cantidad_minima, precio, precio_normal FROM v_ofertas WHERE activa ORDER BY producto"),
  },
  caja_por_forma_de_pago: {
    descripcion: "Tickets y total cobrado en efectivo, tarjeta y Bizum en cada uno de los últimos días, y si la caja de ese día se cerró y con qué diferencia (descuadre) de efectivo.",
    parametros: dias(7),
    ejecutar: (c, a) => filas(c, `
      SELECT d.*, x.efectivo_contado, x.diferencia AS descuadre_efectivo
        FROM v_caja_diaria d LEFT JOIN v_cierres_caja x ON x.fecha = d.dia
       WHERE d.dia >= ${desde} ORDER BY d.dia DESC`, limitado(a.dias, 7, 365)),
  },
};

const DE_ADMIN: Record<string, Herramienta> = {
  resumen_mensual: {
    descripcion: "Facturación, coste, beneficio real, pérdidas por mermas y margen de los últimos meses. Incluye la estimación antigua del 15 % para compararla con el beneficio real.",
    parametros: { meses: { type: "INTEGER", description: "Cuántos meses (por defecto 6)" } },
    ejecutar: (c, a) => filas(c, "SELECT * FROM v_beneficio_mensual ORDER BY mes DESC LIMIT ?", limitado(a.meses, 6, 60)),
  },
  beneficio_por_categoria: {
    descripcion: "Facturación, beneficio y margen de cada categoría (histórico completo).",
    ejecutar: (c) => filas(c, "SELECT * FROM v_beneficio_categoria ORDER BY beneficio DESC"),
  },
  ranking_productos: {
    descripcion: "Ranking de productos por beneficio total, porcentaje de margen o unidades vendidas.",
    parametros: {
      criterio: { type: "STRING", description: "Por qué ordenar", enum: ["beneficio", "margen", "unidades"] },
      orden: { type: "STRING", description: "Los mejores o los peores", enum: ["mejores", "peores"] },
      limite: { type: "INTEGER", description: "Cuántos (por defecto 10)" },
    },
    ejecutar: (c, a) => {
      const columna = { beneficio: "beneficio", margen: "margen_pct", unidades: "unidades_vendidas" }[String(a.criterio)] ?? "beneficio";
      const sentido = a.orden === "peores" ? "ASC" : "DESC";
      return filas(c, `SELECT * FROM v_beneficio_producto ORDER BY ${columna} ${sentido} LIMIT ?`, limitado(a.limite, 10, 50));
    },
  },
  beneficio_de_producto: {
    descripcion: "Ventas, coste, beneficio y margen de los productos cuyo nombre contiene el texto, junto con su precio de venta y coste medio actuales.",
    parametros: { texto: { type: "STRING", description: "Parte del nombre del producto" } },
    ejecutar: async (c, a) => {
      const q = normalizar(a.texto);
      const todos = await filas<{ nombre: string }>(c, `
        SELECT p.nombre, p.precio_venta_cent / 100.0 AS precio_venta, p.coste_medio_dm / 10000.0 AS coste_medio_sin_iva,
               b.unidades_vendidas, b.facturacion, b.beneficio, b.margen_pct
          FROM productos p LEFT JOIN v_beneficio_producto b ON b.producto_id = p.id`);
      return todos.filter((p) => normalizar(p.nombre).includes(q)).slice(0, 20);
    },
  },
  ventas_por_dia: {
    descripcion: "Tickets, facturación y ticket medio de cada uno de los últimos días.",
    parametros: dias(14),
    ejecutar: (c, a) => filas(c, `SELECT * FROM v_ventas_diarias WHERE dia >= ${desde} ORDER BY dia DESC`, limitado(a.dias, 14, 365)),
  },
  mermas_recientes: {
    descripcion: "Productos tirados (caducados, rotos...) en los últimos días y lo que han costado.",
    parametros: dias(30),
    ejecutar: (c, a) => filas(c, `
      SELECT m.fecha, p.nombre AS producto, m.cantidad_milli / 1000.0 AS cantidad, m.motivo,
             ROUND(m.cantidad_milli * m.coste_unitario_dm / 100000.0) / 100.0 AS perdida
        FROM mermas m JOIN productos p ON p.id = m.producto_id
       WHERE m.fecha >= ${desde} ORDER BY m.fecha DESC LIMIT 100`, limitado(a.dias, 30, 365)),
  },
  pedido_sugerido: {
    descripcion: "Qué pedir a cada proveedor (productos con stock bajo), cuánto y el coste estimado sin IVA.",
    ejecutar: (c) => filas(c, `
      SELECT COALESCE(a.proveedor, 'Sin proveedor') AS proveedor, a.producto, a.unidad_medida, a.stock_actual, a.cantidad_sugerida,
             ROUND(a.cantidad_sugerida * p.coste_medio_dm / 100.0) / 100.0 AS coste_estimado
        FROM v_alertas_stock a JOIN productos p ON p.id = a.id ORDER BY 1, a.producto`),
  },
  cambios_recientes: {
    descripcion: "Registro de auditoría: cambios de precio, ventas anuladas, compras borradas, mermas y cambios de usuarios en los últimos días, con quién lo hizo.",
    parametros: dias(7),
    ejecutar: (c, a) => filas(c, `
      SELECT fecha, usuario, accion, detalle FROM auditoria
       WHERE fecha >= ${desde} ORDER BY fecha DESC LIMIT 50`, limitado(a.dias, 7, 365)),
  },
};

function instrucciones(rol: string, dia: string) {
  const [a, m, d] = dia.split("-");
  const lineas = [
    "Eres el asistente de una pequeña tienda de alimentación de barrio en España.",
    `Hablas con ${rol === "admin" ? "el administrador (dueño del negocio)" : "un dependiente de la tienda"}. Hoy es ${d}/${m}/${a}.`,
    "",
    "- Responde en español, breve y claro, como hablarías con alguien de la familia que lleva la tienda. Usa euros con coma decimal (1,25 €) y kg cuando toque.",
    "- Usa siempre las herramientas para obtener datos; no inventes cifras, productos ni fechas. Si una herramienta no devuelve nada, dilo.",
    '- "Beneficio" es siempre el real: base imponible (precio sin IVA) menos coste de compra.',
    "- Cuando des recomendaciones (qué pedir, qué retirar, qué precio revisar), básalas en los datos y explica el porqué en una frase.",
  ];
  if (rol !== "admin") {
    lineas.push("- Esta persona tiene perfil de DEPENDIENTE: no tiene acceso a precios de compra, costes, márgenes ni beneficios. Si lo pide, explícale que eso solo lo ve el administrador.");
  }
  return lineas.join("\n");
}

// ---------------------------------------------------------------------
//  Llamada a Gemini
// ---------------------------------------------------------------------
type Parte = { text?: string; functionCall?: { name: string; args?: Datos }; functionResponse?: unknown; [k: string]: unknown };
type Mensaje = { role: "user" | "model"; parts: Parte[] };

class ErrorProveedor extends Error {
  constructor(readonly estado: number) { super(`Gemini respondió ${estado}`); }
}

async function llamar(c: C, cuerpoPeticion: unknown, reintentar = true): Promise<Parte[]> {
  const modelo = c.env.LLM_MODEL || MODELO;
  // La clave va en una cabecera, no en la URL, para que no acabe en ningún registro
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": c.env.GOOGLE_API_KEY! },
    body: JSON.stringify(cuerpoPeticion),
    signal: AbortSignal.timeout(25000),
  });
  if (!r.ok) {
    await r.body?.cancel();
    if (reintentar && (r.status === 429 || r.status >= 500)) {
      await new Promise((listo) => setTimeout(listo, 2000));
      return llamar(c, cuerpoPeticion, false);
    }
    throw new ErrorProveedor(r.status);
  }
  const j = await r.json<{ candidates?: { content?: { parts?: Parte[] } }[] }>();
  return j.candidates?.[0]?.content?.parts ?? [];
}

asistente.post("/asistente", async (c) => {
  if (!c.env.GOOGLE_API_KEY) throw fallo(503, "El asistente no está configurado (falta la clave del proveedor)");
  const d = await cuerpo(c);
  if (typeof d.mensaje !== "string" || !d.mensaje.trim() || d.mensaje.length > 2000) throw fallo(400, "Escribe un mensaje de hasta 2000 caracteres");
  const conversacion = typeof d.conversacion === "string" ? d.conversacion.slice(0, 64) : "principal";

  const u = c.get("u");
  const db = c.env.DB;
  const herramientas = u.rol === "admin" ? { ...COMUNES, ...DE_ADMIN } : COMUNES;
  const declaraciones = Object.entries(herramientas).map(([name, h]) => ({
    name, description: h.descripcion,
    ...(h.parametros ? { parameters: { type: "OBJECT", properties: h.parametros } } : {}),
  }));

  // El perfil va en la clave: quien deja de ser administrador no conserva lo que vio
  const clave = `${u.rol}:${u.usuario}:${conversacion}`;
  const guardada = await db.prepare("SELECT mensajes FROM conversaciones WHERE clave = ?").bind(clave).first<string>("mensajes");
  const historial: Mensaje[] = guardada ? JSON.parse(guardada) : [];
  const pregunta: Mensaje = { role: "user", parts: [{ text: d.mensaje }] };
  const contenidos: Mensaje[] = [...historial, pregunta];
  const dia = await hoy(c);

  let respuesta = "";
  try {
    for (let vuelta = 0; vuelta < MAX_VUELTAS && !respuesta; vuelta++) {
      const partes = await llamar(c, {
        systemInstruction: { parts: [{ text: instrucciones(u.rol, dia) }] },
        contents: contenidos,
        tools: [{ functionDeclarations: declaraciones }],
        generationConfig: { maxOutputTokens: 4000 },
      });
      const llamadas = partes.filter((p) => p.functionCall);
      if (!llamadas.length) {
        respuesta = partes.map((p) => p.text ?? "").join("").trim();
        if (!respuesta) throw new ErrorProveedor(502);
        break;
      }
      // Las partes del modelo se devuelven tal cual: pueden llevar firmas que Gemini exige
      contenidos.push({ role: "model", parts: partes });
      const resultados = await Promise.all(llamadas.map(async (p) => {
        const { name, args } = p.functionCall!;
        const h = Object.hasOwn(herramientas, name) ? herramientas[name] : undefined;
        const filasOk = h ? await h.ejecutar(c, args ?? {}) : null;
        const resultado = filasOk === null ? "Herramienta no disponible."
          : filasOk.length ? JSON.stringify(filasOk) : "Sin resultados.";
        return { functionResponse: { name, response: { resultado } } };
      }));
      contenidos.push({ role: "user", parts: resultados });
    }
  } catch (e) {
    if (e instanceof ErrorProveedor && e.estado === 429) {
      throw fallo(429, "Se ha superado el límite gratuito de preguntas por minuto. Espera un momento y vuelve a probar.");
    }
    console.error("asistente:", e instanceof ErrorProveedor ? e.message : String(e));
    throw fallo(503, "El asistente no está disponible ahora mismo (el proveedor no responde). Prueba de nuevo en un rato.");
  }
  if (!respuesta) throw fallo(503, "El asistente no ha podido responder a eso. Prueba a preguntarlo de otra forma.");

  // Se recuerdan las preguntas y respuestas; los datos se vuelven a consultar,
  // para no responder con cifras viejas.
  const nuevo = [...historial, pregunta, { role: "model", parts: [{ text: respuesta }] }].slice(-MAX_MENSAJES);
  await db.batch([
    db.prepare("INSERT OR REPLACE INTO conversaciones (clave, mensajes, actualizado) VALUES (?, ?, ?)").bind(clave, JSON.stringify(nuevo), dia),
    db.prepare("DELETE FROM conversaciones WHERE actualizado < date(?, '-7 days')").bind(dia),
  ]);
  return c.json({ respuesta });
});
