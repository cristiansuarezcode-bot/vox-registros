'use client';
import { useState } from 'react';
import type { Quien } from '@/lib/tipos';
import { fechaCorta, hoy, pesos } from '@/lib/util';
import { BuscarQuien, Campo, Cargando, ErrorCaja, Modal, Monto, Pantalla, Segmentado, Selector, cuentasTodas, useAccion, useApp, useDatos, usePorPartes } from './ui';

type Integrante = { id: string; estudiante_id: string; estudiante: string; esperado: number; pagado: number; saldo: number };
type Abono = { id: string; fecha: string; valor: number; pagado_desde: string; nota: string };
type Costo = { id: string; proveedor: string; descripcion: string; valor: number; nota: string; pagado: number; pendiente: number; abonos: Abono[] };
type Montaje = { id: string; nombre: string; profe: string; valor_vestuario: number; activo: boolean; nota: string; integrantes: Integrante[]; cantidad: number; esperado: number; recogido: number; por_cobrar: number; costos?: Costo[] };
type PorRevisar = { estudiante_id: string; estudiante: string; cargo: string; montajes_cargo: number; montajes_asignados: number; valor: number };
type Lista = { es_director: boolean; valor_base: number; montajes: Montaje[]; por_revisar: PorRevisar[]; pagado_de_mas: number; pagos_sin_montaje: number };

export function Montajes() {
  const { d, error, cargando, recargar } = useDatos<Lista>('listarMontajes', {}, []);
  const [editar, setEditar] = useState<Montaje | 'nuevo' | null>(null);
  const [verArchivados, setVerArchivados] = useState(false);
  const [vista, setVista] = useState<'Grupos' | 'Ganancias'>('Grupos');
  const activos = (d?.montajes || []).filter(m => m.activo);
  const archivados = (d?.montajes || []).filter(m => !m.activo);
  return (
    <Pantalla titulo="Montajes de la clausura" sub="Cada grupo con sus integrantes. El cargo de vestuario de cada estudiante se calcula solo con sus montajes">
      {error && <ErrorCaja msg={error} reintentar={recargar} />}
      {cargando && !d && <Cargando texto="Cargando montajes…" />}
      {d?.es_director && <div className="vista-montajes"><Segmentado opciones={['Grupos', 'Ganancias'] as const} valor={vista} onChange={setVista} /></div>}
      {d && d.es_director && vista === 'Ganancias' && <Ganancias d={d} />}
      {d && !(d.es_director && vista === 'Ganancias') && <>
        <div className="cifras">
          <div className="cifra destacada"><span>Montajes</span><b>{activos.length}</b></div>
          <div className="cifra"><span>Integrantes</span><b>{activos.reduce((s, m) => s + m.cantidad, 0)}</b></div>
          <div className="cifra"><span>Debería recoger</span><b>{pesos(activos.reduce((s, m) => s + m.esperado, 0))}</b></div>
          <div className="cifra"><span>Recogido</span><b>{pesos(activos.reduce((s, m) => s + m.recogido, 0))}</b></div>
          <div className="cifra"><span>Falta por cobrar</span><b>{pesos(activos.reduce((s, m) => s + m.por_cobrar, 0))}</b></div>
          {d.es_director && <>
            <div className="cifra"><span>Costo vestuarios</span><b>{pesos(sumaCostos(activos, 'valor'))}</b></div>
            <div className="cifra"><span>Debemos a proveedores</span><b>{pesos(sumaCostos(activos, 'pendiente'))}</b></div>
          </>}
        </div>
        {(d.pagado_de_mas > 0 || d.pagos_sin_montaje > 0) && <p className="suave" style={{ fontSize: 13, marginTop: -4 }}>
          {d.pagado_de_mas > 0 && <>Pagado de más (queda a favor de los estudiantes): {pesos(d.pagado_de_mas)}. </>}
          {d.pagos_sin_montaje > 0 && <>Pagos de vestuario de quienes aún no tienen montaje: {pesos(d.pagos_sin_montaje)}.</>}
        </p>}
        {d.es_director && <div className="acciones mt0" style={{ marginTop: 0, marginBottom: 14 }}>
          <button className="btn" onClick={() => setEditar('nuevo')}>+ Nuevo montaje</button>
        </div>}
        {d.por_revisar.length > 0 && activos.length > 0 && <PorAsignar filas={d.por_revisar} montajes={activos} onListo={recargar} />}
        {!activos.length && <div className="tarjeta"><p className="vacio">{d.es_director ? 'Todavía no hay montajes. Crea el primero con “+ Nuevo montaje”.' : 'Todavía no hay montajes. Cristian o Liz los crean.'}</p></div>}
        <div className="montajes">
          {activos.map(m => <TarjetaMontaje key={m.id} m={m} director={d.es_director} onEditar={() => setEditar(m)} onListo={recargar} />)}
        </div>
        {archivados.length > 0 && <div className="tarjeta">
          <button className="enlace" onClick={() => setVerArchivados(v => !v)}>{verArchivados ? 'Ocultar' : 'Ver'} montajes archivados ({archivados.length})</button>
          {verArchivados && <ul className="lista-simple" style={{ marginTop: 8 }}>{archivados.map(m => (
            <li key={m.id}><span>{m.nombre}{m.profe && <small className="suave"> · {m.profe}</small>}</span>
              {d.es_director && <button className="btn secundario chico" onClick={() => setEditar(m)}>Editar</button>}</li>))}
          </ul>}
        </div>}
      </>}
      {editar && d && <EditarMontaje m={editar === 'nuevo' ? null : editar} valorBase={d.valor_base} onCerrar={() => setEditar(null)} onListo={() => { setEditar(null); recargar(); }} />}
    </Pantalla>
  );
}

