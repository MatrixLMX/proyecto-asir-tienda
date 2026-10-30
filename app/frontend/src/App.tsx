import { useEffect, useState, type ComponentType } from "react";
import {
  BarChart3, CalendarClock, LayoutDashboard, LogOut, Menu, Package, ShoppingCart, Store, Tags, Truck, X,
} from "lucide-react";
import { api, sesion, type Usuario } from "./api";
import Asistente from "./Asistente";
import Login from "./pages/Login";
import Inicio from "./pages/Inicio";
import Vender from "./pages/Vender";
import Stock from "./pages/Stock";
import Caducidades from "./pages/Caducidades";
import Compras from "./pages/Compras";
import Catalogo from "./pages/Catalogo";
import Informes from "./pages/Informes";

interface Seccion {
  id: string;
  nombre: string;
  icono: ComponentType<{ className?: string }>;
  pagina: ComponentType<{ usuario: Usuario }>;
  soloAdmin?: boolean;
}

const SECCIONES: Seccion[] = [
  { id: "inicio", nombre: "Inicio", icono: LayoutDashboard, pagina: Inicio },
  { id: "vender", nombre: "Vender", icono: ShoppingCart, pagina: Vender },
  { id: "stock", nombre: "Stock", icono: Package, pagina: Stock },
  { id: "caducidades", nombre: "Caducidades", icono: CalendarClock, pagina: Caducidades },
  { id: "compras", nombre: "Compras", icono: Truck, pagina: Compras, soloAdmin: true },
  { id: "catalogo", nombre: "Catálogo", icono: Tags, pagina: Catalogo, soloAdmin: true },
  { id: "informes", nombre: "Beneficios", icono: BarChart3, pagina: Informes, soloAdmin: true },
];

export default function App() {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(!!sesion.token());
  const [actual, setActual] = useState("inicio");
  const [menuMovil, setMenuMovil] = useState(false);

  useEffect(() => {
    if (!sesion.token()) return;
    api<Usuario>("/auth/yo").then(setUsuario).catch(() => sesion.cerrar()).finally(() => setCargando(false));
  }, []);

  if (cargando) return null;
  if (!usuario) return <Login alEntrar={(u) => setUsuario(u)} />;

  const visibles = SECCIONES.filter((s) => !s.soloAdmin || usuario.rol === "admin");
  const Pagina = (visibles.find((s) => s.id === actual) ?? visibles[0]).pagina;

  const navegacion = (
    <nav className="flex flex-1 flex-col gap-1">
      {visibles.map(({ id, nombre, icono: Icono }) => (
        <button
          key={id}
          onClick={() => { setActual(id); setMenuMovil(false); }}
          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
            actual === id ? "bg-marca-600 text-white shadow-sm" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          <Icono className="size-4.5" />
          {nombre}
        </button>
      ))}
    </nav>
  );

  const pie = (
    <div className="mt-6 flex items-center gap-3 rounded-xl bg-slate-100 p-3">
      <div className="grid size-9 place-items-center rounded-full bg-marca-600 text-sm font-semibold text-white">
        {usuario.nombre[0]}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{usuario.nombre}</p>
        <p className="text-xs capitalize text-slate-500">{usuario.rol}</p>
      </div>
      <button title="Cerrar sesión" onClick={() => { sesion.cerrar(); setUsuario(null); }} className="text-slate-400 hover:text-slate-700">
        <LogOut className="size-4.5" />
      </button>
    </div>
  );

  const logo = (
    <div className="mb-8 flex items-center gap-2.5 px-2">
      <div className="grid size-9 place-items-center rounded-xl bg-marca-600 text-white"><Store className="size-5" /></div>
      <span className="text-lg font-bold tracking-tight">Mi Tienda</span>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      {/* Barra lateral (escritorio) */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white p-4 lg:flex">
        {logo}
        {navegacion}
        {pie}
      </aside>

      {/* Barra superior (móvil) */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2 font-bold"><Store className="size-5 text-marca-600" /> Mi Tienda</div>
        <button onClick={() => setMenuMovil(true)}><Menu className="size-6" /></button>
      </header>
      {menuMovil && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setMenuMovil(false)}>
          <aside className="flex h-full w-72 flex-col bg-white p-4" onClick={(e) => e.stopPropagation()}>
            <button className="mb-4 self-end" onClick={() => setMenuMovil(false)}><X className="size-5" /></button>
            {logo}
            {navegacion}
            {pie}
          </aside>
        </div>
      )}

      <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-8">
        <Pagina usuario={usuario} />
      </main>

      <Asistente disponible={!!usuario.asistente} rol={usuario.rol} />
    </div>
  );
}
