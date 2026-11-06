import { NOMBRE_PAGO, api, euros, partesPago, type Venta } from "./api";

/** Datos de la tienda que salen en la web y en el ticket (vienen del .env del servidor). */
export interface DatosTienda { nombre: string; nif: string; direccion: string }
export const tienda: DatosTienda = { nombre: "Mi Tienda", nif: "", direccion: "" };

const escapar = (t: string) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const num = (n: number, dec = 2) => n.toLocaleString("es-ES", { minimumFractionDigits: dec, maximumFractionDigits: dec });

/** HTML del ticket para impresora térmica de 80 mm (también vale para PDF). */
function htmlTicket(v: Venta, cambio?: { entregado: number; cambio: number }) {
  const lineas = v.lineas ?? [];
  // Desglose de IVA: los precios ya lo llevan incluido
  const porIva = new Map<number, number>();
  lineas.forEach((l) => porIva.set(l.iva_porcentaje, (porIva.get(l.iva_porcentaje) ?? 0) + l.importe));
  const desglose = [...porIva].sort(([a], [b]) => a - b).map(([iva, total]) => {
    const base = total / (1 + iva / 100);
    return `<tr><td>${num(iva, 0)} %</td><td>${num(base)}</td><td>${num(total - base)}</td><td>${num(total)}</td></tr>`;
  }).join("");
  const filas = lineas.map((l) => `
    <tr><td colspan="2">${escapar(l.producto)}</td></tr>
    <tr class="det"><td>${l.unidad_medida === "kg" ? `${num(l.cantidad, 3)} kg` : num(l.cantidad, 0)} × ${num(l.precio_unitario)}</td><td class="d">${num(l.importe)}</td></tr>`).join("");
  const fecha = new Date(v.fecha).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
  const pagos = partesPago(v).map((p) => `<tr><td>${NOMBRE_PAGO[p.metodo]}</td><td class="d">${num(p.importe)}</td></tr>`).join("");

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Ticket ${v.id}</title><style>
    @page { size: 80mm auto; margin: 4mm; }
    body { font: 12px/1.35 ui-monospace, Menlo, Consolas, monospace; color: #000; width: 72mm; margin: 0 auto; }
    h1 { font-size: 16px; text-align: center; margin: 0 0 2px; }
    .c { text-align: center; } .d { text-align: right; } .det td { padding-bottom: 3px; }
    table { width: 100%; border-collapse: collapse; } hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
    .total { font-size: 16px; font-weight: bold; } .iva td { font-size: 10px; text-align: right; } .iva td:first-child { text-align: left; }
  </style></head><body>
    <h1>${escapar(tienda.nombre)}</h1>
    ${tienda.direccion ? `<div class="c">${escapar(tienda.direccion)}</div>` : ""}
    ${tienda.nif ? `<div class="c">NIF ${escapar(tienda.nif)}</div>` : ""}
    <hr><div>Factura simplificada nº ${v.id}</div><div>${fecha}</div><hr>
    <table>${filas}</table><hr>
    <table><tr class="total"><td>TOTAL</td><td class="d">${euros(v.total)}</td></tr>
      ${pagos}
      ${v.cliente ? `<tr><td>Cliente</td><td class="d">${escapar(v.cliente)}</td></tr>` : ""}
      ${v.devuelto ? `<tr><td>Devuelto</td><td class="d">${num(v.devuelto)}</td></tr>` : ""}
      ${cambio ? `<tr><td>Entregado en efectivo</td><td class="d">${num(cambio.entregado)}</td></tr><tr><td>Cambio</td><td class="d">${num(cambio.cambio)}</td></tr>` : ""}</table>
    <hr><table class="iva"><tr><td>IVA</td><td>Base</td><td>Cuota</td><td>Total</td></tr>${desglose}</table>
    <hr><div class="c">IVA incluido · Gracias por su compra</div>
  </body></html>`;
}

/** El ticket en texto, para mandarlo al móvil del cliente que lo pida. */
function textoTicket(v: Venta) {
  const lineas = (v.lineas ?? []).map((l) =>
    `${l.producto}\n  ${l.unidad_medida === "kg" ? `${num(l.cantidad, 3)} kg` : num(l.cantidad, 0)} x ${num(l.precio_unitario)} = ${num(l.importe)} €`);
  const fecha = new Date(v.fecha).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
  return [tienda.nombre, tienda.nif ? `NIF ${tienda.nif}` : "", `Ticket nº ${v.id} · ${fecha}`, "", ...lineas, "", `TOTAL ${euros(v.total)} (IVA incluido)`,
    ...(v.devuelto ? [`Devuelto ${euros(v.devuelto)}`] : []),
    ...partesPago(v).map((p) => `${NOMBRE_PAGO[p.metodo]}: ${euros(p.importe)}`)].filter((l, i) => l || i > 1).join("\n");
}

/** Comparte el ticket (WhatsApp, correo...). Sin esa opción en el navegador, lo copia.
 *  Devuelve qué ha hecho, para avisarlo. */
export async function compartirTicket(ventaId: number): Promise<"compartido" | "copiado"> {
  const texto = textoTicket(await api<Venta>(`/ventas/${ventaId}`));
  if (navigator.share) {
    try {
      await navigator.share({ title: `Ticket nº ${ventaId}`, text: texto });
      return "compartido";
    } catch (e) {
      if ((e as Error).name === "AbortError") return "compartido";
    }
  }
  await navigator.clipboard.writeText(texto);
  return "copiado";
}

/** Imprime un ticket sin abrir ventanas nuevas (iframe oculto). */
export async function imprimirTicket(ventaId: number, cambio?: { entregado: number; cambio: number }) {
  const venta = await api<Venta>(`/ventas/${ventaId}`);
  const marco = document.createElement("iframe");
  marco.style.cssText = "position:fixed;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(marco);
  const doc = marco.contentDocument!;
  doc.open();
  doc.write(htmlTicket(venta, cambio));
  doc.close();
  marco.contentWindow!.focus();
  marco.contentWindow!.print();
  setTimeout(() => marco.remove(), 1000);
}