const sumaCostos = (ms: Montaje[], campo: 'valor' | 'pagado' | 'pendiente') => ms.reduce((s, m) => s + (m.costos || []).reduce((t, c) => t + c[campo], 0), 0);

function TarjetaMontaje({ m, director, onEditar, onListo }: { m: Montaje; director: boolean; onEditar: () => void; onListo: () => void }) {
  const { aviso } = useApp();
  const { ocupado, correr } = useAccion();
  const [abierto, setAbierto] = useState(false);
  const [clave, setClave] = useState(0);
  const [quitar, setQuitar] = useState<Integrante | null>(null);
  const lista = usePorPartes(m.integrantes, 50, m.id);
  const agregar = async (q: Quien) => {
    if (!q?.estudiante_id) return;
    const r = await correr<{ estudiante: string; aviso: string }>('agregarIntegrante', { montaje_id: m.id, estudiante_id: q.estudiante_id });
    setClave(k => k + 1);
    if (r) { aviso(r.aviso || `${r.estudiante} quedó en ${m.nombre}`); onListo(); }
  };
  return (
    <div className="tarjeta montaje">
      <div className="montaje-cabeza">
        <div>
          <h3 className="mt0">{m.nombre}</h3>
          <span className="suave">{m.profe ? `${m.profe} · ` : ''}Vestuario {pesos(m.valor_vestuario)}</span>
        </div>
        {director && <button className="btn secundario chico" onClick={onEditar}>Editar</button>}
      </div>
      <div className="montaje-datos">
        <div><span>Integrantes</span><b>{m.cantidad}</b></div>
        <div><span>Debería recoger</span><b>{pesos(m.esperado)}</b></div>
        <div><span>Recogido</span><b>{pesos(m.recogido)}</b></div>
        <div><span>Falta por cobrar</span><b className={m.por_cobrar > 0 ? 'debe' : ''}>{pesos(m.por_cobrar)}</b></div>
      </div>
      {m.esperado > 0 && <div className="avance" title={`${Math.round(m.recogido * 100 / m.esperado)}% recogido`}><span style={{ width: `${Math.min(100, m.recogido * 100 / m.esperado)}%` }} /></div>}
      {m.nota && <p className="suave" style={{ fontSize: 13, margin: '0 0 8px' }}>{m.nota}</p>}
      {director && m.costos && <CostosMontaje m={m} onListo={onListo} />}
      <button className="btn secundario" style={{ width: '100%' }} onClick={() => setAbierto(a => !a)}>{abierto ? 'Ocultar integrantes' : `Ver y agregar integrantes`}</button>
      {abierto && <div style={{ marginTop: 12 }}>
        <div key={clave}><BuscarQuien valor={null} onChange={agregar} permitirPersona={false} etiqueta="Agregar integrante" /></div>
        {ocupado && <p className="suave" style={{ fontSize: 13 }}>Guardando…</p>}
        {!m.integrantes.length ? <p className="vacio">Sin integrantes todavía.</p> : <>
          <ul className="lista-simple integrantes">{lista.visibles.map(i => (
            <li key={i.id}>
              <span>{i.estudiante}</span>
              <span className="integrante-estado">
                {i.saldo <= 0 ? <span className="chip ok">Al día</span> : <span className="chip debe">Debe {pesos(i.saldo)}</span>}
                <button className="enlace" onClick={() => setQuitar(i)}>Quitar</button>
              </span>
            </li>))}
          </ul>
          {lista.verMas}
        </>}
      </div>}
      {quitar && <QuitarIntegrante i={quitar} montaje={m.nombre} onCerrar={() => setQuitar(null)} onListo={() => { setQuitar(null); onListo(); }} />}
    </div>
  );
}

