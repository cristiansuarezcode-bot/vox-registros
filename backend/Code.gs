/**
 * Registros Vox Corpus Danza
 * Backend en Google Apps Script. La base de datos es la hoja de cálculo
 * a la que está ligado este script (Extensiones → Apps Script).
 *
 * La página llama a este script con fetch:
 *   - GET  → solo responde que el servicio está vivo (no entrega datos).
 *   - POST → cuerpo JSON como texto, SIN cabecera Content-Type (evita el bloqueo de CORS).
 *            { accion: 'login', usuario, clave }  → { token, nombre, rol }
 *            { accion: '<otra>', token, datos: {...} }
 *
 * Toda escritura usa LockService y deja rastro en la hoja "Bitácora".
 * Nada se borra: los registros se anulan con motivo, quién y cuándo.
 */

// Hoja de cálculo que sirve de base de datos (Registros Vox Corpus Danza, cuenta voxcorpusdanza@gmail.com).
const HOJA_ID = '1XWxLoazHg4dCTqvaM0E2ZQYFzcL0XjNFcp_xQ4B51p0';
const TZ = 'America/Bogota';
const VERSION = '1.0.1';
const SESION_SEG = 6 * 60 * 60;          // máximo que permite CacheService
const INTENTOS_MAX = 5;                  // claves erradas antes de bloquear
const BLOQUEO_SEG = 15 * 60;

const H = {
  PAGOS: 'Pagos', CARGOS: 'Cargos', VENTAS: 'Ventas tienda', PEDIDOS: 'Pedidos uniforme',
  PRENDAS: 'Prendas del pedido', PAGO_PROFES: 'Pago profes', GASTOS: 'Gastos', TRASLADOS: 'Traslados',
  ESTUDIANTES: 'Estudiantes', PRODUCTOS: 'Productos', CAT_PRENDAS: 'Prendas uniforme', CONCEPTOS: 'Conceptos',
  PROFES: 'Profes', CUENTAS: 'Cuentas', LISTAS: 'Listas', USUARIOS: 'Usuarios', BITACORA: 'Bitácora',
};

// Hojas de registros que se pueden anular. "grupo" = columna que junta varias líneas de un mismo registro.
const ANULABLES = {
  'Pagos': null, 'Cargos': null, 'Ventas tienda': 'venta', 'Pedidos uniforme': null,
  'Pago profes': 'pago', 'Gastos': null, 'Traslados': null,
};

// Columnas que configurar() agrega si la hoja no las tiene.
const COLUMNAS_EXTRA = {
  'Pagos': ['anulado_por', 'anulado_en'],
  'Cargos': ['anulado_por', 'anulado_en', 'actualizado_por', 'actualizado_en'],
  'Ventas tienda': ['recibido_en', 'anulado_por', 'anulado_en'],
  'Pedidos uniforme': ['anulado_por', 'anulado_en'],
  'Pago profes': ['anulado_por', 'anulado_en'],
  'Gastos': ['anulado_por', 'anulado_en'],
  'Traslados': ['anulado_por', 'anulado_en'],
  'Usuarios': ['clave_nueva'],
};
const BITACORA_COLS = ['fecha_hora', 'usuario', 'accion', 'hoja', 'id', 'detalle'];

// ===================================================================== entrada web

function doGet() {
  return salida_({ ok: true, data: { app: 'Registros Vox Corpus Danza', version: VERSION } });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (x) {
    return salida_({ ok: false, error: 'La solicitud no es JSON válido' });
  }
  try {
    return salida_({ ok: true, data: enrutar_(body) });
  } catch (x) {
    if (!x.publico) console.error(x && x.stack || x);
    return salida_({ ok: false, error: x.publico ? x.message : 'Error interno: ' + (x && x.message), codigo: x.codigo || '' });
  }
}

function salida_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// accion → [función, escribe]
const ACCIONES = {
  catalogos:           [catalogos_, false],
  registros:           [registros_, false],
  resumenDia:          [resumenDia_, false],
  reporteTienda:       [reporteTienda_, false],
  reporteSaldos:       [reporteSaldos_, false],
  reporteEntregas:     [reporteEntregas_, false],
  reporteCuentas:      [reporteCuentas_, false],
  reporteProfes:       [reporteProfes_, false],
  fichaEstudiante:     [fichaEstudiante_, false],
  registrarPago:       [registrarPago_, true],
  registrarCargo:      [registrarCargo_, true],
  editarCargo:         [editarCargo_, true],
  registrarVenta:      [registrarVenta_, true],
  crearPedido:         [crearPedido_, true],
  actualizarPrenda:    [actualizarPrenda_, true],
  registrarPagoProfe:  [registrarPagoProfe_, true],
  registrarGasto:      [registrarGasto_, true],
  registrarTraslado:   [registrarTraslado_, true],
  agregarEstudiante:   [agregarEstudiante_, true],
  anular:              [anular_, true],
};

function enrutar_(body) {
  const accion = String(body.accion || '');
  if (accion === 'login') return login_(body.usuario, body.clave);
  if (accion === 'logout') return logout_(body.token);
  const def = ACCIONES[accion];
  if (!def) throw err_('Acción desconocida: ' + accion);
  const ses = sesion_(body.token);
  const datos = body.datos || {};
  if (!def[1]) return def[0](datos, ses);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw err_('Hay otra persona guardando en este momento. Intenta de nuevo en unos segundos.', 'ocupado');
  try {
    const r = def[0](datos, ses);
    SpreadsheetApp.flush();
    return r;
  } finally {
    lock.releaseLock();
  }
}

// ===================================================================== sesiones

function login_(usuario, clave) {
  usuario = norm_(usuario);
  if (!usuario || !clave) throw err_('Escribe tu usuario y tu clave');
  const cache = CacheService.getScriptCache();
  const kf = 'f:' + usuario;
  const fallos = Number(cache.get(kf) || 0);
  if (fallos >= INTENTOS_MAX) throw err_('Demasiados intentos. Espera 15 minutos e intenta de nuevo.', 'bloqueado');
  const u = tabla_(H.USUARIOS).filas.find(f => norm_(f.usuario) === usuario);
  const valido = u && esSi_(u.activo) && u.clave_hash && u.clave_hash === hash_(String(clave));
  if (!valido) {
    cache.put(kf, String(fallos + 1), BLOQUEO_SEG);
    throw err_('Usuario o clave incorrectos', 'credenciales');
  }
  cache.remove(kf);
  const token = Utilities.getUuid();
  const ses = { usuario: usuario, nombre: String(u.nombre), rol: String(u.rol), v: versionSesiones_() };
  cache.put('s:' + token, JSON.stringify(ses), SESION_SEG);
  bitacora_(ses, 'login', H.USUARIOS, usuario, {});
  return { token: token, nombre: ses.nombre, rol: ses.rol, dura_horas: SESION_SEG / 3600 };
}

