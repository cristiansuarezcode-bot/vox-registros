'use client';
import { useMemo, useState } from 'react';
import { reemplazarSesion, leerSesion } from '@/lib/api';
import { fechaCorta, hoy, norm, pesos, primeroDelMes } from '@/lib/util';
import { BotonAnular, Campo, Cargando, ErrorCaja, Modal, Monto, Pantalla, Segmentado, Selector, TraerDelAdmin, useAccion, useApp, useDatos } from './ui';

// ================================================================== estudiantes y planes
type EstFila = { id: string; nombre: string; plan: string; activo: boolean; nota: string; estado_admin?: string; del_admin?: boolean; valor_mensual?: number };
type PlanFila = { id: string; nombre: string; valor_mensual: number; activo: boolean; nota: string; estudiantes: number };
type ListaEst = { estudiantes: EstFila[]; planes: PlanFila[]; admin?: { conectado: boolean; ultima: string } };
const ESTADOS_ADMIN: Record<string, string> = { ACTIVO: 'Activo', NUEVO: 'Nuevo', PAUSADO: 'Pausado', DE_VIAJE: 'De viaje', INCAPACITADO: 'Incapacitado', RETIRADO: 'Retirado' };
const estadoAdmin = (e: string) => ESTADOS_ADMIN[e] || e;
const haceCuanto = (iso: string) => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return !iso || !isFinite(m) ? '' : m < 1 ? 'hace un momento' : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : fechaCorta(iso.slice(0, 10));
};

export function Estudiantes() {
  const { params, ir } = useApp();
  const pestana = params.pestana === 'planes' ? 'planes' : 'estudiantes';
  const datos = useDatos<ListaEst>('listarEstudiantes', {}, []);
  return (
    <Pantalla titulo="Estudiantes y planes" sub={datos.d?.admin?.conectado ? 'Llegan solos desde el admin cada 15 minutos. Se matriculan y se editan allá' : 'Agrega estudiantes, asígnales su plan y define cuánto vale cada plan al mes'}>
      <div className="pestanas">
        <button className={pestana === 'estudiantes' ? 'activo' : ''} onClick={() => ir('estudiantes')}>Estudiantes</button>
        <button className={pestana === 'planes' ? 'activo' : ''} onClick={() => ir('estudiantes', { pestana: 'planes' })}>Planes</button>
      </div>
      {datos.error && <ErrorCaja msg={datos.error} reintentar={datos.recargar} />}
      {datos.cargando && !datos.d && <Cargando texto="Cargando estudiantes…" />}
      {datos.d && (pestana === 'planes' ? <Planes d={datos.d} recargar={datos.recargar} /> : <ListaEstudiantes d={datos.d} recargar={datos.recargar} />)}
    </Pantalla>
  );
}