function QuitarIntegrante({ i, montaje, onCerrar, onListo }: { i: Integrante; montaje: string; onCerrar: () => void; onListo: () => void }) {
  const { aviso } = useApp();
  const { ocupado, correr } = useAccion();
  const [motivo, setMotivo] = useState('');
  const confirmar = async () => {
    const r = await correr<{ aviso: string }>('quitarIntegrante', { id: i.id, motivo });
    if (r) { aviso(r.aviso || `${i.estudiante} salió de ${montaje}`); onListo(); }
  };
  return (
    <Modal titulo={`Quitar a ${i.estudiante}`} onCerrar={onCerrar}>
      <p style={{ fontSize: 15 }}>Sale de <b>{montaje}</b> y su cargo de vestuario se recalcula. Lo que ya pagó no se pierde.</p>
      <div className="rejilla"><Campo label="Motivo (opcional)" ancho><input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ej: se cambió de grupo" /></Campo></div>
      <div className="acciones"><button className="btn peligro" disabled={ocupado} onClick={confirmar}>{ocupado ? 'Quitando…' : 'Quitar del montaje'}</button><button className="btn secundario" onClick={onCerrar}>Cancelar</button></div>
    </Modal>
  );
}

function PorAsignar({ filas, montajes, onListo }: { filas: PorRevisar[]; montajes: Montaje[]; onListo: () => void }) {
  const [abierto, setAbierto] = useState(false);
  const lista = usePorPartes(filas, 30, String(filas.length));
  return (
    <div className="tarjeta" style={{ borderLeft: '4px solid var(--acento, #7b1028)' }}>
      <h3 className="mt0">Por asignar: {filas.length} estudiante(s)</h3>
      <p className="suave mt0" style={{ fontSize: 14 }}>Tienen cargo de vestuario pero les faltan montajes asignados. Mientras tanto su cargo no cambia.</p>
      {!abierto ? <button className="btn secundario chico" onClick={() => setAbierto(true)}>Ver la lista</button> : <>
        <ul className="lista-simple por-asignar">{lista.visibles.map(f => <FilaAsignar key={f.estudiante_id} f={f} montajes={montajes} onListo={onListo} />)}</ul>
        {lista.verMas}
      </>}
    </div>
  );
}

function FilaAsignar({ f, montajes, onListo }: { f: PorRevisar; montajes: Montaje[]; onListo: () => void }) {
  const { aviso } = useApp();
  const { ocupado, correr } = useAccion();
  const opciones = montajes.filter(m => !m.integrantes.some(i => i.estudiante_id === f.estudiante_id));
  const [montaje, setMontaje] = useState('');
  const [salir, setSalir] = useState(false);
  const agregar = async () => {
    const r = await correr<{ estudiante: string; montaje: string; aviso: string }>('agregarIntegrante', { montaje_id: montaje, estudiante_id: f.estudiante_id });
    if (r) { aviso(r.aviso || `${r.estudiante} quedó en ${r.montaje}`); onListo(); }
  };
  const completo = async () => {
    if (await correr('confirmarMontajes', { estudiante_id: f.estudiante_id }, `El cargo de ${f.estudiante} quedó con ${f.montajes_asignados} montaje(s)`)) onListo();
  };
  return (
    <li>
      <span><b>{f.estudiante}</b><br /><small className="suave">En el cargo: {f.montajes_cargo} · Asignados: {f.montajes_asignados}</small></span>
      <span className="fila-asignar">
        <span className="campo"><Selector valor={montaje} onChange={setMontaje} vacio="Agregar a…" opciones={opciones.map(m => ({ v: m.id, t: m.nombre }))} /></span>
        <button className="btn chico" disabled={!montaje || ocupado} onClick={agregar}>Agregar</button>
        {f.montajes_asignados > 0 && f.montajes_asignados < f.montajes_cargo && <button className="btn secundario chico" disabled={ocupado} onClick={completo} title="El número del cargo estaba mal: dejar solo los asignados">Está completo</button>}
        {f.montajes_asignados === 0 && <button className="btn secundario chico" disabled={ocupado} onClick={() => setSalir(true)}>Ya no participa</button>}
      </span>
      {salir && <NoParticipa f={f} onCerrar={() => setSalir(false)} onListo={() => { setSalir(false); onListo(); }} />}
    </li>
  );
}

