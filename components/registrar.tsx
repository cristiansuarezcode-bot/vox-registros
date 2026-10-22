'use client';
import { useEffect, useMemo, useState } from 'react';
import type { Quien } from '@/lib/tipos';
import { api } from '@/lib/api';
import { hoy, mesActual, norm, pesos } from '@/lib/util';
import { BuscarQuien, Campo, Estado, Monto, Pantalla, Segmentado, Selector, cuentaPorMetodo, cuentasBanco, datosQuien, useAccion, useApp } from './ui';

type Ficha = {
  cargos: { concepto: string; saldo: number; cantidad: number }[];
  pedidos: { id: string; saldo: number; prendas: { prenda: string; estado: string }[] }[];
  tienda: { saldo: number } | null;
};

/** Resumen de lo que debe un estudiante, para que Majo lo vea al registrar. */
export function ResumenQuien({ q }: { q: Quien }) {
  const [f, setF] = useState<Ficha | null>(null);
  const [cargando, setCargando] = useState(false);
  useEffect(() => {
    setF(null);
    if (!q?.estudiante_id) return;
    let vivo = true;
    setCargando(true);
    api<Ficha>('fichaEstudiante', { estudiante_id: q.estudiante_id }).then(r => vivo && setF(r)).catch(() => {}).finally(() => vivo && setCargando(false));
    return () => { vivo = false; };
  }, [q?.estudiante_id]);
  if (q?.estudiante_id && cargando) return <div className="cargando" style={{ padding: '8px 0', fontSize: 13 }}><span className="girando chico" />Revisando lo que debe…</div>;
  if (!q?.estudiante_id || !f) return null;
  const items: { t: string; s: number }[] = [
    ...f.cargos.map(c => ({ t: c.concepto + (c.cantidad > 1 ? ` (${c.cantidad})` : ''), s: c.saldo })),
    ...f.pedidos.filter(p => p.saldo !== 0).map(p => ({ t: 'Uniforme ' + p.id, s: p.saldo })),
    ...(f.tienda ? [{ t: 'Tienda', s: f.tienda.saldo }] : []),
  ];
  if (!items.length) return <p className="suave" style={{ fontSize: 13, margin: '6px 0 0' }}>No tiene saldos pendientes registrados.</p>;
  return (
    <div className="chips" style={{ marginTop: 6 }}>
      {items.map((x, i) => <span key={i} className="chips" style={{ alignItems: 'center' }}><span style={{ fontSize: 13 }}>{x.t}:</span><Estado saldo={x.s} /></span>)}
    </div>
  );
}

