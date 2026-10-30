import { useState, type FormEvent } from "react";
import { Loader2, Store } from "lucide-react";
import { api, post, sesion, type Usuario } from "../api";

export default function Login({ alEntrar }: { alEntrar: (u: Usuario) => void }) {
  const [usuario, setUsuario] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const r = await post<{ token: string }>("/auth/login", { usuario, password });
      sesion.guardar(r.token);
      alEntrar(await api<Usuario>("/auth/yo"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-gradient-to-br from-marca-50 via-white to-slate-100 p-4">
      <form onSubmit={entrar} className="tarjeta w-full max-w-sm p-8">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-marca-600 text-white shadow-lg shadow-marca-600/30">
            <Store className="size-7" />
          </div>
          <h1 className="text-xl font-bold">Gestión de la tienda</h1>
          <p className="mt-1 text-sm text-slate-500">Inicia sesión para continuar</p>
        </div>
        <label className="etiqueta">Usuario</label>
        <input className="campo mb-4" value={usuario} onChange={(e) => setUsuario(e.target.value)} autoFocus autoComplete="username" />
        <label className="etiqueta">Contraseña</label>
        <input className="campo mb-6" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}
        <button className="boton w-full" disabled={enviando || !usuario || !password}>
          {enviando && <Loader2 className="size-4 animate-spin" />} Entrar
        </button>
      </form>
    </div>
  );
}