function ListaEstudiantes({ d, recargar }: { d: ListaEst; recargar: () => void }) {
  const { ir } = useApp();
  const [buscar, setBuscar] = useState('');
  const [estado, setEstado] = useState<'Activos' | 'Inactivos' | 'Todos'>('Activos');
  const [plan, setPlan] = useState('');
  const [editar, setEditar] = useState<EstFila | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const filas = useMemo(() => {
    const partes = norm(buscar).split(' ').filter(Boolean);
    return d.estudiantes.filter(e =>
      (estado === 'Todos' || (estado === 'Activos') === e.activo) &&
      (!plan || (plan === '—' ? !e.plan : norm(e.plan) === norm(plan))) &&
      partes.every(p => norm(e.nombre).includes(p)));
  }, [d, buscar, estado, plan]);
  const activos = d.estudiantes.filter(e => e.activo).length;
  const sinPlan = d.estudiantes.filter(e => e.activo && !e.plan).length;
  return (
    <>
      <div className="cifras">
        <div className="cifra destacada"><span>Estudiantes activos</span><b>{activos}</b></div>
        <div className="cifra"><span>Sin plan asignado</span><b>{sinPlan}</b></div>
      </div>
      <div className="tarjeta">
        <div className="rejilla">
          <Campo label="Buscar"><input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Nombre o apellido…" /></Campo>
          <Campo label="Plan"><Selector valor={plan} onChange={setPlan} vacio="Todos los planes" opciones={[...d.planes.map(p => p.nombre), { v: '—', t: 'Sin plan' }]} /></Campo>
          <Campo label="Mostrar"><Segmentado opciones={['Activos', 'Inactivos', 'Todos'] as const} valor={estado} onChange={setEstado} /></Campo>
        </div>
        <div className="acciones">
          {d.admin?.conectado
            ? <><TraerDelAdmin onListo={recargar} />{d.admin.ultima && <span className="suave" style={{ fontSize: 13 }}>Última vez: {haceCuanto(d.admin.ultima)}</span>}</>
            : <button className="btn" onClick={() => setNuevo(true)}>+ Agregar estudiante</button>}
        </div>
      </div>
      <div className="tarjeta">
        <p className="suave mt0" style={{ fontSize: 13 }}>{filas.length} estudiante(s)</p>
        {!filas.length ? <p className="vacio">Nadie con estos filtros.</p> : (
          <div className="tabla-envoltura"><table className="tabla tarjetas">
            <thead><tr><th>Nombre</th><th>Plan</th><th>Estado</th><th></th></tr></thead>
            <tbody>{filas.map(e => (
              <tr key={e.id} className={e.activo ? '' : 'inactivo'}>
                <td><button className="enlace" onClick={() => ir('ficha', { estudiante_id: e.id })}>{e.nombre}</button> {!e.activo && <span className="chip inactivo">Inactivo</span>}
                  {e.estado_admin && e.activo && e.estado_admin !== 'ACTIVO' && <> <span className="chip">{estadoAdmin(e.estado_admin)}</span></>}
                  {d.admin?.conectado && !e.del_admin && <><br /><small className="suave">No está en el admin</small></>}
                  {e.nota && <><br /><small className="suave">{e.nota}</small></>}</td>
                <td data-label="Plan">{e.plan || <span className="suave">Sin plan</span>}{e.valor_mensual && e.valor_mensual !== d.planes.find(x => norm(x.nombre) === norm(e.plan))?.valor_mensual ? <><br /><small className="suave">Valor acordado: {pesos(e.valor_mensual)}</small></> : null}</td>
                <td className="solo-escritorio">{e.estado_admin ? <span className={'chip ' + (e.activo ? 'ok' : 'inactivo')}>{estadoAdmin(e.estado_admin)}</span> : e.activo ? <span className="chip ok">Activo</span> : <span className="chip inactivo">Inactivo</span>}</td>
                <td className="acciones-fila"><button className="btn secundario chico" onClick={() => setEditar(e)}>Editar</button></td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </div>
      {editar && <EditarEstudiante e={editar} planes={d.planes} soloNota={!!(d.admin?.conectado && editar.del_admin)} onCerrar={() => setEditar(null)} onListo={() => { setEditar(null); recargar(); }} />}
      {nuevo && <NuevoEstudiante planes={d.planes} onCerrar={() => setNuevo(false)} onListo={() => { setNuevo(false); recargar(); }} />}
    </>
  );
}

const opcionesPlan = (planes: PlanFila[], actual = '') => {
  const ops = planes.filter(p => p.activo || norm(p.nombre) === norm(actual)).map(p => ({ v: p.nombre, t: p.nombre + (p.valor_mensual ? ` · ${pesos(p.valor_mensual)}` : '') }));
  return ops;
};

function EditarEstudiante({ e, planes, soloNota, onCerrar, onListo }: { e: EstFila; planes: PlanFila[]; soloNota: boolean; onCerrar: () => void; onListo: () => void }) {
  const { recargarCat } = useApp();
  const [nombre, setNombre] = useState(e.nombre);
  const [plan, setPlan] = useState(e.plan);
  const [activo, setActivo] = useState(e.activo);
  const [nota, setNota] = useState(e.nota || '');
  const { ocupado, correr } = useAccion();
  const guardar = async () => {
    const datos: Record<string, unknown> = { id: e.id };
    if (!soloNota && nombre.trim() !== e.nombre) datos.nombre = nombre;
    if (!soloNota && plan !== e.plan) datos.plan = plan;
    if (!soloNota && activo !== e.activo) datos.activo = activo;
    if (nota.trim() !== (e.nota || '')) datos.nota = nota;
    const r = await correr<{ renombrados: number }>('editarEstudiante', datos, 'Estudiante actualizado');
    if (r) { await recargarCat(); onListo(); }
  };
  return (
    <Modal titulo="Editar estudiante" onCerrar={onCerrar}>
      {soloNota ? (
        <>
          <p className="aviso info mt0">El nombre, el plan y el estado vienen del admin: si hay que corregirlos, se hace allá y aquí se actualizan solos.</p>
          <div className="rejilla">
            <div className="campo" style={{ gridColumn: "1 / -1" }}><label>Nombre</label><div className="elegido"><b>{e.nombre}</b></div></div>
            <div className="campo"><label>Plan</label><div className="elegido">{e.plan || 'Sin plan'}{e.valor_mensual ? ` · ${pesos(e.valor_mensual)}` : ''}</div></div>
            <div className="campo"><label>Estado en el admin</label><div className="elegido">{estadoAdmin(e.estado_admin || '') || '—'}</div></div>
          </div>
        </>
      ) : (
        <div className="rejilla">
          <Campo label="Nombre completo" ancho ayuda="Si lo corriges, también se corrige en sus pagos y pedidos."><input value={nombre} onChange={x => setNombre(x.target.value)} /></Campo>
          <Campo label="Plan" ancho><Selector valor={plan} onChange={setPlan} vacio="Sin plan" opciones={opcionesPlan(planes, e.plan)} /></Campo>
          <Campo label="Estado" ancho><Segmentado opciones={['Activo', 'Inactivo'] as const} valor={activo ? 'Activo' : 'Inactivo'} onChange={v => setActivo(v === 'Activo')} /></Campo>
        </div>
      )}
      <div className="rejilla" style={{ marginTop: 10 }}>
        <Campo label="Nota (opcional)" ancho><input value={nota} onChange={x => setNota(x.target.value)} placeholder="Ej: la recoge la abuela" /></Campo>
      </div>
      {!activo && e.activo && <p className="aviso info">Si queda inactivo, deja de salir en las listas para registrar. Sus pagos y saldos se conservan.</p>}
      <div className="acciones"><button className="btn" disabled={ocupado || !nombre.trim()} onClick={guardar}>{ocupado ? 'Guardando…' : 'Guardar'}</button><button className="btn secundario" onClick={onCerrar}>Cancelar</button></div>
    </Modal>
  );
}

function NuevoEstudiante({ planes, onCerrar, onListo }: { planes: PlanFila[]; onCerrar: () => void; onListo: () => void }) {
  const { recargarCat } = useApp();
  const [nombre, setNombre] = useState('');
  const [plan, setPlan] = useState('');
  const { ocupado, correr } = useAccion();
  const guardar = async () => {
    const r = await correr<{ id: string; nombre: string }>('agregarEstudiante', { nombre, plan }, 'Estudiante agregado');
    if (r) { await recargarCat(); onListo(); }
  };
  return (
    <Modal titulo="Agregar estudiante" onCerrar={onCerrar}>
      <div className="rejilla">
        <Campo label="Nombre completo" ancho ayuda="Nombre y apellidos, como para buscarlo después."><input autoFocus value={nombre} onChange={x => setNombre(x.target.value)} /></Campo>
        <Campo label="Plan" ancho><Selector valor={plan} onChange={setPlan} vacio="Sin plan por ahora" opciones={opcionesPlan(planes)} /></Campo>
      </div>
      <div className="acciones"><button className="btn" disabled={ocupado || nombre.trim().length < 3} onClick={guardar}>{ocupado ? 'Guardando…' : 'Agregar'}</button><button className="btn secundario" onClick={onCerrar}>Cancelar</button></div>
    </Modal>
  );
}

function Planes({ d, recargar }: { d: ListaEst; recargar: () => void }) {
  const [editar, setEditar] = useState<PlanFila | 'nuevo' | null>(null);
  const delAdmin = !!d.admin?.conectado;
  const sinValor = d.planes.filter(p => p.activo && !p.valor_mensual).length;
  return (
    <>
      {delAdmin && <p className="aviso info">Los planes y sus precios vienen del admin. Si cambia un precio, cámbialo allá.</p>}
      {!delAdmin && sinValor > 0 && <p className="aviso info">{sinValor} plan(es) no tienen valor mensual. Con el valor, al registrar una mensualidad el monto sale solo.</p>}
      <div className="tarjeta">
        {!delAdmin && <div className="acciones mt0" style={{ marginTop: 0, marginBottom: 10 }}><button className="btn" onClick={() => setEditar('nuevo')}>+ Nuevo plan</button></div>}
        <div className="tabla-envoltura"><table className="tabla tarjetas">
          <thead><tr><th>Plan</th><th className="num">Valor mensual</th><th className="num">Estudiantes</th><th>Estado</th><th></th></tr></thead>
          <tbody>{d.planes.map(p => (
            <tr key={p.id} className={p.activo ? '' : 'inactivo'}>
              <td><b>{p.nombre}</b> {!p.activo && <span className="chip inactivo">Inactivo</span>}{p.nota && <><br /><small className="suave">{p.nota}</small></>}</td>
              <td className="num" data-label="Valor mensual">{p.valor_mensual ? pesos(p.valor_mensual) : <span className="chip debe">Sin valor</span>}</td>
              <td className="num" data-label="Estudiantes">{p.estudiantes}</td>
              <td className="solo-escritorio">{p.activo ? <span className="chip ok">Activo</span> : <span className="chip inactivo">Inactivo</span>}</td>
              <td className="acciones-fila">{!delAdmin && <button className="btn secundario chico" onClick={() => setEditar(p)}>Editar</button>}</td>
            </tr>))}
          </tbody>
        </table></div>
      </div>
      {editar && <EditarPlan p={editar === 'nuevo' ? null : editar} onCerrar={() => setEditar(null)} onListo={() => { setEditar(null); recargar(); }} />}
    </>
  );
}

function EditarPlan({ p, onCerrar, onListo }: { p: PlanFila | null; onCerrar: () => void; onListo: () => void }) {
  const { recargarCat } = useApp();
  const [nombre, setNombre] = useState(p?.nombre || '');
  const [valor, setValor] = useState(p?.valor_mensual || 0);
  const [activo, setActivo] = useState(p ? p.activo : true);
  const [nota, setNota] = useState(p?.nota || '');
  const { ocupado, correr } = useAccion();
  const guardar = async () => {
    const datos: Record<string, unknown> = { nombre, valor_mensual: valor || '', nota };
    if (p) { datos.id = p.id; datos.activo = activo; }
    const r = await correr<{ estudiantes_actualizados?: number }>('guardarPlan', datos, p ? 'Plan actualizado' : 'Plan creado');
    if (r) { await recargarCat(); onListo(); }
  };
  return (
    <Modal titulo={p ? 'Editar plan' : 'Nuevo plan'} onCerrar={onCerrar}>
      <div className="rejilla">
        <Campo label="Nombre" ancho ayuda={p && p.estudiantes ? `Si cambias el nombre, se actualiza en sus ${p.estudiantes} estudiante(s).` : undefined}><input autoFocus value={nombre} onChange={x => setNombre(x.target.value)} /></Campo>
        <Campo label="Valor mensual"><Monto valor={valor} onChange={setValor} /></Campo>
        {p && <Campo label="Estado"><Segmentado opciones={['Activo', 'Inactivo'] as const} valor={activo ? 'Activo' : 'Inactivo'} onChange={v => setActivo(v === 'Activo')} /></Campo>}
        <Campo label="Nota (opcional)" ancho><input value={nota} onChange={x => setNota(x.target.value)} placeholder="Ej: 2 clases por semana" /></Campo>
      </div>
      <div className="acciones"><button className="btn" disabled={ocupado || !nombre.trim()} onClick={guardar}>{ocupado ? 'Guardando…' : 'Guardar'}</button><button className="btn secundario" onClick={onCerrar}>Cancelar</button></div>
    </Modal>
  );
}

// ================================================================== inventario
type ProdInv = { id: string; nombre: string; precio: number; activo: boolean; stock: number | null; ultimo_conteo: string; vendidas: number; total_vendido: number };
type RepInv = { productos: ProdInv[]; movimientos: Record<string, any>[] };

export function Inventario() {
  const [desde, setDesde] = useState(primeroDelMes());
  const [hasta, setHasta] = useState(hoy());
  const { d, error, cargando, recargar } = useDatos<RepInv>('reporteInventario', { desde, hasta }, [desde, hasta]);
  const [mov, setMov] = useState<ProdInv | null>(null);
  const [editar, setEditar] = useState<ProdInv | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [verInactivos, setVerInactivos] = useState(false);
  const productos = (d?.productos || []).filter(p => verInactivos || p.activo);
  const agotados = (d?.productos || []).filter(p => p.activo && p.stock !== null && p.stock <= 0).length;
  const bajos = (d?.productos || []).filter(p => p.activo && p.stock !== null && p.stock > 0 && p.stock <= 3).length;
  const sinContar = (d?.productos || []).filter(p => p.activo && p.stock === null).length;
  const { recargarCat } = useApp();
  const listo = () => { setMov(null); setEditar(null); setNuevo(false); recargar(); recargarCat(); };
  return (
    <Pantalla titulo="Inventario de la tienda" sub="Cuántos productos hay, lo que entra y lo que se vende">
      {error && <ErrorCaja msg={error} reintentar={recargar} />}
      {cargando && !d && <Cargando texto="Cargando inventario…" />}
      {d && <>
        <div className="cifras">
          <div className="cifra destacada"><span>Agotados</span><b>{agotados}</b></div>
          <div className="cifra"><span>Quedan 3 o menos</span><b>{bajos}</b></div>
          <div className="cifra"><span>Sin contar todavía</span><b>{sinContar}</b></div>
        </div>
        {sinContar > 0 && <p className="aviso info">Para empezar a llevar el inventario, cuenta lo que hay de cada producto y regístralo con <b>Contar</b>. Desde ese momento, cada venta descuenta sola.</p>}
        <div className="tarjeta">
          <div className="acciones mt0" style={{ marginTop: 0, marginBottom: 12 }}>
            <button className="btn" onClick={() => setNuevo(true)}>+ Producto nuevo</button>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 14 }}><input type="checkbox" checked={verInactivos} onChange={e => setVerInactivos(e.target.checked)} style={{ width: 18, height: 18 }} /> Ver productos inactivos</label>
          </div>
          <div className="tabla-envoltura"><table className="tabla tarjetas">
            <thead><tr><th>Producto</th><th className="num">Precio</th><th className="num">Hay</th><th className="num">Vendidos ({fechaCorta(desde)} – {fechaCorta(hasta)})</th><th></th></tr></thead>
            <tbody>{productos.map(p => (
              <tr key={p.id} className={p.activo ? '' : 'inactivo'}>
                <td><b>{p.nombre}</b>{!p.activo && <> <span className="chip inactivo">Inactivo</span></>}{p.ultimo_conteo && <><br /><small className="suave">Último conteo: {fechaCorta(p.ultimo_conteo)}</small></>}</td>
                <td className="num" data-label="Precio">{pesos(p.precio)}</td>
                <td className="num" data-label="Hay">{p.stock === null ? <span className="suave">Sin contar</span> : <span className={'chip ' + (p.stock <= 0 ? 'agotado' : p.stock <= 3 ? 'debe' : 'ok')}>{p.stock}</span>}</td>
                <td className="num" data-label="Vendidos">{p.vendidas}{p.total_vendido ? <small className="suave"> · {pesos(p.total_vendido)}</small> : null}</td>
                <td className="acciones-fila" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn chico" onClick={() => setMov(p)}>Entrada / Contar</button>{' '}
                  <button className="btn secundario chico" onClick={() => setEditar(p)}>Editar</button>
                </td>
              </tr>))}
            </tbody>
          </table></div>
        </div>
        <div className="tarjeta">
          <h3>Últimos movimientos</h3>
          <div className="rejilla" style={{ marginBottom: 10 }}>
            <Campo label="Ventas desde"><input type="date" value={desde} max={hasta} onChange={e => setDesde(e.target.value)} /></Campo>
            <Campo label="Hasta"><input type="date" value={hasta} max={hoy()} onChange={e => setHasta(e.target.value)} /></Campo>
          </div>
          {!d.movimientos.length ? <p className="vacio">Todavía no hay entradas ni conteos.</p> : (
            <div className="tabla-envoltura"><table className="tabla">
              <thead><tr><th>Fecha</th><th>Producto</th><th>Tipo</th><th className="num">Cantidad</th><th>Nota</th><th></th></tr></thead>
              <tbody>{d.movimientos.map(m => {
                const anulado = m.estado === 'anulado';
                return (
                  <tr key={m.id} className={anulado ? 'anulado' : ''}>
                    <td>{fechaCorta(m.fecha)}<br /><small className="suave">{m.registrado_por}</small></td><td>{m.producto}</td><td>{m.tipo}</td>
                    <td className="num">{m.tipo === 'Salida' ? '−' : m.tipo === 'Entrada' ? '+' : '='}{m.cantidad}</td>
                    <td style={{ fontSize: 13 }}>{m.nota}{m.costo_unitario ? ` · costo ${pesos(m.costo_unitario)} c/u` : ''}</td>
                    <td className="sin-tachar">{anulado ? <span className="chip anulado">Anulado</span> : <BotonAnular hoja="Inventario" id={m.id} onListo={listo} />}</td>
                  </tr>);
              })}</tbody>
            </table></div>
          )}
        </div>
      </>}
      {mov && <Movimiento p={mov} onCerrar={() => setMov(null)} onListo={listo} />}
      {editar && <EditarProducto p={editar} onCerrar={() => setEditar(null)} onListo={listo} />}
      {nuevo && <NuevoProducto onCerrar={() => setNuevo(false)} onListo={listo} />}
    </Pantalla>
  );
}

const TIPOS = ['Entrada', 'Conteo', 'Salida'] as const;
const AYUDA_TIPO: Record<(typeof TIPOS)[number], string> = {
  Entrada: 'Llegó mercancía: se suma a lo que hay.',
  Conteo: 'Contaste lo que hay: la cantidad queda exactamente en este número.',
  Salida: 'Se dañó, se venció o se regaló: se resta.',
};

function Movimiento({ p, onCerrar, onListo }: { p: ProdInv; onCerrar: () => void; onListo: () => void }) {
  const [tipo, setTipo] = useState<(typeof TIPOS)[number]>(p.stock === null ? 'Conteo' : 'Entrada');
  const [cantidad, setCantidad] = useState('');
  const [costo, setCosto] = useState(0);
  const [nota, setNota] = useState('');
  const [fecha, setFecha] = useState(hoy());
  const { ocupado, correr } = useAccion();
  const n = Number(cantidad);
  const valido = cantidad !== '' && Number.isInteger(n) && n >= 0 && (tipo === 'Conteo' || n > 0);
  const despues = p.stock === null ? (tipo === 'Conteo' ? n : tipo === 'Entrada' ? n : -n) : tipo === 'Conteo' ? n : tipo === 'Entrada' ? p.stock + n : p.stock - n;
  const guardar = async () => {
    const r = await correr<{ stock: number }>('movimientoInventario', { producto_id: p.id, tipo, cantidad: n, costo_unitario: costo || '', nota, fecha }, `${p.nombre}: ${tipo.toLowerCase()} guardada`);
    if (r) onListo();
  };
  return (
    <Modal titulo={p.nombre} onCerrar={onCerrar}>
      <p className="suave mt0" style={{ fontSize: 14 }}>Hay ahora: <b>{p.stock === null ? 'sin contar' : p.stock}</b></p>
      <Campo label="¿Qué pasó?" ayuda={AYUDA_TIPO[tipo]}><Segmentado opciones={TIPOS} valor={tipo} onChange={setTipo} /></Campo>
      <div className="rejilla" style={{ marginTop: 12 }}>
        <Campo label={tipo === 'Conteo' ? 'Cantidad que hay' : 'Cantidad'}><input type="number" inputMode="numeric" min={0} autoFocus value={cantidad} onChange={e => setCantidad(e.target.value)} /></Campo>
        {tipo === 'Entrada' && <Campo label="Costo por unidad (opcional)"><Monto valor={costo} onChange={setCosto} /></Campo>}
        <Campo label="Fecha"><input type="date" value={fecha} max={hoy()} onChange={e => setFecha(e.target.value)} /></Campo>
        <Campo label="Nota (opcional)" ancho><input value={nota} onChange={e => setNota(e.target.value)} placeholder={tipo === 'Entrada' ? 'Ej: pedido de la distribuidora' : tipo === 'Salida' ? 'Ej: se venció' : 'Ej: conteo del lunes'} /></Campo>
      </div>
      {valido && <p className="aviso ok">Quedarán <b>{despues}</b>.</p>}
      <div className="acciones"><button className="btn" disabled={ocupado || !valido} onClick={guardar}>{ocupado ? 'Guardando…' : 'Guardar'}</button><button className="btn secundario" onClick={onCerrar}>Cancelar</button></div>
    </Modal>
  );
}

function EditarProducto({ p, onCerrar, onListo }: { p: ProdInv; onCerrar: () => void; onListo: () => void }) {
  const [nombre, setNombre] = useState(p.nombre);
  const [precio, setPrecio] = useState(p.precio);
  const [activo, setActivo] = useState(p.activo);
  const { ocupado, correr } = useAccion();
  const guardar = async () => {
    const datos: Record<string, unknown> = { id: p.id };
    if (nombre.trim() !== p.nombre) datos.nombre = nombre;
    if (precio !== p.precio) datos.precio = precio;
    if (activo !== p.activo) datos.activo = activo;
    if (await correr('editarProducto', datos, 'Producto actualizado')) onListo();
  };
  return (
    <Modal titulo="Editar producto" onCerrar={onCerrar}>
      <div className="rejilla">
        <Campo label="Nombre" ancho><input value={nombre} onChange={e => setNombre(e.target.value)} /></Campo>
        <Campo label="Precio de venta" ayuda="Las ventas anteriores conservan el precio con que se vendieron."><Monto valor={precio} onChange={setPrecio} /></Campo>
        <Campo label="Estado"><Segmentado opciones={['Activo', 'Inactivo'] as const} valor={activo ? 'Activo' : 'Inactivo'} onChange={v => setActivo(v === 'Activo')} /></Campo>
      </div>
      <div className="acciones"><button className="btn" disabled={ocupado || !nombre.trim() || !precio} onClick={guardar}>{ocupado ? 'Guardando…' : 'Guardar'}</button><button className="btn secundario" onClick={onCerrar}>Cancelar</button></div>
    </Modal>
  );
}

function NuevoProducto({ onCerrar, onListo }: { onCerrar: () => void; onListo: () => void }) {
  const [nombre, setNombre] = useState('');
  const [precio, setPrecio] = useState(0);
  const [cantidad, setCantidad] = useState('');
  const [costo, setCosto] = useState(0);
  const { ocupado, correr } = useAccion();
  const guardar = async () => {
    const datos: Record<string, unknown> = { nombre, precio };
    if (cantidad !== '') { datos.cantidad_inicial = Number(cantidad); if (costo) datos.costo_unitario = costo; }
    if (await correr('registrarProducto', datos, `${nombre} agregado a la tienda`)) onListo();
  };
  return (
    <Modal titulo="Producto nuevo" onCerrar={onCerrar}>
      <div className="rejilla">
        <Campo label="Nombre" ancho><input autoFocus value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej: Bon Bril" /></Campo>
        <Campo label="Precio de venta"><Monto valor={precio} onChange={setPrecio} /></Campo>
        <Campo label="¿Cuántos hay? (opcional)"><input type="number" inputMode="numeric" min={0} value={cantidad} onChange={e => setCantidad(e.target.value)} /></Campo>
        {cantidad !== '' && <Campo label="Costo por unidad (opcional)"><Monto valor={costo} onChange={setCosto} /></Campo>}
      </div>
      <div className="acciones"><button className="btn" disabled={ocupado || !nombre.trim() || !precio} onClick={guardar}>{ocupado ? 'Guardando…' : 'Agregar'}</button><button className="btn secundario" onClick={onCerrar}>Cancelar</button></div>
    </Modal>
  );
}

// ================================================================== cuenta y usuarios
export function Cuenta() {
  const { cat } = useApp();
  const esDirector = norm(cat.usuario.rol) === 'director';
  return (
    <Pantalla titulo="Mi cuenta" sub={`${cat.usuario.nombre} · ${esDirector ? 'Director(a)' : 'Registro'}`}>
      <CambiarMiClave />
      {esDirector && <Usuarios />}
    </Pantalla>
  );
}

function CambiarMiClave() {
  const { aviso } = useApp();
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [repetir, setRepetir] = useState('');
  const { ocupado, correr } = useAccion();
  const problema = nueva && nueva.length < 6 ? 'Mínimo 6 caracteres.' : repetir && nueva !== repetir ? 'Las dos claves nuevas no coinciden.' : '';
  const guardar = async () => {
    const r = await correr<{ token: string; nombre: string; rol: string }>('cambiarClave', { actual, nueva });
    if (r) {
      reemplazarSesion({ token: r.token, nombre: r.nombre, rol: r.rol });
      setActual(''); setNueva(''); setRepetir('');
      aviso('Clave cambiada. Si tenías la página abierta en otro equipo, allá tendrás que volver a entrar.');
    }
  };
  return (
    <div className="tarjeta">
      <h3>Cambiar mi clave</h3>
      <form className="rejilla" onSubmit={e => { e.preventDefault(); guardar(); }}>
        <input type="text" name="username" autoComplete="username" value={leerSesion()?.nombre || ''} readOnly hidden />
        <Campo label="Clave actual"><input type="password" autoComplete="current-password" value={actual} onChange={e => setActual(e.target.value)} /></Campo>
        <Campo label="Clave nueva" ayuda="Mínimo 6 caracteres."><input type="password" autoComplete="new-password" value={nueva} onChange={e => setNueva(e.target.value)} /></Campo>
        <Campo label="Repite la clave nueva"><input type="password" autoComplete="new-password" value={repetir} onChange={e => setRepetir(e.target.value)} /></Campo>
      </form>
      {problema && <p className="aviso error">{problema}</p>}
      <div className="acciones"><button className="btn" disabled={ocupado || !actual || nueva.length < 6 || nueva !== repetir} onClick={guardar}>{ocupado ? 'Guardando…' : 'Cambiar clave'}</button></div>
    </div>
  );
}

type Usuario = { usuario: string; nombre: string; rol: string; activo: boolean; tiene_clave: boolean };
function Usuarios() {
  const { d, error, cargando, recargar } = useDatos<{ usuarios: Usuario[] }>('listarUsuarios', {}, []);
  const [restablecer, setRestablecer] = useState<Usuario | null>(null);
  return (
    <div className="tarjeta">
      <h3>Usuarios</h3>
      <p className="suave mt0" style={{ fontSize: 14 }}>Si alguien olvidó su clave, ponle una nueva aquí y díctasela. Al cambiarla se cierran las sesiones que tenga abiertas.</p>
      {error && <ErrorCaja msg={error} reintentar={recargar} />}
      {cargando && !d && <Cargando />}
      {d && <div className="tabla-envoltura"><table className="tabla">
        <thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th></th></tr></thead>
        <tbody>{d.usuarios.map(u => (
          <tr key={u.usuario}><td><b>{u.usuario}</b></td><td>{u.nombre}</td><td>{u.rol === 'director' ? 'Director(a)' : 'Registro'}{!u.activo && <> <span className="chip inactivo">Inactivo</span></>}</td>
            <td><button className="btn secundario chico" onClick={() => setRestablecer(u)}>Poner clave nueva</button></td></tr>))}
        </tbody>
      </table></div>}
      {restablecer && <Restablecer u={restablecer} onCerrar={() => setRestablecer(null)} />}
    </div>
  );
}

function Restablecer({ u, onCerrar }: { u: Usuario; onCerrar: () => void }) {
  const [nueva, setNueva] = useState('');
  const { ocupado, correr } = useAccion();
  const { aviso } = useApp();
  const guardar = async () => {
    const r = await correr<{ propia: boolean }>('restablecerClave', { usuario: u.usuario, nueva });
    if (r) { aviso(`Clave nueva para ${u.nombre}${r.propia ? '. Vuelve a entrar con ella.' : ''}`); onCerrar(); }
  };
  return (
    <Modal titulo={`Clave nueva para ${u.nombre}`} onCerrar={onCerrar}>
      <Campo label="Clave nueva" ayuda="Mínimo 6 caracteres. Pídele que luego la cambie por una suya desde Mi cuenta.">
        <input type="text" autoComplete="off" autoFocus value={nueva} onChange={e => setNueva(e.target.value)} />
      </Campo>
      <div className="acciones"><button className="btn" disabled={ocupado || nueva.length < 6} onClick={guardar}>{ocupado ? 'Guardando…' : 'Guardar clave'}</button><button className="btn secundario" onClick={onCerrar}>Cancelar</button></div>
    </Modal>
  );
}

// ================================================================== profes
type ProfeFila = { id: string; nombre: string; valor_clase: number; activo: boolean; nota: string; total_pagado: number; clases: number; pagos: number; ultimo_pago: string };

export function Profes() {
  const { recargarCat, ir } = useApp();
  const { d, error, cargando, recargar } = useDatos<{ profes: ProfeFila[] }>('listarProfes', {}, []);
  const [ver, setVer] = useState<'Trabajando' | 'Eliminados' | 'Todos'>('Trabajando');
  const [editar, setEditar] = useState<ProfeFila | 'nuevo' | null>(null);
  const [eliminar, setEliminar] = useState<ProfeFila | null>(null);
  const { ocupado, correr } = useAccion();
  const filas = (d?.profes || []).filter(p => ver === 'Todos' || (ver === 'Trabajando') === p.activo);
  const listo = async () => { setEditar(null); setEliminar(null); recargar(); await recargarCat(); };
  const reactivar = async (p: ProfeFila) => { if (await correr('guardarProfe', { id: p.id, activo: true }, `${p.nombre} vuelve a estar en la lista`)) listo(); };
  return (
    <Pantalla titulo="Profes" sub="Quién da clases y cuánto se le paga. Eliminar a un profe no borra lo que se le ha pagado">
      <div className="tarjeta">
        <div className="rejilla">
          <Campo label="Mostrar"><Segmentado opciones={['Trabajando', 'Eliminados', 'Todos'] as const} valor={ver} onChange={setVer} /></Campo>
        </div>
        <div className="acciones">
          <button className="btn" onClick={() => setEditar('nuevo')}>+ Nuevo profe</button>
          <button className="btn secundario" onClick={() => ir('profe')}>Registrar pago a profe</button>
          <button className="btn secundario" onClick={() => ir('reporteProfes')}>Ver pagos</button>
        </div>
      </div>
      {error && <ErrorCaja msg={error} reintentar={recargar} />}
      {cargando && !d && <Cargando texto="Cargando profes…" />}
      {d && <div className="tarjeta">
        {!filas.length ? <p className="vacio">{ver === 'Eliminados' ? 'No hay profes eliminados.' : 'No hay profes.'}</p> : (
          <div className="tabla-envoltura"><table className="tabla tarjetas">
            <thead><tr><th>Profe</th><th className="num">Valor por clase</th><th className="num">Pagado en total</th><th>Último pago</th><th></th></tr></thead>
            <tbody>{filas.map(p => (
              <tr key={p.id} className={p.activo ? '' : 'inactivo'}>
                <td><b>{p.nombre}</b>{!p.activo && <> <span className="chip inactivo">Eliminado</span></>}{p.nota && <><br /><small className="suave">{p.nota}</small></>}</td>
                <td className="num" data-label="Valor por clase">{p.valor_clase ? pesos(p.valor_clase) : <span className="suave">Variable</span>}</td>
                <td className="num" data-label="Pagado en total">{p.pagos ? <>{pesos(p.total_pagado)} <small className="suave">· {p.clases} clases, {p.pagos} pago(s)</small></> : <span className="suave">Sin pagos registrados</span>}</td>
                <td data-label="Último pago">{p.ultimo_pago ? fechaCorta(p.ultimo_pago) : <span className="suave">—</span>}</td>
                <td className="acciones-fila" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn secundario chico" onClick={() => setEditar(p)}>Editar</button>{' '}
                  {p.activo
                    ? <button className="btn secundario chico" onClick={() => setEliminar(p)}>Eliminar</button>
                    : <button className="btn chico" disabled={ocupado} onClick={() => reactivar(p)}>Reactivar</button>}
                </td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </div>}
      {editar && <EditarProfe p={editar === 'nuevo' ? null : editar} onCerrar={() => setEditar(null)} onListo={listo} />}
      {eliminar && <EliminarProfe p={eliminar} onCerrar={() => setEliminar(null)} onListo={listo} />}
    </Pantalla>
  );
}

function EditarProfe({ p, onCerrar, onListo }: { p: ProfeFila | null; onCerrar: () => void; onListo: () => void }) {
  const [nombre, setNombre] = useState(p?.nombre || '');
  const [valor, setValor] = useState(p?.valor_clase || 0);
  const [nota, setNota] = useState(p?.nota || '');
  const { ocupado, correr } = useAccion();
  const guardar = async () => {
    const datos: Record<string, unknown> = p ? { id: p.id } : {};
    if (!p || nombre.trim() !== p.nombre) datos.nombre = nombre;
    if (!p || valor !== p.valor_clase) datos.valor_clase = valor || '';
    if (!p || nota.trim() !== p.nota) datos.nota = nota;
    if (await correr('guardarProfe', datos, p ? 'Profe actualizado' : `${nombre.trim()} agregado`)) onListo();
  };
  return (
    <Modal titulo={p ? 'Editar profe' : 'Nuevo profe'} onCerrar={onCerrar}>
      <div className="rejilla">
        <Campo label="Nombre" ancho ayuda={p && p.pagos ? 'Si lo corriges, también se corrige en sus pagos.' : undefined}><input autoFocus value={nombre} onChange={e => setNombre(e.target.value)} /></Campo>
        <Campo label="Valor por clase" ayuda="Déjalo vacío si cambia según la clase. Igual se puede cambiar en cada pago."><Monto valor={valor} onChange={setValor} placeholder="Variable" /></Campo>
        <Campo label="Nota (opcional)"><input value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej: urbano, miércoles y sábados" /></Campo>
      </div>
      <div className="acciones"><button className="btn" disabled={ocupado || !nombre.trim()} onClick={guardar}>{ocupado ? 'Guardando…' : 'Guardar'}</button><button className="btn secundario" onClick={onCerrar}>Cancelar</button></div>
    </Modal>
  );
}

function EliminarProfe({ p, onCerrar, onListo }: { p: ProfeFila; onCerrar: () => void; onListo: () => void }) {
  const { ocupado, correr } = useAccion();
  const confirmar = async () => { if (await correr('guardarProfe', { id: p.id, activo: false }, `${p.nombre} eliminado de la lista`)) onListo(); };
  return (
    <Modal titulo={`Eliminar a ${p.nombre}`} onCerrar={onCerrar}>
      <p style={{ fontSize: 15 }}>Deja de aparecer para registrar pagos nuevos.</p>
      <p className="aviso ok">{p.pagos ? <>Su historial no se pierde: {p.pagos === 1 ? 'el pago' : `los ${p.pagos} pagos`} por <b>{pesos(p.total_pagado)}</b> {p.pagos === 1 ? 'sigue' : 'siguen'} en los reportes.</> : 'No tiene pagos registrados.'} Si vuelve a trabajar, lo puedes reactivar desde “Eliminados”.</p>
      <div className="acciones"><button className="btn peligro" disabled={ocupado} onClick={confirmar}>{ocupado ? 'Eliminando…' : 'Eliminar'}</button><button className="btn secundario" onClick={onCerrar}>Cancelar</button></div>
    </Modal>
  );
}

// ---------- descuentos
type DescFila = { id: string; nombre: string; tipo: string; valor: number; aplica_a: string; activo: boolean; nota: string };

export function Descuentos() {
  const { recargarCat } = useApp();
  const { d, error, cargando, recargar } = useDatos<{ descuentos: DescFila[] }>('listarDescuentos', {}, []);
  const [editar, setEditar] = useState<DescFila | 'nuevo' | null>(null);
  const { ocupado, correr } = useAccion();
  const listo = async () => { setEditar(null); recargar(); await recargarCat(); };
  const alternar = async (x: DescFila) => {
    if (await correr('guardarDescuento', { ...x, activo: !x.activo }, x.activo ? `"${x.nombre}" desactivado` : `"${x.nombre}" activado`)) listo();
  };
  const filas = d?.descuentos || [];
  return (
    <Pantalla titulo="Descuentos" sub="Los que aparecen para escoger al registrar un pago, un cargo o un uniforme. Siempre se puede poner uno especial escribiendo el motivo">
      <div className="tarjeta">
        <div className="acciones" style={{ marginTop: 0 }}><button className="btn" onClick={() => setEditar('nuevo')}>+ Nuevo descuento</button></div>
      </div>
      {error && <ErrorCaja msg={error} reintentar={recargar} />}
      {cargando && !d && <Cargando texto="Cargando descuentos…" />}
      {d && <div className="tarjeta">
        {!filas.length ? <p className="vacio">No hay descuentos guardados.</p> : (
          <div className="tabla-envoltura"><table className="tabla tarjetas">
            <thead><tr><th>Descuento</th><th className="num">Valor</th><th>Aplica a</th><th></th></tr></thead>
            <tbody>{filas.map(x => (
              <tr key={x.id} className={x.activo ? '' : 'inactivo'}>
                <td><b>{x.nombre}</b>{!x.activo && <> <span className="chip inactivo">Inactivo</span></>}{x.nota && <><br /><small className="suave">{x.nota}</small></>}</td>
                <td className="num" data-label="Valor">{x.tipo === '%' ? `${x.valor}%` : pesos(x.valor)}</td>
                <td data-label="Aplica a">{x.aplica_a === 'Todos' ? 'Cualquier concepto' : x.aplica_a}</td>
                <td className="acciones-fila" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn secundario chico" onClick={() => setEditar(x)}>Editar</button>{' '}
                  <button className={'btn chico' + (x.activo ? ' secundario' : '')} disabled={ocupado} onClick={() => alternar(x)}>{x.activo ? 'Desactivar' : 'Activar'}</button>
                </td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </div>}
      {editar && <EditarDescuento x={editar === 'nuevo' ? null : editar} onCerrar={() => setEditar(null)} onListo={listo} />}
    </Pantalla>
  );
}

function EditarDescuento({ x, onCerrar, onListo }: { x: DescFila | null; onCerrar: () => void; onListo: () => void }) {
  const { cat } = useApp();
  const [nombre, setNombre] = useState(x?.nombre || '');
  const [tipo, setTipo] = useState<'%' | '$'>(x?.tipo === '$' ? '$' : '%');
  const [valor, setValor] = useState(x?.valor || 0);
  const [aplica, setAplica] = useState(x?.aplica_a || 'Todos');
  const [nota, setNota] = useState(x?.nota || '');
  const { ocupado, correr } = useAccion();
  const opciones = ['Todos', ...cat.conceptos.map(c => c.nombre)];
  const malo = !nombre.trim() || valor <= 0 || (tipo === '%' && valor > 100);
  const guardar = async () => {
    const datos = { id: x?.id, nombre, tipo, valor, aplica_a: aplica, nota };
    if (await correr('guardarDescuento', datos, x ? 'Descuento actualizado' : `"${nombre.trim()}" agregado`)) onListo();
  };
  return (
    <Modal titulo={x ? 'Editar descuento' : 'Nuevo descuento'} onCerrar={onCerrar}>
      <div className="rejilla">
        <Campo label="Nombre" ancho><input autoFocus value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Ej: Hermanos" /></Campo>
        <Campo label="Tipo"><Segmentado opciones={['%', '$'] as const} valor={tipo} onChange={setTipo} /></Campo>
        <Campo label={tipo === '%' ? 'Porcentaje' : 'Valor'}>
          {tipo === '%'
            ? <input type="number" inputMode="decimal" min={1} max={100} value={valor || ''} onChange={e => setValor(Number(e.target.value))} placeholder="Ej: 5" />
            : <Monto valor={valor} onChange={setValor} />}
        </Campo>
        <Campo label="Aplica a" ayuda="En qué concepto aparece para escoger"><Selector valor={aplica} onChange={setAplica} opciones={opciones} /></Campo>
        <Campo label="Nota (opcional)" ancho><input value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej: solo si compra el mismo día" /></Campo>
      </div>
      {tipo === '%' && valor > 100 && <p className="aviso error">No puede ser mayor al 100%.</p>}
      <div className="acciones"><button className="btn" disabled={ocupado || malo} onClick={guardar}>{ocupado ? 'Guardando…' : 'Guardar'}</button><button className="btn secundario" onClick={onCerrar}>Cancelar</button></div>
    </Modal>
  );
}