// ------------------------------------------------------------------ pago
export function RegistrarPago() {
  const { cat, aviso } = useApp();
  const { ocupado, correr } = useAccion();
  const metodos = cat.listas.metodo_pago.map(String);
  const [fecha, setFecha] = useState(hoy());
  const [quien, setQuien] = useState<Quien>(null);
  const [concepto, setConcepto] = useState('');
  const [valor, setValor] = useState(0);
  const [metodo, setMetodo] = useState(metodos[0] || 'Efectivo');
  const [recibido, setRecibido] = useState('Caja');
  const [pedido, setPedido] = useState('');
  const [nota, setNota] = useState('');
  const [pedidos, setPedidos] = useState<{ pedido: string; saldo: number; estudiante_id: string; quien: string; prendas_pendientes: string[] }[]>([]);
  const [clave, setClave] = useState(0); // para reiniciar el buscador

  const esUniforme = norm(concepto) === 'uniforme';
  useEffect(() => {
    if (!esUniforme) return;
    api<{ filas: typeof pedidos }>('reporteSaldos', { concepto: 'Uniforme' }).then(r => setPedidos(r.filas)).catch(() => setPedidos([]));
  }, [esUniforme]);
  const pedidosDeQuien = useMemo(() => pedidos.filter(p => quien && (quien.estudiante_id ? p.estudiante_id === quien.estudiante_id : norm(p.quien) === norm(quien.persona))), [pedidos, quien]);

  const planDe = (q: Quien) => {
    const e = q?.estudiante_id ? cat.estudiantes.find(x => x.id === q.estudiante_id) : undefined;
    return e?.plan ? (cat.planes || []).find(p => norm(p.nombre) === norm(e.plan)) || { nombre: e.plan, valor_mensual: 0 } : null;
  };
  const plan = planDe(quien);
  const valorSugerido = (c: string, q: Quien) => {
    if (norm(c) === 'mensualidad') return planDe(q)?.valor_mensual || 0;
    return cat.conceptos.find(x => x.nombre === c)?.valor_base || 0;
  };
  const elegirConcepto = (c: string) => {
    setConcepto(c);
    const v = valorSugerido(c, quien);
    if (v) setValor(v);
    setPedido('');
  };
  const elegirQuien = (q: Quien) => {
    setQuien(q);
    if (concepto) { const v = valorSugerido(concepto, q); if (v) setValor(v); }
  };
  const elegirMetodo = (m: string) => { setMetodo(m); setRecibido(cuentaPorMetodo(m, cat)); };

  const listo = quien && concepto && valor > 0 && metodo && recibido && (!esUniforme || pedido);
  const guardar = async () => {
    const r = await correr<{ id: string }>('registrarPago', { fecha, ...datosQuien(quien), concepto, valor, metodo, recibido_en: recibido, pedido_uniforme: pedido, nota });
    if (r) {
      aviso(`Pago guardado (${r.id}): ${quien?.nombre} · ${concepto} · ${pesos(valor)}`);
      setQuien(null); setValor(0); setNota(''); setPedido(''); setClave(k => k + 1);
      const k = cat.conceptos.find(x => x.nombre === concepto);
      if (k?.valor_base && norm(concepto) !== 'mensualidad') setValor(k.valor_base);
    }
  };

  return (
    <Pantalla titulo="Registrar pago" sub="Mensualidades, vestuarios, matrículas, uniformes y otros">
      <div className="tarjeta">
        <div className="rejilla">
          <div style={{ gridColumn: '1 / -1' }} key={clave}>
            <BuscarQuien valor={quien} onChange={elegirQuien} />
            <ResumenQuien q={quien} />
          </div>
          <Campo label="Concepto">
            <Selector valor={concepto} onChange={elegirConcepto} vacio="Escoge…" opciones={cat.conceptos.map(c => c.nombre)} />
          </Campo>
          {esUniforme && (
            <Campo label="Pedido de uniforme" ayuda={quien && !pedidosDeQuien.length ? 'No tiene pedidos con saldo. Créalo en Uniformes.' : undefined}>
              <Selector valor={pedido} onChange={setPedido} vacio="Escoge el pedido…"
                opciones={pedidosDeQuien.map(p => ({ v: p.pedido, t: `${p.pedido} · debe ${pesos(p.saldo)}` }))} />
            </Campo>
          )}
          <Campo label="Valor" ayuda={norm(concepto) === 'mensualidad' ? (plan ? (plan.valor_mensual ? `${plan.nombre}: ${pesos(plan.valor_mensual)} al mes` : `${plan.nombre} no tiene valor mensual. Ponlo en Estudiantes → Planes.`) : quien?.estudiante_id ? 'Este estudiante no tiene plan asignado.' : undefined) : undefined}>
            <Monto valor={valor} onChange={setValor} />
          </Campo>
          <Campo label="Fecha"><input type="date" value={fecha} max={hoy()} onChange={e => setFecha(e.target.value)} /></Campo>
          <Campo label="Método de pago" ancho><Segmentado opciones={metodos} valor={metodo} onChange={elegirMetodo} /></Campo>
          <Campo label="¿A dónde entró la plata?" ancho ayuda={metodo !== 'Efectivo' ? `Sugerida por la fecha: ${cat.cuenta_sugerida}. Cámbiala si la familia transfirió a otra.` : undefined}>
            <Segmentado opciones={cuentasBanco(cat)} valor={recibido} onChange={setRecibido} />
          </Campo>
          <Campo label="Nota (opcional)" ancho><input value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej: abono, pagó la mamá…" /></Campo>
        </div>
        <div className="acciones">
          <button className="btn" disabled={!listo || ocupado} onClick={guardar}>{ocupado ? 'Guardando…' : `Guardar pago${valor ? ' de ' + pesos(valor) : ''}`}</button>
        </div>
      </div>
    </Pantalla>
  );
}

