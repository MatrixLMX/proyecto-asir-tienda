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
      ${cambio ? `<tr><td>Entregado en efectivo</td><td class="d">${num(cambio.entregado)}</td></tr><tr><td>Cambio</td><td class="d">${num(cambio.cambio)}</td></tr>` : ""}</table>
    <hr><table class="iva"><tr><td>IVA</td><td>Base</td><td>Cuota</td><td>Total</td></tr>${desglose}</table>
    <hr><div class="c">IVA incluido · Gracias por su compra</div>
  </body></html>`;
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
