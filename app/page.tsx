'use client';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, cuandoSeCierreSesion, entrar, ErrorApi, leerSesion, salir, type Sesion } from '@/lib/api';
import type { Catalogos } from '@/lib/tipos';
import { AppCtx, Cargando, ErrorCaja } from '@/components/ui';
import { Gasto, PagoProfe, RegistrarPago, Traslado } from '@/components/registrar';
import { Tienda } from '@/components/tienda';
import { Uniformes } from '@/components/uniformes';
import { Cuentas, Ficha, Historial, Hoy, ReporteProfes, ReporteTienda, Saldos } from '@/components/consultas';

const base = process.env.NEXT_PUBLIC_BASE_PATH || '';

const VISTAS: Record<string, () => ReactNode> = {
  pago: () => <RegistrarPago />,
  tienda: () => <Tienda />,
  uniformes: () => <Uniformes />,
  profe: () => <PagoProfe />,
  gasto: () => <Gasto />,
  traslado: () => <Traslado />,
  hoy: () => <Hoy />,
  saldos: () => <Saldos />,
  reporteTienda: () => <ReporteTienda />,
  ficha: () => <Ficha />,
  cuentas: () => <Cuentas />,
  reporteProfes: () => <ReporteProfes />,
  historial: () => <Historial />,
};

