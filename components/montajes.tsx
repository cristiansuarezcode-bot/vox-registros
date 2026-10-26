'use client';
import { useState } from 'react';
import type { Quien } from '@/lib/tipos';
import { pesos } from '@/lib/util';
import { BuscarQuien, Campo, Cargando, ErrorCaja, Modal, Monto, Pantalla, Selector, useAccion, useApp, useDatos, usePorPartes } from './ui';

type Integrante = { id: string; estudiante_id: string; estudiante: string };
type Montaje = { id: string; nombre: string; profe: string; valor_vestuario: number; activo: boolean; nota: string; integrantes: Integrante[]; cantidad: number; esperado: number };
type PorRevisar = { estudiante_id: string; estudiante: string; cargo: string; montajes_cargo: number; montajes_asignados: number; valor: number };
type Lista = { es_director: boolean; valor_base: number; montajes: Montaje[]; por_revisar: PorRevisar[] };

export function Montajes() {
  const { d, error, cargando, recargar } = useDatos<Lista>('listarMontajes', {}, []);
  const [editar, setEditar] = useState<Montaje | 'nuevo' | null>(null);
  const [verArchivados, setVerArchivados] = useState(false);
  const activos = (d?.montajes || []).filter(m => m.activo);
  const archivados = (d?.montajes || []).filter(m => !m.activo);
  return (
    <Pantalla titulo="Montajes de la clausura" sub="Cada grupo con sus integrantes. El cargo de vestuario de cada estudiante se calcula solo con sus montajes">
      {error && <ErrorCaja msg={error} reintentar={recargar} />}
      {cargando && !d && <Cargando texto="Cargando montajes…" />}
      {d && <>
        <div className="cifras">
          <div className="cifra destacada"><span>Montajes</span><b>{activos.length}</b></div>
          <div className="cifra"><span>Integrantes</span><b>{activos.reduce((s, m) => s + m.cantidad, 0)}</b></div>
          <div className="cifra"><span>Debería recoger</span><b>{pesos(activos.reduce((s, m) => s + m.esperado, 0))}</b></div>
        </div>
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
      </div>
      {m.nota && <p className="suave" style={{ fontSize: 13, margin: '0 0 8px' }}>{m.nota}</p>}
      <button className="btn secundario" style={{ width: '100%' }} onClick={() => setAbierto(a => !a)}>{abierto ? 'Ocultar integrantes' : `Ver y agregar integrantes`}</button>
      {abierto && <div style={{ marginTop: 12 }}>
        <div key={clave}><BuscarQuien valor={null} onChange={agregar} permitirPersona={false} etiqueta="Agregar integrante" /></div>
        {ocupado && <p className="suave" style={{ fontSize: 13 }}>Guardando…</p>}
        {!m.integrantes.length ? <p className="vacio">Sin integrantes todavía.</p> : <>
          <ul className="lista-simple integrantes">{lista.visibles.map(i => (
            <li key={i.id}><span>{i.estudiante}</span><button className="enlace" onClick={() => setQuitar(i)}>Quitar</button></li>))}
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
