import { useEffect, useState, type ComponentType } from "react";
import {
  BarChart3, CalendarClock, LayoutDashboard, LogOut, MoreHorizontal, Package, ShoppingCart, Store, Tags, Truck, X,
} from "lucide-react";
import { api, sesion, type AlertaStock, type Caducidad, type Usuario } from "./api";
import Asistente from "./Asistente";
import { ProveedorAvisos, SelectorTema, useDatos } from "./ui";
import Login from "./pages/Login";
import Inicio from "./pages/Inicio";
import Vender from "./pages/Vender";
import Stock from "./pages/Stock";
import Caducidades from "./pages/Caducidades";
import Compras from "./pages/Compras";
import Catalogo from "./pages/Catalogo";
import Informes from "./pages/Informes";

export interface PropsPagina { usuario: Usuario; ir: (seccion: string) => void }

interface Seccion {
  id: string;
  nombre: string;
  icono: ComponentType<{ className?: string }>;
  pagina: ComponentType<PropsPagina>;
  soloAdmin?: boolean;
  movil?: boolean; // aparece en la barra inferior del móvil
}

const SECCIONES: Seccion[] = [
  { id: "inicio", nombre: "Inicio", icono: LayoutDashboard, pagina: Inicio, movil: true },
  { id: "vender", nombre: "Vender", icono: ShoppingCart, pagina: Vender, movil: true },
  { id: "stock", nombre: "Stock", icono: Package, pagina: Stock, movil: true },
  { id: "caducidades", nombre: "Caducidades", icono: CalendarClock, pagina: Caducidades, movil: true },
  { id: "compras", nombre: "Compras", icono: Truck, pagina: Compras, soloAdmin: true },
  { id: "catalogo", nombre: "Catálogo", icono: Tags, pagina: Catalogo, soloAdmin: true },
  { id: "informes", nombre: "Beneficios", icono: BarChart3, pagina: Informes, soloAdmin: true },
];

const leerSeccion = () => window.location.hash.slice(1) || "inicio";

export default function App() {
  return (
    <ProveedorAvisos>
      <Aplicacion />
    </ProveedorAvisos>
  );
}

function Aplicacion() {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(!!sesion.token());

  useEffect(() => {
    if (!sesion.token()) return;
    api<Usuario>("/auth/yo").then(setUsuario).catch(() => sesion.cerrar()).finally(() => setCargando(false));
  }, []);

  if (cargando) return <div className="grid min-h-screen place-items-center"><Store className="size-8 animate-pulse text-marca-500" /></div>;
  if (!usuario) return <Login alEntrar={setUsuario} />;
  return <Panel usuario={usuario} alSalir={() => { sesion.cerrar(); setUsuario(null); }} />;
}

