import { useState, type FormEvent } from "react";
import { BarChart3, CalendarClock, Eye, EyeOff, Loader2, Lock, Package, Store, User } from "lucide-react";
import { api, post, sesion, type Usuario } from "../api";
import { SelectorTema } from "../ui";

const VENTAJAS = [
  { icono: Package, texto: "Stock al día con cada venta y cada compra" },
  { icono: CalendarClock, texto: "Avisos de caducidad sin revisar producto a producto" },
  { icono: BarChart3, texto: "Beneficio real, no una estimación" },
];

export default function Login({ alEntrar, nombreTienda }: { alEntrar: (u: Usuario) => void; nombreTienda: string }) {
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [ver, setVer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const r = await post<{ token: string }>("/auth/login", { usuario: usuario.trim(), password });
      sesion.guardar(r.token);
      alEntrar(await api<Usuario>("/auth/yo"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Panel de marca (escritorio) */}
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-marca-600 via-marca-700 to-emerald-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -bottom-32 -left-16 size-96 rounded-full bg-emerald-300/10 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <div className="grid size-11 place-items-center rounded-2xl bg-white/15 backdrop-blur"><Store className="size-6" /></div>
          <span className="text-xl font-bold">{nombreTienda}</span>
        </div>
        <div className="relative">
          <h2 className="max-w-md text-4xl font-bold leading-tight tracking-tight">Toda la tienda, en orden y sin libreta.</h2>
          <ul className="mt-8 space-y-4">
            {VENTAJAS.map(({ icono: Icono, texto }) => (
              <li key={texto} className="flex items-center gap-3 text-white/85">
                <div className="grid size-9 place-items-center rounded-xl bg-white/10"><Icono className="size-[18px]" /></div>
                {texto}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white/50">Proyecto ASIR · Linmao Xia</p>
      </div>

      {/* Formulario */}
      <div className="relative flex items-center justify-center p-6">
        <div className="absolute right-4 top-4 w-44"><SelectorTema compacto /></div>
        <form onSubmit={entrar} className="animar-entrada w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="mb-4 grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-marca-500 to-marca-700 text-white shadow-lg shadow-marca-600/30">
              <Store className="size-6" />
            </div>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Bienvenido 👋</h1>
          <p className="mb-8 mt-1 text-sm text-suave">Inicia sesión con tu usuario de la tienda.</p>

          <label className="etiqueta" htmlFor="usuario">Usuario</label>
          <div className="relative mb-4">
            <User className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-tenue" />
            <input id="usuario" className="campo pl-10" value={usuario} onChange={(e) => setUsuario(e.target.value)} autoFocus autoComplete="username" autoCapitalize="none" />
          </div>

          <label className="etiqueta" htmlFor="password">Contraseña</label>
          <div className="relative mb-6">
            <Lock className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-tenue" />
            <input id="password" className="campo px-10" type={ver ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            <button type="button" onClick={() => setVer((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-tenue hover:text-texto" aria-label={ver ? "Ocultar contraseña" : "Mostrar contraseña"}>
              {ver ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>

          {error && <p className="mb-4 rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
          <button className="boton w-full py-3" disabled={enviando || !usuario || !password}>
            {enviando && <Loader2 className="size-4 animate-spin" />} Entrar
          </button>
        </form>
      </div>
    </div>
  );
}
