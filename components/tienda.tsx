'use client';
import { useMemo, useState } from 'react';
import type { Quien } from '@/lib/tipos';
import { hoy, norm, pesos } from '@/lib/util';
import { BuscarQuien, Campo, Pantalla, Segmentado, cuentasBanco, datosQuien, useAccion, useApp } from './ui';

export function Tienda() {
  const { cat, aviso, ir } = useApp();
  const { ocupado, correr } = useAccion();
  const metodos = (cat.listas.metodo_tienda || ['Efectivo', 'Transferencia', 'Fiado', 'Consumo interno']).map(String);
  const internos = (cat.listas.consumo_interno || []).map(String);
  const [carrito, setCarrito] = useState<Record<string, number>>({});
  const [metodo, setMetodo] = useState('Efectivo');
  const [cuenta, setCuenta] = useState(cat.cuenta_sugerida);
  const [quien, setQuien] = useState<Quien>(null);
  const [interno, setInterno] = useState('');
  const [fecha, setFecha] = useState(hoy());
  const [filtro, setFiltro] = useState('');
  const [clave, setClave] = useState(0);

  const lineas = useMemo(() => cat.productos.filter(p => carrito[p.id]).map(p => ({ ...p, cantidad: carrito[p.id] })), [carrito, cat.productos]);
  const total = lineas.reduce((s, l) => s + l.cantidad * l.precio, 0);
  const visibles = cat.productos.filter(p => !filtro || norm(p.nombre).includes(norm(filtro)));
  const sumar = (id: string, d: number) => setCarrito(c => { const n = Math.max(0, (c[id] || 0) + d); const x = { ...c }; if (n) x[id] = n; else delete x[id]; return x; });

  const m = norm(metodo);
  const listo = lineas.length && (m !== 'fiado' || quien) && (m !== 'consumo interno' || interno) && (m !== 'transferencia' || cuenta);
  const guardar = async () => {
    const datos: Record<string, unknown> = { fecha, metodo, lineas: lineas.map(l => ({ producto_id: l.id, cantidad: l.cantidad })) };
    if (m === 'transferencia') datos.recibido_en = cuenta;
    if (m === 'fiado') Object.assign(datos, datosQuien(quien));
    if (m === 'consumo interno') datos.persona = interno;
    const r = await correr<{ venta: string; total: number }>('registrarVenta', datos);
    if (r) {
      aviso(`Venta ${r.venta} guardada: ${pesos(r.total)}${m === 'fiado' ? ' fiado a ' + quien?.nombre : ''}`);
      setCarrito({}); setQuien(null); setInterno(''); setMetodo('Efectivo'); setClave(k => k + 1);
    }
  };

  return (
    <Pantalla titulo="Tienda" sub="Toca los productos para agregarlos a la venta">
      <div className="dos-columnas">
        <div className="tarjeta">
          <div className="campo" style={{ marginBottom: 10 }}>
            <input placeholder="Buscar producto…" value={filtro} onChange={e => setFiltro(e.target.value)} />
          </div>
          <div className="productos">
            {visibles.map(p => (
              <button key={p.id} className="producto" disabled={ocupado} onClick={() => sumar(p.id, 1)}>
                <b>{p.nombre}</b><span>{pesos(p.precio)}</span>
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
          {m === 'transferencia' && <div style={{ marginTop: 10 }}><Campo label="¿A qué cuenta?"><Segmentado opciones={cuentasBanco(cat).filter(c => c !== 'Caja')} valor={cuenta} onChange={setCuenta} /></Campo></div>}
          {m === 'fiado' && <div style={{ marginTop: 10 }} key={clave}><BuscarQuien valor={quien} onChange={setQuien} etiqueta="¿A quién se le fía?" /></div>}
          {m === 'consumo interno' && <div style={{ marginTop: 10 }}><Campo label="¿Quién lo consumió?"><Segmentado opciones={internos} valor={interno} onChange={setInterno} /></Campo></div>}
          <div style={{ marginTop: 10 }}><Campo label="Fecha"><input type="date" value={fecha} max={hoy()} onChange={e => setFecha(e.target.value)} /></Campo></div>
          <div className="acciones">
            <button className="btn" style={{ flex: 1 }} disabled={!listo || ocupado} onClick={guardar}>{ocupado ? 'Guardando…' : `Guardar venta de ${pesos(total)}`}</button>
            {lineas.length > 0 && <button className="btn secundario" onClick={() => setCarrito({})}>Vaciar</button>}
          </div>
          <div className="acciones" style={{ marginTop: 8 }}>
            <button className="enlace" onClick={() => ir('reporteTienda')}>Ver ventas y fiados →</button>
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
