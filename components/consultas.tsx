'use client';
import { useMemo, useState, type ReactNode } from 'react';
import type { Quien } from '@/lib/tipos';
import { fechaCorta, hoy, norm, pesos, primeroDelMes } from '@/lib/util';
import { BotonAnular, BuscarQuien, Campo, Cargando, DevolverSaldo, ErrorCaja, Estado, Modal, Pantalla, Segmentado, Selector, SelectorDescuento, SIN_DESCUENTO, datosDescuento, useAccion, useApp, useDatos, type ValorDescuento } from './ui';

const Lista = ({ datos, dinero = true }: { datos: Record<string, number>; dinero?: boolean }) => {
  const filas = Object.entries(datos || {}).sort((a, b) => b[1] - a[1]);
  if (!filas.length) return <p className="vacio">Nada.</p>;
  return <ul className="lista-simple">{filas.map(([k, v]) => <li key={k}><span>{k}</span><b className="monto">{dinero ? pesos(v) : v}</b></li>)}</ul>;
};

/** Botones para quien tiene saldo a favor: devolverle la plata o usarla en otra cosa. */
function AccionesFavor({ estudiante_id, persona, nombre, concepto, pedido, favor, onListo }: { estudiante_id?: string; persona?: string; nombre: string; concepto: string; pedido?: string; favor: number; onListo: () => void }) {
  const { ir } = useApp();
  const [devolver, setDevolver] = useState(false);
  const q = estudiante_id ? { estudiante_id, nombre } : { persona: persona || nombre, nombre };
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
      <button className="btn secundario chico" onClick={() => setDevolver(true)}>Devolver</button>
      <button className="btn secundario chico" onClick={() => ir('pago', estudiante_id ? { estudiante_id, metodo: 'saldo' } : { persona: persona || nombre, metodo: 'saldo' })}>Usar en otro pago</button>
      {devolver && <DevolverSaldo q={q} item={{ concepto, pedido, favor }} onCerrar={() => setDevolver(false)} onListo={() => { setDevolver(false); onListo(); }} />}
    </span>
  );
}

const Cifra = ({ t, v, destacada }: { t: string; v: ReactNode; destacada?: boolean }) => <div className={'cifra' + (destacada ? ' destacada' : '')}><span>{t}</span><b>{v}</b></div>;

