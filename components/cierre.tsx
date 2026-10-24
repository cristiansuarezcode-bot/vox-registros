'use client';
import { useMemo, useState } from 'react';
import { fechaCorta, hoy, pesos } from '@/lib/util';
import { BotonAnular, Campo, Cargando, ErrorCaja, Monto, Pantalla, Segmentado, useAccion, useApp, useDatos } from './ui';

type Mov = { fecha: string; tipo: string; detalle: string; valor: number; id: string };
type Cierre = {
  id: string; fecha: string; base_inicial: number; entradas: number; salidas: number; esperado: number; contado: number;
  diferencia: number; entregado: number; entregado_a: string; cuenta_destino: string; base_siguiente: number; nota: string;
  registrado_por: string; registrado_en: string;
};
type Previa = {
  fecha: string; cerrado: Cierre | null; es_el_ultimo?: boolean; primer_cierre?: boolean; anterior?: Cierre | null;
  base_inicial: number | null; movimientos?: Mov[]; entradas?: number; salidas?: number; neto?: number;
  por_tipo_entradas?: Record<string, number>; por_tipo_salidas?: Record<string, number>;
  base_minima: number; redondeo: number; entregas?: string[]; historial: Cierre[];
};

const BILLETES = [100000, 50000, 20000, 10000, 5000, 2000, 1000];

export function CierreCaja() {
  const [fecha, setFecha] = useState(hoy());
  const { d, error, cargando, recargar } = useDatos<Previa>('previaCierre', { fecha }, [fecha]);
  return (
    <Pantalla titulo="Cierre de caja" sub="Al final del día: contar la caja, ver si cuadra y entregar lo que pasa de la base">
      <div className="tarjeta"><div className="rejilla">
        <Campo label="Día que se cierra"><input type="date" value={fecha} max={hoy()} onChange={e => e.target.value && setFecha(e.target.value)} /></Campo>
      </div></div>
      {error && <ErrorCaja msg={error} reintentar={recargar} />}
      {cargando && !d && <Cargando texto="Calculando la caja…" />}
      {d && (d.cerrado ? <YaCerrado d={d} onListo={recargar} /> : <Formulario key={d.fecha + (d.anterior?.id || '')} d={d} onListo={recargar} />)}
      {d && d.historial.length > 0 && <Historial cierres={d.historial} />}
    </Pantalla>
  );
}