function NoParticipa({ f, onCerrar, onListo }: { f: PorRevisar; onCerrar: () => void; onListo: () => void }) {
  const { aviso } = useApp();
  const { ocupado, correr } = useAccion();
  const [motivo, setMotivo] = useState('');
  const confirmar = async () => {
    const r = await correr<{ a_favor: number }>('noParticipa', { estudiante_id: f.estudiante_id, motivo });
    if (r) { aviso(`${f.estudiante} ya no participa: su cargo de vestuario quedó en $0${r.a_favor > 0 ? ` y tiene ${pesos(r.a_favor)} a favor` : ''}`); onListo(); }
  };
  return (
    <Modal titulo={`${f.estudiante} ya no participa`} onCerrar={onCerrar}>
      <p style={{ fontSize: 15 }}>Su cargo de vestuario ({pesos(f.valor)}) queda en $0. Si ya había pagado algo, le queda a favor para devolvérselo o usarlo en otra cosa.</p>
      <div className="rejilla"><Campo label="Motivo (opcional)" ancho><input value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ej: se retiró de la academia" /></Campo></div>
      <div className="acciones"><button className="btn peligro" disabled={ocupado} onClick={confirmar}>{ocupado ? 'Guardando…' : 'Confirmar'}</button><button className="btn secundario" onClick={onCerrar}>Cancelar</button></div>
    </Modal>
  );
}

function EditarMontaje({ m, valorBase, onCerrar, onListo }: { m: Montaje | null; valorBase: number; onCerrar: () => void; onListo: () => void }) {
  const { aviso } = useApp();
  const { ocupado, correr } = useAccion();
  const [nombre, setNombre] = useState(m?.nombre || '');
  const [profe, setProfe] = useState(m?.profe || '');
  const [valor, setValor] = useState(m ? m.valor_vestuario : valorBase || 150000);
  const [nota, setNota] = useState(m?.nota || '');
  const guardar = async (extra: Record<string, unknown> = {}) => {
    const datos: Record<string, unknown> = m ? { id: m.id, ...extra } : {};
    if (!extra.activo && extra.activo !== false) {
      if (!m || nombre.trim() !== m.nombre) datos.nombre = nombre;
      if (!m || profe.trim() !== m.profe) datos.profe = profe;
      if (!m || valor !== m.valor_vestuario) datos.valor_vestuario = valor;
      if (!m || nota.trim() !== m.nota) datos.nota = nota;
    }
    const r = await correr<{ cargos_recalculados?: number; avisos?: string[] }>('guardarMontaje', datos);
    if (r) {
      aviso(extra.activo === false ? `${m?.nombre} archivado` : extra.activo ? `${m?.nombre} activo otra vez`
        : !m ? `Montaje ${nombre.trim()} creado` : r.cargos_recalculados ? `Montaje actualizado: se recalcularon ${r.cargos_recalculados} cargo(s)` : 'Montaje actualizado');
      onListo();
    }
  };
  return (
    <Modal titulo={m ? `Editar ${m.nombre}` : 'Nuevo montaje'} onCerrar={onCerrar}>
      <div className="rejilla">
        <Campo label="Nombre del montaje" ancho><input autoFocus value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej: Urbano kids" /></Campo>
        <Campo label="Profe o coreógrafo (opcional)"><input value={profe} onChange={e => setProfe(e.target.value)} /></Campo>
        <Campo label="Valor del vestuario" ayuda={m && m.cantidad && valor !== m.valor_vestuario ? `Se recalcula el cargo de sus ${m.cantidad} integrante(s).` : 'Por estudiante'}><Monto valor={valor} onChange={setValor} /></Campo>
        <Campo label="Nota (opcional)" ancho><input value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej: vestuario negro con dorado" /></Campo>
      </div>
      <div className="acciones">
        <button className="btn" disabled={ocupado || !nombre.trim() || valor <= 0} onClick={() => guardar()}>{ocupado ? 'Guardando…' : 'Guardar'}</button>
        <button className="btn secundario" onClick={onCerrar}>Cancelar</button>
        {m && (m.activo
          ? <button className="btn secundario" style={{ marginLeft: 'auto' }} disabled={ocupado || m.cantidad > 0} title={m.cantidad ? 'Quita primero sus integrantes' : ''} onClick={() => guardar({ activo: false })}>Archivar</button>
          : <button className="btn secundario" style={{ marginLeft: 'auto' }} disabled={ocupado} onClick={() => guardar({ activo: true })}>Activar</button>)}
      </div>
      {m && m.activo && m.cantidad > 0 && <p className="ayuda" style={{ marginTop: 8 }}>Para archivarlo primero hay que quitar sus integrantes.</p>}
    </Modal>
  );
}