function Rango({ desde, hasta, setDesde, setHasta }: { desde: string; hasta: string; setDesde: (s: string) => void; setHasta: (s: string) => void }) {
  return (
    <div className="tarjeta">
      <div className="rejilla">
        <Campo label="Desde"><input type="date" value={desde} max={hasta} onChange={e => setDesde(e.target.value)} /></Campo>
        <Campo label="Hasta"><input type="date" value={hasta} max={hoy()} onChange={e => setHasta(e.target.value)} /></Campo>
        <div className="campo"><label>Atajos</label><div className="segmentado">
          <button onClick={() => { setDesde(hoy()); setHasta(hoy()); }}>Hoy</button>
          <button onClick={() => { setDesde(primeroDelMes()); setHasta(hoy()); }}>Este mes</button>
        </div></div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ resumen (día, mes o fechas)
type Mov = { fecha: string; grupo: string; concepto: string; quien: string; detalle: string; valor: number; metodo: string; cuenta: string; id: string };
type Resumen = {
  desde: string; hasta: string; concepto: string; grupos: string[];
  entradas: { total: number; cantidad: number; por_concepto: Record<string, number>; por_cuenta: Record<string, number>; por_metodo: Record<string, number>; por_dia: Record<string, number> };
  salidas: null | { total: number; gastos: number; por_categoria: Record<string, number>; pago_profes: number; por_profe: Record<string, number> };
  neto: number | null;
  efectivo_neto_caja: number;
  traslados: { de: string; a: string; valor: number; nota: string }[];
  movimientos: Mov[];
};

const finDeMes = (mes: string) => { const [a, m] = mes.split('-').map(Number); const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate(); const f = `${mes}-${String(ultimo).padStart(2, '0')}`; return f > hoy() ? hoy() : f; };
const mesAnterior = () => { const [a, m] = hoy().split('-').map(Number); return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, '0')}`; };
const NOMBRE_MES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = (mes: string) => `${NOMBRE_MES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}`;

export function Hoy() {
  const { cat } = useApp();
  const [periodo, setPeriodo] = useState<'Día' | 'Mes' | 'Fechas'>('Día');
  const [dia, setDia] = useState(hoy());
  const [mes, setMes] = useState(hoy().slice(0, 7));
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState(hoy());
  const [concepto, setConcepto] = useState('');
  const [verDetalle, setVerDetalle] = useState(false);
  const r = periodo === 'Día' ? { desde: dia, hasta: dia } : periodo === 'Mes' ? { desde: mes + '-01', hasta: finDeMes(mes) } : { desde, hasta };
  const { d, error, cargando, recargar } = useDatos<Resumen>('resumen', { ...r, concepto }, [r.desde, r.hasta, concepto]);
  const opciones = useMemo(() => {
    const base = cat.conceptos.map(c => c.nombre).filter(n => norm(n) !== 'cuenta tienda');
    return [...new Set([...base, 'Tienda', ...(d?.grupos || [])])].sort((a, b) => a.localeCompare(b, 'es'));
  }, [cat.conceptos, d?.grupos]);
  const titulo = periodo === 'Día' ? (dia === hoy() ? 'hoy' : fechaCorta(dia)) : periodo === 'Mes' ? nombreMes(mes) : `${fechaCorta(r.desde)} al ${fechaCorta(r.hasta)}`;
  const varios = r.desde !== r.hasta;
  return (
    <Pantalla titulo="Resumen" sub="Lo que entró y salió en un día, un mes o entre dos fechas">
      <div className="tarjeta">
        <div className="rejilla">
          <Campo label="Ver"><Segmentado opciones={['Día', 'Mes', 'Fechas'] as const} valor={periodo} onChange={setPeriodo} /></Campo>
          {periodo === 'Día' && <Campo label="Día"><input type="date" value={dia} max={hoy()} onChange={e => setDia(e.target.value)} /></Campo>}
          {periodo === 'Mes' && <Campo label="Mes">
            <input type="month" value={mes} max={hoy().slice(0, 7)} onChange={e => e.target.value && setMes(e.target.value)} />
            <div className="chips" style={{ marginTop: 6 }}>
              <button type="button" className={'btn secundario chico' + (mes === hoy().slice(0, 7) ? ' activo' : '')} onClick={() => setMes(hoy().slice(0, 7))}>Este mes</button>
              <button type="button" className={'btn secundario chico' + (mes === mesAnterior() ? ' activo' : '')} onClick={() => setMes(mesAnterior())}>Mes pasado</button>
            </div>
          </Campo>}
          {periodo === 'Fechas' && <>
            <Campo label="Desde"><input type="date" value={desde} max={hasta} onChange={e => setDesde(e.target.value)} /></Campo>
            <Campo label="Hasta"><input type="date" value={hasta} max={hoy()} onChange={e => setHasta(e.target.value)} /></Campo>
          </>}
          <Campo label="Concepto"><Selector valor={concepto} onChange={setConcepto} vacio="Todos los conceptos" opciones={opciones} /></Campo>
        </div>
      </div>
      {error && <ErrorCaja msg={error} reintentar={recargar} />}
      {cargando && !d && <Cargando />}
      {d && <>
        <div className="cifras">
          <Cifra t={concepto ? `Entró por ${concepto} (${titulo})` : `Entró (${titulo})`} v={pesos(d.entradas.total)} destacada />
          {d.salidas && <Cifra t="Salió (gastos y profes)" v={pesos(d.salidas.total)} />}
          {d.neto !== null && <Cifra t="Quedó" v={pesos(d.neto)} />}
          {!concepto && periodo === 'Día' && <Cifra t="Efectivo neto en caja" v={pesos(d.efectivo_neto_caja)} />}
          {concepto && <Cifra t="De eso, en efectivo" v={pesos(d.efectivo_neto_caja)} />}
        </div>
        <div className="rejilla">
          {!concepto && <div className="tarjeta"><h3>Por concepto</h3>
            {!Object.keys(d.entradas.por_concepto).length ? <p className="vacio">Nada.</p> :
              <ul className="lista-simple">{Object.entries(d.entradas.por_concepto).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <li key={k}><button className="enlace" onClick={() => setConcepto(k)}>{k}</button><b className="monto">{pesos(v)}</b></li>))}
              </ul>}
            <p className="suave" style={{ fontSize: 12, marginBottom: 0 }}>Toca un concepto para ver solo ese. “Tienda” incluye ventas y pagos de fiados.</p>
          </div>}
          <div className="tarjeta"><h3>Por cuenta</h3><Lista datos={d.entradas.por_cuenta} /></div>
          <div className="tarjeta"><h3>Por método</h3><Lista datos={d.entradas.por_metodo} /></div>
          {varios && <div className="tarjeta"><h3>Por día</h3>
            {!Object.keys(d.entradas.por_dia).length ? <p className="vacio">Nada.</p> :
              <ul className="lista-simple">{Object.entries(d.entradas.por_dia).sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([k, v]) => <li key={k}><span>{fechaCorta(k)}</span><b className="monto">{pesos(v)}</b></li>)}</ul>}
          </div>}
          {d.salidas && d.salidas.gastos > 0 && <div className="tarjeta"><h3>Gastos por categoría</h3><Lista datos={d.salidas.por_categoria} /></div>}
          {d.salidas && d.salidas.pago_profes > 0 && <div className="tarjeta"><h3>Pagos a profes</h3><Lista datos={d.salidas.por_profe} /></div>}
          {d.traslados.length > 0 && <div className="tarjeta"><h3>Traslados</h3><ul className="lista-simple">{d.traslados.map((t, i) => <li key={i}><span>{t.de} → {t.a}</span><b>{pesos(t.valor)}</b></li>)}</ul></div>}
        </div>
        <div className="tarjeta">
          <h3>{concepto ? `Detalle de ${concepto}` : 'Detalle de lo que entró'} <span className="suave" style={{ fontWeight: 400, fontSize: 14 }}>· {d.entradas.cantidad} registro(s)</span></h3>
          {concepto && <div className="acciones mt0" style={{ marginTop: 0, marginBottom: 8 }}><button className="btn secundario chico" onClick={() => setConcepto('')}>Ver todos los conceptos</button></div>}
          {!concepto && periodo !== 'Día' && !verDetalle && d.movimientos.length > 0 ? (
            <button className="btn secundario" onClick={() => setVerDetalle(true)}>Ver los {d.entradas.cantidad} registros</button>
          ) : !d.movimientos.length ? <p className="vacio">No entró nada en estas fechas.</p> : (
            <div className="tabla-envoltura"><table className="tabla tarjetas">
              <thead><tr><th>Fecha</th><th>Concepto</th><th>Quién</th><th>Cuenta</th><th className="num">Valor</th></tr></thead>
              <tbody>{d.movimientos.slice(0, 300).map(m => (
                <tr key={m.id}>
                  <td data-label="Fecha">{fechaCorta(m.fecha)}</td>
                  <td data-label="Concepto"><b>{m.grupo}</b>{m.detalle && <><br /><small className="suave">{m.detalle}</small></>}</td>
                  <td data-label="Quién">{m.quien || <span className="suave">—</span>}</td>
                  <td data-label="Cuenta">{m.cuenta}<br /><small className="suave">{m.metodo}</small></td>
                  <td className="num" data-label="Valor" style={m.valor < 0 ? { color: 'var(--error)' } : undefined}>{pesos(m.valor)}</td>
                </tr>))}
              </tbody>
            </table></div>
          )}
          {d.movimientos.length > 300 && <p className="suave" style={{ fontSize: 13 }}>Se muestran los 300 más recientes. Escoge un concepto o menos días para ver el resto.</p>}
        </div>
      </>}
    </Pantalla>
  );
}

// ------------------------------------------------------------------ saldos y cargos
type FilaSaldo = { quien: string; estudiante_id: string; cantidad?: number; valor: number; pagado: number; saldo: number; estado: string; cargo?: string; sin_cargo?: boolean; pedido?: string; fecha?: string; prendas_pendientes?: string[] };
type FilaTienda = { quien: string; estudiante_id: string; fiado: number; pagado: number; saldo: number };

export function Saldos() {
  const { cat, params, ir } = useApp();
  const opciones = [...cat.conceptos.filter(c => norm(c.usa_cargos) === 'si').map(c => c.nombre), 'Uniforme', 'Tienda (fiados)'];
  const concepto = params.concepto && opciones.includes(params.concepto) ? params.concepto : opciones[0];
  const [filtro, setFiltro] = useState<'Todos' | 'Deben' | 'A favor' | 'Al día'>('Deben');
  const [buscar, setBuscar] = useState('');
  return (
    <Pantalla titulo="Saldos y cargos" sub="Quién debe, quién está al día y a quién hay que devolverle">
      <div className="segmentado" style={{ marginBottom: 12 }}>
        {opciones.map(o => <button key={o} className={o === concepto ? 'activo' : ''} onClick={() => ir('saldos', { concepto: o })}>{o}</button>)}
      </div>
      <div className="tarjeta">
        <div className="rejilla">
          <Campo label="Mostrar"><Segmentado opciones={['Deben', 'A favor', 'Al día', 'Todos'] as const} valor={filtro} onChange={setFiltro} /></Campo>
          <Campo label="Buscar"><input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Nombre…" /></Campo>
        </div>
      </div>
      {concepto === 'Tienda (fiados)' ? <SaldosTienda filtro={filtro} buscar={buscar} /> : <SaldosConcepto key={concepto} concepto={concepto} filtro={filtro} buscar={buscar} />}
    </Pantalla>
  );
}

const pasaFiltro = (saldo: number, filtro: string) => filtro === 'Todos' || (filtro === 'Deben' && saldo > 0) || (filtro === 'A favor' && saldo < 0) || (filtro === 'Al día' && saldo === 0);

function SaldosConcepto({ concepto, filtro, buscar }: { concepto: string; filtro: string; buscar: string }) {
  const { cat, ir } = useApp();
  const esUniforme = concepto === 'Uniforme';
  const { d, error, cargando, recargar } = useDatos<{ por_cobrar: number; a_favor: number; deben: number; filas: FilaSaldo[] }>('reporteSaldos', { concepto }, [concepto]);
  const [editar, setEditar] = useState<FilaSaldo | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const base = cat.conceptos.find(c => c.nombre === concepto)?.valor_base || 0;
  const filas = useMemo(() => (d?.filas || []).filter(f => pasaFiltro(f.saldo, filtro) && (!buscar || norm(f.quien).includes(norm(buscar)))), [d, filtro, buscar]);

  if (error) return <ErrorCaja msg={error} reintentar={recargar} />;
  if (cargando && !d) return <Cargando />;
  if (!d) return null;
  return (
    <>
      <div className="cifras">
        <Cifra t="Por cobrar" v={pesos(d.por_cobrar)} destacada />
        <Cifra t={esUniforme ? 'Pedidos que deben' : 'Estudiantes que deben'} v={d.deben} />
        <Cifra t="A favor (por devolver o abonar)" v={pesos(d.a_favor)} />
      </div>
      <div className="tarjeta">
        {!esUniforme && <div className="acciones mt0" style={{ marginTop: 0, marginBottom: 10 }}>
          <button className="btn chico" onClick={() => setNuevo(true)}>+ Agregar cargo</button>
          <span className="suave" style={{ fontSize: 13 }}>El cargo es lo que debe pagar cada estudiante{base ? ` (${pesos(base)} por montaje)` : ''}.</span>
        </div>}
        {!filas.length ? <p className="vacio">No hay registros con este filtro.</p> : (
          <div className="tabla-envoltura"><table className="tabla tarjetas">
            <thead><tr>
              <th>{esUniforme ? 'Pedido' : 'Estudiante'}</th>
              {!esUniforme && <th className="num">Montajes</th>}
              <th className="num">Valor</th><th className="num">Pagado</th><th>Estado</th>
              {esUniforme ? <th>Pendiente de entregar</th> : <th></th>}
            </tr></thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={(f.cargo || f.pedido || '') + i}>
                  <td>{f.estudiante_id ? <button className="enlace" onClick={() => ir('ficha', { estudiante_id: f.estudiante_id })}>{f.quien}</button> : f.quien}
                    {esUniforme && <><br /><small className="suave">{f.pedido} · {fechaCorta(f.fecha || '')}</small></>}
                    {f.sin_cargo && <><br /><small className="suave">Pagó pero no tiene cargo</small></>}</td>
                  {!esUniforme && <td className="num" data-label="Montajes">{f.cantidad || '—'}</td>}
                  <td className="num" data-label="Valor">{pesos(f.valor)}</td>
                  <td className="num" data-label="Pagado">{pesos(f.pagado)}</td>
                  <td data-label="Estado"><Estado saldo={f.saldo} /></td>
                  {esUniforme ? <td style={{ fontSize: 13 }} data-label="Pendiente de entregar">{(f.prendas_pendientes || []).join(', ') || '—'}
                      {f.saldo < 0 && <><br /><AccionesFavor estudiante_id={f.estudiante_id} nombre={f.quien} concepto="Uniforme" pedido={f.pedido} favor={-f.saldo} onListo={recargar} /></>}</td>
                    : <td>{f.cargo ? <button className="enlace" onClick={() => setEditar(f)}>Editar</button> : f.estudiante_id && <button className="enlace" onClick={() => setNuevo(true)}>Crear cargo</button>}
                      {f.saldo < 0 && f.estudiante_id && <><br /><AccionesFavor estudiante_id={f.estudiante_id} nombre={f.quien} concepto={concepto} favor={-f.saldo} onListo={recargar} /></>}</td>}
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>
      {editar && <EditarCargo fila={editar} base={base} concepto={concepto} onCerrar={() => setEditar(null)} onListo={() => { setEditar(null); recargar(); }} />}
      {nuevo && <NuevoCargo concepto={concepto} base={base} onCerrar={() => setNuevo(false)} onListo={() => { setNuevo(false); recargar(); }} />}
    </>
  );
}

function EditarCargo({ fila, base, concepto, onCerrar, onListo }: { fila: FilaSaldo; base: number; concepto: string; onCerrar: () => void; onListo: () => void }) {
  const [cantidad, setCantidad] = useState(fila.cantidad || 1);
  const [nota, setNota] = useState('');
  const [desc, setDesc] = useState<ValorDescuento>(SIN_DESCUENTO);
  const [tocoDesc, setTocoDesc] = useState(false);
  const { ocupado, correr } = useAccion();
  const guardar = async () => {
    const datos: Record<string, unknown> = { id: fila.cargo, cantidad };
    if (tocoDesc) Object.assign(datos, desc.descuento ? datosDescuento(desc) : { descuento: 0 });
    if (nota.trim()) datos.nota = nota;
    if (await correr('editarCargo', datos, 'Cargo actualizado')) onListo();
  };
  return (
    <Modal titulo={`Cargo de ${fila.quien}`} onCerrar={onCerrar}>
      <div className="rejilla">
        <Campo label="Montajes" ayuda={base ? `Valor: ${pesos(cantidad * base - (tocoDesc ? desc.descuento : 0))}${!tocoDesc && fila.valor !== (fila.cantidad || 1) * base ? ' (conserva su descuento actual)' : ''}` : undefined}><input type="number" min={1} value={cantidad} onChange={e => setCantidad(Number(e.target.value))} /></Campo>
        {base > 0 && <SelectorDescuento concepto={concepto} base={cantidad * base} valor={desc} onChange={d => { setDesc(d); setTocoDesc(true); }} />}
        <Campo label="Nota (opcional)" ancho><input value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej: se unió a contempo" /></Campo>
      </div>
      <p className="suave" style={{ fontSize: 13 }}>El cambio queda en la bitácora con el valor anterior.</p>
      <div className="acciones"><button className="btn" disabled={ocupado || cantidad < 1 || (tocoDesc && desc.descuento > 0 && !desc.motivo.trim())} onClick={guardar}>Guardar</button><button className="btn secundario" onClick={onCerrar}>Cancelar</button></div>
    </Modal>
  );
}

function NuevoCargo({ concepto, base, onCerrar, onListo }: { concepto: string; base: number; onCerrar: () => void; onListo: () => void }) {
  const [quien, setQuien] = useState<Quien>(null);
  const [cantidad, setCantidad] = useState(1);
  const [nota, setNota] = useState('');
  const [desc, setDesc] = useState<ValorDescuento>(SIN_DESCUENTO);
  const { ocupado, correr } = useAccion();
  const guardar = async () => {
    if (await correr('registrarCargo', { estudiante_id: quien?.estudiante_id, concepto, cantidad, nota, ...datosDescuento(desc) }, 'Cargo agregado')) onListo();
  };
  return (
    <Modal titulo={`Nuevo cargo · ${concepto}`} onCerrar={onCerrar}>
      <BuscarQuien valor={quien} onChange={setQuien} permitirPersona={false} />
      <div className="rejilla" style={{ marginTop: 10 }}>
        <Campo label="Montajes" ayuda={base ? `Valor: ${pesos(cantidad * base - desc.descuento)}` : undefined}><input type="number" min={1} value={cantidad} onChange={e => setCantidad(Number(e.target.value))} /></Campo>
        <Campo label="Nota (opcional)"><input value={nota} onChange={e => setNota(e.target.value)} /></Campo>
        {base > 0 && <SelectorDescuento concepto={concepto} base={cantidad * base} valor={desc} onChange={setDesc} />}
      </div>
      <div className="acciones"><button className="btn" disabled={ocupado || !quien?.estudiante_id || cantidad < 1 || (desc.descuento > 0 && !desc.motivo.trim())} onClick={guardar}>Agregar</button><button className="btn secundario" onClick={onCerrar}>Cancelar</button></div>
    </Modal>
  );
}

function SaldosTienda({ filtro, buscar }: { filtro: string; buscar: string }) {
  const { ir } = useApp();
  const { d, error, cargando, recargar } = useDatos<{ cuentas_tienda: FilaTienda[] }>('reporteTienda', { desde: hoy(), hasta: hoy() }, []);
  if (error) return <ErrorCaja msg={error} reintentar={recargar} />;
  if (cargando && !d) return <Cargando />;
  const filas = (d?.cuentas_tienda || []).filter(f => pasaFiltro(f.saldo, filtro) && (!buscar || norm(f.quien).includes(norm(buscar))));
  const porCobrar = (d?.cuentas_tienda || []).filter(f => f.saldo > 0).reduce((s, f) => s + f.saldo, 0);
  return (
    <>
      <div className="cifras"><Cifra t="Fiado por cobrar" v={pesos(porCobrar)} destacada /></div>
      <div className="tarjeta">
        <p className="suave mt0" style={{ fontSize: 13 }}>Para registrar que alguien pagó lo fiado, usa <b>Registrar pago</b> con el concepto <b>Cuenta tienda</b>.</p>
        {!filas.length ? <p className="vacio">Nadie con este filtro.</p> : (
          <div className="tabla-envoltura"><table className="tabla tarjetas">
            <thead><tr><th>Quién</th><th className="num">Fiado</th><th className="num">Pagado</th><th>Estado</th></tr></thead>
            <tbody>{filas.map((f, i) => <tr key={i}>
              <td>{f.estudiante_id ? <button className="enlace" onClick={() => ir('ficha', { estudiante_id: f.estudiante_id })}>{f.quien}</button> : f.quien}</td>
              <td className="num" data-label="Fiado">{pesos(f.fiado)}</td><td className="num" data-label="Pagado">{pesos(f.pagado)}</td><td data-label="Estado"><Estado saldo={f.saldo} />
                {f.saldo < 0 && <><br /><AccionesFavor estudiante_id={f.estudiante_id || undefined} persona={f.estudiante_id ? undefined : f.quien} nombre={f.quien} concepto="Cuenta tienda" favor={-f.saldo} onListo={recargar} /></>}
                {f.saldo > 0 && <><br /><button className="btn secundario chico" style={{ marginTop: 4 }} onClick={() => ir('pago', { ...(f.estudiante_id ? { estudiante_id: f.estudiante_id } : { persona: f.quien }), concepto: 'Cuenta tienda', valor: String(f.saldo) })}>Registrar pago</button></>}</td></tr>)}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ ventas de la tienda
type RepTienda = {
  por_dia: { fecha: string; vendido: number; efectivo: number; transferencia: number; fiado: number; consumo_interno: number; ventas: number }[];
  productos: { producto: string; cantidad: number; total: number }[];
  consumo_interno: Record<string, number>;
};
export function ReporteTienda() {
  const { ir } = useApp();
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState(hoy());
  const { d, error, cargando, recargar } = useDatos<RepTienda>('reporteTienda', { desde, hasta }, [desde, hasta]);
  const total = (d?.por_dia || []).reduce((s, x) => s + x.vendido, 0);
  return (
    <Pantalla titulo="Ventas de la tienda" sub="Por día y por producto">
      <Rango desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />
      {error && <ErrorCaja msg={error} reintentar={recargar} />}
      {cargando && !d && <Cargando />}
      {d && <>
        <div className="cifras">
          <Cifra t="Vendido en el periodo" v={pesos(total)} destacada />
          <Cifra t="Días con ventas" v={d.por_dia.length} />
          {Object.entries(d.consumo_interno).map(([k, v]) => <Cifra key={k} t={`Consumo de ${k}`} v={pesos(v)} />)}
        </div>
        <div className="acciones mt0" style={{ marginTop: 0, marginBottom: 12 }}><button className="btn secundario chico" onClick={() => ir('saldos', { concepto: 'Tienda (fiados)' })}>Ver quién debe en la tienda →</button></div>
        <div className="dos-columnas">
          <div className="tarjeta"><h3>Por día</h3>
            {!d.por_dia.length ? <p className="vacio">No hay ventas en estas fechas.</p> : <div className="tabla-envoltura"><table className="tabla">
              <thead><tr><th>Día</th><th className="num">Vendido</th><th className="num">Efectivo</th><th className="num">Transf.</th><th className="num">Fiado</th></tr></thead>
              <tbody>{d.por_dia.map(x => <tr key={x.fecha}><td>{fechaCorta(x.fecha)}<br /><small className="suave">{x.ventas} ventas</small></td><td className="num"><b>{pesos(x.vendido)}</b></td><td className="num">{pesos(x.efectivo)}</td><td className="num">{pesos(x.transferencia)}</td><td className="num">{pesos(x.fiado)}</td></tr>)}</tbody>
            </table></div>}
          </div>
          <div className="tarjeta"><h3>Lo más vendido</h3>
            {!d.productos.length ? <p className="vacio">Nada todavía.</p> : <ul className="lista-simple">{d.productos.map(p => <li key={p.producto}><span>{p.producto} <small className="suave">× {p.cantidad}</small></span><b className="monto">{pesos(p.total)}</b></li>)}</ul>}
          </div>
        </div>
      </>}
    </Pantalla>
  );
}

// ------------------------------------------------------------------ ficha del estudiante
type FichaCompleta = {
  estudiante: { id: string; nombre: string; plan: string };
  cargos: { id: string; concepto: string; cantidad: number; valor: number; pagado: number; saldo: number }[];
  pedidos: { id: string; fecha: string; valor: number; pagado: number; saldo: number; prendas: { prenda: string; talla: string; estado: string }[] }[];
  tienda: { fiado: number; pagado: number; saldo: number } | null;
  pagos: Record<string, any>[];
  a_favor?: { origen: string; concepto: string; pedido: string; saldo: number }[];
  total_a_favor?: number;
};
export function Ficha() {
  const { params, cat, ir } = useApp();
  const inicial = params.estudiante_id ? cat.estudiantes.find(e => e.id === params.estudiante_id) : undefined;
  const [quien, setQuien] = useState<Quien>(inicial ? { estudiante_id: inicial.id, nombre: inicial.nombre } : null);
  return (
    <Pantalla titulo="Ficha de estudiante" sub="Todo lo que debe y ha pagado">
      <div className="tarjeta"><BuscarQuien valor={quien} onChange={q => { setQuien(q); if (q?.estudiante_id) ir('ficha', { estudiante_id: q.estudiante_id }); }} permitirPersona={false} /></div>
      {quien?.estudiante_id && <FichaDe id={quien.estudiante_id} />}
    </Pantalla>
  );
}
function FichaDe({ id }: { id: string }) {
  const { d, error, cargando, recargar } = useDatos<FichaCompleta>('fichaEstudiante', { estudiante_id: id }, [id]);
  if (error) return <ErrorCaja msg={error} reintentar={recargar} />;
  if (cargando && !d) return <Cargando />;
  if (!d) return null;
  return (
    <>
      {(d.total_a_favor || 0) > 0 && (
        <div className="tarjeta" style={{ borderLeft: '4px solid var(--favor)' }}>
          <h3>Saldo a favor: {pesos(d.total_a_favor || 0)}</h3>
          <ul className="lista-simple">{(d.a_favor || []).map((x, i) => (
            <li key={i} style={{ flexWrap: 'wrap', alignItems: 'center' }}>
              <span>{x.concepto}{x.pedido ? ' ' + x.pedido : ''}: <b>{pesos(-x.saldo)}</b></span>
              <AccionesFavor estudiante_id={d.estudiante.id} nombre={d.estudiante.nombre} concepto={x.concepto} pedido={x.pedido} favor={-x.saldo} onListo={recargar} />
            </li>))}
          </ul>
        </div>
      )}
      <div className="rejilla">
        <div className="tarjeta"><h3>Cargos</h3>
          {!d.cargos.length ? <p className="vacio">Sin cargos.</p> : <ul className="lista-simple">{d.cargos.map(c => <li key={c.id}><span>{c.concepto}{c.cantidad > 1 ? ` (${c.cantidad})` : ''}<br /><small className="suave">{pesos(c.pagado)} de {pesos(c.valor)}</small></span><Estado saldo={c.saldo} /></li>)}</ul>}
        </div>
        <div className="tarjeta"><h3>Uniformes</h3>
          {!d.pedidos.length ? <p className="vacio">Sin pedidos.</p> : <ul className="lista-simple">{d.pedidos.map(p => <li key={p.id} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
            <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span>{p.id} · {fechaCorta(p.fecha)}</span><Estado saldo={p.saldo} /></span>
            <small className="suave">{p.prendas.map(x => `${x.prenda}${x.talla ? ' ' + x.talla : ''}: ${x.estado}`).join(' · ')}</small></li>)}</ul>}
        </div>
        <div className="tarjeta"><h3>Tienda</h3>{d.tienda ? <ul className="lista-simple"><li><span>Fiado {pesos(d.tienda.fiado)} · pagado {pesos(d.tienda.pagado)}</span><Estado saldo={d.tienda.saldo} /></li></ul> : <p className="vacio">Al día en la tienda.</p>}</div>
      </div>
      <div className="tarjeta"><h3>Pagos</h3>
        {!d.pagos.length ? <p className="vacio">No hay pagos registrados.</p> : <div className="tabla-envoltura"><table className="tabla tarjetas">
          <thead><tr><th>Fecha</th><th>Concepto</th><th className="num">Valor</th><th>Método</th><th>Cuenta</th><th></th></tr></thead>
          <tbody>{d.pagos.map(p => <tr key={p.id} className={p.estado === 'anulado' ? 'anulado' : ''}>
            <td data-label="Fecha">{fechaCorta(p.fecha)}</td><td data-label="Concepto"><b>{p.concepto}</b>{p.descuento ? <><br /><small className="suave">Descuento {pesos(p.descuento)}: {p.motivo_descuento}</small></> : null}{p.nota && <><br /><small className="suave">{p.nota}</small></>}</td><td className="num" data-label="Valor">{pesos(p.valor)}</td><td data-label="Método">{p.metodo}</td><td data-label="Cuenta">{p.recibido_en || '—'}</td>
            <td className="sin-tachar">{p.estado === 'anulado' ? <span className="chip anulado" title={p.motivo_anulacion}>Anulado</span> : <BotonAnular hoja="Pagos" id={p.id} onListo={recargar} />}</td></tr>)}</tbody>
        </table></div>}
      </div>
    </>
  );
}

// ------------------------------------------------------------------ cuentas
type RepCuentas = { cuentas: { cuenta: string; saldo_total: number; entradas: number; salidas: number; segun_cierre?: string }[]; movimientos: { fecha: string; cuenta: string; valor: number; tipo: string; detalle: string; id: string }[] };
export function Cuentas() {
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState(hoy());
  const [cuenta, setCuenta] = useState('');
  const { d, error, cargando, recargar } = useDatos<RepCuentas>('reporteCuentas', { desde, hasta }, [desde, hasta]);
  const movs = (d?.movimientos || []).filter(m => !cuenta || m.cuenta === cuenta);
  return (
    <Pantalla titulo="Cuentas" sub="Entradas y salidas por cuenta">
      <Rango desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />
      {error && <ErrorCaja msg={error} reintentar={recargar} />}
      {cargando && !d && <Cargando />}
      {d && <>
        <div className="tarjeta"><div className="tabla-envoltura"><table className="tabla">
          <thead><tr><th>Cuenta</th><th className="num">Entradas</th><th className="num">Salidas</th><th className="num">Saldo acumulado</th></tr></thead>
          <tbody>{d.cuentas.map(c => <tr key={c.cuenta}><td><button className="enlace" onClick={() => setCuenta(c.cuenta === cuenta ? '' : c.cuenta)}>{c.cuenta}</button></td><td className="num">{pesos(c.entradas)}</td><td className="num">{pesos(c.salidas)}</td><td className="num"><b>{pesos(c.saldo_total)}</b>{c.segun_cierre && <><br /><small className="suave">según el cierre del {fechaCorta(c.segun_cierre)}</small></>}</td></tr>)}</tbody>
        </table></div>
        <p className="suave" style={{ fontSize: 13, marginBottom: 0 }}>El saldo acumulado cuenta todo lo registrado aquí desde la migración. Lo de antes que quedó como “Sin dato” no se sabe a qué cuenta entró.</p></div>
        <div className="tarjeta"><h3>Movimientos{cuenta ? ` · ${cuenta}` : ''} {cuenta && <button className="enlace" onClick={() => setCuenta('')}>(ver todas)</button>}</h3>
          {!movs.length ? <p className="vacio">Sin movimientos.</p> : <div className="tabla-envoltura"><table className="tabla">
            <thead><tr><th>Fecha</th><th>Cuenta</th><th>Tipo</th><th>Detalle</th><th className="num">Valor</th></tr></thead>
            <tbody>{movs.slice(0, 300).map((m, i) => <tr key={m.id + i}><td>{fechaCorta(m.fecha)}</td><td>{m.cuenta}</td><td>{m.tipo}</td><td>{m.detalle}</td><td className="num" style={{ color: m.valor < 0 ? 'var(--error)' : 'var(--ok)' }}>{pesos(m.valor)}</td></tr>)}</tbody>
          </table></div>}
        </div>
      </>}
    </Pantalla>
  );
}

// ------------------------------------------------------------------ pagos a profes
type RepProfes = { total: number; por_profe: { profe: string; clases: number; total: number; pagos: number }[]; filas: Record<string, any>[] };
export function ReporteProfes() {
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState(hoy());
  const { d, error, cargando, recargar } = useDatos<RepProfes>('reporteProfes', { desde, hasta }, [desde, hasta]);
  return (
    <Pantalla titulo="Pagos a profes" sub="Cuánto se le ha pagado a cada profe">
      <Rango desde={desde} hasta={hasta} setDesde={setDesde} setHasta={setHasta} />
      {error && <ErrorCaja msg={error} reintentar={recargar} />}
      {cargando && !d && <Cargando />}
      {d && <>
        <div className="cifras"><Cifra t="Total pagado" v={pesos(d.total)} destacada /></div>
        <div className="tarjeta"><h3>Por profe</h3>
          {!d.por_profe.length ? <p className="vacio">No hay pagos en estas fechas.</p> : <ul className="lista-simple">{d.por_profe.map(p => <li key={p.profe}><span>{p.profe} <small className="suave">{p.clases} clases · {p.pagos} pago(s)</small></span><b className="monto">{pesos(p.total)}</b></li>)}</ul>}
        </div>
        {d.filas.length > 0 && <div className="tarjeta"><h3>Detalle</h3><div className="tabla-envoltura"><table className="tabla">
          <thead><tr><th>Fecha</th><th>Profe</th><th>Periodo</th><th className="num">Clases</th><th className="num">Por clase</th><th className="num">Total</th><th></th></tr></thead>
          <tbody>{d.filas.map(f => <tr key={f.id}><td>{fechaCorta(f.fecha)}</td><td>{f.profe}</td><td>{f.periodo}</td><td className="num">{f.clases}</td><td className="num">{pesos(f.valor_clase)}</td><td className="num">{pesos(f.total)}</td><td><BotonAnular hoja="Pago profes" id={f.pago} onListo={recargar} etiqueta="Anular pago" /></td></tr>)}</tbody>
        </table></div></div>}
      </>}
    </Pantalla>
  );
}

// ------------------------------------------------------------------ historial y anulaciones
const HOJAS: Record<string, { cols: [string, string][]; grupo?: string; anulable: boolean }> = {
  'Pagos': { cols: [['fecha', 'Fecha'], ['quien', 'Quién'], ['concepto', 'Concepto'], ['valor', 'Valor'], ['metodo', 'Método'], ['recibido_en', 'Cuenta'], ['tipo', 'Tipo']], anulable: true },
  'Ventas tienda': { cols: [['fecha', 'Fecha'], ['venta', 'Venta'], ['producto', 'Producto'], ['cantidad', 'Cant.'], ['total', 'Total'], ['metodo', 'Método'], ['quien', 'Quién']], grupo: 'venta', anulable: true },
  'Pedidos uniforme': { cols: [['fecha', 'Fecha'], ['id', 'Pedido'], ['quien', 'Quién'], ['valor_acordado', 'Valor']], anulable: true },
  'Pago profes': { cols: [['fecha', 'Fecha'], ['pago', 'Pago'], ['profe', 'Profe'], ['periodo', 'Periodo'], ['clases', 'Clases'], ['total', 'Total']], grupo: 'pago', anulable: true },
  'Gastos': { cols: [['fecha', 'Fecha'], ['categoria', 'Categoría'], ['descripcion', 'Descripción'], ['valor', 'Valor'], ['pagado_desde', 'Salió de']], anulable: true },
  'Traslados': { cols: [['fecha', 'Fecha'], ['de', 'De'], ['a', 'A'], ['valor', 'Valor']], anulable: true },
  'Cargos': { cols: [['quien', 'Estudiante'], ['concepto', 'Concepto'], ['cantidad', 'Cant.'], ['valor_total', 'Valor']], anulable: true },
  'Bitácora': { cols: [['fecha_hora', 'Fecha y hora'], ['usuario', 'Usuario'], ['accion', 'Acción'], ['hoja', 'Hoja'], ['id', 'Registro']], anulable: false },
};
const DINERO = new Set(['valor', 'total', 'valor_acordado', 'valor_total']);

export function Historial() {
  const [hoja, setHoja] = useState('Pagos');
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState(hoy());
  const [buscar, setBuscar] = useState('');
  const [q, setQ] = useState('');
  const conFecha = hoja !== 'Cargos';
  const { d, error, cargando, recargar } = useDatos<{ total: number; filas: Record<string, any>[] }>('registros',
    { hoja, limite: 300, buscar: q, ...(conFecha ? { desde, hasta } : {}) }, [hoja, desde, hasta, q]);
  const conf = HOJAS[hoja];
  const vistos = new Set<string>();
  return (
    <Pantalla titulo="Historial y anulaciones" sub="Todo lo registrado. Anular deja rastro: quién, cuándo y por qué">
      <div className="segmentado" style={{ marginBottom: 12 }}>{Object.keys(HOJAS).map(h => <button key={h} className={h === hoja ? 'activo' : ''} onClick={() => setHoja(h)}>{h}</button>)}</div>
      <div className="tarjeta"><div className="rejilla">
        {conFecha && <Campo label="Desde"><input type="date" value={desde} max={hasta} onChange={e => setDesde(e.target.value)} /></Campo>}
        {conFecha && <Campo label="Hasta"><input type="date" value={hasta} max={hoy()} onChange={e => setHasta(e.target.value)} /></Campo>}
        <Campo label="Buscar"><form onSubmit={e => { e.preventDefault(); setQ(buscar); }} style={{ display: 'flex', gap: 6 }}><input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Nombre, concepto, id…" /><button className="btn chico">Buscar</button></form></Campo>
      </div></div>
      {error && <ErrorCaja msg={error} reintentar={recargar} />}
      {cargando && !d && <Cargando />}
      {d && <div className="tarjeta">
        <p className="suave mt0" style={{ fontSize: 13 }}>{d.total} registro(s){d.total > d.filas.length ? `, se muestran los ${d.filas.length} más recientes` : ''}.</p>
        {!d.filas.length ? <p className="vacio">Nada en estas fechas.</p> : <div className="tabla-envoltura"><table className="tabla">
          <thead><tr>{conf.cols.map(([, t]) => <th key={t} className={DINERO.has(t.toLowerCase()) ? 'num' : ''}>{t}</th>)}<th>Registró</th><th></th></tr></thead>
          <tbody>{d.filas.map((f, i) => {
            const anulado = f.estado === 'anulado';
            const idAnular = conf.grupo ? f[conf.grupo] : f.id;
            const mostrarBoton = conf.anulable && !anulado && !vistos.has(idAnular);
            vistos.add(idAnular);
            return (
              <tr key={(f.id || '') + i} className={anulado ? 'anulado' : ''}>
                {conf.cols.map(([k]) => {
                  const v = k === 'quien' ? (f.estudiante || f.persona || '') : f[k];
                  return <td key={k} className={DINERO.has(k) ? 'num' : ''}>{DINERO.has(k) ? pesos(v) : k === 'fecha' ? fechaCorta(v) : String(v ?? '')}</td>;
                })}
                <td style={{ fontSize: 13 }}>{f.registrado_por || f.usuario || ''}</td>
                <td className="sin-tachar" style={{ whiteSpace: 'nowrap' }}>
                  {anulado ? <span className="chip anulado" title={`${f.anulado_por || ''} ${f.anulado_en || ''}`}>Anulado: {f.motivo_anulacion}</span>
                    : mostrarBoton ? <BotonAnular hoja={hoja} id={idAnular} onListo={recargar} etiqueta={conf.grupo ? `Anular ${idAnular}` : 'Anular'} /> : null}
                  {hoja === 'Bitácora' && <small className="suave" style={{ display: 'block', maxWidth: 380, whiteSpace: 'normal', wordBreak: 'break-word' }}>{String(f.detalle || '').slice(0, 220)}</small>}
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>}
      </div>}
    </Pantalla>
  );
}