function logout_(token) {
  if (token) CacheService.getScriptCache().remove('s:' + token);
  return { cerrada: true };
}

function sesion_(token) {
  if (!token) throw err_('Tu sesión terminó. Vuelve a entrar.', 'sesion');
  const cache = CacheService.getScriptCache();
  const raw = cache.get('s:' + token);
  if (!raw) throw err_('Tu sesión terminó. Vuelve a entrar.', 'sesion');
  const ses = JSON.parse(raw);
  if (ses.v !== versionSesiones_()) throw err_('Tu sesión terminó. Vuelve a entrar.', 'sesion');
  const u = tabla_(H.USUARIOS).filas.find(f => norm_(f.usuario) === ses.usuario);
  if (!u || !esSi_(u.activo)) throw err_('Tu usuario está desactivado.', 'sesion');
  cache.put('s:' + token, raw, SESION_SEG); // se renueva con cada uso
  return ses;
}

function versionSesiones_() {
  return PropertiesService.getScriptProperties().getProperty('SESIONES_V') || '1';
}

function hash_(clave) {
  const sal = PropertiesService.getScriptProperties().getProperty('SAL');
  if (!sal) throw err_('Falta configurar el script: ejecuta "Configurar" desde el menú Vox.');
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, sal + ':' + clave, Utilities.Charset.UTF_8);
  return bytes.map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}

// ===================================================================== catálogos