// ------------------------------------------------------------------ costos del vestuario (solo directores)
function CostosMontaje({ m, onListo }: { m: Montaje; onListo: () => void }) {
  const costos = m.costos || [];
  const [abierto, setAbierto] = useState(false);
  const [editar, setEditar] = useState<Costo | 'nuevo' | null>(null);
  const [abonar, setAbonar] = useState<Costo | null>(null);
  const total = costos.reduce((s, c) => s + c.valor, 0);
  const pendiente = costos.reduce((s, c) => s + c.pendiente, 0);
  return (
    <div className="costos-montaje">
      <button className="costos-resumen" onClick={() => setAbierto(a => !a)} aria-expanded={abierto}>
        <span><small>Costo del vestuario</small><b>{costos.length ? pesos(total) : 'Sin registrar'}</b></span>
        {costos.length > 0 && (pendiente > 0 ? <span className="chip debe">Debemos {pesos(pendiente)}</span> : <span className="chip ok">Pagado</span>)}
        <span className="flecha">{abierto ? '▲' : '▼'}</span>
      </button>
      {abierto && <div className="costos-detalle">
        {!costos.length && <p className="suave" style={{ fontSize: 14, margin: '0 0 10px' }}>Agrega lo que cuesta el vestuario: uno por proveedor (confección, accesorios, zapatos…).</p>}
        {costos.map(c => (
          <div key={c.id} className="costo">
            <div className="costo-cabeza">
              <span><b>{c.proveedor}</b>{c.descripcion && <small className="suave"> · {c.descripcion}</small>}</span>
              <b>{pesos(c.valor)}</b>
            </div>
            <div className="costo-estado">
              <span className="suave">Pagado {pesos(c.pagado)}</span>
              {c.pendiente > 0 ? <span className="chip debe">Falta {pesos(c.pendiente)}</span> : <span className="chip ok">Paz y salvo</span>}
            </div>
            {c.abonos.length > 0 && <ul className="abonos">{c.abonos.map(a => (
              <li key={a.id}><span>{fechaCorta(a.fecha)} · {a.pagado_desde}{a.nota && <small className="suave"> · {a.nota}</small>}</span><span>{pesos(a.valor)}</span></li>))}
            </ul>}
            {c.nota && <p className="suave" style={{ fontSize: 13, margin: '4px 0 0' }}>{c.nota}</p>}
            <div className="costo-acciones">
              {c.pendiente > 0 && <button className="btn chico" onClick={() => setAbonar(c)}>Registrar pago</button>}
              <button className="btn secundario chico" onClick={() => setEditar(c)}>Editar</button>
            </div>
          </div>
        ))}
        <button className="btn secundario chico" onClick={() => setEditar('nuevo')}>+ Agregar costo</button>
      </div>}
      {editar && <EditarCosto m={m} c={editar === 'nuevo' ? null : editar} onCerrar={() => setEditar(null)} onListo={() => { setEditar(null); setAbierto(true); onListo(); }} />}
      {abonar && <AbonarCosto m={m} c={abonar} onCerrar={() => setAbonar(null)} onListo={() => { setAbonar(null); onListo(); }} />}
    </div>
  );
}

