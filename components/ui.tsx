'use client';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Catalogos, Quien } from '@/lib/tipos';
import { api, ErrorApi, escucharCarga } from '@/lib/api';
import { norm, pesos, aNumero, hoy } from '@/lib/util';

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
  return <div className="cargando" role="status"><span className="girando" aria-hidden />{texto || 'Cargando…'}</div>;
}

/** Barra fina arriba de la pantalla mientras haya consultas en camino (aparece si tardan más de 0,15 s). */
export function BarraCarga() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const quitar = escucharCarga(n => {
      if (n > 0) { if (!t) t = setTimeout(() => setVisible(true), 150); }
      else { if (t) clearTimeout(t); t = null; setVisible(false); }
    });
    return () => { quitar(); if (t) clearTimeout(t); };
  }, []);
  return visible ? <div className="barra-carga" role="progressbar" aria-label="Cargando" /> : null;
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

// ------------------------------------------------------------------ estudiantes del admin
/** Trae de una vez los estudiantes y planes del admin (normalmente llegan solos cada 15 minutos). */
export function TraerDelAdmin({ chico, texto = 'Traer estudiantes del admin', onListo }: { chico?: boolean; texto?: string; onListo?: () => void }) {
  const { recargarCat, aviso } = useApp();
  const { ocupado, correr } = useAccion();
  const traer = async () => {
    const r = await correr<{ resumen: string; nuevos: string[] }>('traerDelAdmin', {});
    if (r) { aviso(r.nuevos.length ? `Del admin: ${r.resumen}. ${r.nuevos.map(n => n.replace(/^E\d+ /, '')).join(', ')}` : `Del admin: ${r.resumen}`); await recargarCat(); onListo?.(); }
  };
  return (
    <button type="button" className={chico ? 'enlace' : 'btn secundario'} disabled={ocupado} onClick={traer}>
      {ocupado ? <><span className="girando" aria-hidden /> Trayendo…</> : texto}
    </button>
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
    const coincide = (nombre: string) => { const n = norm(nombre); return partes.every(p => n.includes(p)); };
    // Los profes también salen (para fiarles en la tienda o registrar lo que pagan); quedan como "persona".
    const profes = permitirPersona ? cat.profes.filter(p => coincide(p.nombre)).map(p => ({ id: 'profe:' + p.id, nombre: p.nombre, plan: '', profe: true })) : [];
    return [...cat.estudiantes.filter(e => coincide(e.nombre)).map(e => ({ ...e, profe: false })), ...profes].slice(0, 8);
  }, [texto, cat.estudiantes, cat.profes, permitirPersona]);

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
          {!valor.estudiante_id && <span className="chip">{cat.profes.some(p => norm(p.nombre) === norm(valor.persona || '')) ? 'Profe' : 'Otra persona'}</span>}
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
    if (e) { onChange(e.profe ? { persona: e.nombre, nombre: e.nombre } : { estudiante_id: e.id, nombre: e.nombre }); setAbierto(false); }
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
                {e.nombre}{e.profe ? <small>Profe</small> : e.plan && <small>{e.plan}</small>}
              </button>
            ))}
            {!resultados.length && <div className="vacio" style={{ padding: '10px 12px' }}>No aparece “{texto.trim()}”.
              {cat.admin_conectado && <><br /><TraerDelAdmin chico texto="¿Lo acabas de matricular? Traer del admin" /></>}</div>}
          </div>
        )}
      </div>
      <div className="chips" style={{ marginTop: 4 }}>
        {texto.trim().length > 3 && !creando && !cat.admin_conectado && (
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

// Cuentas de la tienda (Nequi): ahí solo entra lo de la tienda, así que no salen para los demás pagos.
const esDeTienda = (c: { tipo?: string }) => norm(c.tipo || '') === 'tienda';
/** Cuentas para recibir pagos de la academia (sin las de la tienda). */
export const cuentasBanco = (cat: Catalogos) => cat.cuentas.filter(c => !esDeTienda(c)).map(c => c.nombre);
/** Cuentas a las que se transfiere lo de la tienda (si no hay ninguna marcada, las de banco). */
export const cuentasTienda = (cat: Catalogos) => { const t = cat.cuentas.filter(esDeTienda).map(c => c.nombre); return t.length ? t : cuentasBanco(cat).filter(c => c !== 'Caja'); };
/** Todas las cuentas activas, para salidas de plata y traslados. */
export const cuentasTodas = (cat: Catalogos) => cat.cuentas.map(c => c.nombre);


// ------------------------------------------------------------------ descuentos
export type ValorDescuento = { descuento: number; motivo: string };
export const SIN_DESCUENTO: ValorDescuento = { descuento: 0, motivo: '' };

/** Escoger un descuento de la lista (o uno a mano) sobre un valor base. Devuelve el descuento en pesos y su motivo. */
export function SelectorDescuento({ concepto, base, valor, onChange }: { concepto: string; base: number; valor: ValorDescuento; onChange: (v: ValorDescuento) => void }) {
  const { cat } = useApp();
  const opciones = (cat.descuentos || []).filter(d => norm(d.aplica_a) === 'todos' || norm(d.aplica_a) === norm(concepto));
  const [elegido, setElegido] = useState<string>(valor.descuento ? 'otro' : 'ninguno');
  const [tipo, setTipo] = useState<'%' | '$'>('%');
  const [cifra, setCifra] = useState(0);
  const [motivo, setMotivo] = useState('');
  const calcular = (t: string, v: number) => Math.min(base, Math.round(t === '%' ? (base * v) / 100 : v));
  // Si cambia el valor base, se recalcula el descuento escogido.
  useEffect(() => {
    if (elegido === 'ninguno') return;
    if (elegido === 'otro') { onChange({ descuento: calcular(tipo, cifra), motivo }); return; }
    const d = opciones.find(o => o.id === elegido);
    if (d) onChange({ descuento: calcular(d.tipo, d.valor), motivo: `${d.nombre} (${d.tipo === '%' ? d.valor + '%' : pesos(d.valor)})` });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base]);
  const escoger = (id: string) => {
    setElegido(id);
    if (id === 'ninguno') return onChange(SIN_DESCUENTO);
    if (id === 'otro') return onChange({ descuento: calcular(tipo, cifra), motivo });
    const d = opciones.find(o => o.id === id)!;
    onChange({ descuento: calcular(d.tipo, d.valor), motivo: `${d.nombre} (${d.tipo === '%' ? d.valor + '%' : pesos(d.valor)})` });
  };
  const aMano = (t: '%' | '$', v: number, m: string) => { setTipo(t); setCifra(v); setMotivo(m); onChange({ descuento: calcular(t, v), motivo: m }); };
  if (!base) return null;
  return (
    <div className="campo" style={{ gridColumn: '1 / -1' }}>
      <label>Descuento</label>
      <div className="segmentado">
        <button type="button" className={elegido === 'ninguno' ? 'activo' : ''} onClick={() => escoger('ninguno')}>Sin descuento</button>
        {opciones.map(o => <button type="button" key={o.id} className={elegido === o.id ? 'activo' : ''} onClick={() => escoger(o.id)}>{o.nombre} · {o.tipo === '%' ? o.valor + '%' : pesos(o.valor)}</button>)}
        <button type="button" className={elegido === 'otro' ? 'activo' : ''} onClick={() => escoger('otro')}>Otro…</button>
      </div>
      {elegido === 'otro' && (
        <div className="rejilla" style={{ marginTop: 8 }}>
          <div className="campo"><label>Tipo</label><Segmentado opciones={['%', '$'] as const} valor={tipo} onChange={t => aMano(t, cifra, motivo)} /></div>
          <div className="campo"><label>{tipo === '%' ? 'Porcentaje' : 'Valor'}</label>
            {tipo === '%' ? <input type="number" inputMode="numeric" min={0} max={100} value={cifra || ''} onChange={e => aMano(tipo, Number(e.target.value), motivo)} />
              : <Monto valor={cifra} onChange={v => aMano(tipo, v, motivo)} />}</div>
          <div className="campo"><label>Motivo</label><input value={motivo} onChange={e => aMano(tipo, cifra, e.target.value)} placeholder="Ej: hermanos, beca, cortesía" /></div>
        </div>
      )}
      {valor.descuento > 0 && <span className="ayuda">Descuento de <b>{pesos(valor.descuento)}</b> sobre {pesos(base)} → queda en <b>{pesos(base - valor.descuento)}</b>{!valor.motivo.trim() && ' · falta el motivo'}</span>}
    </div>
  );
}

export const datosDescuento = (v: ValorDescuento) => (v.descuento > 0 ? { descuento: v.descuento, motivo_descuento: v.motivo } : {});

// ------------------------------------------------------------------ saldo a favor
export type ItemSaldo = { origen: string; concepto: string; pedido: string; valor: number; pagado: number; saldo: number };

export function useSaldoFavor(q: Quien) {
  const [d, setD] = useState<{ a_favor: number; items: ItemSaldo[] } | null>(null);
  const [n, setN] = useState(0);
  const llave = q ? (q.estudiante_id || 'p:' + norm(q.persona)) : '';
  useEffect(() => {
    setD(null);
    if (!q) return;
    let vivo = true;
    api<{ a_favor: number; items: ItemSaldo[] }>('saldosFavor', datosQuien(q)).then(r => vivo && setD(r)).catch(() => vivo && setD({ a_favor: 0, items: [] }));
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llave, n]);
  return { a_favor: d?.a_favor || 0, items: d?.items || [], cargando: !!q && !d, recargar: () => setN(x => x + 1) };
}

/** Devolverle plata a alguien que tiene saldo a favor en un concepto. */
export function DevolverSaldo({ q, item, onCerrar, onListo }: { q: Quien; item: { concepto: string; pedido?: string; favor: number }; onCerrar: () => void; onListo: () => void }) {
  const { cat } = useApp();
  const metodos = cat.listas.metodo_pago.map(String);
  const [valor, setValor] = useState(item.favor);
  const [metodo, setMetodo] = useState('Efectivo');
  const [desde, setDesde] = useState('Caja');
  const [nota, setNota] = useState('');
  const [fecha, setFecha] = useState(hoy());
  const { ocupado, correr } = useAccion();
  const guardar = async () => {
    const r = await correr('registrarDevolucion', { ...datosQuien(q), concepto: item.concepto, pedido_uniforme: item.pedido || '', valor, metodo, pagado_desde: desde, nota, fecha },
      `Devolución de ${pesos(valor)} a ${q?.nombre} registrada`);
    if (r) onListo();
  };
  return (
    <Modal titulo={`Devolver a ${q?.nombre}`} onCerrar={onCerrar}>
      <p className="suave mt0" style={{ fontSize: 14 }}>Tiene <b>{pesos(item.favor)}</b> a favor en {item.concepto}{item.pedido ? ' ' + item.pedido : ''}.</p>
      <div className="rejilla">
        <Campo label="Valor a devolver"><Monto valor={valor} onChange={setValor} /></Campo>
        <Campo label="Fecha"><input type="date" value={fecha} max={hoy()} onChange={e => setFecha(e.target.value)} /></Campo>
        <Campo label="¿Cómo se le devolvió?" ancho><Segmentado opciones={metodos} valor={metodo} onChange={m => { setMetodo(m); setDesde(cuentaPorMetodo(m, cat)); }} /></Campo>
        <Campo label="¿De dónde salió la plata?" ancho><Segmentado opciones={cuentasTodas(cat)} valor={desde} onChange={setDesde} /></Campo>
        <Campo label="Nota (opcional)" ancho><input value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej: se le devolvió a la mamá" /></Campo>
      </div>
      {valor > item.favor && <p className="aviso error">No puede ser más de {pesos(item.favor)}.</p>}
      <div className="acciones"><button className="btn" disabled={ocupado || !valor || valor > item.favor} onClick={guardar}>{ocupado ? 'Guardando…' : `Devolver ${pesos(valor)}`}</button><button className="btn secundario" onClick={onCerrar}>Cancelar</button></div>
    </Modal>
  );
}
