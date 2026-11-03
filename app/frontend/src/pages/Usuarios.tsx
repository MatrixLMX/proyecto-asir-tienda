import { useState, type FormEvent } from "react";
import { History, KeyRound, Pencil, UserPlus, Users } from "lucide-react";
import { fechaHora, patch, post, type Rol } from "../api";
import type { PropsPagina } from "../App";
import { Cabecera, Esqueleto, Insignia, Modal, Pestañas, Vacio, emitirCambio, useAviso, useDatos, type ColorInsignia } from "../ui";

interface UsuarioWeb { id: number; usuario: string; nombre: string; rol: Rol; activo: number; creado_en: string }
interface Cambio { id: number; fecha: string; usuario: string; accion: string; tabla: string; detalle: string | null }

const ACCIONES: Record<string, { texto: string; color: ColorInsignia }> = {
  anular_venta: { texto: "Venta anulada", color: "rojo" },
  borrar_compra: { texto: "Compra borrada", color: "rojo" },
  merma: { texto: "Merma", color: "ambar" },
  cambiar_precio: { texto: "Cambio de precio", color: "azul" },
  alta_producto: { texto: "Producto activado", color: "verde" },
  baja_producto: { texto: "Producto de baja", color: "gris" },
  crear_usuario: { texto: "Usuario creado", color: "verde" },
  modificar_usuario: { texto: "Usuario modificado", color: "azul" },
  "cambiar_contraseña": { texto: "Contraseña cambiada", color: "gris" },
};

export default function Usuarios({ usuario: yo }: PropsPagina) {
  const [vista, setVista] = useState<"usuarios" | "registro">("usuarios");
  return (
    <>
      <Cabecera titulo="Usuarios" subtitulo="Quién puede entrar en la web y registro de cambios importantes">
        <Pestañas valor={vista} alCambiar={setVista} opciones={[{ id: "usuarios", nombre: "Usuarios" }, { id: "registro", nombre: "Registro de cambios" }]} />
      </Cabecera>
      {vista === "usuarios" ? <ListaUsuarios yo={yo.usuario} /> : <Registro />}
    </>
  );
}

const vacio = { usuario: "", nombre: "", rol: "dependiente" as Rol, password: "" };

