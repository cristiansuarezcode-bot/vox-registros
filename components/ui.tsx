'use client';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Catalogos, Quien } from '@/lib/tipos';
import { api, ErrorApi } from '@/lib/api';
import { norm, pesos, aNumero } from '@/lib/util';

// ------------------------------------------------------------------ contexto de la app
export type Ctx = {
  cat: Catalogos;
  recargarCat: () => Promise<void>;
  aviso: (msg: string, tipo?: 'ok' | 'error') => void;
  ir: (vista: string, params?: Record<string, string>) => void;
  params: Record<string, string>;
};
export const AppCtx = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(AppCtx);
  if (!c) throw new Error('Sin contexto');
  return c;
};

/** Ejecuta una acción del backend mostrando errores; devuelve null si falló. */
export function useAccion() {
  const { aviso } = useApp();
  const [ocupado, setOcupado] = useState(false);
  const correr = async <T,>(accion: string, datos: Record<string, unknown>, okMsg?: string): Promise<T | null> => {
    setOcupado(true);
    try {
      const r = await api<T>(accion, datos);
      if (okMsg) aviso(okMsg);
      return r;
    } catch (e) {
      aviso(e instanceof ErrorApi ? e.message : 'Algo falló. Intenta de nuevo.', 'error');
      return null;
    } finally {
      setOcupado(false);
    }
  };
  return { ocupado, correr };
}

/** Carga datos del backend cuando cambian las dependencias. */
export function useDatos<T>(accion: string, datos: Record<string, unknown>, deps: unknown[]) {
  const [d, setD] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);
  const [n, setN] = useState(0);
  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setError('');
    api<T>(accion, datos)
      .then(r => vivo && setD(r))
      .catch(e => vivo && setError(e instanceof ErrorApi ? e.message : 'No se pudo cargar'))
      .finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { d, error, cargando, recargar: () => setN(x => x + 1) };
}

// ------------------------------------------------------------------ piezas
export function Pantalla({ titulo, sub, children }: { titulo: string; sub?: string; children: ReactNode }) {
  const { ir } = useApp();
  return (
    <div>
      <button className="volver" onClick={() => ir('inicio')}>← Inicio</button>
      <div className="titulo-pantalla"><h2>{titulo}</h2>{sub && <p>{sub}</p>}</div>
      {children}
    </div>
  );
}

export function Campo({ label, ayuda, children, ancho }: { label: string; ayuda?: string; children: ReactNode; ancho?: boolean }) {
  return (
    <div className="campo" style={ancho ? { gridColumn: '1 / -1' } : undefined}>
      <label>{label}</label>
      {children}
      {ayuda && <span className="ayuda">{ayuda}</span>}
    </div>
  );
}

export function Monto({ valor, onChange, placeholder, autoFocus }: { valor: number; onChange: (n: number) => void; placeholder?: string; autoFocus?: boolean }) {
  return (
    <input
      className="monto" inputMode="numeric" autoFocus={autoFocus}
      placeholder={placeholder || '$ 0'}
      value={valor ? '$ ' + valor.toLocaleString('es-CO') : ''}
      onChange={e => onChange(aNumero(e.target.value))}
    />
  );
}

export function Segmentado<T extends string>({ opciones, valor, onChange }: { opciones: readonly T[] | T[]; valor: T | ''; onChange: (v: T) => void }) {
  return (
    <div className="segmentado" role="radiogroup">
      {opciones.map(o => (
        <button type="button" key={o} role="radio" aria-checked={valor === o} className={valor === o ? 'activo' : ''} onClick={() => onChange(o)}>{o}</button>
      ))}
    </div>
  );
}

export function Selector({ valor, onChange, opciones, vacio }: { valor: string; onChange: (v: string) => void; opciones: (string | { v: string; t: string })[]; vacio?: string }) {
  return (
    <select value={valor} onChange={e => onChange(e.target.value)}>
      {vacio !== undefined && <option value="">{vacio}</option>}
      {opciones.map(o => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.v} value={o.v}>{o.t}</option>)}
    </select>
  );
}

