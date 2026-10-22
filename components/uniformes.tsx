'use client';
import { useMemo, useState } from 'react';
import type { Quien } from '@/lib/tipos';
import { fechaCorta, hoy, pesos } from '@/lib/util';
import { BuscarQuien, Campo, Cargando, ErrorCaja, Monto, Pantalla, Segmentado, Selector, cuentaPorMetodo, cuentasBanco, datosQuien, useAccion, useApp, useDatos } from './ui';
import { ResumenQuien } from './registrar';

export function Uniformes() {
  const { params, ir } = useApp();
  const pestana = params.pestana || 'nuevo';
  return (
    <Pantalla titulo="Uniformes" sub="Pedidos, tallas y entregas">
      <div className="segmentado" style={{ marginBottom: 14 }}>
        <button className={pestana === 'nuevo' ? 'activo' : ''} onClick={() => ir('uniformes', { pestana: 'nuevo' })}>Nuevo pedido</button>
        <button className={pestana === 'entregas' ? 'activo' : ''} onClick={() => ir('uniformes', { pestana: 'entregas' })}>Por entregar</button>
        <button onClick={() => ir('saldos', { concepto: 'Uniforme' })}>Saldos de uniformes</button>
      </div>
      {pestana === 'nuevo' ? <NuevoPedido /> : <PorEntregar />}
    </Pantalla>
  );
}

type Linea = { prenda: string; talla: string; estado: string };