function Panel({ usuario, alSalir }: { usuario: Usuario; alSalir: () => void }) {
  const [actual, setActual] = useState(leerSeccion);
  const [masAbierto, setMasAbierto] = useState(false);
  const caducidades = useDatos<Caducidad[]>("/alertas/caducidades");
  const stockBajo = useDatos<AlertaStock[]>("/alertas/stock");

  // La sección va en la URL (#vender) para que funcionen atrás/adelante
  useEffect(() => {
    const alCambiar = () => setActual(leerSeccion());
    window.addEventListener("hashchange", alCambiar);
    return () => window.removeEventListener("hashchange", alCambiar);
  }, []);
  const ir = (id: string) => { window.location.hash = id; setMasAbierto(false); window.scrollTo({ top: 0 }); };

  const visibles = SECCIONES.filter((s) => !s.soloAdmin || usuario.rol === "admin");
  const seccion = visibles.find((s) => s.id === actual) ?? visibles[0];
  const Pagina = seccion.pagina;

  const avisos: Record<string, number> = {
    caducidades: caducidades.datos?.length ?? 0,
    stock: stockBajo.datos?.length ?? 0,
  };

  const Contador = ({ id, activo }: { id: string; activo: boolean }) =>
    avisos[id] ? (
      <span className={`ml-auto min-w-5 rounded-full px-1.5 text-center text-xs font-semibold ${
        activo ? "bg-white/25 text-white" : id === "caducidades" ? "bg-rose-500 text-white" : "bg-amber-400 text-amber-950"
      }`}>
        {avisos[id]}
      </span>
    ) : null;

  const navegacion = (
    <nav className="flex flex-1 flex-col gap-1" aria-label="Secciones">
      {visibles.map(({ id, nombre, icono: Icono }, i) => (
        <div key={id}>
          {i === 4 && <p className="mb-1 mt-5 px-3 text-[11px] font-semibold uppercase tracking-wider text-tenue">Administración</p>}
          <button
            onClick={() => ir(id)}
            aria-current={seccion.id === id ? "page" : undefined}
            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
              seccion.id === id ? "bg-marca-600 text-white shadow-sm shadow-marca-600/25" : "text-suave hover:bg-superficie-2 hover:text-texto"
            }`}
          >
            <Icono className="size-[18px]" />
            {nombre}
            <Contador id={id} activo={seccion.id === id} />
          </button>
        </div>
      ))}
    </nav>
  );

  const perfil = (
    <div className="space-y-3">
      <SelectorTema />
      <div className="flex items-center gap-3 rounded-xl bg-superficie-2 p-3">
        <div className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-marca-500 to-marca-700 text-sm font-semibold text-white">
          {usuario.nombre[0]}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{usuario.nombre}</p>
          <p className="text-xs capitalize text-tenue">{usuario.rol}</p>
        </div>
        <button title="Cerrar sesión" aria-label="Cerrar sesión" onClick={alSalir} className="rounded-lg p-1.5 text-tenue hover:bg-superficie hover:text-rose-500">
          <LogOut className="size-[18px]" />
        </button>
      </div>
    </div>
  );

  const logo = (
    <div className="mb-8 flex items-center gap-2.5 px-2">
      <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-marca-500 to-marca-700 text-white shadow-md shadow-marca-600/30">
        <Store className="size-5" />
      </div>
      <div>
        <p className="text-base font-bold leading-tight tracking-tight">Mi Tienda</p>
        <p className="text-xs text-tenue">Gestión</p>
      </div>
    </div>
  );

  const enBarraMovil = visibles.filter((s) => s.movil);

  return (
    <div className="min-h-screen lg:flex">
      {/* Barra lateral (escritorio) */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-borde bg-superficie p-4 lg:flex">
        {logo}
        {navegacion}
        {perfil}
      </aside>

      {/* Cabecera (móvil) */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-borde bg-superficie/85 px-4 py-3 backdrop-blur-lg lg:hidden">
        <div className="flex items-center gap-2 font-bold"><Store className="size-5 text-marca-500" /> Mi Tienda</div>
        <SelectorTema compacto />
      </header>

      <main key={seccion.id} className="animar-entrada mx-auto w-full max-w-7xl flex-1 p-4 pb-28 sm:p-8 lg:pb-8">
        <Pagina usuario={usuario} ir={ir} />
      </main>

      {/* Barra inferior (móvil) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-borde bg-superficie/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg lg:hidden" aria-label="Secciones">
        {enBarraMovil.map(({ id, nombre, icono: Icono }) => (
          <button key={id} onClick={() => ir(id)} className={`relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${seccion.id === id ? "text-marca-fuerte" : "text-tenue"}`}>
            <Icono className="size-5" />
            {nombre}
            {avisos[id] ? <span className="absolute right-[22%] top-1.5 size-2 rounded-full bg-rose-500" /> : null}
          </button>
        ))}
        <button onClick={() => setMasAbierto(true)} className={`flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium ${!seccion.movil ? "text-marca-fuerte" : "text-tenue"}`}>
          <MoreHorizontal className="size-5" /> Más
        </button>
      </nav>

      {masAbierto && (
        <div className="fixed inset-0 z-40 bg-slate-950/50 backdrop-blur-sm lg:hidden" onClick={() => setMasAbierto(false)}>
          <div className="animar-modal absolute inset-x-0 bottom-0 rounded-t-3xl border-t border-borde bg-superficie p-5 pb-8" onClick={(e) => e.stopPropagation()}>
            <div className="mb-4 flex items-center justify-between">
              <p className="font-semibold">Menú</p>
              <button onClick={() => setMasAbierto(false)} aria-label="Cerrar"><X className="size-5 text-tenue" /></button>
            </div>
            <div className="mb-5 grid grid-cols-3 gap-2">
              {visibles.filter((s) => !s.movil).map(({ id, nombre, icono: Icono }) => (
                <button key={id} onClick={() => ir(id)} className={`flex flex-col items-center gap-2 rounded-2xl border p-4 text-xs font-medium ${seccion.id === id ? "border-marca-500 bg-marca-suave text-marca-fuerte" : "border-borde text-suave"}`}>
                  <Icono className="size-5" /> {nombre}
                </button>
              ))}
            </div>
            {perfil}
          </div>
        </div>
      )}

      <Asistente disponible={!!usuario.asistente} rol={usuario.rol} />
    </div>
  );
}