// ------------------------------------------------------------------ pago a profe
export function PagoProfe() {
  const { cat, aviso, ir } = useApp();
  const { ocupado, correr } = useAccion();
  const tarifas = (cat.listas.tarifa_clase || [70000, 80000, 90000]).map(Number);
  const notas = (cat.listas.tarifa_clase_nota || []).map(String);
  const metodos = cat.listas.metodo_pago.map(String);
  const [profeId, setProfeId] = useState('');
  const [periodo, setPeriodo] = useState(mesActual());
  const [fecha, setFecha] = useState(hoy());
  const [lineas, setLineas] = useState<{ clases: number; valor_clase: number }[]>([{ clases: 4, valor_clase: tarifas[0] }]);
  const [metodo, setMetodo] = useState('Transferencia');
  const [desde, setDesde] = useState(cat.cuentas.find(c => c.nombre !== 'Caja')?.nombre || 'Caja');
  const [nota, setNota] = useState('');
  const total = lineas.reduce((s, l) => s + l.clases * l.valor_clase, 0);

  const elegirProfe = (id: string) => {
    setProfeId(id);
    const p = cat.profes.find(x => x.id === id);
    if (p?.valor_clase) setLineas([{ clases: 4, valor_clase: p.valor_clase }]);
  };
  const cambiar = (i: number, k: 'clases' | 'valor_clase', v: number) => setLineas(ls => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  const guardar = async () => {
    const r = await correr<{ pago: string; total: number }>('registrarPagoProfe', { profe_id: profeId, periodo, fecha, lineas, metodo, pagado_desde: desde, nota });
    if (r) {
      aviso(`Pago a profe guardado (${r.pago}): ${pesos(r.total)}`);
      setProfeId(''); setNota(''); setLineas([{ clases: 4, valor_clase: tarifas[0] }]);
    }
  };

  return (
    <Pantalla titulo="Pago a profe" sub="Lo que se le pagó a cada profe por sus clases">
      <div className="tarjeta">
        <div className="rejilla">
          <Campo label="Profe"><Selector valor={profeId} onChange={elegirProfe} vacio="Escoge…" opciones={cat.profes.map(p => ({ v: p.id, t: p.nombre }))} /></Campo>
          <Campo label="Periodo" ayuda="Ej: Octubre (1) es la primera quincena"><input value={periodo} onChange={e => setPeriodo(e.target.value)} /></Campo>
          <Campo label="Fecha del pago"><input type="date" value={fecha} max={hoy()} onChange={e => setFecha(e.target.value)} /></Campo>
        </div>
        <div className="separador" />
        <span className="etiqueta">Clases</span>
        {lineas.map((l, i) => (
          <div key={i} className="rejilla" style={{ marginTop: 8, alignItems: 'end' }}>
            <Campo label="Número de clases"><input type="number" min={1} inputMode="numeric" value={l.clases || ''} onChange={e => cambiar(i, 'clases', Number(e.target.value))} /></Campo>
            <Campo label="Valor por clase">
              <Selector valor={String(l.valor_clase)} onChange={v => cambiar(i, 'valor_clase', Number(v))}
                opciones={Array.from(new Set([...tarifas, l.valor_clase])).map((t, k) => ({ v: String(t), t: pesos(t) + (notas[k] && tarifas[k] === t ? ` · ${notas[k]}` : '') }))} />
            </Campo>
            <div className="campo"><label>Subtotal</label><div className="elegido" style={{ borderColor: 'var(--linea)', background: '#fff' }}><b>{pesos(l.clases * l.valor_clase)}</b>
              {lineas.length > 1 && <button className="enlace" onClick={() => setLineas(ls => ls.filter((_, j) => j !== i))}>Quitar</button>}</div></div>
          </div>
        ))}
        <button className="enlace" style={{ marginTop: 8 }} onClick={() => setLineas(ls => [...ls, { clases: 1, valor_clase: tarifas[1] || tarifas[0] }])}>+ Agregar clases con otra tarifa</button>
        <div className="total-grande"><span>Total</span><b>{pesos(total)}</b></div>
        <div className="separador" />
        <div className="rejilla">
          <Campo label="Método" ancho><Segmentado opciones={metodos} valor={metodo} onChange={setMetodo} /></Campo>
          <Campo label="¿De dónde salió la plata?" ancho><Segmentado opciones={cuentasBanco(cat)} valor={desde} onChange={setDesde} /></Campo>
          <Campo label="Nota (opcional)" ancho><input value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej: incluye reposición del sábado" /></Campo>
        </div>
        <div className="acciones">
          <button className="btn" disabled={!profeId || !periodo || !total || ocupado} onClick={guardar}>{ocupado ? 'Guardando…' : `Guardar pago de ${pesos(total)}`}</button>
          <button className="btn secundario" onClick={() => ir('reporteProfes')}>Ver pagos a profes</button>
        </div>
      </div>
    </Pantalla>
  );
}

// ------------------------------------------------------------------ gasto
export function Gasto() {
  const { cat, aviso } = useApp();
  const { ocupado, correr } = useAccion();
  const cats = (cat.listas.categoria_gasto || []).map(String);
  const [fecha, setFecha] = useState(hoy());
  const [categoria, setCategoria] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [valor, setValor] = useState(0);
  const [desde, setDesde] = useState('Caja');
  const [nota, setNota] = useState('');
  const guardar = async () => {
    const r = await correr<{ id: string }>('registrarGasto', { fecha, categoria, descripcion, valor, pagado_desde: desde, nota });
    if (r) { aviso(`Gasto guardado (${r.id}): ${descripcion} · ${pesos(valor)}`); setDescripcion(''); setValor(0); setNota(''); }
  };
  return (
    <Pantalla titulo="Registrar gasto" sub="Compras, parqueadero, aseo, celebraciones…">
      <div className="tarjeta">
        <div className="rejilla">
          <Campo label="Categoría" ancho><Segmentado opciones={cats} valor={categoria} onChange={setCategoria} /></Campo>
          <Campo label="¿Qué se compró o pagó?"><input value={descripcion} onChange={e => setDescripcion(e.target.value)} placeholder="Ej: jabón y toallas" /></Campo>
          <Campo label="Valor"><Monto valor={valor} onChange={setValor} /></Campo>
          <Campo label="Fecha"><input type="date" value={fecha} max={hoy()} onChange={e => setFecha(e.target.value)} /></Campo>
          <Campo label="¿De dónde salió la plata?" ancho><Segmentado opciones={cuentasBanco(cat)} valor={desde} onChange={setDesde} /></Campo>
          <Campo label="Nota (opcional)" ancho><input value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej: lo pagó Liz y se le devolvió" /></Campo>
        </div>
        <div className="acciones"><button className="btn" disabled={!categoria || !descripcion.trim() || !valor || ocupado} onClick={guardar}>{ocupado ? 'Guardando…' : 'Guardar gasto'}</button></div>
      </div>
    </Pantalla>
  );
}

// ------------------------------------------------------------------ traslado
export function Traslado() {
  const { cat, aviso } = useApp();
  const { ocupado, correr } = useAccion();
  const origenes = cat.cuentas_todas?.length ? cat.cuentas_todas.filter(c => c !== 'Sin dato') : cuentasBanco(cat);
  const [fecha, setFecha] = useState(hoy());
  const [de, setDe] = useState('');
  const [a, setA] = useState('');
  const [valor, setValor] = useState(0);
  const [nota, setNota] = useState('');
  const guardar = async () => {
    const r = await correr<{ id: string }>('registrarTraslado', { fecha, de, a, valor, nota });
    if (r) { aviso(`Traslado guardado (${r.id}): ${de} → ${a} · ${pesos(valor)}`); setValor(0); setNota(''); }
  };
  return (
    <Pantalla titulo="Traslado entre cuentas" sub="Cuando se saca plata de una cuenta y se pasa a otra o a la caja">
      <div className="tarjeta">
        <div className="rejilla">
          <Campo label="Sale de" ancho><Segmentado opciones={origenes} valor={de} onChange={setDe} /></Campo>
          <Campo label="Entra a" ancho><Segmentado opciones={cuentasBanco(cat).filter(c => c !== de)} valor={a} onChange={setA} /></Campo>
          <Campo label="Valor"><Monto valor={valor} onChange={setValor} /></Campo>
          <Campo label="Fecha"><input type="date" value={fecha} max={hoy()} onChange={e => setFecha(e.target.value)} /></Campo>
          <Campo label="Nota (opcional)" ancho><input value={nota} onChange={e => setNota(e.target.value)} placeholder="Ej: retiro por cajero, se le entregó a Cristian" /></Campo>
        </div>
        <div className="acciones"><button className="btn" disabled={!de || !a || de === a || !valor || ocupado} onClick={guardar}>{ocupado ? 'Guardando…' : 'Guardar traslado'}</button></div>
      </div>
    </Pantalla>
  );
}