function NuevoPedido() {
  const { cat, aviso } = useApp();
  const { ocupado, correr } = useAccion();
  const estados = (cat.listas.estado_prenda || []).map(String);
  const metodos = cat.listas.metodo_pago.map(String);
  const [quien, setQuien] = useState<Quien>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [valor, setValor] = useState(0);
  const [valorTocado, setValorTocado] = useState(false);
  const [fecha, setFecha] = useState(hoy());
  const [nota, setNota] = useState('');
  const [abono, setAbono] = useState(0);
  const [metodo, setMetodo] = useState('Transferencia');
  const [cuenta, setCuenta] = useState(cuentaPorMetodo('Transferencia', cat));
  const [items, setItems] = useState<string[]>([]); // ids del catálogo escogidos (para sugerir el valor)
  const [clave, setClave] = useState(0);

  const sugerido = useMemo(() => items.reduce((s, id) => s + (cat.prendas.find(p => p.id === id)?.precio || 0), 0), [items, cat.prendas]);
  const valorFinal = valorTocado ? valor : sugerido;

  const agregar = (id: string) => {
    const p = cat.prendas.find(x => x.id === id);
    if (!p) return;
    setItems(xs => [...xs, id]);
    setLineas(ls => [...ls, ...p.incluye.map(n => ({ prenda: n, talla: '', estado: estados[0] || 'Por encargar' }))]);
  };
  const cambiar = (i: number, k: keyof Linea, v: string) => setLineas(ls => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const quitar = (i: number) => setLineas(ls => ls.filter((_, j) => j !== i));

  const guardar = async () => {
    const datos: Record<string, unknown> = { fecha, ...datosQuien(quien), valor_acordado: valorFinal, prendas: lineas, nota };
    if (abono > 0) datos.pago = { valor: abono, metodo, recibido_en: cuenta };
    const r = await correr<{ id: string }>('crearPedido', datos);
    if (r) {
      aviso(`Pedido ${r.id} guardado para ${quien?.nombre}${abono ? ` con abono de ${pesos(abono)}` : ''}`);
      setQuien(null); setLineas([]); setItems([]); setValor(0); setValorTocado(false); setAbono(0); setNota(''); setClave(k => k + 1);
    }
  };

  return (
    <div className="tarjeta">
      <div key={clave}><BuscarQuien valor={quien} onChange={setQuien} etiqueta="¿Para quién es el pedido?" /><ResumenQuien q={quien} /></div>
      <div className="separador" />
      <span className="etiqueta">Agrega las prendas</span>
      <div className="chips" style={{ margin: '8px 0 12px' }}>
        {cat.prendas.map(p => <button key={p.id} className="btn secundario chico" onClick={() => agregar(p.id)}>+ {p.nombre}{p.precio ? ` · ${pesos(p.precio)}` : ''}</button>)}
      </div>
      {lineas.length > 0 && (
        <div className="tabla-envoltura">
          <table className="tabla">
            <thead><tr><th>Prenda</th><th>Talla</th><th>Estado</th><th></th></tr></thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i}>
                  <td><b>{l.prenda}</b></td>
                  <td style={{ minWidth: 110 }}><div className="campo"><input value={l.talla} placeholder="Ej: 10" onChange={e => cambiar(i, 'talla', e.target.value)} /></div></td>
                  <td style={{ minWidth: 170 }}><div className="campo"><Selector valor={l.estado} onChange={v => cambiar(i, 'estado', v)} opciones={estados} /></div></td>
                  <td><button className="enlace" onClick={() => quitar(i)}>Quitar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="rejilla" style={{ marginTop: 12 }}>
        <Campo label="Valor acordado" ayuda={sugerido ? `Según el catálogo: ${pesos(sugerido)}` : 'Escríbelo si no sale del catálogo'}>
          <Monto valor={valorFinal} onChange={v => { setValor(v); setValorTocado(true); }} />
        </Campo>
        <Campo label="Fecha"><input type="date" value={fecha} max={hoy()} onChange={e => setFecha(e.target.value)} /></Campo>
        <Campo label="Nota (opcional)"><input value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej: la quiere para el sábado" /></Campo>
      </div>
      <div className="separador" />
      <span className="etiqueta">¿Pagó algo ya? (opcional)</span>
      <div className="rejilla" style={{ marginTop: 8 }}>
        <Campo label="Abono"><Monto valor={abono} onChange={setAbono} placeholder="$ 0 (no pagó)" /></Campo>
        {abono > 0 && <>
          <Campo label="Método" ancho><Segmentado opciones={metodos} valor={metodo} onChange={m => { setMetodo(m); setCuenta(cuentaPorMetodo(m, cat)); }} /></Campo>
          <Campo label="¿A dónde entró?" ancho><Segmentado opciones={cuentasBanco(cat)} valor={cuenta} onChange={setCuenta} /></Campo>
        </>}
      </div>
      <div className="acciones">
        <button className="btn" disabled={!quien || !lineas.length || ocupado || abono > valorFinal} onClick={guardar}>
          {ocupado ? 'Guardando…' : 'Guardar pedido'}
        </button>
        {abono > valorFinal && <span className="aviso error" style={{ margin: 0 }}>El abono es mayor que el valor acordado.</span>}
      </div>
    </div>
  );
}

type Pendiente = { id: string; pedido: string; fecha_pedido: string; quien: string; prenda: string; talla: string; estado: string; nota: string };

function PorEntregar() {
  const { cat } = useApp();
  const estados = (cat.listas.estado_prenda || []).map(String);
  const { d, error, cargando, recargar } = useDatos<{ total: number; por_estado: Record<string, number>; filas: Pendiente[] }>('reporteEntregas', {}, []);
  const { correr } = useAccion();
  const [filtro, setFiltro] = useState('');
  const grupos = useMemo(() => {
    const g: Record<string, Pendiente[]> = {};
    (d?.filas || []).filter(f => !filtro || f.estado === filtro).forEach(f => { (g[f.pedido] = g[f.pedido] || []).push(f); });
    return Object.values(g);
  }, [d, filtro]);

  const cambiarEstado = async (id: string, estado: string) => {
    const r = await correr('actualizarPrenda', { id, estado }, estado === 'Entregada' ? 'Marcada como entregada' : 'Estado actualizado');
    if (r) recargar();
  };

  if (cargando && !d) return <Cargando />;
  if (error) return <ErrorCaja msg={error} reintentar={recargar} />;
  return (
    <div>
      <div className="segmentado" style={{ marginBottom: 12 }}>
        <button className={!filtro ? 'activo' : ''} onClick={() => setFiltro('')}>Todas ({d?.total || 0})</button>
        {Object.entries(d?.por_estado || {}).map(([e, n]) => <button key={e} className={filtro === e ? 'activo' : ''} onClick={() => setFiltro(e)}>{e} ({n})</button>)}
      </div>
      {!grupos.length && <p className="vacio">No hay prendas pendientes. 🎉</p>}
      {grupos.map(g => (
        <div className="tarjeta" key={g[0].pedido}>
          <h3>{g[0].quien} <span className="suave" style={{ fontWeight: 400, fontSize: 14 }}>· {g[0].pedido} · pedido el {fechaCorta(g[0].fecha_pedido)}</span></h3>
          <ul className="lista-simple">
            {g.map(l => (
              <li key={l.id} style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ flex: 1, minWidth: 160 }}><b>{l.prenda}</b> {l.talla && <>talla {l.talla}</>}{l.nota && <><br /><small className="suave">{l.nota}</small></>}</span>
                <span className="campo" style={{ minWidth: 190 }}><Selector valor={l.estado} onChange={v => cambiarEstado(l.id, v)} opciones={estados} /></span>
                {l.estado !== 'Entregada' && <button className="btn chico" onClick={() => cambiarEstado(l.id, 'Entregada')}>Entregada ✓</button>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