export function Estado({ saldo }: { saldo: number }) {
  if (saldo > 0) return <span className="chip debe">Debe {pesos(saldo)}</span>;
  if (saldo < 0) return <span className="chip favor">A favor {pesos(-saldo)}</span>;
  return <span className="chip ok">Al día</span>;
}

export function Cargando({ texto }: { texto?: string }) {
  return <div className="cargando">{texto || 'Cargando…'}</div>;
}

export function ErrorCaja({ msg, reintentar }: { msg: string; reintentar?: () => void }) {
  return (
    <div className="aviso error">
      {msg} {reintentar && <button className="enlace" onClick={reintentar}>Reintentar</button>}
    </div>
  );
}

export function Modal({ titulo, children, onCerrar }: { titulo: string; children: ReactNode; onCerrar: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onCerrar]);
  return (
    <div className="velo" onClick={onCerrar}>
      <div className="modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <h3>{titulo}</h3>
        {children}
      </div>
    </div>
  );
}

/** Anular cualquier registro con motivo obligatorio. */
export function BotonAnular({ hoja, id, onListo, etiqueta }: { hoja: string; id: string; onListo: () => void; etiqueta?: string }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState('');
  const { ocupado, correr } = useAccion();
  const { aviso } = useApp();
  const enviar = async () => {
    const r = await correr<{ avisos: string[] }>('anular', { hoja, id, motivo });
    if (r) {
      setAbierto(false);
      setMotivo('');
      aviso(r.avisos?.length ? 'Anulado. ' + r.avisos.join(' ') : 'Registro anulado');
      onListo();
    }
  };
  return (
    <>
      <button className="btn secundario chico" onClick={() => setAbierto(true)}>{etiqueta || 'Anular'}</button>
      {abierto && (
        <Modal titulo={`Anular ${id}`} onCerrar={() => setAbierto(false)}>
          <p className="suave mt0" style={{ fontSize: 14 }}>El registro no se borra: queda marcado como anulado, con tu nombre, la hora y el motivo.</p>
          <Campo label="¿Por qué se anula?">
            <textarea autoFocus value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ej: se registró dos veces" />
          </Campo>
          <div className="acciones">
            <button className="btn peligro" disabled={ocupado || motivo.trim().length < 5} onClick={enviar}>{ocupado ? 'Anulando…' : 'Anular'}</button>
            <button className="btn secundario" onClick={() => setAbierto(false)}>Cancelar</button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ------------------------------------------------------------------ buscador de estudiantes
export function BuscarQuien({ valor, onChange, permitirPersona = true, etiqueta = 'Estudiante' }: {
  valor: Quien; onChange: (q: Quien) => void; permitirPersona?: boolean; etiqueta?: string;
}) {
  const { cat, recargarCat } = useApp();
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [marcado, setMarcado] = useState(0);
  const [modoPersona, setModoPersona] = useState(false);
  const [creando, setCreando] = useState(false);
  const { ocupado, correr } = useAccion();
  const ref = useRef<HTMLDivElement>(null);

  const resultados = useMemo(() => {
    const t = norm(texto);
    if (!t) return [];
    const partes = t.split(' ');
    return cat.estudiantes.filter(e => { const n = norm(e.nombre); return partes.every(p => n.includes(p)); }).slice(0, 8);
  }, [texto, cat.estudiantes]);

  useEffect(() => {
    const fuera = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, []);

  if (valor) {
    return (
      <Campo label={etiqueta}>
        <div className="elegido">
          <b>{valor.nombre}</b>
          {!valor.estudiante_id && <span className="chip">Otra persona</span>}
          <button type="button" className="enlace" onClick={() => { onChange(null); setTexto(''); }}>Cambiar</button>
        </div>
      </Campo>
    );
  }

  if (modoPersona) {
    return (
      <Campo label="Nombre de la persona" ayuda="Para mamás, papás, profes o alguien que no es estudiante.">
        <input autoFocus value={texto} onChange={e => setTexto(e.target.value)} placeholder="Ej: Mamá de José" />
        <div className="acciones" style={{ marginTop: 6 }}>
          <button type="button" className="btn chico" disabled={!texto.trim()} onClick={() => onChange({ persona: texto.trim(), nombre: texto.trim() })}>Usar este nombre</button>
          <button type="button" className="enlace" onClick={() => { setModoPersona(false); setTexto(''); }}>Buscar estudiante</button>
        </div>
      </Campo>
    );
  }

  const elegir = (i: number) => {
    const e = resultados[i];
    if (e) { onChange({ estudiante_id: e.id, nombre: e.nombre }); setAbierto(false); }
  };

  const crear = async () => {
    const r = await correr<{ id: string; nombre: string }>('agregarEstudiante', { nombre: texto.trim() }, 'Estudiante agregado');
    if (r) { await recargarCat(); onChange({ estudiante_id: r.id, nombre: r.nombre }); setCreando(false); }
  };

  return (
    <Campo label={etiqueta}>
      <div className="buscador" ref={ref}>
        <input
          value={texto} placeholder="Escribe nombre o apellido…" autoComplete="off"
          onChange={e => { setTexto(e.target.value); setAbierto(true); setMarcado(0); }}
          onFocus={() => setAbierto(true)}
          onKeyDown={e => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setMarcado(m => Math.min(m + 1, resultados.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setMarcado(m => Math.max(m - 1, 0)); }
            if (e.key === 'Enter') { e.preventDefault(); elegir(marcado); }
          }}
        />
        {abierto && texto.trim() && (
          <div className="sugerencias">
            {resultados.map((e, i) => (
              <button type="button" key={e.id} className={i === marcado ? 'marcado' : ''} onMouseDown={ev => ev.preventDefault()} onClick={() => elegir(i)}>
                {e.nombre}{e.plan && <small>{e.plan}</small>}
              </button>
            ))}
            {!resultados.length && <div className="vacio" style={{ padding: '10px 12px' }}>No aparece “{texto.trim()}”.</div>}
          </div>
        )}
      </div>
      <div className="chips" style={{ marginTop: 4 }}>
        {texto.trim().length > 3 && !creando && (
          <button type="button" className="enlace" onClick={() => setCreando(true)}>+ Agregar “{texto.trim()}” como estudiante nuevo</button>
        )}
        {permitirPersona && <button type="button" className="enlace" onClick={() => { setModoPersona(true); setTexto(''); }}>No es estudiante</button>}
      </div>
      {creando && (
        <div className="aviso info">
          ¿Agregar a <b>{texto.trim()}</b> a la lista de estudiantes?
          <div className="acciones" style={{ marginTop: 8 }}>
            <button type="button" className="btn chico" disabled={ocupado} onClick={crear}>{ocupado ? 'Agregando…' : 'Sí, agregar'}</button>
            <button type="button" className="btn secundario chico" onClick={() => setCreando(false)}>No</button>
          </div>
        </div>
      )}
    </Campo>
  );
}

export const datosQuien = (q: Quien) => (q?.estudiante_id ? { estudiante_id: q.estudiante_id } : { persona: q?.persona || '' });

/** Cuenta destino según el método: efectivo → Caja; si no, la sugerida del día. */
export function cuentaPorMetodo(metodo: string, cat: Catalogos) {
  if (norm(metodo) === 'efectivo') return 'Caja';
  return cat.cuenta_sugerida || cat.cuentas.find(c => c.nombre !== 'Caja')?.nombre || '';
}

export const cuentasBanco = (cat: Catalogos) => cat.cuentas.map(c => c.nombre);