function Formulario({ d, onListo }: { d: Previa; onListo: () => void }) {
  const { cat, aviso } = useApp();
  const { ocupado, correr } = useAccion();
  const [base, setBase] = useState(d.base_minima);
  const [contado, setContado] = useState(0);
  const [porBilletes, setPorBilletes] = useState(false);
  const [billetes, setBilletes] = useState<Record<number, number>>({});
  const [monedas, setMonedas] = useState(0);
  const [entregado, setEntregado] = useState(0);
  const [tocado, setTocado] = useState(false);
  const [a, setA] = useState<'' | 'Cristian' | 'Liz' | 'Consignación'>('');
  const [cuenta, setCuenta] = useState('');
  const [nota, setNota] = useState('');
  const [verMovs, setVerMovs] = useState(false);

  const baseInicial = d.primer_cierre ? base : d.base_inicial || 0;
  const esperado = baseInicial + (d.neto || 0);
  const totalBilletes = BILLETES.reduce((s, b) => s + b * (billetes[b] || 0), 0) + monedas;
  const real = porBilletes ? totalBilletes : contado;
  const hayConteo = porBilletes ? totalBilletes > 0 : contado > 0;
  const diferencia = real - esperado;
  const sugerido = Math.max(0, Math.floor((real - d.base_minima) / d.redondeo) * d.redondeo);
  const entrega = tocado ? entregado : sugerido;
  const queda = real - entrega;
  const cuentasConsig = cat.cuentas.map(c => c.nombre).filter(c => c !== 'Caja');
  const faltaNota = diferencia !== 0 && nota.trim().length < 5;
  const problemaEntrega = entrega > real ? 'No se puede entregar más de lo que hay.'
    : entrega > 0 && queda < d.base_minima ? `Así la caja queda con ${pesos(queda)}, menos que la base de ${pesos(d.base_minima)}.`
    : entrega > 0 && !a ? 'Escoge a quién se le entregó.'
    : entrega > 0 && a === 'Consignación' && !cuenta ? 'Escoge la cuenta donde se consignó.' : '';
  const listo = hayConteo && !faltaNota && !problemaEntrega && (!d.primer_cierre || base >= 0);

  const guardar = async () => {
    const datos: Record<string, unknown> = { fecha: d.fecha, contado: real, entregado: entrega, nota };
    if (d.primer_cierre) datos.base_inicial = base;
    if (entrega > 0) { datos.entregado_a = a; if (a === 'Consignación') datos.cuenta_destino = cuenta; }
    const r = await correr<{ diferencia: number; entregado: number; base_siguiente: number }>('cerrarCaja', datos);
    if (r) {
      aviso(`Caja cerrada${r.entregado ? `: se entregaron ${pesos(r.entregado)} a ${a === 'Consignación' ? cuenta : a}` : ''}. Base para el siguiente día: ${pesos(r.base_siguiente)}`);
      onListo();
    }
  };

  const tipos = (o?: Record<string, number>) => Object.entries(o || {}).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));

  return (
    <>
      <div className="tarjeta">
        <h3>1. Con cuánto arrancó la caja</h3>
        {d.primer_cierre ? (
          <div className="rejilla">
            <Campo label="Base con la que arrancó" ayuda="Es el primer cierre: escribe la base que había al empezar el día. Desde mañana sale sola.">
              <Monto valor={base} onChange={setBase} />
            </Campo>
          </div>
        ) : (
          <div className="fila-dato"><span>Base que quedó en el cierre del {fechaCorta(d.anterior!.fecha)}</span><b>{pesos(baseInicial)}</b></div>
        )}
      </div>

      <div className="tarjeta">
        <h3>2. Lo que pasó en efectivo</h3>
        {!d.movimientos?.length ? <p className="vacio">No hubo movimientos en efectivo.</p> : <>
          <ul className="lista-simple">
            {tipos(d.por_tipo_entradas).map(([k, v]) => <li key={'e' + k}><span>+ {k}</span><b className="monto">{pesos(v)}</b></li>)}
            {tipos(d.por_tipo_salidas).map(([k, v]) => <li key={'s' + k}><span>− {k}</span><b className="monto" style={{ color: 'var(--error)' }}>{pesos(v)}</b></li>)}
          </ul>
          <button className="enlace" onClick={() => setVerMovs(v => !v)}>{verMovs ? 'Ocultar' : 'Ver'} {d.movimientos.length === 1 ? 'el movimiento' : `los ${d.movimientos.length} movimientos`}</button>
          {verMovs && <ul className="lista-simple" style={{ marginTop: 8, fontSize: 14 }}>
            {d.movimientos.map((m, i) => <li key={m.id + i}><span>{fechaCorta(m.fecha)} · {m.detalle}<br /><small className="suave">{m.tipo}</small></span><b className="monto" style={m.valor < 0 ? { color: 'var(--error)' } : undefined}>{pesos(m.valor)}</b></li>)}
          </ul>}
          {d.movimientos.some(m => m.fecha < d.fecha) && <p className="ayuda" style={{ marginBottom: 0 }}>Incluye registros de días anteriores que se anotaron después del último cierre.</p>}
        </>}
        <div className="total-grande"><span>Debería haber en la caja</span><b>{pesos(esperado)}</b></div>
      </div>

      <div className="tarjeta">
        <h3>3. Cuánto hay al contar</h3>
        <div className="fila-dos"><Segmentado opciones={['Escribir el total', 'Contar billete por billete'] as const} valor={porBilletes ? 'Contar billete por billete' : 'Escribir el total'} onChange={v => setPorBilletes(v === 'Contar billete por billete')} /></div>
        {porBilletes ? (
          <div className="conteo">
            {BILLETES.map(b => (
              <label key={b} className="conteo-fila">
                <span>{pesos(b)}</span>
                <input type="number" inputMode="numeric" min={0} placeholder="0" value={billetes[b] || ''} onChange={e => setBilletes(x => ({ ...x, [b]: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))} />
                <b>{billetes[b] ? pesos(b * billetes[b]) : ''}</b>
              </label>
            ))}
            <label className="conteo-fila"><span>Monedas (total)</span><Monto valor={monedas} onChange={setMonedas} /><b /></label>
            <div className="fila-dato"><span>Total contado</span><b>{pesos(totalBilletes)}</b></div>
          </div>
        ) : (
          <div className="rejilla" style={{ marginTop: 10 }}><Campo label="Total en la caja"><Monto valor={contado} onChange={setContado} placeholder="$ 0" /></Campo></div>
        )}
        {hayConteo && (diferencia === 0
          ? <div className="cambio" style={{ marginTop: 12 }}><span>Cuadra</span><b>✓</b></div>
          : <div className={'cambio ' + (diferencia < 0 ? 'falta' : 'guardado')} style={{ marginTop: 12 }}><span>{diferencia < 0 ? 'Faltan' : 'Sobran'}</span><b>{pesos(Math.abs(diferencia))}</b></div>)}
        {hayConteo && diferencia !== 0 && (
          <div className="rejilla" style={{ marginTop: 10 }}>
            <Campo label="¿Qué pasó? (obligatorio)" ancho ayuda="Ej: un pago que no se registró, se dio mal un cambio, se pagó algo de la caja sin anotarlo.">
              <input value={nota} onChange={e => setNota(e.target.value)} />
            </Campo>
          </div>
        )}
      </div>

      {hayConteo && (
        <div className="tarjeta">
          <h3>4. Lo que se entrega</h3>
          <p className="suave mt0" style={{ fontSize: 14 }}>Se deja siempre la base mínima de {pesos(d.base_minima)}. La página propone entregar lo que pasa de ahí en cifra cerrada, y lo suelto queda en la base.</p>
          <div className="rejilla">
            <Campo label="Entregar" ayuda={sugerido ? `Sugerido: ${pesos(sugerido)}` : 'No alcanza para entregar sin bajar de la base.'}>
              <Monto valor={entrega} onChange={v => { setEntregado(v); setTocado(true); }} placeholder="$ 0" />
            </Campo>
            {entrega > 0 && <Campo label="¿A quién?" ancho><Segmentado opciones={['Cristian', 'Liz', 'Consignación'] as const} valor={a} onChange={setA} /></Campo>}
            {entrega > 0 && a === 'Consignación' && <Campo label="¿A qué cuenta?" ancho><Segmentado opciones={cuentasConsig} valor={cuenta} onChange={setCuenta} /></Campo>}
            {(diferencia === 0 || nota) && <Campo label="Nota (opcional)" ancho><input value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej: se le entregó en la noche" /></Campo>}
          </div>
          <div className="total-grande"><span>Queda de base para el siguiente día</span><b style={queda < d.base_minima ? { color: 'var(--error)' } : undefined}>{pesos(queda)}</b></div>
          {queda < d.base_minima && entrega === 0 && <p className="aviso info">La caja queda por debajo de la base mínima. No se entrega nada hoy.</p>}
          {problemaEntrega && <p className="aviso error">{problemaEntrega}</p>}
        </div>
      )}

      <div className="acciones">
        <button className="btn" style={{ flex: 1 }} disabled={!listo || ocupado} onClick={guardar}>{ocupado ? 'Guardando…' : 'Cerrar la caja'}</button>
      </div>
      {hayConteo && faltaNota && <p className="aviso error">La caja no cuadra: escribe en la nota qué pasó.</p>}
    </>
  );
}

function YaCerrado({ d, onListo }: { d: Previa; onListo: () => void }) {
  const c = d.cerrado!;
  return (
    <div className="tarjeta">
      <h3>La caja del {fechaCorta(c.fecha)} ya está cerrada</h3>
      <ul className="lista-simple">
        <li><span>Base con la que arrancó</span><b className="monto">{pesos(c.base_inicial)}</b></li>
        <li><span>Entró en efectivo</span><b className="monto">{pesos(c.entradas)}</b></li>
        <li><span>Salió en efectivo</span><b className="monto">{pesos(c.salidas)}</b></li>
        <li><span>Debería haber</span><b className="monto">{pesos(c.esperado)}</b></li>
        <li><span>Se contó</span><b className="monto">{pesos(c.contado)}</b></li>
        <li><span>{c.diferencia === 0 ? 'Cuadró' : c.diferencia < 0 ? 'Faltó' : 'Sobró'}</span><b className="monto" style={c.diferencia < 0 ? { color: 'var(--error)' } : undefined}>{c.diferencia === 0 ? '✓' : pesos(Math.abs(c.diferencia))}</b></li>
        <li><span>Se entregó{c.entregado ? ` a ${c.entregado_a}${c.cuenta_destino ? ` (${c.cuenta_destino})` : ''}` : ''}</span><b className="monto">{pesos(c.entregado)}</b></li>
        <li><span><b>Base para el siguiente día</b></span><b className="monto">{pesos(c.base_siguiente)}</b></li>
      </ul>
      {c.nota && <p className="suave" style={{ fontSize: 14 }}>Nota: {c.nota}</p>}
      <p className="suave" style={{ fontSize: 13 }}>Lo cerró {c.registrado_por} · {c.registrado_en}</p>
      {d.es_el_ultimo
        ? <BotonAnular hoja="Cierres caja" id={c.id} onListo={onListo} etiqueta="Anular este cierre para repetirlo" />
        : <p className="ayuda">Para corregirlo hay que anular primero los cierres más recientes.</p>}
    </div>
  );
}

function Historial({ cierres }: { cierres: Cierre[] }) {
  const [ver, setVer] = useState(false);
  const filas = useMemo(() => cierres, [cierres]);
  return (
    <div className="tarjeta">
      <h3>Últimos cierres</h3>
      {!ver ? <button className="btn secundario chico" onClick={() => setVer(true)}>Ver los {filas.length} más recientes</button> : (
        <div className="tabla-envoltura"><table className="tabla tarjetas">
          <thead><tr><th>Día</th><th className="num">Contado</th><th className="num">Diferencia</th><th>Entregado</th><th className="num">Base siguiente</th></tr></thead>
          <tbody>{filas.map(c => (
            <tr key={c.id}>
              <td data-label="Día"><b>{fechaCorta(c.fecha)}</b>{c.nota && <><br /><small className="suave">{c.nota}</small></>}</td>
              <td className="num" data-label="Contado">{pesos(c.contado)}</td>
              <td className="num" data-label="Diferencia" style={c.diferencia < 0 ? { color: 'var(--error)' } : undefined}>{c.diferencia === 0 ? 'Cuadró' : (c.diferencia > 0 ? '+' : '') + pesos(c.diferencia)}</td>
              <td data-label="Entregado">{c.entregado ? `${pesos(c.entregado)} · ${c.entregado_a}${c.cuenta_destino ? ` (${c.cuenta_destino})` : ''}` : '—'}</td>
              <td className="num" data-label="Base siguiente">{pesos(c.base_siguiente)}</td>
            </tr>))}
          </tbody>
        </table></div>
      )}
    </div>
  );
}