function ListaUsuarios({ yo }: { yo: string }) {
  const { datos } = useDatos<UsuarioWeb[]>("/usuarios");
  const avisar = useAviso();
  const [nuevo, setNuevo] = useState<typeof vacio | null>(null);
  const [editando, setEditando] = useState<(UsuarioWeb & { password: string }) | null>(null);

  async function ejecutar(accion: () => Promise<unknown>, ok: string) {
    try { await accion(); avisar("ok", ok); emitirCambio(); return true; } catch (e) { avisar("error", (e as Error).message); return false; }
  }

  async function crear(e: FormEvent) {
    e.preventDefault();
    if (nuevo && await ejecutar(() => post("/usuarios", nuevo), `Usuario ${nuevo.usuario} creado`)) setNuevo(null);
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!editando) return;
    const { id, nombre, rol, activo, password } = editando;
    const ok = await ejecutar(() => patch(`/usuarios/${id}`, { nombre, rol, activo: !!activo, ...(password ? { password } : {}) }),
      `${editando.usuario} actualizado${password ? " (contraseña nueva)" : ""}`);
    if (ok) setEditando(null);
  }

  const selectorRol = (valor: Rol, cambiar: (r: Rol) => void, bloqueado = false) => (
    <div className="grid grid-cols-2 gap-2">
      {(["dependiente", "admin"] as const).map((r) => (
        <button type="button" key={r} disabled={bloqueado} onClick={() => cambiar(r)}
          className={`rounded-xl border px-3 py-2.5 text-left text-sm disabled:opacity-50 ${valor === r ? "border-marca-500 bg-marca-suave text-marca-fuerte" : "border-borde text-suave"}`}>
          <b className="block">{r === "admin" ? "Administrador" : "Dependiente"}</b>
          <span className="text-xs">{r === "admin" ? "Todo, incluidos costes y beneficios" : "Vender, stock, caducidades y caja"}</span>
        </button>
      ))}
    </div>
  );

  return (
    <>
      <div className="mb-4 flex justify-end"><button className="boton" onClick={() => setNuevo({ ...vacio })}><UserPlus className="size-4" /> Nuevo usuario</button></div>
      <div className="tarjeta overflow-x-auto">
        {!datos ? <div className="p-5"><Esqueleto className="h-32" /></div> : (
          <table className="tabla w-full text-sm">
            <thead><tr><th>Nombre</th><th>Usuario</th><th>Perfil</th><th className="hidden sm:table-cell">Alta</th><th /></tr></thead>
            <tbody>
              {datos.map((u) => (
                <tr key={u.id} className={u.activo ? "" : "opacity-50"}>
                  <td className="font-medium">{u.nombre} {u.usuario === yo && <span className="text-xs text-tenue">(tú)</span>}</td>
                  <td className="text-suave">{u.usuario}</td>
                  <td><Insignia color={u.rol === "admin" ? "azul" : "gris"}>{u.rol}</Insignia> {!u.activo && <Insignia color="rojo">desactivado</Insignia>}</td>
                  <td className="hidden text-suave sm:table-cell">{fechaHora(u.creado_en)}</td>
                  <td className="text-right">
                    <button className="rounded-lg p-1.5 text-tenue hover:bg-superficie-2 hover:text-texto" aria-label={`Editar ${u.usuario}`} onClick={() => setEditando({ ...u, password: "" })}>
                      <Pencil className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-3 text-xs text-tenue">Los usuarios no se borran: se desactivan, para que sus ventas sigan teniendo nombre.</p>

      <Modal abierto={!!nuevo} alCerrar={() => setNuevo(null)} titulo="Nuevo usuario">
        {nuevo && (
          <form onSubmit={crear} className="space-y-4">
            <div><label className="etiqueta" htmlFor="n-nombre">Nombre</label><input id="n-nombre" className="campo" required autoFocus value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} placeholder="p. ej. María" /></div>
            <div><label className="etiqueta" htmlFor="n-usuario">Usuario para entrar</label><input id="n-usuario" className="campo" required minLength={3} pattern="[a-zA-Z0-9._\-]+" autoCapitalize="none" value={nuevo.usuario} onChange={(e) => setNuevo({ ...nuevo, usuario: e.target.value.toLowerCase() })} placeholder="sin espacios ni tildes" /></div>
            <div><label className="etiqueta" htmlFor="n-pass">Contraseña inicial</label><input id="n-pass" className="campo" type="password" required minLength={8} autoComplete="new-password" value={nuevo.password} onChange={(e) => setNuevo({ ...nuevo, password: e.target.value })} placeholder="mínimo 8 caracteres" /></div>
            {selectorRol(nuevo.rol, (rol) => setNuevo({ ...nuevo, rol }))}
            <div className="flex justify-end gap-2 pt-2"><button type="button" className="boton-sec" onClick={() => setNuevo(null)}>Cancelar</button><button className="boton">Crear</button></div>
          </form>
        )}
      </Modal>

      <Modal abierto={!!editando} alCerrar={() => setEditando(null)} titulo={editando ? `Editar ${editando.usuario}` : ""}>
        {editando && (
          <form onSubmit={guardar} className="space-y-4">
            <div><label className="etiqueta" htmlFor="e-nombre">Nombre</label><input id="e-nombre" className="campo" required value={editando.nombre} onChange={(e) => setEditando({ ...editando, nombre: e.target.value })} /></div>
            {selectorRol(editando.rol, (rol) => setEditando({ ...editando, rol }), editando.usuario === yo)}
            <div>
              <label className="etiqueta flex items-center gap-1.5" htmlFor="e-pass"><KeyRound className="size-3.5" /> Nueva contraseña (opcional)</label>
              <input id="e-pass" className="campo" type="password" minLength={8} autoComplete="new-password" value={editando.password} onChange={(e) => setEditando({ ...editando, password: e.target.value })} placeholder="déjalo vacío para no cambiarla" />
            </div>
            <label className={`flex items-center gap-3 text-sm ${editando.usuario === yo ? "opacity-50" : "cursor-pointer"}`}>
              <input type="checkbox" className="size-4 accent-emerald-600" disabled={editando.usuario === yo} checked={!!editando.activo} onChange={(e) => setEditando({ ...editando, activo: e.target.checked ? 1 : 0 })} />
              Puede entrar en la web
            </label>
            <div className="flex justify-end gap-2 pt-2"><button type="button" className="boton-sec" onClick={() => setEditando(null)}>Cancelar</button><button className="boton">Guardar</button></div>
          </form>
        )}
      </Modal>
    </>
  );
}

function Registro() {
  const { datos } = useDatos<Cambio[]>("/auditoria?limite=300");
  return (
    <div className="tarjeta">
      {!datos ? <div className="p-5"><Esqueleto className="h-40" /></div> : !datos.length ? (
        <Vacio icono={<History className="size-6" />} titulo="Sin cambios registrados" />
      ) : (
        <ul className="divide-y divide-borde">
          {datos.map((c) => {
            const a = ACCIONES[c.accion] ?? { texto: c.accion, color: "gris" as ColorInsignia };
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
                <Insignia color={a.color}>{a.texto}</Insignia>
                <span className="min-w-0 flex-1">{c.detalle}</span>
                <span className="flex items-center gap-1.5 text-xs text-tenue"><Users className="size-3.5" />{c.usuario.split("@")[0]} · {fechaHora(c.fecha)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