function catalogos_(d, ses) {
  const l = listas_();
  return {
    usuario: { nombre: ses.nombre, rol: ses.rol },
    hoy: ymd_(new Date()),
    estudiantes: activos_(H.ESTUDIANTES).map(f => ({ id: f.id, nombre: f.nombre, plan: f.plan || '' }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    productos: activos_(H.PRODUCTOS).map(f => ({ id: f.id, nombre: f.nombre, precio: num_(f.precio) })),
    prendas: activos_(H.CAT_PRENDAS).map(f => ({ id: f.id, nombre: f.nombre, precio: num_(f.precio),
      incluye: String(f.incluye || f.nombre).split(',').map(s => s.trim()).filter(Boolean) })),
    conceptos: activos_(H.CONCEPTOS).map(f => ({ id: f.id, nombre: f.nombre, valor_base: num_(f.valor_base), usa_cargos: String(f.usa_cargos || '') })),
    profes: activos_(H.PROFES).map(f => ({ id: f.id, nombre: f.nombre, valor_clase: num_(f.valor_clase) })),
    cuentas: activos_(H.CUENTAS).map(f => ({ id: f.id, nombre: f.nombre, tipo: f.tipo, sugerida_dias: String(f.sugerida_dias || '') })),
    cuentas_todas: tabla_(H.CUENTAS).filas.filter(f => f.id).map(f => String(f.nombre)),
    cuenta_sugerida: cuentaSugerida_(new Date()),
    listas: l,
  };
}

function listas_() {
  const t = tabla_(H.LISTAS);
  const out = {};
  t.headers.forEach(h => { if (h) out[h] = []; });
  t.filas.forEach(f => t.headers.forEach(h => { if (h && f[h] !== '' && f[h] !== null) out[h].push(f[h]); }));
  return out;
}

function cuentaSugerida_(fecha) {
  const dia = Number(Utilities.formatDate(fecha, TZ, 'd'));
  const c = activos_(H.CUENTAS).find(f => {
    const m = String(f.sugerida_dias || '').match(/^(\d+)\s*-\s*(\d+)$/);
    return m && dia >= Number(m[1]) && dia <= Number(m[2]);
  });
  return c ? c.nombre : '';
}

// ===================================================================== registros

function registrarPago_(d, ses) {
  const q = quien_(d);
  const concepto = concepto_(d.concepto);
  const metodo = enLista_(d.metodo, 'metodo_pago', 'método de pago');
  const p = {
    fecha: fecha_(d.fecha), estudiante_id: q.estudiante_id, estudiante: q.estudiante, persona: q.persona,
    concepto: concepto.nombre, valor: monto_(d.valor), metodo: metodo,
    recibido_en: cuentaActiva_(d.recibido_en, 'recibido en'), pedido_uniforme: '', nota: texto_(d.nota),
  };
  if (norm_(concepto.nombre) === 'uniforme') {
    const ped = buscarValido_(H.PEDIDOS, d.pedido_uniforme, 'pedido de uniforme');
    p.pedido_uniforme = ped.id;
  }
  p.id = siguienteId_(H.PAGOS, 'id', 'P', 4);
  insertar_(H.PAGOS, [auditar_(p, ses)]);
  bitacora_(ses, 'registrarPago', H.PAGOS, p.id, p);
  return { id: p.id };
}

function registrarCargo_(d, ses) {
  const q = quien_(d, true);
  const concepto = concepto_(d.concepto);
  const cantidad = entero_(d.cantidad === undefined ? 1 : d.cantidad, 'cantidad');
  const valor = d.valor_total !== undefined && d.valor_total !== '' ? monto_(d.valor_total, true)
    : (concepto.valor_base ? cantidad * concepto.valor_base : null);
  if (valor === null) throw err_('Este concepto no tiene valor base: escribe el valor total.');
  const ya = tabla_(H.CARGOS).filas.find(f => f.estudiante_id === q.estudiante_id && norm_(f.concepto) === norm_(concepto.nombre) && esValido_(f));
  if (ya) throw err_(q.estudiante + ' ya tiene un cargo de ' + concepto.nombre + ' (' + ya.id + '). Edítalo en vez de crear otro.', 'duplicado');
  const c = { id: siguienteId_(H.CARGOS, 'id', 'C', 3), estudiante_id: q.estudiante_id, estudiante: q.estudiante,
    concepto: concepto.nombre, cantidad: cantidad, valor_total: valor, nota: texto_(d.nota) };
  insertar_(H.CARGOS, [auditar_(c, ses)]);
  bitacora_(ses, 'registrarCargo', H.CARGOS, c.id, c);
  return { id: c.id };
}

function editarCargo_(d, ses) {
  const t = tabla_(H.CARGOS);
  const c = t.filas.find(f => f.id === d.id);
  if (!c) throw err_('No encontré el cargo ' + d.id);
  if (!esValido_(c)) throw err_('Ese cargo está anulado.');
  const concepto = concepto_(c.concepto);
  const cambios = {};
  if (d.cantidad !== undefined) {
    cambios.cantidad = entero_(d.cantidad, 'cantidad');
    if (d.valor_total === undefined && concepto.valor_base) cambios.valor_total = cambios.cantidad * concepto.valor_base;
  }
  if (d.valor_total !== undefined) cambios.valor_total = monto_(d.valor_total, true);
  if (d.nota !== undefined) cambios.nota = texto_(d.nota);
  if (!Object.keys(cambios).length) throw err_('No hay cambios para guardar.');
  cambios.actualizado_por = ses.nombre;
  cambios.actualizado_en = new Date();
  const antes = {};
  Object.keys(cambios).filter(k => k.indexOf('actualizado_') !== 0).forEach(k => antes[k] = c[k]);
  actualizar_(t, c, cambios);
  bitacora_(ses, 'editarCargo', H.CARGOS, c.id, { antes: antes, despues: cambios });
  return { id: c.id };
}

function registrarVenta_(d, ses) {
  const metodo = enLista_(d.metodo, 'metodo_tienda', 'método');
  const lineas = arreglo_(d.lineas, 'productos', 40);
  const prods = indice_(activos_(H.PRODUCTOS));
  let q = { estudiante_id: '', estudiante: '', persona: '' };
  if (norm_(metodo) === 'fiado') q = quien_(d);
  if (norm_(metodo) === 'consumo interno') q.persona = enLista_(d.persona, 'consumo_interno', 'quién consumió');
  let recibido = '';
  if (norm_(metodo) === 'efectivo') recibido = 'Caja';
  else if (norm_(metodo) === 'transferencia') recibido = cuentaActiva_(d.recibido_en, 'recibido en');
  const fecha = fecha_(d.fecha);
  const venta = siguienteId_(H.VENTAS, 'venta', 'S', 4);
  let n = numeroId_(siguienteId_(H.VENTAS, 'id', 'V', 4));
  let total = 0;
  const filas = lineas.map(l => {
    const p = prods[l.producto_id];
    if (!p) throw err_('Producto no encontrado o inactivo: ' + l.producto_id);
    const cant = entero_(l.cantidad, 'cantidad');
    const precio = num_(p.precio);
    total += cant * precio;
    return auditar_({ id: 'V' + pad_(n++, 4), venta: venta, fecha: fecha, producto_id: p.id, producto: p.nombre,
      cantidad: cant, precio: precio, total: cant * precio, metodo: metodo, recibido_en: recibido,
      estudiante_id: q.estudiante_id, estudiante: q.estudiante, persona: q.persona, nota: texto_(d.nota) }, ses);
  });
  insertar_(H.VENTAS, filas);
  bitacora_(ses, 'registrarVenta', H.VENTAS, venta, { metodo: metodo, total: total, lineas: filas.length, quien: q.estudiante || q.persona });
  return { venta: venta, total: total, lineas: filas.length };
}

function crearPedido_(d, ses) {
  const q = quien_(d);
  const valor = monto_(d.valor_acordado, true);
  const piezas = nombresPiezas_();
  const prendas = arreglo_(d.prendas, 'prendas', 20);
  const estados = listas_().estado_prenda || [];
  const fecha = fecha_(d.fecha);
  const pid = siguienteId_(H.PEDIDOS, 'id', 'U', 3);
  let n = numeroId_(siguienteId_(H.PRENDAS, 'id', 'L', 3));
  const lineas = prendas.map(p => {
    const nombre = piezas[norm_(p.prenda)];
    if (!nombre) throw err_('Prenda desconocida: ' + p.prenda);
    const estado = p.estado ? enLista_(p.estado, 'estado_prenda', 'estado') : (estados[0] || 'Por encargar');
    return { id: 'L' + pad_(n++, 3), pedido: pid, prenda: nombre, talla: texto_(p.talla), estado: estado,
      fecha_entrega: norm_(estado) === 'entregada' ? fecha : '', nota: texto_(p.nota),
      actualizado_por: ses.nombre, actualizado_en: new Date() };
  });
  const ped = { id: pid, fecha: fecha, estudiante_id: q.estudiante_id, estudiante: q.estudiante, persona: q.persona,
    valor_acordado: valor, nota: texto_(d.nota) };
  insertar_(H.PEDIDOS, [auditar_(ped, ses)]);
  insertar_(H.PRENDAS, lineas);
  let pago = null;
  if (d.pago && d.pago.valor) {
    const metodo = enLista_(d.pago.metodo, 'metodo_pago', 'método de pago');
    pago = { id: siguienteId_(H.PAGOS, 'id', 'P', 4), fecha: fecha, estudiante_id: q.estudiante_id, estudiante: q.estudiante,
      persona: q.persona, concepto: concepto_('Uniforme').nombre, valor: monto_(d.pago.valor), metodo: metodo,
      recibido_en: cuentaActiva_(d.pago.recibido_en, 'recibido en'), pedido_uniforme: pid, nota: texto_(d.pago.nota) };
    insertar_(H.PAGOS, [auditar_(pago, ses)]);
  }
  bitacora_(ses, 'crearPedido', H.PEDIDOS, pid, { pedido: ped, prendas: lineas.length, pago: pago && pago.id });
  return { id: pid, prendas: lineas.map(l => l.id), pago: pago && pago.id };
}

function actualizarPrenda_(d, ses) {
  const t = tabla_(H.PRENDAS);
  const l = t.filas.find(f => f.id === d.id);
  if (!l) throw err_('No encontré la prenda ' + d.id);
  const ped = tabla_(H.PEDIDOS).filas.find(f => f.id === l.pedido);
  if (ped && !esValido_(ped)) throw err_('El pedido ' + l.pedido + ' está anulado.');
  const cambios = {};
  if (d.estado !== undefined) cambios.estado = enLista_(d.estado, 'estado_prenda', 'estado');
  if (d.talla !== undefined) cambios.talla = texto_(d.talla);
  if (d.nota !== undefined) cambios.nota = texto_(d.nota);
  if (d.fecha_entrega) cambios.fecha_entrega = fecha_(d.fecha_entrega);
  else if (cambios.estado && norm_(cambios.estado) === 'entregada' && !l.fecha_entrega) cambios.fecha_entrega = fecha_();
  if (!Object.keys(cambios).length) throw err_('No hay cambios para guardar.');
  cambios.actualizado_por = ses.nombre;
  cambios.actualizado_en = new Date();
  const antes = {};
  Object.keys(cambios).filter(k => k.indexOf('actualizado_') !== 0).forEach(k => antes[k] = l[k] instanceof Date ? ymd_(l[k]) : l[k]);
  actualizar_(t, l, cambios);
  bitacora_(ses, 'actualizarPrenda', H.PRENDAS, l.id, { pedido: l.pedido, antes: antes, despues: cambios });
  return { id: l.id };
}

function registrarPagoProfe_(d, ses) {
  const profe = indice_(activos_(H.PROFES))[d.profe_id];
  if (!profe) throw err_('Profe no encontrado o inactivo');
  const lineas = arreglo_(d.lineas, 'líneas de clases', 10);
  const metodo = enLista_(d.metodo, 'metodo_pago', 'método de pago');
  const desde = cuentaActiva_(d.pagado_desde, 'pagado desde');
  const periodo = requerido_(d.periodo, 'periodo');
  const fecha = fecha_(d.fecha);
  const pago = siguienteId_(H.PAGO_PROFES, 'pago', 'PP', 3);
  let n = numeroId_(siguienteId_(H.PAGO_PROFES, 'id', 'Q', 4));
  let total = 0;
  const filas = lineas.map(l => {
    const clases = entero_(l.clases, 'clases');
    const vc = monto_(l.valor_clase || profe.valor_clase);
    total += clases * vc;
    return auditar_({ id: 'Q' + pad_(n++, 4), pago: pago, fecha: fecha, profe_id: profe.id, profe: profe.nombre,
      periodo: periodo, clases: clases, valor_clase: vc, total: clases * vc, metodo: metodo, pagado_desde: desde,
      nota: texto_(d.nota) }, ses);
  });
  insertar_(H.PAGO_PROFES, filas);
  bitacora_(ses, 'registrarPagoProfe', H.PAGO_PROFES, pago, { profe: profe.nombre, periodo: periodo, total: total });
  return { pago: pago, total: total };
}

function registrarGasto_(d, ses) {
  const g = { id: siguienteId_(H.GASTOS, 'id', 'G', 4), fecha: fecha_(d.fecha),
    categoria: enLista_(d.categoria, 'categoria_gasto', 'categoría'), descripcion: requerido_(d.descripcion, 'descripción'),
    valor: monto_(d.valor), pagado_desde: cuentaActiva_(d.pagado_desde, 'pagado desde'), nota: texto_(d.nota) };
  insertar_(H.GASTOS, [auditar_(g, ses)]);
  bitacora_(ses, 'registrarGasto', H.GASTOS, g.id, g);
  return { id: g.id };
}

function registrarTraslado_(d, ses) {
  const todas = indicePorNombre_(tabla_(H.CUENTAS).filas);   // "de" puede ser una cuenta ya inactiva (p. ej. Cuenta Majo)
  const de = todas[norm_(d.de)];
  if (!de) throw err_('Cuenta de origen no encontrada');
  const a = cuentaActiva_(d.a, 'cuenta de destino');
  if (norm_(de.nombre) === norm_(a)) throw err_('El origen y el destino son la misma cuenta.');
  const t = { id: siguienteId_(H.TRASLADOS, 'id', 'X', 3), fecha: fecha_(d.fecha), de: de.nombre, a: a,
    valor: monto_(d.valor), nota: texto_(d.nota) };
  insertar_(H.TRASLADOS, [auditar_(t, ses)]);
  bitacora_(ses, 'registrarTraslado', H.TRASLADOS, t.id, t);
  return { id: t.id };
}

function agregarEstudiante_(d, ses) {
  const nombre = requerido_(d.nombre, 'nombre').replace(/\s+/g, ' ');
  const ya = tabla_(H.ESTUDIANTES).filas.find(f => norm_(f.nombre) === norm_(nombre));
  if (ya) throw err_('Ya existe: ' + ya.nombre + ' (' + ya.id + ')' + (esSi_(ya.activo) ? '' : ', marcado como inactivo'), 'duplicado');
  const e = { id: siguienteId_(H.ESTUDIANTES, 'id', 'E', 3), nombre: nombre, plan: texto_(d.plan), activo: 'Sí',
    nota: 'Agregado por ' + ses.nombre + ' el ' + ymd_(new Date()) };
  insertar_(H.ESTUDIANTES, [e]);
  bitacora_(ses, 'agregarEstudiante', H.ESTUDIANTES, e.id, e);
  return { id: e.id, nombre: e.nombre };
}

function anular_(d, ses) {
  const hoja = String(d.hoja || '');
  if (!(hoja in ANULABLES)) throw err_('En esa hoja no se puede anular: ' + hoja);
  const motivo = requerido_(d.motivo, 'motivo');
  if (motivo.length < 5) throw err_('Escribe un motivo un poco más claro.');
  const t = tabla_(hoja);
  const grupo = ANULABLES[hoja];
  const filas = t.filas.filter(f => f.id === d.id || (grupo && f[grupo] === d.id));
  if (!filas.length) throw err_('No encontré el registro ' + d.id);
  if (!filas.some(esValido_)) throw err_('Ese registro ya estaba anulado.');
  const ahora = new Date();
  filas.filter(esValido_).forEach(f => actualizar_(t, f, { estado: 'anulado', motivo_anulacion: motivo, anulado_por: ses.nombre, anulado_en: ahora }));
  const avisos = [];
  if (hoja === H.PEDIDOS) {
    const pagosVivos = tabla_(H.PAGOS).filas.filter(p => p.pedido_uniforme === d.id && esValido_(p));
    if (pagosVivos.length) avisos.push('Este pedido tiene ' + pagosVivos.length + ' pago(s) válidos (' + pagosVivos.map(p => p.id).join(', ') + '). Si hay que devolver la plata, anula también esos pagos.');
  }
  bitacora_(ses, 'anular', hoja, d.id, { motivo: motivo, lineas: filas.length });
  return { id: d.id, lineas: filas.length, avisos: avisos };
}

// ===================================================================== consultas y reportes

function registros_(d) {
  const hoja = String(d.hoja || '');
  const permitidas = Object.keys(ANULABLES).concat([H.PRENDAS, H.ESTUDIANTES, H.BITACORA]);
  if (permitidas.indexOf(hoja) < 0) throw err_('Hoja no disponible: ' + hoja);
  const desde = d.desde ? ymd_(fecha_(d.desde)) : '';
  const hasta = d.hasta ? ymd_(fecha_(d.hasta)) : '';
  const campoFecha = hoja === H.BITACORA ? 'fecha_hora' : 'fecha';
  let filas = tabla_(hoja).filas;
  if (desde || hasta) filas = filas.filter(f => { const x = f[campoFecha] ? ymd_(f[campoFecha]) : ''; return (!desde || x >= desde) && (!hasta || x <= hasta); });
  if (d.estudiante_id) filas = filas.filter(f => f.estudiante_id === d.estudiante_id);
  if (d.buscar) { const b = norm_(d.buscar); filas = filas.filter(f => norm_(Object.keys(f).map(k => f[k]).join(' ')).indexOf(b) >= 0); }
  const limite = Math.min(Number(d.limite) || 100, 1000);
  return { total: filas.length, filas: filas.slice(-limite).reverse().map(limpio_) };
}

function resumenDia_(d) {
  const dia = ymd_(fecha_(d.fecha));
  const delDia = f => esValido_(f) && f.fecha && ymd_(f.fecha) === dia;
  const pagos = tabla_(H.PAGOS).filas.filter(delDia);
  const ventas = tabla_(H.VENTAS).filas.filter(delDia);
  const gastos = tabla_(H.GASTOS).filas.filter(delDia);
  const profes = tabla_(H.PAGO_PROFES).filas.filter(delDia);
  const tras = tabla_(H.TRASLADOS).filas.filter(delDia);
  const vendido = ventas.filter(v => esVentaCobrada_(v));
  const caja = sum_(pagos.filter(p => p.recibido_en === 'Caja'), 'valor') + sum_(vendido.filter(v => v.recibido_en === 'Caja'), 'total')
    + sum_(tras.filter(t => t.a === 'Caja'), 'valor') - sum_(tras.filter(t => t.de === 'Caja'), 'valor')
    - sum_(gastos.filter(g => g.pagado_desde === 'Caja'), 'valor') - sum_(profes.filter(p => p.pagado_desde === 'Caja'), 'total');
  return {
    fecha: dia,
    pagos: { total: sum_(pagos, 'valor'), cantidad: pagos.length, por_concepto: agrupar_(pagos, 'concepto', 'valor'),
      por_cuenta: agrupar_(pagos, 'recibido_en', 'valor'), por_metodo: agrupar_(pagos, 'metodo', 'valor') },
    tienda: { vendido: sum_(vendido, 'total'), ventas: contarGrupos_(ventas, 'venta'), por_metodo: agrupar_(ventas, 'metodo', 'total'),
      productos: agrupar_(ventas, 'producto', 'cantidad') },
    gastos: { total: sum_(gastos, 'valor'), por_cuenta: agrupar_(gastos, 'pagado_desde', 'valor') },
    pago_profes: { total: sum_(profes, 'total'), por_profe: agrupar_(profes, 'profe', 'total') },
    traslados: tras.map(limpio_),
    efectivo_neto_caja: caja,
  };
}

function reporteTienda_(d) {
  const rango = rango_(d);
  const todas = tabla_(H.VENTAS).filas.filter(esValido_);
  const ventas = todas.filter(v => enRango_(v.fecha, rango));
  const dias = {};
  ventas.forEach(v => {
    const k = ymd_(v.fecha);
    const x = dias[k] || (dias[k] = { fecha: k, vendido: 0, efectivo: 0, transferencia: 0, fiado: 0, consumo_interno: 0, ventas: {} });
    const m = norm_(v.metodo).replace(' ', '_');
    if (m in x) x[m] += num_(v.total);
    if (esVentaCobrada_(v)) x.vendido += num_(v.total);
    x.ventas[v.venta] = true;
  });
  const porDia = Object.keys(dias).sort().reverse().map(k => { const x = dias[k]; x.ventas = Object.keys(x.ventas).length; return x; });
  const productos = {};
  ventas.filter(v => norm_(v.metodo) !== 'consumo interno').forEach(v => {
    const p = productos[v.producto] || (productos[v.producto] = { producto: v.producto, cantidad: 0, total: 0 });
    p.cantidad += num_(v.cantidad); p.total += num_(v.total);
  });
  const consumo = agrupar_(ventas.filter(v => norm_(v.metodo) === 'consumo interno'), 'persona', 'total');
  return {
    desde: rango.desde, hasta: rango.hasta, por_dia: porDia,
    productos: Object.keys(productos).map(k => productos[k]).sort((a, b) => b.cantidad - a.cantidad),
    consumo_interno: consumo,
    cuentas_tienda: cuentasTienda_(todas),
  };
}

// Fiado menos pagos de "Cuenta tienda". Positivo = debe; negativo = tiene saldo a favor.
function cuentasTienda_(ventasValidas) {
  const c = {};
  const llave = f => f.estudiante_id || ('p:' + norm_(f.persona));
  const nombre = f => f.estudiante || f.persona;
  ventasValidas.filter(v => norm_(v.metodo) === 'fiado').forEach(v => {
    const k = llave(v); const x = c[k] || (c[k] = { quien: nombre(v), estudiante_id: v.estudiante_id || '', fiado: 0, pagado: 0 });
    x.fiado += num_(v.total);
  });
  tabla_(H.PAGOS).filas.filter(p => esValido_(p) && norm_(p.concepto) === 'cuenta tienda').forEach(p => {
    const k = llave(p); const x = c[k] || (c[k] = { quien: nombre(p), estudiante_id: p.estudiante_id || '', fiado: 0, pagado: 0 });
    x.pagado += num_(p.valor);
  });
  return Object.keys(c).map(k => { const x = c[k]; x.saldo = x.fiado - x.pagado; return x; })
    .filter(x => x.saldo !== 0).sort((a, b) => b.saldo - a.saldo);
}

function reporteSaldos_(d) {
  const concepto = concepto_(d.concepto || 'Vestuario clausura');
  const pagos = tabla_(H.PAGOS).filas.filter(esValido_);
  if (norm_(concepto.nombre) === 'uniforme') {
    const prendas = tabla_(H.PRENDAS).filas;
    const filas = tabla_(H.PEDIDOS).filas.filter(esValido_).map(p => {
      const pagado = sum_(pagos.filter(x => x.pedido_uniforme === p.id), 'valor');
      const pend = prendas.filter(l => l.pedido === p.id && norm_(l.estado) !== 'entregada');
      return { pedido: p.id, fecha: p.fecha ? ymd_(p.fecha) : '', quien: p.estudiante || p.persona, estudiante_id: p.estudiante_id || '',
        valor: num_(p.valor_acordado), pagado: pagado, saldo: num_(p.valor_acordado) - pagado,
        prendas_pendientes: pend.map(l => l.prenda + (l.talla ? ' ' + l.talla : '') + ' (' + l.estado + ')') };
    }).filter(x => x.saldo !== 0 || x.prendas_pendientes.length);
    return resumenSaldos_(concepto.nombre, filas);
  }
  const porEst = {};
  tabla_(H.CARGOS).filas.filter(c => esValido_(c) && norm_(c.concepto) === norm_(concepto.nombre)).forEach(c => {
    porEst[c.estudiante_id] = { estudiante_id: c.estudiante_id, quien: c.estudiante, cantidad: num_(c.cantidad), valor: num_(c.valor_total), pagado: 0, cargo: c.id };
  });
  pagos.filter(p => norm_(p.concepto) === norm_(concepto.nombre)).forEach(p => {
    const k = p.estudiante_id || ('p:' + norm_(p.persona));
    const x = porEst[k] || (porEst[k] = { estudiante_id: p.estudiante_id || '', quien: p.estudiante || p.persona, cantidad: 0, valor: 0, pagado: 0, cargo: '', sin_cargo: true });
    x.pagado += num_(p.valor);
  });
  const filas = Object.keys(porEst).map(k => { const x = porEst[k]; x.saldo = x.valor - x.pagado; return x; });
  return resumenSaldos_(concepto.nombre, filas);
}

function resumenSaldos_(concepto, filas) {
  const estado = x => x.saldo > 0 ? 'debe' : (x.saldo < 0 ? 'a favor' : 'al día');
  filas.forEach(x => x.estado = estado(x));
  filas.sort((a, b) => b.saldo - a.saldo || String(a.quien).localeCompare(String(b.quien), 'es'));
  return {
    concepto: concepto,
    por_cobrar: filas.filter(x => x.saldo > 0).reduce((s, x) => s + x.saldo, 0),
    a_favor: filas.filter(x => x.saldo < 0).reduce((s, x) => s - x.saldo, 0),
    deben: filas.filter(x => x.saldo > 0).length,
    filas: filas,
  };
}

function reporteEntregas_() {
  const pedidos = indice_(tabla_(H.PEDIDOS).filas.filter(esValido_));
  const filas = tabla_(H.PRENDAS).filas.filter(l => pedidos[l.pedido] && norm_(l.estado) !== 'entregada').map(l => {
    const p = pedidos[l.pedido];
    return { id: l.id, pedido: l.pedido, fecha_pedido: p.fecha ? ymd_(p.fecha) : '', quien: p.estudiante || p.persona,
      prenda: l.prenda, talla: l.talla, estado: l.estado, nota: l.nota };
  });
  return { total: filas.length, por_estado: contar_(filas, 'estado'), filas: filas };
}

// Movimientos por cuenta. El saldo histórico solo tiene sentido desde que todo se registra aquí.
function reporteCuentas_(d) {
  const rango = rango_(d);
  const mov = movimientos_();
  const cuentas = {};
  mov.forEach(m => {
    const c = cuentas[m.cuenta] || (cuentas[m.cuenta] = { cuenta: m.cuenta, saldo_total: 0, entradas: 0, salidas: 0 });
    c.saldo_total += m.valor;
    if (enRango_(m.fecha, rango)) { if (m.valor > 0) c.entradas += m.valor; else c.salidas -= m.valor; }
  });
  return { desde: rango.desde, hasta: rango.hasta, cuentas: Object.keys(cuentas).map(k => cuentas[k]),
    movimientos: mov.filter(m => enRango_(m.fecha, rango)).map(m => Object.assign({}, m, { fecha: ymd_(m.fecha) })).reverse().slice(0, 500) };
}

function movimientos_() {
  const m = [];
  tabla_(H.PAGOS).filas.filter(esValido_).forEach(p => m.push({ fecha: p.fecha, cuenta: p.recibido_en, valor: num_(p.valor), tipo: 'Pago', detalle: p.concepto + ' – ' + (p.estudiante || p.persona), id: p.id }));
  tabla_(H.VENTAS).filas.filter(v => esValido_(v) && esVentaCobrada_(v) && v.recibido_en).forEach(v => m.push({ fecha: v.fecha, cuenta: v.recibido_en, valor: num_(v.total), tipo: 'Tienda', detalle: v.producto, id: v.id }));
  tabla_(H.GASTOS).filas.filter(esValido_).forEach(g => m.push({ fecha: g.fecha, cuenta: g.pagado_desde, valor: -num_(g.valor), tipo: 'Gasto', detalle: g.descripcion, id: g.id }));
  tabla_(H.PAGO_PROFES).filas.filter(esValido_).forEach(p => m.push({ fecha: p.fecha, cuenta: p.pagado_desde, valor: -num_(p.total), tipo: 'Pago profe', detalle: p.profe + ' – ' + p.periodo, id: p.id }));
  tabla_(H.TRASLADOS).filas.filter(esValido_).forEach(t => {
    m.push({ fecha: t.fecha, cuenta: t.de, valor: -num_(t.valor), tipo: 'Traslado', detalle: 'A ' + t.a, id: t.id });
    m.push({ fecha: t.fecha, cuenta: t.a, valor: num_(t.valor), tipo: 'Traslado', detalle: 'De ' + t.de, id: t.id });
  });
  return m.filter(x => x.cuenta).sort((a, b) => ymd_(a.fecha) < ymd_(b.fecha) ? -1 : 1);
}

function reporteProfes_(d) {
  const rango = rango_(d);
  const filas = tabla_(H.PAGO_PROFES).filas.filter(p => esValido_(p) && enRango_(p.fecha, rango));
  const por = {};
  filas.forEach(p => {
    const x = por[p.profe] || (por[p.profe] = { profe: p.profe, clases: 0, total: 0, pagos: {} });
    x.clases += num_(p.clases); x.total += num_(p.total); x.pagos[p.pago] = true;
  });
  return { desde: rango.desde, hasta: rango.hasta, total: sum_(filas, 'total'),
    por_profe: Object.keys(por).map(k => { const x = por[k]; x.pagos = Object.keys(x.pagos).length; return x; }),
    filas: filas.map(limpio_).reverse() };
}

function fichaEstudiante_(d) {
  const e = tabla_(H.ESTUDIANTES).filas.find(f => f.id === d.estudiante_id);
  if (!e) throw err_('Estudiante no encontrado');
  const pagos = tabla_(H.PAGOS).filas.filter(p => p.estudiante_id === e.id);
  const validos = pagos.filter(esValido_);
  const cargos = tabla_(H.CARGOS).filas.filter(c => c.estudiante_id === e.id && esValido_(c)).map(c => {
    const pagado = sum_(validos.filter(p => norm_(p.concepto) === norm_(c.concepto)), 'valor');
    return { id: c.id, concepto: c.concepto, cantidad: num_(c.cantidad), valor: num_(c.valor_total), pagado: pagado, saldo: num_(c.valor_total) - pagado };
  });
  const prendas = tabla_(H.PRENDAS).filas;
  const pedidos = tabla_(H.PEDIDOS).filas.filter(p => p.estudiante_id === e.id && esValido_(p)).map(p => {
    const pagado = sum_(validos.filter(x => x.pedido_uniforme === p.id), 'valor');
    return { id: p.id, fecha: p.fecha ? ymd_(p.fecha) : '', valor: num_(p.valor_acordado), pagado: pagado, saldo: num_(p.valor_acordado) - pagado,
      prendas: prendas.filter(l => l.pedido === p.id).map(limpio_) };
  });
  const tienda = cuentasTienda_(tabla_(H.VENTAS).filas.filter(esValido_)).find(x => x.estudiante_id === e.id) || null;
  return { estudiante: limpio_(e), cargos: cargos, pedidos: pedidos, tienda: tienda, pagos: pagos.map(limpio_).reverse() };
}

// ===================================================================== validaciones

function quien_(d, soloEstudiante) {
  if (d.estudiante_id) {
    const e = tabla_(H.ESTUDIANTES).filas.find(f => f.id === d.estudiante_id);
    if (!e) throw err_('Estudiante no encontrado: ' + d.estudiante_id);
    return { estudiante_id: e.id, estudiante: e.nombre, persona: '' };
  }
  if (soloEstudiante) throw err_('Escoge el estudiante.');
  const persona = texto_(d.persona);
  if (!persona) throw err_('Escoge un estudiante o escribe el nombre de la persona.');
  return { estudiante_id: '', estudiante: '', persona: persona };
}

function concepto_(nombre) {
  const c = activos_(H.CONCEPTOS).find(f => norm_(f.nombre) === norm_(nombre));
  if (!c) throw err_('Concepto no encontrado o inactivo: ' + nombre);
  return { nombre: c.nombre, valor_base: num_(c.valor_base) };
}

function cuentaActiva_(nombre, campo) {
  const c = activos_(H.CUENTAS).find(f => norm_(f.nombre) === norm_(nombre));
  if (!c) throw err_('Escoge una cuenta válida en "' + campo + '".');
  return c.nombre;
}

function enLista_(valor, lista, campo) {
  const opciones = listas_()[lista] || [];
  const v = opciones.find(o => norm_(o) === norm_(valor));
  if (v === undefined) throw err_('Valor no válido en ' + campo + ': ' + (valor || '(vacío)'));
  return v;
}

function nombresPiezas_() {
  const out = {};
  activos_(H.CAT_PRENDAS).forEach(f => String(f.incluye || f.nombre).split(',').forEach(s => { s = s.trim(); if (s) out[norm_(s)] = s; }));
  return out;
}

function buscarValido_(hoja, id, campo) {
  const f = tabla_(hoja).filas.find(x => x.id === id);
  if (!f) throw err_('Escoge el ' + campo + '.');
  if (!esValido_(f)) throw err_('Ese ' + campo + ' está anulado.');
  return f;
}

function monto_(v, permiteCero) {
  const n = typeof v === 'number' ? v : Number(String(v === undefined ? '' : v).replace(/[$.\s]/g, '').replace(',', '.'));
  if (!isFinite(n) || n < 0 || (!permiteCero && n === 0)) throw err_('Valor no válido: ' + v);
  return Math.round(n);
}

function entero_(v, campo) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw err_('La ' + campo + ' debe ser un número entero mayor que cero.');
  return n;
}

function requerido_(v, campo) {
  const t = texto_(v);
  if (!t) throw err_('Falta: ' + campo);
  return t;
}

function arreglo_(v, campo, max) {
  if (!Array.isArray(v) || !v.length) throw err_('Agrega al menos un elemento en ' + campo + '.');
  if (v.length > max) throw err_('Demasiados elementos en ' + campo + '.');
  return v;
}

// Texto limpio. Evita que algo escrito se interprete como fórmula en la hoja.
function texto_(v) {
  let t = String(v === undefined || v === null ? '' : v).trim().slice(0, 500);
  if (/^[=+\-@]/.test(t)) t = "'" + t;
  return t;
}

// 'YYYY-MM-DD' → fecha al mediodía en Bogotá. Sin valor → hoy.
function fecha_(v) {
  if (v instanceof Date) return v;
  if (!v) { const h = ymd_(new Date()).split('-'); return new Date(Number(h[0]), Number(h[1]) - 1, Number(h[2]), 12); }
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw err_('Fecha no válida: ' + v);
  const f = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  if (ymd_(f) !== String(v)) throw err_('Fecha no válida: ' + v);
  return f;
}

// ===================================================================== hoja de cálculo

let LIBRO_ = null;
function libro_() {
  if (!LIBRO_) LIBRO_ = SpreadsheetApp.getActive() || SpreadsheetApp.openById(HOJA_ID);
  return LIBRO_;
}

function hoja_(nombre) {
  const sh = libro_().getSheetByName(nombre);
  if (!sh) throw err_('No existe la pestaña "' + nombre + '" en la hoja.');
  return sh;
}

function tabla_(nombre) {
  const sh = hoja_(nombre);
  const values = sh.getDataRange().getValues();
  const headers = (values[0] || []).map(h => String(h).trim());
  const filas = [];
  for (let i = 1; i < values.length; i++) {
    const r = values[i];
    if (r.every(v => v === '' || v === null)) continue;
    const o = { _fila: i + 1 };
    headers.forEach((h, j) => { if (h) o[h] = r[j]; });
    filas.push(o);
  }
  return { sh: sh, headers: headers, filas: filas };
}

function insertar_(nombre, objs) {
  if (!objs.length) return;
  const sh = hoja_(nombre);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const faltan = Object.keys(objs[0]).filter(k => headers.indexOf(k) < 0);
  if (faltan.length) throw err_('A la pestaña "' + nombre + '" le faltan columnas: ' + faltan.join(', ') + '. Ejecuta "Configurar" desde el menú Vox.');
  const rows = objs.map(o => headers.map(h => o[h] === undefined || o[h] === null ? '' : o[h]));
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
}

function actualizar_(t, fila, cambios) {
  Object.keys(cambios).forEach(k => {
    const j = t.headers.indexOf(k);
    if (j < 0) throw err_('A la pestaña "' + t.sh.getName() + '" le falta la columna ' + k + '. Ejecuta "Configurar" desde el menú Vox.');
    t.sh.getRange(fila._fila, j + 1).setValue(cambios[k]);
    fila[k] = cambios[k];
  });
}

function siguienteId_(nombre, campo, prefijo, ancho) {
  const t = tabla_(nombre);
  const re = new RegExp('^' + prefijo + '(\\d+)$');
  let max = 0;
  t.filas.forEach(f => { const m = String(f[campo] || '').match(re); if (m) max = Math.max(max, Number(m[1])); });
  return prefijo + pad_(max + 1, ancho);
}

function auditar_(o, ses) {
  o.registrado_por = ses.nombre;
  o.registrado_en = new Date();
  o.estado = 'válido';
  o.motivo_anulacion = '';
  return o;
}

function bitacora_(ses, accion, hoja, id, detalle) {
  const sh = libro_().getSheetByName(H.BITACORA);
  if (!sh) return;
  let txt = JSON.stringify(detalle, (k, v) => (k === '_fila' ? undefined : v));
  if (txt.length > 2000) txt = txt.slice(0, 2000) + '…';
  sh.appendRow([new Date(), ses.nombre, accion, hoja, id, txt]);
}

// ===================================================================== utilidades

function err_(mensaje, codigo) { const e = new Error(mensaje); e.publico = true; e.codigo = codigo || ''; return e; }
function norm_(s) { return String(s === undefined || s === null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function esSi_(v) { return ['si', 'sí', 'true', '1', 'x'].indexOf(norm_(v)) >= 0 || v === true; }
function esValido_(f) { return norm_(f.estado || 'valido') !== 'anulado'; }
function activos_(hoja) { return tabla_(hoja).filas.filter(f => f.id && norm_(f.activo) !== 'no'); }
function indice_(filas) { const o = {}; filas.forEach(f => o[f.id] = f); return o; }
function indicePorNombre_(filas) { const o = {}; filas.forEach(f => o[norm_(f.nombre)] = f); return o; }
function num_(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function sum_(filas, campo) { return filas.reduce((s, f) => s + num_(f[campo]), 0); }
function pad_(n, w) { return String(n).padStart(w, '0'); }
function numeroId_(id) { return Number(String(id).replace(/^\D+/, '')); }
function ymd_(d) { return d instanceof Date ? Utilities.formatDate(d, TZ, 'yyyy-MM-dd') : String(d || ''); }
function esVentaCobrada_(v) { const m = norm_(v.metodo); return m !== 'fiado' && m !== 'consumo interno'; }
function agrupar_(filas, campo, valor) { const o = {}; filas.forEach(f => { const k = f[campo] || '(sin dato)'; o[k] = (o[k] || 0) + num_(f[valor]); }); return o; }
function contar_(filas, campo) { const o = {}; filas.forEach(f => { const k = f[campo] || '(sin dato)'; o[k] = (o[k] || 0) + 1; }); return o; }
function contarGrupos_(filas, campo) { const o = {}; filas.forEach(f => o[f[campo]] = true); return Object.keys(o).length; }
function rango_(d) {
  const hasta = d.hasta ? ymd_(fecha_(d.hasta)) : ymd_(new Date());
  const desde = d.desde ? ymd_(fecha_(d.desde)) : hasta.slice(0, 8) + '01';
  return { desde: desde, hasta: hasta };
}
function enRango_(f, r) { if (!f) return false; const x = ymd_(f); return x >= r.desde && x <= r.hasta; }
function limpio_(f) {
  const o = {};
  Object.keys(f).forEach(k => { if (k !== '_fila') o[k] = f[k] instanceof Date ? (k.indexOf('_en') > 0 || k === 'fecha_hora' ? Utilities.formatDate(f[k], TZ, 'yyyy-MM-dd HH:mm') : ymd_(f[k])) : f[k]; });
  return o;
}

// ===================================================================== menú en la hoja (solo para ustedes)

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Vox')
    .addItem('Configurar (primera vez)', 'configurar')
    .addItem('Asignar o cambiar clave', 'asignarClave')
    .addItem('Cerrar todas las sesiones', 'cerrarSesiones')
    .addToUi();
}

/** Prepara la hoja: zona horaria, columnas que falten, Bitácora y la "sal" para cifrar claves. */
function configurar() {
  const ss = libro_();
  ss.setSpreadsheetTimeZone(TZ);
  Object.keys(COLUMNAS_EXTRA).forEach(nombre => {
    const sh = ss.getSheetByName(nombre);
    if (!sh) return;
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
    COLUMNAS_EXTRA[nombre].filter(c => headers.indexOf(c) < 0).forEach(c => {
      const col = sh.getLastColumn() + 1;
      sh.getRange(1, col).setValue(c).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F1229');
    });
  });
  let b = ss.getSheetByName(H.BITACORA);
  if (!b) {
    b = ss.insertSheet(H.BITACORA);
    b.getRange(1, 1, 1, BITACORA_COLS.length).setValues([BITACORA_COLS]).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F1229');
    b.setFrozenRows(1);
    b.getRange('A:A').setNumberFormat('dd/mm/yyyy hh:mm');
  }
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SAL')) props.setProperty('SAL', Utilities.getUuid() + Utilities.getUuid());
  try { SpreadsheetApp.getUi().alert('Listo. Ahora asigna las claves desde Vox → Asignar o cambiar clave.'); } catch (x) { /* sin interfaz */ }
}

function asignarClave() {
  const ui = SpreadsheetApp.getUi();
  const r1 = ui.prompt('Asignar clave', 'Usuario (como aparece en la pestaña Usuarios):', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  const r2 = ui.prompt('Asignar clave', 'Clave nueva (mínimo 6 caracteres):', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  ui.alert(fijarClave_(r1.getResponseText(), r2.getResponseText()));
}

function fijarClave_(usuario, clave) {
  clave = String(clave || '');
  if (clave.length < 6) return 'La clave debe tener mínimo 6 caracteres. No se guardó.';
  const t = tabla_(H.USUARIOS);
  const u = t.filas.find(f => norm_(f.usuario) === norm_(usuario));
  if (!u) return 'No existe el usuario "' + usuario + '" en la pestaña Usuarios.';
  actualizar_(t, u, { clave_hash: hash_(clave) });
  bitacora_({ nombre: 'Editor de la hoja' }, 'asignarClave', H.USUARIOS, u.usuario, {});
  return 'Clave guardada para ' + u.nombre + '.';
}

/**
 * Para poner o cambiar claves sin abrir menús:
 * 1. Escribe la clave en la columna "clave_nueva" de la pestaña Usuarios.
 * 2. Ejecuta esta función desde el editor de Apps Script.
 * La clave se cifra en "clave_hash" y la celda de "clave_nueva" queda vacía.
 */
function aplicarClavesNuevas() {
  const t = tabla_(H.USUARIOS);
  const res = [];
  t.filas.forEach(u => {
    const nueva = String(u.clave_nueva || '').trim();
    if (!nueva) return;
    if (nueva.length < 6) { res.push(u.usuario + ': la clave debe tener mínimo 6 caracteres, no se guardó'); return; }
    actualizar_(t, u, { clave_hash: hash_(nueva), clave_nueva: '' });
    bitacora_({ nombre: 'Editor del script' }, 'asignarClave', H.USUARIOS, u.usuario, {});
    res.push(u.usuario + ': clave guardada');
  });
  const msg = res.length ? res.join('\n') : 'No había claves nuevas en la columna clave_nueva.';
  console.log(msg);
  return msg;
}

function cerrarSesiones() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SESIONES_V', String(Number(props.getProperty('SESIONES_V') || '1') + 1));
  try { SpreadsheetApp.getUi().alert('Listo: todos tendrán que volver a entrar.'); } catch (x) { /* sin interfaz */ }
}