function EditarCosto({ m, c, onCerrar, onListo }: { m: Montaje; c: Costo | null; onCerrar: () => void; onListo: () => void }) {
  const { aviso } = useApp();
  const { ocupado, correr } = useAccion();
  const [proveedor, setProveedor] = useState(c?.proveedor || '');
  const [descripcion, setDescripcion] = useState(c?.descripcion || '');
  const [valor, setValor] = useState(c?.valor || 0);
  const [nota, setNota] = useState(c?.nota || '');
  const [anular, setAnular] = useState(false);
  const [motivo, setMotivo] = useState('');
  const guardar = async () => {
    const datos: Record<string, unknown> = c ? { id: c.id } : { montaje_id: m.id };
    if (!c || proveedor.trim() !== c.proveedor) datos.proveedor = proveedor;
    if (!c || descripcion.trim() !== c.descripcion) datos.descripcion = descripcion;
    if (!c || valor !== c.valor) datos.valor = valor;
    if (!c || nota.trim() !== c.nota) datos.nota = nota;
    if (await correr('guardarCostoMontaje', datos)) { aviso(c ? 'Costo actualizado' : `Costo de ${proveedor.trim()} agregado a ${m.nombre}`); onListo(); }
  };
  const quitar = async () => {
    if (await correr('anular', { hoja: 'Costos montaje', id: c!.id, motivo }, 'Costo anulado')) onListo();
  };
  const bajo = c && valor > 0 && valor < c.pagado;
  return (
    <Modal titulo={c ? `Costo de ${c.proveedor}` : `Nuevo costo · ${m.nombre}`} onCerrar={onCerrar}>
      <div className="rejilla">
        <Campo label="Proveedor"><input autoFocus value={proveedor} onChange={e => setProveedor(e.target.value)} placeholder="Ej: Confecciones Luz" /></Campo>
        <Campo label="¿Qué incluye? (opcional)"><input value={descripcion} onChange={e => setDescripcion(e.target.value)} placeholder="Ej: 12 vestidos con falda" /></Campo>
        <Campo label="Valor total" ayuda={bajo ? `Ya se le pagaron ${pesos(c!.pagado)}: no puede quedar por debajo.` : 'Lo que cobra el proveedor por todo'}><Monto valor={valor} onChange={setValor} /></Campo>
        <Campo label="Nota (opcional)"><input value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej: entrega el 20 de noviembre" /></Campo>
      </div>
      <div className="acciones">
        <button className="btn" disabled={ocupado || !proveedor.trim() || valor <= 0 || !!bajo} onClick={guardar}>{ocupado ? 'Guardando…' : 'Guardar'}</button>
        <button className="btn secundario" onClick={onCerrar}>Cancelar</button>
        {c && !anular && <button className="btn secundario" style={{ marginLeft: 'auto' }} disabled={c.abonos.length > 0} title={c.abonos.length ? 'Tiene pagos: anúlalos primero en Consultas → Gastos' : ''} onClick={() => setAnular(true)}>Anular</button>}
      </div>
      {c && c.abonos.length > 0 && <p className="ayuda" style={{ marginTop: 8 }}>Para anular este costo primero hay que anular sus pagos (en Consultas → Gastos).</p>}
      {anular && <div className="rejilla" style={{ marginTop: 12 }}>
        <Campo label="¿Por qué se anula?" ancho><input autoFocus value={motivo} onChange={e => setMotivo(e.target.value)} placeholder="Ej: se registró en el montaje equivocado" /></Campo>
        <div className="acciones" style={{ gridColumn: '1 / -1', marginTop: 0 }}><button className="btn peligro" disabled={ocupado || motivo.trim().length < 5} onClick={quitar}>Anular costo</button></div>
      </div>}
    </Modal>
  );
}

