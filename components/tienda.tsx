'use client';
import { useMemo, useState } from 'react';
import type { Quien } from '@/lib/tipos';
import { hoy, norm, pesos } from '@/lib/util';
import { BuscarQuien, Campo, Monto, Pantalla, Segmentado, cuentasTienda, datosQuien, useAccion, useApp, useSaldoFavor } from './ui';

export function Tienda() {
  const { cat, aviso, ir, recargarCat } = useApp();
  const { ocupado, correr } = useAccion();
  const metodos = [...(cat.listas.metodo_tienda || ['Efectivo', 'Transferencia', 'Fiado', 'Consumo interno']).map(String), 'Saldo a favor'];
  const internos = (cat.listas.consumo_interno || []).map(String);
  const [carrito, setCarrito] = useState<Record<string, number>>({});
  const [metodo, setMetodo] = useState('Efectivo');
  const [cuenta, setCuenta] = useState(cuentasTienda(cat)[0] || '');
  const [quien, setQuien] = useState<Quien>(null);
  const [interno, setInterno] = useState('');
  const [fecha, setFecha] = useState(hoy());
  const [filtro, setFiltro] = useState('');
  const [clave, setClave] = useState(0);
  const [recibido, setRecibido] = useState(0);
  const [destinoCambio, setDestinoCambio] = useState<'Se le devolvió' | 'No quiso el cambio' | 'Dejárselo a favor'>('Se le devolvió');
  const [quienCambio, setQuienCambio] = useState<Quien>(null);

  const lineas = useMemo(() => cat.productos.filter(p => carrito[p.id]).map(p => ({ ...p, cantidad: carrito[p.id] })), [carrito, cat.productos]);
  const total = lineas.reduce((s, l) => s + l.cantidad * l.precio, 0);
  const visibles = cat.productos.filter(p => !filtro || norm(p.nombre).includes(norm(filtro)));
  const sumar = (id: string, d: number) => setCarrito(c => { const n = Math.max(0, (c[id] || 0) + d); const x = { ...c }; if (n) x[id] = n; else delete x[id]; return x; });

  const m = norm(metodo);
  const efectivo = m === 'efectivo';
  // Billetes con los que probablemente pague: el siguiente múltiplo de cada denominación, sin repetir.
  const billetes = useMemo(() => {
    if (!total) return [];
    const xs = [1000, 2000, 5000, 10000, 20000, 50000, 100000].map(d => Math.ceil(total / d) * d).filter(v => v > total);
    return [...new Set(xs)].sort((a, b) => a - b).slice(0, 4);
  }, [total]);
  const devolver = recibido - total;
  const sobra = efectivo && devolver > 0 ? devolver : 0;
  const cambioPendiente = sobra > 0 && destinoCambio !== 'Se le devolvió';
  const conSaldo = m === 'saldo a favor';
  const favor = useSaldoFavor(conSaldo ? quien : null);
  const listo = lineas.length && (m !== 'fiado' || quien) && (m !== 'consumo interno' || interno) && (m !== 'transferencia' || cuenta)
    && (!conSaldo || (quien && !favor.cargando && total <= favor.a_favor))
    && (!(cambioPendiente && destinoCambio === 'Dejárselo a favor') || quienCambio);
  const guardar = async () => {
    const datos: Record<string, unknown> = { fecha, metodo, lineas: lineas.map(l => ({ producto_id: l.id, cantidad: l.cantidad })) };
    if (m === 'transferencia') datos.recibido_en = cuenta;
    if (m === 'fiado' || conSaldo) Object.assign(datos, datosQuien(quien));
    if (m === 'consumo interno') datos.persona = interno;
    if (cambioPendiente) datos.cambio = destinoCambio === 'No quiso el cambio' ? { valor: sobra, destino: 'caja' } : { valor: sobra, destino: 'favor', ...datosQuien(quienCambio) };
    const r = await correr<{ venta: string; total: number }>('registrarVenta', datos);
    if (r) {
      aviso(`Venta ${r.venta} guardada: ${pesos(r.total)}${m === 'fiado' ? ' fiado a ' + quien?.nombre : conSaldo ? ' con el saldo a favor de ' + quien?.nombre : ''}${!sobra ? '' : destinoCambio === 'No quiso el cambio' ? ` · ${pesos(sobra)} de cambio quedan en la caja` : destinoCambio === 'Dejárselo a favor' ? ` · ${pesos(sobra)} quedan a favor de ${quienCambio?.nombre}` : ` · devolver ${pesos(sobra)}`}`);
      setCarrito({}); setRecibido(0); setDestinoCambio('Se le devolvió'); setQuienCambio(null); setQuien(null); setInterno(''); setMetodo('Efectivo'); setClave(k => k + 1);
      if (lineas.some(l => typeof l.stock === 'number')) recargarCat();
    }
  };

  return (
    <Pantalla titulo="Tienda" sub="Toca los productos para agregarlos a la venta">
      <div className="acciones mt0" style={{ marginTop: -6, marginBottom: 12 }}>
        <button className="btn secundario chico" onClick={() => ir('inventario')}>Inventario y productos</button>
        <button className="btn secundario chico" onClick={() => ir('reporteTienda')}>Ventas y fiados</button>
      </div>
      <div className="dos-columnas">
        <div className="tarjeta">
          <div className="campo" style={{ marginBottom: 10 }}>
            <input placeholder="Buscar producto…" value={filtro} onChange={e => setFiltro(e.target.value)} />
          </div>
          <div className="productos">
            {visibles.map(p => (
              <button key={p.id} className="producto" disabled={ocupado} onClick={() => sumar(p.id, 1)}>
                <b>{p.nombre}</b><span>{pesos(p.precio)}</span>
                {typeof p.stock === 'number' && (() => { const q = p.stock - (carrito[p.id] || 0); return (
                  <span className={'existencias' + (q <= 0 ? ' cero' : q <= 3 ? ' bajo' : '')}>{q <= 0 ? 'Agotado' : `Quedan ${q}`}</span>); })()}
                {carrito[p.id] ? <span className="cant">{carrito[p.id]}</span> : null}
              </button>
            ))}
          </div>
        </div>
        <div className="tarjeta venta-lado" id="venta">
          <h3>Venta</h3>
          {!lineas.length && <p className="vacio">Todavía no hay productos.</p>}
          <ul className="lista-simple carrito">
            {lineas.map(l => (
              <li key={l.id}>
                <span>{l.nombre}<br /><small className="suave">{pesos(l.precio)} c/u</small></span>
                <span className="contador">
                  <button aria-label="Quitar uno" onClick={() => sumar(l.id, -1)}>−</button>
                  <b>{l.cantidad}</b>
                  <button aria-label="Agregar uno" onClick={() => sumar(l.id, 1)}>+</button>
                </span>
                <b className="monto">{pesos(l.cantidad * l.precio)}</b>
              </li>
            ))}
          </ul>
          <div className="total-grande"><span>Total</span><b>{pesos(total)}</b></div>
          <div className="separador" />
          <Campo label="¿Cómo pagó?"><Segmentado opciones={metodos} valor={metodo} onChange={setMetodo} /></Campo>
          {efectivo && total > 0 && (
            <div className="caja-efectivo">
              <Campo label="¿Con cuánto pagó?">
                <Monto valor={recibido} onChange={setRecibido} placeholder="Escribe lo que te entregó" />
              </Campo>
              <div className="chips" style={{ marginTop: 6 }}>
                <button type="button" className={'btn secundario chico' + (recibido === total ? ' activo' : '')} onClick={() => setRecibido(total)}>Exacto</button>
                {billetes.map(b => <button type="button" key={b} className={'btn secundario chico' + (recibido === b ? ' activo' : '')} onClick={() => setRecibido(b)}>{pesos(b)}</button>)}
              </div>
              {recibido > 0 && (devolver >= 0
                ? <div className={'cambio' + (cambioPendiente ? ' guardado' : '')}><span>{!devolver ? 'Sin cambio' : cambioPendiente ? 'Cambio que se queda' : 'Devolver'}</span><b>{pesos(devolver)}</b></div>
                : <div className="cambio falta"><span>Faltan</span><b>{pesos(-devolver)}</b></div>)}
              {sobra > 0 && (
                <div style={{ marginTop: 10 }} className="fila-tres">
                  <Campo label="¿Qué pasó con el cambio?">
                    <Segmentado opciones={['Se le devolvió', 'No quiso el cambio', 'Dejárselo a favor'] as const} valor={destinoCambio} onChange={setDestinoCambio} />
                  </Campo>
                  {destinoCambio === 'No quiso el cambio' && <p className="ayuda" style={{ margin: '6px 0 0' }}>Los {pesos(sobra)} quedan registrados en la caja como “Cambio no devuelto”, para que el cierre cuadre.</p>}
                  {destinoCambio === 'Dejárselo a favor' && <div style={{ marginTop: 8 }} key={'c' + clave}>
                    <BuscarQuien valor={quienCambio} onChange={setQuienCambio} etiqueta="¿A favor de quién?" />
                    <p className="ayuda" style={{ margin: '6px 0 0' }}>La plata queda en la caja y {quienCambio ? quienCambio.nombre : 'esa persona'} la puede usar en su próxima compra con “Saldo a favor”.</p>
                  </div>}
                </div>
              )}
            </div>
          )}
          {m === 'transferencia' && <div style={{ marginTop: 10 }}><Campo label="¿A qué cuenta?"><Segmentado opciones={cuentasTienda(cat)} valor={cuenta} onChange={setCuenta} /></Campo></div>}
          {m === 'fiado' && <div style={{ marginTop: 10 }} key={clave}><BuscarQuien valor={quien} onChange={setQuien} etiqueta="¿A quién se le fía?" /></div>}
          {conSaldo && <div style={{ marginTop: 10 }} key={'s' + clave}>
            <BuscarQuien valor={quien} onChange={setQuien} etiqueta="¿De quién es el saldo a favor?" />
            {quien && <p className={'aviso ' + (favor.cargando ? 'info' : total > favor.a_favor ? 'error' : 'ok')}>
              {favor.cargando ? 'Revisando su saldo a favor…' : favor.a_favor ? <>Tiene <b>{pesos(favor.a_favor)}</b> a favor{total > favor.a_favor ? ': no alcanza para esta compra.' : `. Después de la compra le quedan ${pesos(favor.a_favor - total)}.`}</> : 'No tiene saldo a favor.'}
            </p>}
          </div>}
          {m === 'consumo interno' && <div style={{ marginTop: 10 }}><Campo label="¿Quién lo consumió?"><Segmentado opciones={internos} valor={interno} onChange={setInterno} /></Campo></div>}
          <div style={{ marginTop: 10 }}><Campo label="Fecha"><input type="date" value={fecha} max={hoy()} onChange={e => setFecha(e.target.value)} /></Campo></div>
          <div className="acciones">
            <button className="btn" style={{ flex: 1 }} disabled={!listo || ocupado} onClick={guardar}>{ocupado ? 'Guardando…' : `Guardar venta de ${pesos(total)}`}</button>
            {lineas.length > 0 && <button className="btn secundario" onClick={() => { setCarrito({}); setRecibido(0); setDestinoCambio('Se le devolvió'); setQuienCambio(null); }}>Vaciar</button>}
          </div>
        </div>
      </div>
      {lineas.length > 0 && (
        <div className="barra-movil">
          <span>{lineas.reduce((s, l) => s + l.cantidad, 0)} producto(s) · <b>{pesos(total)}</b></span>
          <button className="btn" onClick={() => document.getElementById('venta')?.scrollIntoView({ behavior: 'smooth' })}>Cobrar ↓</button>
        </div>
      )}
    </Pantalla>
  );
}