function leerHash() {
  const h = typeof window === 'undefined' ? '' : window.location.hash.replace(/^#\/?/, '');
  const [vista, qs] = h.split('?');
  const params: Record<string, string> = {};
  new URLSearchParams(qs || '').forEach((v, k) => (params[k] = v));
  return { vista: vista || 'inicio', params };
}

export default function Pagina() {
  const [sesion, setSesion] = useState<Sesion | null>(null);
  const [listo, setListo] = useState(false);
  useEffect(() => {
    setSesion(leerSesion());
    setListo(true);
    cuandoSeCierreSesion(() => setSesion(null));
  }, []);
  if (!listo) return null;
  if (!sesion) return <Login onEntrar={setSesion} />;
  return <App sesion={sesion} onSalir={async () => { await salir(); setSesion(null); }} />;
}

function Login({ onEntrar }: { onEntrar: (s: Sesion) => void }) {
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setOcupado(true); setError('');
    try { onEntrar(await entrar(usuario.trim(), clave)); }
    catch (x) { setError(x instanceof ErrorApi ? x.message : 'No se pudo entrar'); }
    finally { setOcupado(false); }
  };
  return (
    <div className="login">
      <form className="caja" onSubmit={enviar}>
        <img src={base + '/logo.png'} alt="" />
        <h1>Registros Vox</h1>
        <p>Vox Corpus Danza</p>
        <div className="campo" style={{ marginBottom: 10 }}><label htmlFor="u">Usuario</label>
          <input id="u" autoComplete="username" autoCapitalize="none" value={usuario} onChange={e => setUsuario(e.target.value)} /></div>
        <div className="campo"><label htmlFor="c">Clave</label>
          <input id="c" type="password" autoComplete="current-password" value={clave} onChange={e => setClave(e.target.value)} /></div>
        {error && <div className="aviso error">{error}</div>}
        <button className="btn" disabled={!usuario || !clave || ocupado}>{ocupado ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  );
}

function App({ sesion, onSalir }: { sesion: Sesion; onSalir: () => void }) {
  const [cat, setCat] = useState<Catalogos | null>(null);
  const [errorCat, setErrorCat] = useState('');
  const [ruta, setRuta] = useState(leerHash);
  const [toast, setToast] = useState<{ msg: string; tipo: 'ok' | 'error' } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recargarCat = useCallback(async () => {
    try { setCat(await api<Catalogos>('catalogos')); setErrorCat(''); }
    catch (e) { setErrorCat(e instanceof ErrorApi ? e.message : 'No se pudieron cargar las listas'); }
  }, []);
  useEffect(() => { recargarCat(); }, [recargarCat]);

  useEffect(() => {
    const f = () => { setRuta(leerHash()); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);

  const ir = useCallback((vista: string, params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    window.location.hash = vista === 'inicio' ? '' : `/${vista}${qs}`;
  }, []);
  const aviso = useCallback((msg: string, tipo: 'ok' | 'error' = 'ok') => {
    setToast({ msg, tipo });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), tipo === 'error' ? 6000 : 3500);
  }, []);

  return (
    <>
      <header className="encabezado">
        <div className="encabezado-in">
          <button className="marca" onClick={() => ir('inicio')}>
            <img src={base + '/logo.png'} alt="" />
            <span>Registros Vox<small>Vox Corpus Danza</small></span>
          </button>
          <span className="espacio" />
          <span className="usuario">{sesion.nombre}</span>
          <button className="salir" onClick={onSalir}>Salir</button>
        </div>
      </header>
      <main className="contenedor">
        {errorCat && <ErrorCaja msg={errorCat} reintentar={recargarCat} />}
        {!cat && !errorCat && <Cargando texto="Cargando listas…" />}
        {cat && (
          <AppCtx.Provider value={{ cat, recargarCat, aviso, ir, params: ruta.params }}>
            {VISTAS[ruta.vista] ? <div key={ruta.vista}>{VISTAS[ruta.vista]()}</div> : <Inicio nombre={sesion.nombre} ir={ir} />}
          </AppCtx.Provider>
        )}
      </main>
      {toast && <div className={'toast' + (toast.tipo === 'error' ? ' error' : '')} role="status" onClick={() => setToast(null)}>{toast.msg}</div>}
    </>
  );
}

const REGISTRAR = [
  { v: 'pago', i: '💰', t: 'Registrar pago', s: 'Mensualidad, vestuario, matrícula…', principal: true },
  { v: 'tienda', i: '🍬', t: 'Tienda', s: 'Venta, fiado o consumo', principal: true },
  { v: 'uniformes', i: '👕', t: 'Uniformes', s: 'Pedidos y entregas' },
  { v: 'profe', i: '🧑‍🏫', t: 'Pago a profe', s: 'Clases del periodo' },
  { v: 'gasto', i: '🧾', t: 'Gasto', s: 'Compras y pagos' },
  { v: 'traslado', i: '🔁', t: 'Traslado', s: 'Entre cuentas o a caja' },
];
const CONSULTAR = [
  { v: 'hoy', i: '📅', t: 'Resumen del día', s: 'Lo que entró y salió' },
  { v: 'saldos', i: '📋', t: 'Saldos y cargos', s: 'Quién debe qué' },
  { v: 'reporteTienda', i: '📈', t: 'Ventas tienda', s: 'Por día y producto' },
  { v: 'ficha', i: '👤', t: 'Ficha de estudiante', s: 'Todo de una persona' },
  { v: 'cuentas', i: '🏦', t: 'Cuentas', s: 'Movimientos por cuenta' },
  { v: 'reporteProfes', i: '🗓️', t: 'Pagos a profes', s: 'Por profe y periodo' },
  { v: 'historial', i: '🗂️', t: 'Historial', s: 'Buscar y anular' },
];

function Inicio({ nombre, ir }: { nombre: string; ir: (v: string) => void }) {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', hour: 'numeric', hour12: false }).format(new Date()));
  const saludo = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
  const Baldosa = (b: (typeof REGISTRAR)[number]) => (
    <button key={b.v} className={'baldosa' + (b.principal ? ' principal' : '')} onClick={() => ir(b.v)}>
      <span className="icono" aria-hidden>{b.i}</span><b>{b.t}</b><span>{b.s}</span>
    </button>
  );
  return (
    <div>
      <div className="saludo"><h1>{saludo}, {nombre}</h1><p>¿Qué vas a registrar?</p></div>
      <div className="grupo-titulo">Registrar</div>
      <div className="mosaico">{REGISTRAR.map(Baldosa)}</div>
      <div className="grupo-titulo">Consultar</div>
      <div className="mosaico">{CONSULTAR.map(b => Baldosa({ ...b, principal: false }))}</div>
    </div>
  );
}