function AbonarCosto({ m, c, onCerrar, onListo }: { m: Montaje; c: Costo; onCerrar: () => void; onListo: () => void }) {
  const { cat, aviso } = useApp();
  const { ocupado, correr } = useAccion();
  const [valor, setValor] = useState(0);
  const [fecha, setFecha] = useState(hoy());
  const [desde, setDesde] = useState('');
  const [nota, setNota] = useState('');
  const guardar = async () => {
    const r = await correr<{ pendiente: number }>('abonarCostoMontaje', { costo_id: c.id, valor, fecha, pagado_desde: desde, nota });
    if (r) { aviso(r.pendiente > 0 ? `Pago a ${c.proveedor} guardado. Falta ${pesos(r.pendiente)}` : `${c.proveedor} quedó a paz y salvo`); onListo(); }
  };
  return (
    <Modal titulo={`Pagar a ${c.proveedor}`} onCerrar={onCerrar}>
      <p style={{ fontSize: 15, marginTop: 0 }}>Vestuario de <b>{m.nombre}</b>: {pesos(c.valor)} en total, pagado {pesos(c.pagado)}, falta <b>{pesos(c.pendiente)}</b>.</p>
      <div className="rejilla">
        <Campo label="¿Cuánto se le paga?" ayuda={valor > c.pendiente ? `Es más de lo que falta (${pesos(c.pendiente)}).` : valor === c.pendiente ? 'Queda a paz y salvo' : valor ? `Quedaría faltando ${pesos(c.pendiente - valor)}` : ''}>
          <Monto autoFocus valor={valor} onChange={setValor} />
        </Campo>
        <Campo label="Fecha"><input type="date" value={fecha} max={hoy()} onChange={e => setFecha(e.target.value)} /></Campo>
        <div className="acciones" style={{ gridColumn: '1 / -1', marginTop: -4 }}>
          <button className="btn secundario chico" onClick={() => setValor(c.pendiente)}>Pagar todo lo que falta</button>
        </div>
        <Campo label="¿De dónde salió la plata?" ancho><Segmentado opciones={cuentasTodas(cat)} valor={desde} onChange={setDesde} /></Campo>
        <Campo label="Nota (opcional)" ancho><input value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej: le transfirió Liz" /></Campo>
      </div>
      <div className="acciones">
        <button className="btn" disabled={ocupado || !valor || valor > c.pendiente || !desde} onClick={guardar}>{ocupado ? 'Guardando…' : 'Guardar pago'}</button>
        <button className="btn secundario" onClick={onCerrar}>Cancelar</button>
      </div>
      {desde === 'Caja' && <p className="ayuda" style={{ marginTop: 8 }}>Sale de la caja: va a aparecer en el cierre del día como un gasto.</p>}
    </Modal>
  );
}

// ------------------------------------------------------------------ informe de ganancias (solo directores)
type Fila = { id: string; nombre: string; activo: boolean; integrantes: number; esperado: number; recogido: number; por_cobrar: number;
  costo: number; pagado: number; debe: number; con_costo: boolean; ganancia_esperada: number; ganancia_hoy: number };

const filaDe = (m: Montaje): Fila => {
  const cs = m.costos || [];
  const costo = cs.reduce((s, c) => s + c.valor, 0), pagado = cs.reduce((s, c) => s + c.pagado, 0);
  return { id: m.id, nombre: m.nombre, activo: m.activo, integrantes: m.cantidad, esperado: m.esperado, recogido: m.recogido, por_cobrar: m.por_cobrar,
    costo, pagado, debe: costo - pagado, con_costo: cs.length > 0, ganancia_esperada: m.esperado - costo, ganancia_hoy: m.recogido - pagado };
};
const porcentaje = (g: number, base: number) => (base > 0 ? `${Math.round(g * 100 / base)}%` : '');

function Ganancias({ d }: { d: Lista }) {
  // Los archivados cuentan si tienen costos: lo que se le pagó al proveedor no puede desaparecer del total.
  const filas = d.montajes.filter(m => m.activo || (m.costos || []).length).map(filaDe);
  const [orden, setOrden] = useState<'Ganancia' | 'Nombre' | 'Falta cobrar'>('Ganancia');
  const ordenadas = filas.slice().sort((a, b) => orden === 'Nombre' ? a.nombre.localeCompare(b.nombre, 'es')
    : orden === 'Falta cobrar' ? b.por_cobrar - a.por_cobrar : (Number(b.con_costo) - Number(a.con_costo)) || b.ganancia_esperada - a.ganancia_esperada);
  const t = filas.reduce((s, f) => ({ esperado: s.esperado + f.esperado, recogido: s.recogido + f.recogido, por_cobrar: s.por_cobrar + f.por_cobrar,
    costo: s.costo + f.costo, pagado: s.pagado + f.pagado, debe: s.debe + f.debe }), { esperado: 0, recogido: 0, por_cobrar: 0, costo: 0, pagado: 0, debe: 0 });
  const sinCosto = filas.filter(f => !f.con_costo && f.esperado > 0);
  const gEsperada = t.esperado - t.costo, gHoy = t.recogido - t.pagado;
  return <>
    <div className="cifras">
      <div className="cifra destacada"><span>Ganancia esperada</span><b className={gEsperada < 0 ? 'negativo' : ''}>{pesos(gEsperada)}</b><small>Cuando todos paguen y se pague todo el vestuario{t.esperado > 0 && ` · ${porcentaje(gEsperada, t.esperado)}`}</small></div>
      <div className="cifra"><span>Ganancia hoy</span><b className={gHoy < 0 ? 'negativo' : ''}>{pesos(gHoy)}</b><small>Lo recogido menos lo ya pagado a proveedores</small></div>
    </div>
    <div className="tarjeta informe-total">
      <h3 className="mt0">Total de la clausura</h3>
      <dl className="cuentas-informe">
        <dt>Debería recoger</dt><dd>{pesos(t.esperado)}</dd>
        <dt>Recogido</dt><dd>{pesos(t.recogido)}</dd>
        <dt>Falta por cobrar</dt><dd className={t.por_cobrar > 0 ? 'debe' : ''}>{pesos(t.por_cobrar)}</dd>
        <dt>Costo de los vestuarios</dt><dd>{pesos(t.costo)}</dd>
        <dt>Pagado a proveedores</dt><dd>{pesos(t.pagado)}</dd>
        <dt>Falta pagar a proveedores</dt><dd className={t.debe > 0 ? 'debe' : ''}>{pesos(t.debe)}</dd>
      </dl>
      {sinCosto.length > 0 && <p className="aviso-informe">⚠ {sinCosto.length === 1 ? `${sinCosto[0].nombre} no tiene costo registrado, así que la ganancia sale más alta de lo real.` : `${sinCosto.length} grupos no tienen costo registrado, así que la ganancia sale más alta de lo real: ${sinCosto.map(f => f.nombre).join(', ')}.`}</p>}
      {(d.pagado_de_mas > 0 || d.pagos_sin_montaje > 0) && <p className="suave" style={{ fontSize: 13, margin: '8px 0 0' }}>
        No se cuentan aquí: {[d.pagado_de_mas > 0 && `${pesos(d.pagado_de_mas)} pagados de más (a favor de los estudiantes)`, d.pagos_sin_montaje > 0 && `${pesos(d.pagos_sin_montaje)} de quienes aún no tienen montaje`].filter(Boolean).join(' y ')}.
      </p>}
    </div>
    <div className="orden-informe"><span className="suave">Ordenar por</span><Segmentado opciones={['Ganancia', 'Falta cobrar', 'Nombre'] as const} valor={orden} onChange={setOrden} /></div>
    <div className="informe-grupos">
      {ordenadas.map(f => (
        <div key={f.id} className="tarjeta informe-grupo">
          <div className="informe-cabeza">
            <span><b>{f.nombre}</b><small className="suave"> · {f.integrantes} integrante(s){!f.activo && ' · archivado'}</small></span>
            {!f.con_costo ? <span className="chip">Sin costo</span> : <span className={`chip ${f.ganancia_esperada < 0 ? 'anulado' : 'ok'}`}>{pesos(f.ganancia_esperada)}</span>}
          </div>
          <div className="informe-cols">
            <div><span>Recoger</span><b>{pesos(f.esperado)}</b><small>Recogido {pesos(f.recogido)}</small></div>
            <div><span>Costo</span><b>{f.con_costo ? pesos(f.costo) : '—'}</b><small>{f.con_costo ? (f.debe > 0 ? `Debemos ${pesos(f.debe)}` : 'Pagado') : 'Sin registrar'}</small></div>
            <div><span>Ganancia</span><b className={f.ganancia_esperada < 0 ? 'negativo' : ''}>{pesos(f.ganancia_esperada)}</b><small>Hoy {pesos(f.ganancia_hoy)}</small></div>
          </div>
          {f.esperado > 0 && f.con_costo && <div className="avance" title={`Margen ${porcentaje(f.ganancia_esperada, f.esperado)}`}><span style={{ width: `${Math.max(0, Math.min(100, f.ganancia_esperada * 100 / f.esperado))}%` }} /></div>}
          {f.esperado > 0 && f.con_costo && <small className="suave">Margen {porcentaje(f.ganancia_esperada, f.esperado)} de lo que se recoge</small>}
        </div>
      ))}
    </div>
    <p className="suave" style={{ fontSize: 13 }}>“Ganancia” es lo que queda cuando todos paguen y se le pague todo al proveedor. “Hoy” es la plata que ya entró menos la que ya se le pagó al proveedor.</p>
  </>;
}
