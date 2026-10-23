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
const VERSION = '1.4.1';
const SESION_SEG = 6 * 60 * 60;          // máximo que permite CacheService
const INTENTOS_MAX = 5;                  // claves erradas antes de bloquear
const BLOQUEO_SEG = 15 * 60;

const H = {
  PAGOS: 'Pagos', CARGOS: 'Cargos', VENTAS: 'Ventas tienda', PEDIDOS: 'Pedidos uniforme',
  PRENDAS: 'Prendas del pedido', PAGO_PROFES: 'Pago profes', GASTOS: 'Gastos', TRASLADOS: 'Traslados',
  ESTUDIANTES: 'Estudiantes', PRODUCTOS: 'Productos', CAT_PRENDAS: 'Prendas uniforme', CONCEPTOS: 'Conceptos',
  PROFES: 'Profes', CUENTAS: 'Cuentas', LISTAS: 'Listas', USUARIOS: 'Usuarios', BITACORA: 'Bitácora',
  INVENTARIO: 'Inventario', PLANES: 'Planes', DESCUENTOS: 'Descuentos',
};
const SALDO_FAVOR = 'Saldo a favor';
const CAMBIO_NO_DEVUELTO = 'Cambio no devuelto';

// Pestañas que configurar() crea si no existen.
const HOJAS_NUEVAS = {
  'Inventario': ['id', 'fecha', 'producto_id', 'producto', 'tipo', 'cantidad', 'costo_unitario', 'nota',
    'registrado_por', 'registrado_en', 'estado', 'motivo_anulacion', 'anulado_por', 'anulado_en'],
  'Planes': ['id', 'nombre', 'valor_mensual', 'activo', 'nota'],
  'Descuentos': ['id', 'nombre', 'tipo', 'valor', 'aplica_a', 'activo', 'nota'],
};
// Filas con que nace una pestaña nueva.
const SEMILLAS = {
  'Descuentos': [['DS01', 'Uniforme el día de la matrícula', '%', 5, 'Uniforme', 'Sí', '5% si compra el uniforme el mismo día que se matricula']],
};
const TIPOS_INVENTARIO = ['Entrada', 'Conteo', 'Salida'];

// Hojas de registros que se pueden anular. "grupo" = columna que junta varias líneas de un mismo registro.
const ANULABLES = {
  'Pagos': null, 'Cargos': null, 'Ventas tienda': 'venta', 'Pedidos uniforme': null,
  'Pago profes': 'pago', 'Gastos': null, 'Traslados': null, 'Inventario': null,
};

// Columnas que configurar() agrega si la hoja no las tiene.
const COLUMNAS_EXTRA = {
  'Pagos': ['anulado_por', 'anulado_en', 'tipo', 'descuento', 'motivo_descuento', 'relacionado'],
  'Cargos': ['anulado_por', 'anulado_en', 'actualizado_por', 'actualizado_en', 'descuento', 'motivo_descuento'],
  'Ventas tienda': ['recibido_en', 'anulado_por', 'anulado_en'],
  'Pedidos uniforme': ['anulado_por', 'anulado_en', 'valor_lista', 'descuento', 'motivo_descuento'],
  'Pago profes': ['anulado_por', 'anulado_en'],
  'Gastos': ['anulado_por', 'anulado_en'],
  'Traslados': ['anulado_por', 'anulado_en'],
  'Usuarios': ['clave_nueva', 'sesion_v'],
  'Estudiantes': ['actualizado_por', 'actualizado_en', 'supabase_id', 'estado_admin', 'valor_mensual', 'sincronizado_en'],
  'Profes': ['nota', 'actualizado_por', 'actualizado_en'],
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
  listarEstudiantes:   [listarEstudiantes_, false],
  editarEstudiante:    [editarEstudiante_, true],
  guardarPlan:         [guardarPlan_, true],
  reporteInventario:   [reporteInventario_, false],
  registrarProducto:   [registrarProducto_, true],
  editarProducto:      [editarProducto_, true],
  movimientoInventario:[movimientoInventario_, true],
  cambiarClave:        [cambiarClave_, true],
  restablecerClave:    [restablecerClave_, true],
  listarUsuarios:      [listarUsuarios_, false],
  listarProfes:        [listarProfes_, false],
  saldosFavor:         [saldosFavor_, false],
  registrarDevolucion: [registrarDevolucion_, true],
  listarDescuentos:    [listarDescuentos_, false],
  guardarDescuento:    [guardarDescuento_, true],
  guardarProfe:        [guardarProfe_, true],
  traerDelAdmin:       [traerDelAdmin_, true],
  estadoAdmin:         [estadoAdmin_, false],
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
  const ses = { usuario: usuario, nombre: String(u.nombre), rol: String(u.rol), v: versionSesiones_(), uv: String(u.sesion_v || '0') };
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
  if ((ses.uv || '0') !== String(u.sesion_v || '0')) throw err_('Tu clave cambió. Vuelve a entrar.', 'sesion');
  cache.put('s:' + token, raw, SESION_SEG); // se renueva con cada uso
  ses.token = token;
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
    estudiantes: activos_(H.ESTUDIANTES).map(f => Object.assign({ id: f.id, nombre: f.nombre, plan: f.plan || '' },
      num_(f.valor_mensual) ? { valor_mensual: num_(f.valor_mensual) } : {}, f.estado_admin ? { estado_admin: String(f.estado_admin) } : {}))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
    productos: (() => { const st = stocks_(); return activos_(H.PRODUCTOS).map(f => ({ id: f.id, nombre: f.nombre, precio: num_(f.precio),
      stock: st[f.id] ? st[f.id].stock : null })); })(),
    planes: hojaExiste_(H.PLANES) ? activos_(H.PLANES).map(f => ({ id: f.id, nombre: f.nombre, valor_mensual: num_(f.valor_mensual) })) : [],
    descuentos: hojaExiste_(H.DESCUENTOS) ? activos_(H.DESCUENTOS).map(f => ({ id: f.id, nombre: f.nombre, tipo: String(f.tipo), valor: num_(f.valor), aplica_a: String(f.aplica_a || 'Todos') })) : [],
    prendas: activos_(H.CAT_PRENDAS).map(f => ({ id: f.id, nombre: f.nombre, precio: num_(f.precio),
      incluye: String(f.incluye || f.nombre).split(',').map(s => s.trim()).filter(Boolean) })),
    conceptos: activos_(H.CONCEPTOS).map(f => ({ id: f.id, nombre: f.nombre, valor_base: num_(f.valor_base), usa_cargos: String(f.usa_cargos || '') })),
    profes: activos_(H.PROFES).map(f => ({ id: f.id, nombre: f.nombre, valor_clase: num_(f.valor_clase) })),
    cuentas: activos_(H.CUENTAS).map(f => ({ id: f.id, nombre: f.nombre, tipo: f.tipo, sugerida_dias: String(f.sugerida_dias || '') })),
    cuentas_todas: tabla_(H.CUENTAS).filas.filter(f => f.id).map(f => String(f.nombre)),
    cuenta_sugerida: cuentaSugerida_(new Date()),
    admin_conectado: adminConectado_(),
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
  const conSaldo = esSaldo_(d.metodo);
  const metodo = conSaldo ? SALDO_FAVOR : enLista_(d.metodo, 'metodo_pago', 'método de pago');
  const p = Object.assign({
    fecha: fecha_(d.fecha), estudiante_id: q.estudiante_id, estudiante: q.estudiante, persona: q.persona,
    concepto: concepto.nombre, valor: monto_(d.valor), metodo: metodo,
    recibido_en: conSaldo ? '' : cuentaActiva_(d.recibido_en, 'recibido en'), pedido_uniforme: '', nota: texto_(d.nota),
    tipo: conSaldo ? 'Pago con saldo a favor' : '',
  }, descuento_(d, null));
  if (norm_(concepto.nombre) === 'uniforme') {
    const ped = buscarValido_(H.PEDIDOS, d.pedido_uniforme, 'pedido de uniforme');
    p.pedido_uniforme = ped.id;
  }
  p.id = siguienteId_(H.PAGOS, 'id', 'P', 4);
  let filas = [auditar_(p, ses)];
  if (conSaldo) filas = filas.concat(consumirSaldo_(q, p.valor, { concepto: p.concepto, pedido: p.pedido_uniforme }, p.fecha, ses,
    'Usado para pagar ' + p.concepto + (p.pedido_uniforme ? ' ' + p.pedido_uniforme : ''), numeroId_(p.id) + 1, p.id));
  insertar_(H.PAGOS, filas);
  bitacora_(ses, 'registrarPago', H.PAGOS, p.id, Object.assign({}, p, { saldo_usado_de: filas.slice(1).map(f => f.concepto + ' ' + f.valor) }));
  return { id: p.id, movimientos: filas.length };
}

function registrarCargo_(d, ses) {
  const q = quien_(d, true);
  const concepto = concepto_(d.concepto);
  const cantidad = entero_(d.cantidad === undefined ? 1 : d.cantidad, 'cantidad');
  const bruto = d.valor_total !== undefined && d.valor_total !== '' ? monto_(d.valor_total, true)
    : (concepto.valor_base ? cantidad * concepto.valor_base : null);
  if (bruto === null) throw err_('Este concepto no tiene valor base: escribe el valor total.');
  const desc = descuento_(d, bruto);
  const valor = bruto - num_(desc.descuento);
  const ya = tabla_(H.CARGOS).filas.find(f => f.estudiante_id === q.estudiante_id && norm_(f.concepto) === norm_(concepto.nombre) && esValido_(f));
  if (ya) throw err_(q.estudiante + ' ya tiene un cargo de ' + concepto.nombre + ' (' + ya.id + '). Edítalo en vez de crear otro.', 'duplicado');
  const c = { id: siguienteId_(H.CARGOS, 'id', 'C', 3), estudiante_id: q.estudiante_id, estudiante: q.estudiante,
    concepto: concepto.nombre, cantidad: cantidad, valor_total: valor, nota: texto_(d.nota),
    descuento: desc.descuento, motivo_descuento: desc.motivo_descuento };
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
  // El descuento se mantiene salvo que se envíe uno nuevo (0 lo quita).
  const desc = d.descuento !== undefined ? descuento_(d, null) : null;
  const descV = desc ? num_(desc.descuento) : num_(c.descuento);
  if (desc) { cambios.descuento = desc.descuento; cambios.motivo_descuento = desc.motivo_descuento; }
  if (d.cantidad !== undefined) cambios.cantidad = entero_(d.cantidad, 'cantidad');
  if (d.valor_total !== undefined) cambios.valor_total = monto_(d.valor_total, true);
  else if ((d.cantidad !== undefined || desc) && concepto.valor_base) cambios.valor_total = (cambios.cantidad || num_(c.cantidad) || 1) * concepto.valor_base - descV;
  else if (desc) cambios.valor_total = num_(c.valor_total) + num_(c.descuento) - descV;
  if (cambios.valor_total !== undefined && cambios.valor_total < 0) throw err_('El descuento no puede ser mayor que el valor.');
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
  const conSaldo = esSaldo_(d.metodo);
  const metodo = conSaldo ? SALDO_FAVOR : enLista_(d.metodo, 'metodo_tienda', 'método');
  const lineas = arreglo_(d.lineas, 'productos', 40);
  const prods = indice_(activos_(H.PRODUCTOS));
  let q = { estudiante_id: '', estudiante: '', persona: '' };
  if (norm_(metodo) === 'fiado' || conSaldo) q = quien_(d);
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
  // Con saldo a favor: primero se usa lo que tenga a favor en la tienda; lo que falte se pasa desde otros conceptos.
  let pagos = [];
  if (conSaldo) {
    const tienda = saldosDe_(q).items.find(i => i.origen === 'tienda');
    const enTienda = tienda && tienda.saldo < 0 ? -tienda.saldo : 0;
    const resto = total - Math.min(total, enTienda);
    if (resto > 0) {
      const pid = siguienteId_(H.PAGOS, 'id', 'P', 4);
      const p = auditar_({ id: pid, fecha: fecha, estudiante_id: q.estudiante_id, estudiante: q.estudiante, persona: q.persona,
        concepto: concepto_('Cuenta tienda').nombre, valor: resto, metodo: SALDO_FAVOR, recibido_en: '', pedido_uniforme: '',
        nota: 'Compra ' + venta + ' en la tienda', tipo: 'Pago con saldo a favor', relacionado: venta }, ses);
      pagos = [p].concat(consumirSaldo_(q, resto, { concepto: 'Cuenta tienda', pedido: '' }, fecha, ses, 'Usado en la tienda (' + venta + ')', numeroId_(pid) + 1, venta));
    }
  }
  // Efectivo: si no se devolvió el cambio, esa plata también entró a la caja y se registra.
  //  - destino "caja": queda como una línea "Cambio no devuelto" de la misma venta.
  //  - destino "favor": queda como saldo a favor en la tienda de esa persona (un abono a "Cuenta tienda" ligado a la venta).
  let cambio = null;
  if (d.cambio && num_(d.cambio.valor)) {
    if (norm_(metodo) !== 'efectivo') throw err_('El cambio solo aplica cuando pagan en efectivo.');
    const v = monto_(d.cambio.valor);
    if (v > 200000) throw err_('Ese cambio es muy alto. Revisa con cuánto pagó.');
    const destino = norm_(d.cambio.destino);
    if (destino === 'caja') {
      filas.push(auditar_({ id: 'V' + pad_(n++, 4), venta: venta, fecha: fecha, producto_id: '', producto: CAMBIO_NO_DEVUELTO,
        cantidad: 1, precio: v, total: v, metodo: metodo, recibido_en: recibido, estudiante_id: '', estudiante: '', persona: '',
        nota: 'No quiso el cambio' }, ses));
      cambio = { valor: v, destino: 'caja' };
    } else if (destino === 'favor') {
      const qc = quien_(d.cambio);
      const pid = siguienteId_(H.PAGOS, 'id', 'P', 4);
      pagos.push(auditar_({ id: pid, fecha: fecha, estudiante_id: qc.estudiante_id, estudiante: qc.estudiante, persona: qc.persona,
        concepto: concepto_('Cuenta tienda').nombre, valor: v, metodo: 'Efectivo', recibido_en: recibido, pedido_uniforme: '',
        nota: 'Cambio de la compra ' + venta + ' que quedó a favor', tipo: 'Cambio a favor', relacionado: venta }, ses));
      cambio = { valor: v, destino: 'favor', quien: qc.estudiante || qc.persona };
    } else throw err_('¿Qué se hizo con el cambio? Escoge "no quiso el cambio" o "dejar a favor".');
  }
  insertar_(H.VENTAS, filas);
  if (pagos.length) insertar_(H.PAGOS, pagos);
  bitacora_(ses, 'registrarVenta', H.VENTAS, venta, { metodo: metodo, total: total, lineas: filas.length, quien: q.estudiante || q.persona, pagos_saldo: pagos.map(p => p.id), cambio: cambio });
  return { venta: venta, total: total, lineas: filas.length, cambio: cambio };
}

function crearPedido_(d, ses) {
  const q = quien_(d);
  const lista = d.valor_lista !== undefined && d.valor_lista !== '' && d.valor_lista !== null ? monto_(d.valor_lista, true) : null;
  const desc = descuento_(d, lista);
  const valor = lista !== null ? lista - num_(desc.descuento) : monto_(d.valor_acordado, true) - num_(desc.descuento);
  if (valor < 0) throw err_('El descuento no puede ser mayor que el valor.');
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
    valor_acordado: valor, nota: texto_(d.nota), valor_lista: lista !== null ? lista : '', descuento: desc.descuento, motivo_descuento: desc.motivo_descuento };
  insertar_(H.PEDIDOS, [auditar_(ped, ses)]);
  insertar_(H.PRENDAS, lineas);
  let pago = null;
  if (d.pago && d.pago.valor) {
    const conSaldo = esSaldo_(d.pago.metodo);
    const metodo = conSaldo ? SALDO_FAVOR : enLista_(d.pago.metodo, 'metodo_pago', 'método de pago');
    if (monto_(d.pago.valor) > valor) throw err_('El abono es mayor que el valor del pedido.');
    pago = { id: siguienteId_(H.PAGOS, 'id', 'P', 4), fecha: fecha, estudiante_id: q.estudiante_id, estudiante: q.estudiante,
      persona: q.persona, concepto: concepto_('Uniforme').nombre, valor: monto_(d.pago.valor), metodo: metodo,
      recibido_en: conSaldo ? '' : cuentaActiva_(d.pago.recibido_en, 'recibido en'), pedido_uniforme: pid, nota: texto_(d.pago.nota),
      tipo: conSaldo ? 'Pago con saldo a favor' : '' };
    let filas = [auditar_(pago, ses)];
    if (conSaldo) filas = filas.concat(consumirSaldo_(q, pago.valor, { concepto: 'Uniforme', pedido: pid }, fecha, ses, 'Usado para el uniforme ' + pid, numeroId_(pago.id) + 1, pago.id));
    insertar_(H.PAGOS, filas);
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
  if (adminConectado_()) throw err_('Los estudiantes se crean en el admin. Después toca "Traer estudiantes del admin" y aparece aquí.');
  const nombre = requerido_(d.nombre, 'nombre').replace(/\s+/g, ' ');
  const ya = tabla_(H.ESTUDIANTES).filas.find(f => norm_(f.nombre) === norm_(nombre));
  if (ya) throw err_('Ya existe: ' + ya.nombre + ' (' + ya.id + ')' + (esSi_(ya.activo) ? '' : ', marcado como inactivo'), 'duplicado');
  const e = { id: siguienteId_(H.ESTUDIANTES, 'id', 'E', 3), nombre: nombre, plan: planValido_(d.plan), activo: 'Sí',
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
  if (hoja === H.PAGOS && filas.some(f => f.tipo === 'Saldo usado' && f.relacionado))
    throw err_('Este movimiento es parte de un pago con saldo a favor (' + filas[0].relacionado + '). Anula ese pago y se devuelve todo.');
  const ahora = new Date();
  filas.filter(esValido_).forEach(f => actualizar_(t, f, { estado: 'anulado', motivo_anulacion: motivo, anulado_por: ses.nombre, anulado_en: ahora }));
  const avisos = [];
  // Lo que se usó del saldo a favor para este pago o venta vuelve a quedar disponible.
  if (hoja === H.PAGOS || hoja === H.VENTAS) {
    const tp = tabla_(H.PAGOS);
    const ligados = tp.filas.filter(p => esValido_(p) && p.relacionado && p.relacionado === d.id);
    ligados.forEach(p => actualizar_(tp, p, { estado: 'anulado', motivo_anulacion: 'Se anuló ' + d.id + ': ' + motivo, anulado_por: ses.nombre, anulado_en: ahora }));
    if (ligados.some(p => p.tipo !== 'Cambio a favor')) avisos.push('El saldo a favor que se había usado vuelve a quedar disponible.');
    ligados.filter(p => p.tipo === 'Cambio a favor').forEach(p => {
      const q = { estudiante_id: p.estudiante_id, persona: p.persona };
      const t = saldosDe_(q).items.find(i => i.origen === 'tienda');
      avisos.push('Se quitó el cambio de ' + pesos_(p.valor) + ' que había quedado a favor de ' + (p.estudiante || p.persona) + '.' +
        (t && t.saldo > 0 ? ' Ya había usado parte: ahora debe ' + pesos_(t.saldo) + ' en la tienda.' : ''));
    });
  }
  if (hoja === H.PEDIDOS) {
    const pagosVivos = tabla_(H.PAGOS).filas.filter(p => p.pedido_uniforme === d.id && esValido_(p));
    if (pagosVivos.length) avisos.push('Este pedido tiene ' + pagosVivos.length + ' pago(s) válidos (' + pagosVivos.map(p => p.id).join(', ') + '). Si hay que devolver la plata, anula también esos pagos.');
  }
  bitacora_(ses, 'anular', hoja, d.id, { motivo: motivo, lineas: filas.length });
  return { id: d.id, lineas: filas.length, avisos: avisos };
}

// ===================================================================== administración

function soloDirector_(ses) {
  if (norm_(ses.rol) !== 'director') throw err_('Solo los directores pueden hacer esto.', 'permiso');
}

function hojaExiste_(nombre) { return !!libro_().getSheetByName(nombre); }
function tiempo_(v) { return v instanceof Date ? v.getTime() : (Date.parse(v) || 0); }

// ---------- estudiantes y planes

function planValido_(plan) {
  const p = texto_(plan);
  if (!p || !hojaExiste_(H.PLANES)) return p;
  const f = tabla_(H.PLANES).filas.find(x => norm_(x.nombre) === norm_(p));
  if (!f) throw err_('El plan "' + p + '" no existe. Créalo primero en Planes.');
  return f.nombre;
}

function listarEstudiantes_() {
  const planes = hojaExiste_(H.PLANES) ? tabla_(H.PLANES).filas.filter(f => f.id) : [];
  const usos = {};
  const est = tabla_(H.ESTUDIANTES).filas.filter(f => f.id).map(f => {
    const activo = norm_(f.activo) !== 'no';
    if (activo && f.plan) usos[norm_(f.plan)] = (usos[norm_(f.plan)] || 0) + 1;
    return { id: f.id, nombre: f.nombre, plan: f.plan || '', activo: activo, nota: f.nota || '', estado_admin: String(f.estado_admin || ''),
      del_admin: !!f.supabase_id, valor_mensual: num_(f.valor_mensual) };
  }).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
  return {
    admin: estadoAdmin_(),
    estudiantes: est,
    planes: planes.map(p => ({ id: p.id, nombre: p.nombre, valor_mensual: num_(p.valor_mensual), activo: norm_(p.activo) !== 'no',
      nota: p.nota || '', estudiantes: usos[norm_(p.nombre)] || 0 })),
  };
}

function editarEstudiante_(d, ses) {
  const t = tabla_(H.ESTUDIANTES);
  const e = t.filas.find(f => f.id === d.id);
  if (!e) throw err_('No encontré el estudiante ' + d.id);
  const cambios = {};
  if (adminConectado_() && e.supabase_id && (d.nombre !== undefined || d.plan !== undefined || d.activo !== undefined))
    throw err_('El nombre, el plan y el estado de este estudiante se cambian en el admin. Aquí solo se puede editar la nota.');
  if (d.nota !== undefined && texto_(d.nota) !== String(e.nota || '')) cambios.nota = texto_(d.nota);
  if (d.nombre !== undefined) {
    const nombre = requerido_(d.nombre, 'nombre').replace(/\s+/g, ' ');
    const ya = t.filas.find(f => f.id !== e.id && norm_(f.nombre) === norm_(nombre));
    if (ya) throw err_('Ya existe otro estudiante con ese nombre: ' + ya.nombre + ' (' + ya.id + ')', 'duplicado');
    if (nombre !== e.nombre) cambios.nombre = nombre;
  }
  if (d.plan !== undefined && texto_(d.plan) !== String(e.plan || '')) cambios.plan = planValido_(d.plan);
  if (d.activo !== undefined) { const a = d.activo ? 'Sí' : 'No'; if ((norm_(e.activo) !== 'no') !== !!d.activo) cambios.activo = a; }
  if (!Object.keys(cambios).length) throw err_('No hay cambios para guardar.');
  const antes = {};
  Object.keys(cambios).forEach(k => antes[k] = e[k]);
  cambios.actualizado_por = ses.nombre;
  cambios.actualizado_en = new Date();
  actualizar_(t, e, cambios);
  let renombrados = 0;
  if (cambios.nombre) [H.PAGOS, H.CARGOS, H.PEDIDOS, H.VENTAS].forEach(h => renombrados += renombrar_(h, e.id, cambios.nombre));
  bitacora_(ses, 'editarEstudiante', H.ESTUDIANTES, e.id, { antes: antes, despues: cambios, registros_renombrados: renombrados });
  return { id: e.id, renombrados: renombrados };
}

// Cambia el nombre guardado en los registros de un estudiante (una sola escritura por pestaña).
function renombrar_(hoja, estudianteId, nombre, colId, colNombre) {
  const sh = hoja_(hoja);
  const n = sh.getLastRow() - 1;
  if (n < 1) return 0;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const ci = headers.indexOf(colId || 'estudiante_id'), cn = headers.indexOf(colNombre || 'estudiante');
  if (ci < 0 || cn < 0) return 0;
  const ids = sh.getRange(2, ci + 1, n, 1).getValues();
  const col = sh.getRange(2, cn + 1, n, 1);
  const nombres = col.getValues();
  let c = 0;
  ids.forEach((r, i) => { if (r[0] === estudianteId && nombres[i][0] !== nombre) { nombres[i][0] = nombre; c++; } });
  if (c) col.setValues(nombres);
  return c;
}

function guardarPlan_(d, ses) {
  if (adminConectado_()) throw err_('Los planes y sus precios se manejan en el admin y llegan solos a esta planilla.');
  if (!hojaExiste_(H.PLANES)) throw err_('Falta la pestaña Planes: ejecuta "configurar" en Apps Script.');
  const t = tabla_(H.PLANES);
  const nombre = requerido_(d.nombre, 'nombre del plan').replace(/\s+/g, ' ');
  const valor = d.valor_mensual === undefined || d.valor_mensual === '' ? '' : monto_(d.valor_mensual, true);
  const otro = t.filas.find(f => f.id !== d.id && norm_(f.nombre) === norm_(nombre));
  if (otro) throw err_('Ya existe un plan con ese nombre.', 'duplicado');
  if (!d.id) {
    const p = { id: siguienteId_(H.PLANES, 'id', 'PL', 2), nombre: nombre, valor_mensual: valor, activo: 'Sí', nota: texto_(d.nota) };
    insertar_(H.PLANES, [p]);
    bitacora_(ses, 'crearPlan', H.PLANES, p.id, p);
    return { id: p.id };
  }
  const p = t.filas.find(f => f.id === d.id);
  if (!p) throw err_('No encontré el plan ' + d.id);
  const cambios = { nombre: nombre, valor_mensual: valor };
  if (d.activo !== undefined) cambios.activo = d.activo ? 'Sí' : 'No';
  if (d.nota !== undefined) cambios.nota = texto_(d.nota);
  const antes = { nombre: p.nombre, valor_mensual: p.valor_mensual, activo: p.activo };
  actualizar_(t, p, cambios);
  // Si cambió el nombre, se actualiza en los estudiantes que lo tenían.
  let movidos = 0;
  if (norm_(antes.nombre) !== norm_(nombre)) {
    const te = tabla_(H.ESTUDIANTES);
    te.filas.filter(e => norm_(e.plan) === norm_(antes.nombre)).forEach(e => { actualizar_(te, e, { plan: nombre }); movidos++; });
  }
  bitacora_(ses, 'editarPlan', H.PLANES, p.id, { antes: antes, despues: cambios, estudiantes_actualizados: movidos });
  return { id: p.id, estudiantes_actualizados: movidos };
}

// ---------- profes
// "Eliminar" un profe lo archiva: deja de salir para registrar pagos, pero su historial se conserva.

function listarProfes_() {
  const pagos = tabla_(H.PAGO_PROFES).filas.filter(esValido_);
  const st = {};
  pagos.forEach(p => {
    const x = st[p.profe_id] || (st[p.profe_id] = { total: 0, clases: 0, pagos: {}, ultimo: '' });
    x.total += num_(p.total); x.clases += num_(p.clases); x.pagos[p.pago] = true;
    const f = p.fecha ? ymd_(p.fecha) : '';
    if (f > x.ultimo) x.ultimo = f;
  });
  return { profes: tabla_(H.PROFES).filas.filter(f => f.id).map(f => {
    const x = st[f.id] || { total: 0, clases: 0, pagos: {}, ultimo: '' };
    return { id: f.id, nombre: f.nombre, valor_clase: num_(f.valor_clase), activo: norm_(f.activo) !== 'no', nota: f.nota || '',
      total_pagado: x.total, clases: x.clases, pagos: Object.keys(x.pagos).length, ultimo_pago: x.ultimo };
  }).sort((a, b) => (Number(b.activo) - Number(a.activo)) || String(a.nombre).localeCompare(String(b.nombre), 'es')) };
}

function guardarProfe_(d, ses) {
  const t = tabla_(H.PROFES);
  const conColumna = obj => { const o = {}; Object.keys(obj).forEach(k => { if (t.headers.indexOf(k) >= 0) o[k] = obj[k]; }); return o; };
  const valor = d.valor_clase === undefined || d.valor_clase === '' || d.valor_clase === null ? '' : monto_(d.valor_clase);
  if (!d.id) {
    const nombre = requerido_(d.nombre, 'nombre del profe').replace(/\s+/g, ' ');
    const ya = t.filas.find(f => norm_(f.nombre) === norm_(nombre));
    if (ya) throw err_('Ya existe ' + ya.nombre + (norm_(ya.activo) === 'no' ? ' (eliminado: reactívalo en vez de crearlo de nuevo)' : ''), 'duplicado');
    const p = { id: siguienteId_(H.PROFES, 'id', 'D', 2), nombre: nombre, valor_clase: valor, activo: 'Sí', nota: texto_(d.nota) };
    insertar_(H.PROFES, [conColumna(p)]);
    bitacora_(ses, 'crearProfe', H.PROFES, p.id, p);
    return { id: p.id };
  }
  const p = t.filas.find(f => f.id === d.id);
  if (!p) throw err_('No encontré el profe ' + d.id);
  const cambios = {};
  if (d.nombre !== undefined) {
    const nombre = requerido_(d.nombre, 'nombre').replace(/\s+/g, ' ');
    const otro = t.filas.find(f => f.id !== p.id && norm_(f.nombre) === norm_(nombre));
    if (otro) throw err_('Ya existe otro profe con ese nombre.', 'duplicado');
    if (nombre !== p.nombre) cambios.nombre = nombre;
  }
  if (d.valor_clase !== undefined && valor !== (p.valor_clase === '' ? '' : num_(p.valor_clase))) cambios.valor_clase = valor;
  if (d.nota !== undefined && texto_(d.nota) !== String(p.nota || '')) cambios.nota = texto_(d.nota);
  if (d.activo !== undefined && (norm_(p.activo) !== 'no') !== !!d.activo) cambios.activo = d.activo ? 'Sí' : 'No';
  if (!Object.keys(cambios).length) throw err_('No hay cambios para guardar.');
  const antes = {};
  Object.keys(cambios).forEach(k => antes[k] = p[k]);
  actualizar_(t, p, conColumna(Object.assign({}, cambios, { actualizado_por: ses.nombre, actualizado_en: new Date() })));
  const renombrados = cambios.nombre ? renombrar_(H.PAGO_PROFES, p.id, cambios.nombre, 'profe_id', 'profe') : 0;
  const accion = cambios.activo === 'No' ? 'eliminarProfe' : cambios.activo === 'Sí' ? 'reactivarProfe' : 'editarProfe';
  bitacora_(ses, accion, H.PROFES, p.id, { antes: antes, despues: cambios, pagos_renombrados: renombrados });
  return { id: p.id, renombrados: renombrados };
}

// ---------- saldo a favor, devoluciones y descuentos

/** Lo que debe o tiene a favor una persona en cada cosa: cargos, pedidos de uniforme y la tienda. */
function saldosDe_(q) {
  const mismo = f => q.estudiante_id ? f.estudiante_id === q.estudiante_id : (!f.estudiante_id && norm_(f.persona) === norm_(q.persona));
  const pagos = tabla_(H.PAGOS).filas.filter(p => esValido_(p) && mismo(p));
  const items = [];
  if (q.estudiante_id) tabla_(H.CARGOS).filas.filter(c => esValido_(c) && mismo(c)).forEach(c => {
    const pagado = sum_(pagos.filter(p => norm_(p.concepto) === norm_(c.concepto) && !p.pedido_uniforme), 'valor');
    items.push({ origen: 'cargo', concepto: c.concepto, pedido: '', valor: num_(c.valor_total), pagado: pagado, saldo: num_(c.valor_total) - pagado });
  });
  tabla_(H.PEDIDOS).filas.filter(p => esValido_(p) && mismo(p)).forEach(pe => {
    const pagado = sum_(pagos.filter(p => p.pedido_uniforme === pe.id), 'valor');
    items.push({ origen: 'pedido', concepto: 'Uniforme', pedido: pe.id, valor: num_(pe.valor_acordado), pagado: pagado, saldo: num_(pe.valor_acordado) - pagado });
  });
  const fiado = sum_(tabla_(H.VENTAS).filas.filter(v => esValido_(v) && mismo(v) && esVentaACuenta_(v)), 'total');
  const pagT = sum_(pagos.filter(p => norm_(p.concepto) === 'cuenta tienda'), 'valor');
  if (fiado || pagT) items.push({ origen: 'tienda', concepto: 'Cuenta tienda', pedido: '', valor: fiado, pagado: pagT, saldo: fiado - pagT });
  return { items: items, a_favor: items.filter(i => i.saldo < 0).reduce((s, i) => s - i.saldo, 0), debe: items.filter(i => i.saldo > 0).reduce((s, i) => s + i.saldo, 0) };
}

function saldosFavor_(d) {
  const q = quien_(d);
  const s = saldosDe_(q);
  return { quien: q.estudiante || q.persona, items: s.items, a_favor: s.a_favor, debe: s.debe };
}

/** Pasa saldo a favor desde otros conceptos hacia "destino". Devuelve las filas negativas (no las inserta). */
function consumirSaldo_(q, valor, destino, fecha, ses, nota, nInicio, ref) {
  const fuentes = saldosDe_(q).items.filter(i => i.saldo < 0 && !(norm_(i.concepto) === norm_(destino.concepto) && String(i.pedido || '') === String(destino.pedido || '')))
    .sort((a, b) => a.saldo - b.saldo);
  const disponible = fuentes.reduce((s, i) => s - i.saldo, 0);
  if (valor > disponible) throw err_((q.estudiante || q.persona) + ' solo tiene ' + pesos_(disponible) + ' a favor para usar aquí.', 'saldo');
  let falta = valor, n = nInicio;
  const filas = [];
  fuentes.forEach(f => {
    if (falta <= 0) return;
    const usar = Math.min(falta, -f.saldo);
    falta -= usar;
    filas.push(auditar_({ id: 'P' + pad_(n++, 4), fecha: fecha, estudiante_id: q.estudiante_id, estudiante: q.estudiante, persona: q.persona,
      concepto: f.concepto, valor: -usar, metodo: SALDO_FAVOR, recibido_en: '', pedido_uniforme: f.pedido || '', nota: nota, tipo: 'Saldo usado',
      relacionado: ref || '' }, ses));
  });
  return filas;
}

/** Devolverle plata a alguien que tiene saldo a favor en un concepto. Sale de una cuenta. */
function registrarDevolucion_(d, ses) {
  const q = quien_(d);
  const valor = monto_(d.valor);
  const item = saldosDe_(q).items.find(i => norm_(i.concepto) === norm_(d.concepto) && String(i.pedido || '') === String(d.pedido_uniforme || ''));
  const favor = item && item.saldo < 0 ? -item.saldo : 0;
  if (!favor) throw err_('No tiene saldo a favor en ' + d.concepto + (d.pedido_uniforme ? ' ' + d.pedido_uniforme : '') + '.');
  if (valor > favor) throw err_('Solo tiene ' + pesos_(favor) + ' a favor en ' + item.concepto + '.');
  const metodo = enLista_(d.metodo, 'metodo_pago', 'método');
  const p = auditar_({ id: siguienteId_(H.PAGOS, 'id', 'P', 4), fecha: fecha_(d.fecha), estudiante_id: q.estudiante_id, estudiante: q.estudiante,
    persona: q.persona, concepto: item.concepto, valor: -valor, metodo: metodo, recibido_en: cuentaActiva_(d.pagado_desde, 'sale de'),
    pedido_uniforme: item.pedido || '', nota: texto_(d.nota) || 'Devolución de saldo a favor', tipo: 'Devolución' }, ses);
  insertar_(H.PAGOS, [p]);
  bitacora_(ses, 'registrarDevolucion', H.PAGOS, p.id, p);
  return { id: p.id, queda_a_favor: favor - valor };
}

/** Descuento en pesos con su motivo. Sin descuento devuelve campos vacíos. */
function descuento_(d, base) {
  if (d.descuento === undefined || d.descuento === null || d.descuento === '' || Number(d.descuento) === 0) return { descuento: '', motivo_descuento: '' };
  const v = monto_(d.descuento);
  if (base !== null && base !== undefined && v > base) throw err_('El descuento no puede ser mayor que el valor.');
  return { descuento: v, motivo_descuento: requerido_(d.motivo_descuento, 'motivo del descuento') };
}

function listarDescuentos_() {
  if (!hojaExiste_(H.DESCUENTOS)) return { descuentos: [] };
  return { descuentos: tabla_(H.DESCUENTOS).filas.filter(f => f.id).map(f => ({ id: f.id, nombre: f.nombre, tipo: String(f.tipo), valor: num_(f.valor),
    aplica_a: String(f.aplica_a || 'Todos'), activo: norm_(f.activo) !== 'no', nota: f.nota || '' })) };
}

function guardarDescuento_(d, ses) {
  if (!hojaExiste_(H.DESCUENTOS)) throw err_('Falta la pestaña Descuentos: ejecuta "configurar" en Apps Script.');
  const t = tabla_(H.DESCUENTOS);
  const nombre = requerido_(d.nombre, 'nombre del descuento');
  const tipo = d.tipo === '%' || d.tipo === '$' ? d.tipo : null;
  if (!tipo) throw err_('El descuento debe ser en % o en $.');
  const valor = monto_(d.valor);
  if (tipo === '%' && valor > 100) throw err_('Un descuento no puede ser mayor al 100%.');
  const aplica = texto_(d.aplica_a) || 'Todos';
  if (norm_(aplica) !== 'todos') concepto_(aplica);
  const otro = t.filas.find(f => f.id !== d.id && norm_(f.nombre) === norm_(nombre));
  if (otro) throw err_('Ya existe un descuento con ese nombre.', 'duplicado');
  if (!d.id) {
    const x = { id: siguienteId_(H.DESCUENTOS, 'id', 'DS', 2), nombre: nombre, tipo: tipo, valor: valor, aplica_a: aplica, activo: 'Sí', nota: texto_(d.nota) };
    insertar_(H.DESCUENTOS, [x]);
    bitacora_(ses, 'crearDescuento', H.DESCUENTOS, x.id, x);
    return { id: x.id };
  }
  const x = t.filas.find(f => f.id === d.id);
  if (!x) throw err_('No encontré el descuento ' + d.id);
  const cambios = { nombre: nombre, tipo: tipo, valor: valor, aplica_a: aplica, nota: texto_(d.nota) };
  if (d.activo !== undefined) cambios.activo = d.activo ? 'Sí' : 'No';
  const antes = { nombre: x.nombre, tipo: x.tipo, valor: x.valor, aplica_a: x.aplica_a, activo: x.activo };
  actualizar_(t, x, cambios);
  bitacora_(ses, 'editarDescuento', H.DESCUENTOS, x.id, { antes: antes, despues: cambios });
  return { id: x.id };
}

function pesos_(v) { const n = Math.round(Number(v) || 0); return (n < 0 ? '-$' : '$') + String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }

// ---------- productos e inventario

// Existencias: un "Conteo" fija la cantidad; "Entrada" suma; "Salida" y cada venta restan.
// Las ventas solo restan desde que el producto tiene su primer conteo o entrada.
function stocks_() {
  const ev = [];
  if (hojaExiste_(H.INVENTARIO)) tabla_(H.INVENTARIO).filas.filter(esValido_).forEach(m =>
    ev.push({ t: tiempo_(m.registrado_en), p: m.producto_id, tipo: norm_(m.tipo), n: num_(m.cantidad), fecha: m.fecha }));
  tabla_(H.VENTAS).filas.filter(v => esValido_(v) && v.producto_id).forEach(v =>
    ev.push({ t: tiempo_(v.registrado_en), p: v.producto_id, tipo: 'venta', n: num_(v.cantidad), fecha: v.fecha }));
  ev.sort((a, b) => a.t - b.t);
  const s = {};
  ev.forEach(e => {
    const x = s[e.p] || (s[e.p] = { stock: null, ultimo_conteo: '', entradas: 0, salidas: 0 });
    if (e.tipo === 'conteo') { x.stock = e.n; x.ultimo_conteo = ymd_(e.fecha); }
    else if (e.tipo === 'entrada') { x.stock = (x.stock || 0) + e.n; x.entradas += e.n; }
    else if (e.tipo === 'salida') { x.stock = (x.stock || 0) - e.n; x.salidas += e.n; }
    else if (e.tipo === 'venta' && x.stock !== null) x.stock -= e.n;
  });
  return s;
}

function reporteInventario_(d) {
  const rango = rango_(d);
  const st = stocks_();
  const vendidas = {};
  tabla_(H.VENTAS).filas.filter(v => esValido_(v) && v.producto_id && enRango_(v.fecha, rango) && norm_(v.metodo) !== 'consumo interno')
    .forEach(v => { const x = vendidas[v.producto_id] || (vendidas[v.producto_id] = { cantidad: 0, total: 0 }); x.cantidad += num_(v.cantidad); x.total += num_(v.total); });
  const productos = tabla_(H.PRODUCTOS).filas.filter(f => f.id).map(f => {
    const s = st[f.id] || { stock: null, ultimo_conteo: '', entradas: 0, salidas: 0 };
    const v = vendidas[f.id] || { cantidad: 0, total: 0 };
    return { id: f.id, nombre: f.nombre, precio: num_(f.precio), activo: norm_(f.activo) !== 'no', stock: s.stock,
      ultimo_conteo: s.ultimo_conteo, vendidas: v.cantidad, total_vendido: v.total };
  }).sort((a, b) => (Number(b.activo) - Number(a.activo)) || String(a.nombre).localeCompare(String(b.nombre), 'es'));
  const movs = hojaExiste_(H.INVENTARIO) ? tabla_(H.INVENTARIO).filas.slice(-60).reverse().map(limpio_) : [];
  return { desde: rango.desde, hasta: rango.hasta, productos: productos, movimientos: movs };
}

function registrarProducto_(d, ses) {
  const nombre = requerido_(d.nombre, 'nombre del producto').replace(/\s+/g, ' ');
  const ya = tabla_(H.PRODUCTOS).filas.find(f => norm_(f.nombre) === norm_(nombre));
  if (ya) throw err_('Ya existe ' + ya.nombre + (norm_(ya.activo) === 'no' ? ' (inactivo: actívalo en vez de crearlo)' : ''), 'duplicado');
  const p = { id: siguienteId_(H.PRODUCTOS, 'id', 'T', 2), nombre: nombre, precio: monto_(d.precio), activo: 'Sí' };
  insertar_(H.PRODUCTOS, [p]);
  let mov = null;
  if (d.cantidad_inicial !== undefined && d.cantidad_inicial !== '' && d.cantidad_inicial !== null) {
    mov = insertarMovimiento_({ producto_id: p.id, tipo: 'Conteo', cantidad: d.cantidad_inicial, costo_unitario: d.costo_unitario, fecha: d.fecha, nota: 'Cantidad inicial al crear el producto' }, ses, p);
  }
  bitacora_(ses, 'registrarProducto', H.PRODUCTOS, p.id, { producto: p, inventario: mov });
  return { id: p.id, movimiento: mov };
}

function editarProducto_(d, ses) {
  const t = tabla_(H.PRODUCTOS);
  const p = t.filas.find(f => f.id === d.id);
  if (!p) throw err_('No encontré el producto ' + d.id);
  const cambios = {};
  if (d.nombre !== undefined) {
    const nombre = requerido_(d.nombre, 'nombre').replace(/\s+/g, ' ');
    const otro = t.filas.find(f => f.id !== p.id && norm_(f.nombre) === norm_(nombre));
    if (otro) throw err_('Ya existe otro producto con ese nombre.', 'duplicado');
    if (nombre !== p.nombre) cambios.nombre = nombre;
  }
  if (d.precio !== undefined && monto_(d.precio) !== num_(p.precio)) cambios.precio = monto_(d.precio);
  if (d.activo !== undefined && (norm_(p.activo) !== 'no') !== !!d.activo) cambios.activo = d.activo ? 'Sí' : 'No';
  if (!Object.keys(cambios).length) throw err_('No hay cambios para guardar.');
  const antes = {};
  Object.keys(cambios).forEach(k => antes[k] = p[k]);
  actualizar_(t, p, cambios);
  bitacora_(ses, 'editarProducto', H.PRODUCTOS, p.id, { antes: antes, despues: cambios });
  return { id: p.id };
}

function movimientoInventario_(d, ses) {
  const p = tabla_(H.PRODUCTOS).filas.find(f => f.id === d.producto_id);
  if (!p) throw err_('Escoge el producto.');
  const mov = insertarMovimiento_(d, ses, p);
  bitacora_(ses, 'movimientoInventario', H.INVENTARIO, mov.id, mov);
  const st = stocks_()[p.id];
  return { id: mov.id, stock: st ? st.stock : null };
}

function insertarMovimiento_(d, ses, p) {
  if (!hojaExiste_(H.INVENTARIO)) throw err_('Falta la pestaña Inventario: ejecuta "configurar" en Apps Script.');
  const tipo = TIPOS_INVENTARIO.find(x => norm_(x) === norm_(d.tipo));
  if (!tipo) throw err_('Tipo de movimiento no válido: ' + d.tipo);
  const n = Number(d.cantidad);
  if (!Number.isInteger(n) || n < 0 || (tipo !== 'Conteo' && n === 0)) throw err_('La cantidad debe ser un número entero' + (tipo === 'Conteo' ? ' (puede ser 0).' : ' mayor que cero.'));
  const m = { id: siguienteId_(H.INVENTARIO, 'id', 'I', 4), fecha: fecha_(d.fecha), producto_id: p.id, producto: p.nombre, tipo: tipo,
    cantidad: n, costo_unitario: d.costo_unitario ? monto_(d.costo_unitario, true) : '', nota: texto_(d.nota) };
  insertar_(H.INVENTARIO, [auditar_(m, ses)]);
  return m;
}

// ---------- claves

function cambiarClave_(d, ses) {
  const t = tabla_(H.USUARIOS);
  const u = t.filas.find(f => norm_(f.usuario) === ses.usuario);
  if (!u) throw err_('Usuario no encontrado');
  if (!u.clave_hash || u.clave_hash !== hash_(String(d.actual || ''))) throw err_('La clave actual no es correcta.', 'credenciales');
  const nueva = String(d.nueva || '');
  if (nueva.length < 6) throw err_('La clave nueva debe tener mínimo 6 caracteres.');
  if (nueva === String(d.actual)) throw err_('La clave nueva debe ser diferente a la actual.');
  const v = String(Number(u.sesion_v || 0) + 1);
  actualizar_(t, u, { clave_hash: hash_(nueva), sesion_v: v });
  // Cierra las demás sesiones de este usuario y entrega un pase nuevo para seguir trabajando.
  const cache = CacheService.getScriptCache();
  if (ses.token) cache.remove('s:' + ses.token);
  const token = Utilities.getUuid();
  const nueva_ses = { usuario: ses.usuario, nombre: ses.nombre, rol: ses.rol, v: versionSesiones_(), uv: v };
  cache.put('s:' + token, JSON.stringify(nueva_ses), SESION_SEG);
  bitacora_(ses, 'cambiarClave', H.USUARIOS, u.usuario, {});
  return { token: token, nombre: ses.nombre, rol: ses.rol };
}

function restablecerClave_(d, ses) {
  soloDirector_(ses);
  const t = tabla_(H.USUARIOS);
  const u = t.filas.find(f => norm_(f.usuario) === norm_(d.usuario));
  if (!u) throw err_('No existe el usuario ' + d.usuario);
  const nueva = String(d.nueva || '');
  if (nueva.length < 6) throw err_('La clave debe tener mínimo 6 caracteres.');
  actualizar_(t, u, { clave_hash: hash_(nueva), sesion_v: String(Number(u.sesion_v || 0) + 1) });
  CacheService.getScriptCache().remove('f:' + norm_(u.usuario)); // quita el bloqueo por intentos fallidos
  bitacora_(ses, 'restablecerClave', H.USUARIOS, u.usuario, { por: ses.nombre });
  return { usuario: u.usuario, propia: norm_(u.usuario) === ses.usuario };
}

function listarUsuarios_(d, ses) {
  soloDirector_(ses);
  return { usuarios: tabla_(H.USUARIOS).filas.filter(f => f.usuario).map(f => ({ usuario: f.usuario, nombre: f.nombre, rol: f.rol,
    activo: esSi_(f.activo), tiene_clave: !!f.clave_hash })) };
}

// ===================================================================== consultas y reportes

function registros_(d) {
  const hoja = String(d.hoja || '');
  const permitidas = Object.keys(ANULABLES).concat([H.PRENDAS, H.ESTUDIANTES, H.BITACORA]);
  if (!hojaExiste_(hoja)) return { total: 0, filas: [] };
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
    const x = dias[k] || (dias[k] = { fecha: k, vendido: 0, efectivo: 0, transferencia: 0, fiado: 0, consumo_interno: 0, saldo_a_favor: 0, ventas: {} });
    const m = norm_(v.metodo).replace(/ /g, '_');
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
  ventasValidas.filter(esVentaACuenta_).forEach(v => {
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
  const s = saldosDe_({ estudiante_id: e.id, estudiante: e.nombre, persona: '' });
  return { estudiante: limpio_(e), cargos: cargos, pedidos: pedidos, tienda: tienda, pagos: pagos.map(limpio_).reverse(),
    a_favor: s.items.filter(i => i.saldo < 0), total_a_favor: s.a_favor };
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
  const faltan = Object.keys(objs[0]).filter(k => headers.indexOf(k) < 0 && objs.some(o => o[k] !== '' && o[k] !== undefined && o[k] !== null));
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
function esVentaCobrada_(v) { const m = norm_(v.metodo); return m !== 'fiado' && m !== 'consumo interno' && m !== 'saldo a favor'; }
function esVentaACuenta_(v) { const m = norm_(v.metodo); return m === 'fiado' || m === 'saldo a favor'; }
function esSaldo_(m) { return norm_(m) === 'saldo a favor'; }
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
  Object.keys(HOJAS_NUEVAS).forEach(nombre => {
    if (ss.getSheetByName(nombre)) return;
    const sh = ss.insertSheet(nombre);
    const cols = HOJAS_NUEVAS[nombre];
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F1229');
    sh.setFrozenRows(1);
    if (SEMILLAS[nombre]) sh.getRange(2, 1, SEMILLAS[nombre].length, cols.length).setValues(SEMILLAS[nombre]);
    if (nombre === H.PLANES) {
      // Se siembran los planes que ya tienen los estudiantes; el valor mensual queda para llenarlo.
      const vistos = {};
      const filas = [];
      tabla_(H.ESTUDIANTES).filas.forEach(e => {
        const p = String(e.plan || '').replace(/\s+/g, ' ').trim();
        if (p && !vistos[norm_(p)]) { vistos[norm_(p)] = true; filas.push(['PL' + pad_(filas.length + 1, 2), p, '', 'Sí', '']); }
      });
      if (filas.length) sh.getRange(2, 1, filas.length, cols.length).setValues(filas);
    }
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
  actualizar_(t, u, Object.assign({ clave_hash: hash_(clave) }, t.headers.indexOf('sesion_v') >= 0 ? { sesion_v: String(Number(u.sesion_v || 0) + 1) } : {}));
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
    actualizar_(t, u, Object.assign({ clave_hash: hash_(nueva), clave_nueva: '' }, t.headers.indexOf('sesion_v') >= 0 ? { sesion_v: String(Number(u.sesion_v || 0) + 1) } : {}));
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


// ===================================================================== correcciones puntuales (se ejecutan una vez desde el editor)

/**
 * Ajustes confirmados con recepción el 22/10/2026. Si ya se aplicaron, no hace nada.
 * Ejecutar desde el editor de Apps Script → función correccionesRevision22oct.
 */
function correccionesRevision22oct() {
  const ses = { nombre: 'Revisión recepción 22/10' };
  if (tabla_(H.BITACORA).filas.some(x => x.accion === 'correcciones_22oct')) { console.log('Ya se habían aplicado.'); return 'Ya se habían aplicado.'; }
  const res = [];
  const est = tabla_(H.ESTUDIANTES).filas;
  const idDe = nombre => (est.find(e => norm_(e.nombre) === norm_(nombre)) || {}).id;
  const F = (y, m, d) => new Date(y, m - 1, d, 12);
  const tp = tabla_(H.PAGOS);
  let n = numeroId_(siguienteId_(H.PAGOS, 'id', 'P', 4));
  const nuevos = [];
  const pago = (o) => auditar_(Object.assign({ id: 'P' + pad_(n++, 4), persona: '', pedido_uniforme: '', metodo: 'Otro', recibido_en: 'Sin dato', tipo: '' }, o), ses);

  // 1. Melanie Zuluaga: ya pagó los $150.000 del vestuario.
  const mel = idDe('Melanie Zuluaga');
  const pagMel = sum_(tp.filas.filter(p => esValido_(p) && p.estudiante_id === mel && norm_(p.concepto) === 'vestuario clausura'), 'valor');
  if (mel && pagMel < 150000) {
    nuevos.push(pago({ fecha: F(2026, 10, 22), estudiante_id: mel, estudiante: 'Melanie Zuluaga', concepto: 'Vestuario clausura', valor: 150000 - pagMel,
      nota: 'Completó el vestuario ($150.000 en total), confirmado por recepción el 22/10. Fecha y método del pago sin dato' }));
    res.push('Melanie Zuluaga: pago de ' + pesos_(150000 - pagMel) + ' (queda al día)');
  } else res.push('Melanie Zuluaga: ya estaba al día');

  // 2. Isabela Ruiz: el abono de $50.300 se deja en $50.250 para cerrar en $300.000.
  const isa = idDe('Isabela Ruiz');
  const p503 = tp.filas.find(p => esValido_(p) && p.estudiante_id === isa && num_(p.valor) === 50300);
  if (p503) {
    actualizar_(tp, p503, { valor: 50250, nota: (p503.nota ? p503.nota + '. ' : '') + 'Ajustado de $50.300 a $50.250 en la revisión del 22/10 para cerrar en $300.000' });
    res.push('Isabela Ruiz: abono ' + p503.id + ' ajustado a $50.250 (queda al día)');
  } else res.push('Isabela Ruiz: no encontré el abono de $50.300');

  // 7. Emiliana Montoya: se explica el valor pagado (5% por matrícula); conserva su saldo a favor.
  const tped = tabla_(H.PEDIDOS);
  const ped = tped.filas.find(p => p.id === 'U064' && norm_(p.estudiante).indexOf('emiliana montoya') >= 0);
  if (ped) {
    actualizar_(tped, ped, { nota: 'Pagó $180.500 = conjunto $190.000 con 5% de descuento por comprarlo el día de la matrícula. Cambió la sudadera por camiseta: blusa $80.000 + camiseta $85.000 = $165.000. Le quedan $15.500 a favor' });
    res.push('Emiliana Montoya: nota del pedido U064 actualizada');
  }

  // 8. La Emma con $100 a favor en la tienda es Emma Rodríguez.
  const emma = idDe('Emma Rodriguez');
  const pe = tp.filas.find(p => esValido_(p) && !p.estudiante_id && norm_(p.persona) === 'emma' && norm_(p.concepto) === 'cuenta tienda');
  if (pe && emma) {
    actualizar_(tp, pe, { estudiante_id: emma, estudiante: 'Emma Rodriguez', persona: '' });
    res.push('Emma: el saldo de $100 de la tienda quedó a nombre de Emma Rodriguez');
  }

  // 9. María Antonia Cortés: tiene además $300 a favor (17/10).
  const mac = idDe('Maria Antonia Cortes');
  const ya300 = tp.filas.some(p => esValido_(p) && p.estudiante_id === mac && norm_(p.concepto) === 'cuenta tienda' && num_(p.valor) === 300);
  if (mac && !ya300) {
    nuevos.push(pago({ fecha: F(2026, 10, 17), estudiante_id: mac, estudiante: 'Maria Antonia Cortes', concepto: 'Cuenta tienda', valor: 300,
      nota: 'Saldo a favor de la tienda vieja (17/10), confirmado por recepción el 22/10' }));
    res.push('María Antonia Cortés: +$300 a favor en la tienda');
  }
  if (nuevos.length) insertar_(H.PAGOS, nuevos);

  // 10. Los $100.000 de Antonia Rueda ya salieron de la cuenta de Majo.
  const yaT = tabla_(H.TRASLADOS).filas.some(t => esValido_(t) && norm_(t.de) === 'cuenta majo' && num_(t.valor) === 100000 && ymd_(t.fecha) >= '2026-10-20');
  if (!yaT) {
    insertar_(H.TRASLADOS, [auditar_({ id: siguienteId_(H.TRASLADOS, 'id', 'X', 3), fecha: F(2026, 10, 22), de: 'Cuenta Majo', a: 'Caja', valor: 100000,
      nota: 'Retiro de los $100.000 de Antonia Rueda, confirmado por recepción el 22/10 (fecha aproximada)' }, ses)]);
    res.push('Traslado de $100.000 de la cuenta de Majo a Caja');
  } else res.push('El traslado de los $100.000 ya estaba registrado');

  bitacora_(ses, 'correcciones_22oct', H.PAGOS, '', res);
  SpreadsheetApp.flush();
  console.log(res.join('\n'));
  return res.join('\n');
}


// ===================================================================== estudiantes desde el admin (Supabase)
/*
 * El admin (Supabase) es la fuente de los estudiantes y los planes. Esta planilla solo los lee.
 * Supabase tiene dos funciones de solo lectura protegidas con una clave: registros_estudiantes y registros_planes.
 *
 * Propiedades del script (Configuración del proyecto → Propiedades del script):
 *   ADMIN_URL    → https://<proyecto>.supabase.co
 *   ADMIN_LLAVE  → la llave pública (anon / publishable) del proyecto
 *   ADMIN_CLAVE  → la clave guardada en Supabase (vault: registros_sheet_clave)
 *
 * Pasos, desde el editor:
 *   1. revisarEmparejamiento  → arma la pestaña "Emparejar admin" sin cambiar nada más.
 *   2. Revisar esa pestaña y escribir en "confirmar": Sí / el código E### correcto / Nuevo / (vacío = después).
 *   3. aplicarEmparejamiento  → une los confirmados y deja la planilla conectada al admin.
 *   4. activarSincronizacionAuto → trae los cambios cada 15 minutos.
 */
const HOJA_EMPAREJAR = 'Emparejar admin';
const EMPAREJAR_COLS = ['supabase_id', 'nombre_admin', 'estado_admin', 'plan_admin', 'tipo', 'id_planilla', 'nombre_planilla', 'confirmar', 'nota'];
const SES_ADMIN = { nombre: 'Sincronización admin', rol: 'sistema' };

function adminConectado_() { return PropertiesService.getScriptProperties().getProperty('ADMIN_EMPAREJADO') === 'si'; }
function esActivoAdmin_(estado) { return norm_(estado) !== 'retirado'; }

function configAdmin_() {
  const p = PropertiesService.getScriptProperties();
  const c = { url: String(p.getProperty('ADMIN_URL') || '').trim().replace(/\/+$/, ''), llave: String(p.getProperty('ADMIN_LLAVE') || '').trim(), clave: String(p.getProperty('ADMIN_CLAVE') || '').trim() };
  const faltan = ['url', 'llave', 'clave'].filter(k => !c[k]).map(k => 'ADMIN_' + k.toUpperCase());
  if (faltan.length) throw err_('Falta conectar el admin: en Apps Script → Configuración del proyecto → Propiedades del script, agrega ' + faltan.join(', ') + '.');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(c.url)) throw err_('ADMIN_URL debe ser como https://xxxx.supabase.co');
  return c;
}

// Lee estudiantes y planes del admin. No escribe nada.
function leerAdmin_() {
  const c = configAdmin_();
  const pedir = fn => ({ url: c.url + '/rest/v1/rpc/' + fn, method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: c.llave, Authorization: 'Bearer ' + c.llave }, payload: JSON.stringify({ p_clave: c.clave }) });
  const rs = UrlFetchApp.fetchAll([pedir('registros_estudiantes'), pedir('registros_planes')]);
  const datos = rs.map((r, i) => {
    const code = r.getResponseCode(), txt = r.getContentText();
    if (code === 200) return JSON.parse(txt);
    if (/Clave inv/i.test(txt)) throw err_('El admin rechazó la clave (ADMIN_CLAVE no coincide con la de Supabase).');
    if (code === 401 || code === 403) throw err_('El admin rechazó la llave pública (revisa ADMIN_LLAVE).');
    if (code === 404) throw err_('No encontré la función ' + (i ? 'registros_planes' : 'registros_estudiantes') + ' en el admin.');
    throw err_('El admin respondió con error ' + code + '. Intenta de nuevo en un momento.');
  });
  const estudiantes = datos[0].filter(e => e.supabase_id && texto_(e.nombre)).map(e => ({
    supabase_id: String(e.supabase_id), nombre: texto_(e.nombre).replace(/\s+/g, ' '), plan: texto_(e.plan),
    valor_mensual: num_(e.valor_mensual), estado: texto_(e.estado) || 'ACTIVO' }));
  const planes = datos[1].filter(p => texto_(p.nombre)).map(p => ({ nombre: texto_(p.nombre).replace(/\s+/g, ' '), valor_mensual: num_(p.valor_mensual), activo: p.activo !== false }));
  return { estudiantes: estudiantes, planes: planes };
}

const PALABRAS_VACIAS_ = { de: 1, del: 1, la: 1, las: 1, los: 1, y: 1 };
function tokens_(n) { return norm_(n).replace(/[^a-z0-9ñ ]/g, ' ').split(' ').filter(t => t && !PALABRAS_VACIAS_[t]); }
// Qué tan parecidos son dos nombres: palabras en común sobre las del nombre más corto (1 = uno contiene al otro).
// El primer nombre de uno tiene que aparecer en el otro.
function parecido_(a, b) {
  const ta = tokens_(a), tb = tokens_(b);
  if (!ta.length || !tb.length) return 0;
  if (tb.indexOf(ta[0]) < 0 && ta.indexOf(tb[0]) < 0) return 0;
  const comunes = ta.filter(t => tb.indexOf(t) >= 0).length;
  return comunes / Math.min(ta.length, tb.length);
}

function fila_(a, tipo, f, confirmar, nota) { return [a.supabase_id, a.nombre, a.estado, a.plan, tipo, f ? f.id : '', f ? f.nombre : '', confirmar, nota || '']; }

// Propuesta de emparejamiento entre el admin y la planilla (no escribe nada).
function proponerEmparejamiento_(admin) {
  const est = tabla_(H.ESTUDIANTES).filas.filter(f => f.id);
  const porSupa = {}; est.forEach(f => { if (f.supabase_id) porSupa[String(f.supabase_id)] = f; });
  const usados = {};
  Object.keys(porSupa).forEach(k => usados[porSupa[k].id] = true);
  const libres = () => est.filter(f => !f.supabase_id && !usados[f.id]);
  const filas = [], pendientes = [];
  admin.estudiantes.forEach(a => {
    const ya = porSupa[a.supabase_id];
    if (ya) { filas.push(fila_(a, 'Ya vinculado', ya, 'Sí')); return; }
    const iguales = libres().filter(f => norm_(f.nombre) === norm_(a.nombre));
    const otrosIgual = admin.estudiantes.some(b => b !== a && norm_(b.nombre) === norm_(a.nombre));
    if (iguales.length === 1 && !otrosIgual) { usados[iguales[0].id] = true; filas.push(fila_(a, 'Igual', iguales[0], 'Sí')); return; }
    pendientes.push(a);
  });
  pendientes.forEach(a => {
    const cand = libres().map(f => ({ f: f, p: parecido_(a.nombre, f.nombre) })).filter(x => x.p >= 0.6).sort((x, y) => y.p - x.p);
    if (!cand.length) { filas.push(fila_(a, 'Nuevo', null, 'Nuevo')); return; }
    const otros = cand.slice(1, 4).map(x => x.f.id + ' ' + x.f.nombre).join(' · ');
    filas.push(fila_(a, 'Parecido', cand[0].f, '', otros ? 'También podría ser: ' + otros : ''));
  });
  const propuestos = {}; filas.forEach(r => { if (r[5]) propuestos[r[5]] = true; });
  est.filter(f => !f.supabase_id && !propuestos[f.id]).forEach(f =>
    filas.push(['', '', '', '', 'Solo en planilla', f.id, f.nombre, '', norm_(f.activo) === 'no' ? 'Inactivo en la planilla' : 'No aparece en el admin']));
  return filas;
}

/** Paso 1 (editor): arma la pestaña "Emparejar admin" para revisarla. No cambia estudiantes. */
function revisarEmparejamiento() {
  const admin = leerAdmin_();
  const filas = proponerEmparejamiento_(admin);
  const orden = { 'Parecido': 0, 'Nuevo': 1, 'Solo en planilla': 2, 'Igual': 3, 'Ya vinculado': 4 };
  filas.sort((x, y) => orden[x[4]] - orden[y[4]] || String(x[1] || x[6]).localeCompare(String(y[1] || y[6]), 'es'));
  const ss = libro_();
  const sh = ss.getSheetByName(HOJA_EMPAREJAR) || ss.insertSheet(HOJA_EMPAREJAR);
  sh.clearContents();
  sh.getRange(1, 1, 1, EMPAREJAR_COLS.length).setValues([EMPAREJAR_COLS]).setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#1F1229');
  sh.setFrozenRows(1);
  if (filas.length) sh.getRange(2, 1, filas.length, EMPAREJAR_COLS.length).setValues(filas);
  const cuenta = {}; filas.forEach(r => cuenta[r[4]] = (cuenta[r[4]] || 0) + 1);
  const msg = 'Admin: ' + admin.estudiantes.length + ' estudiantes, ' + admin.planes.length + ' planes.\n' +
    Object.keys(orden).filter(k => cuenta[k]).map(k => k + ': ' + cuenta[k]).join('\n') +
    '\nRevisa la pestaña "' + HOJA_EMPAREJAR + '": en "confirmar" escribe Sí, el código E### correcto, Nuevo, o déjalo vacío para decidir después.';
  console.log(msg);
  return msg;
}

/** Paso 3 (editor): une lo confirmado en "Emparejar admin" y deja la planilla conectada al admin. */
function aplicarEmparejamiento() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw err_('Hay alguien guardando. Intenta en un momento.');
  try {
    const t = tabla_(HOJA_EMPAREJAR);
    const est = tabla_(H.ESTUDIANTES);
    const porId = indice_(est.filas);
    const res = { unidos: 0, nuevos: 0, despues: 0, errores: [] };
    const asignados = {}, planes = [];
    t.filas.forEach(r => {
      if (!r.supabase_id) return;
      const c = texto_(r.confirmar);
      if (norm_(c) === 'nuevo') { res.nuevos++; return; }
      const destino = esSi_(c) ? texto_(r.id_planilla) : /^E\d+$/i.test(c) ? c.toUpperCase() : '';
      if (!destino) { res.despues++; return; }
      const e = porId[destino];
      if (!e) { res.errores.push(r.nombre_admin + ': no existe ' + destino); return; }
      if (asignados[destino] || (e.supabase_id && String(e.supabase_id) !== String(r.supabase_id))) { res.errores.push(r.nombre_admin + ': ' + destino + ' ya está unido a otro estudiante del admin'); return; }
      asignados[destino] = true;
      if (String(e.supabase_id || '') !== String(r.supabase_id)) planes.push([e, String(r.supabase_id)]);
    });
    if (res.errores.length) { const m = 'No se aplicó nada porque hay errores:\n' + res.errores.join('\n'); console.log(m); return m; }
    planes.forEach(x => { actualizar_(est, x[0], { supabase_id: x[1] }); res.unidos++; });
    PropertiesService.getScriptProperties().setProperty('ADMIN_EMPAREJADO', 'si');
    bitacora_(SES_ADMIN, 'emparejarAdmin', H.ESTUDIANTES, '', res);
    const s = sincronizar_(SES_ADMIN);
    SpreadsheetApp.flush();
    const msg = 'Unidos: ' + res.unidos + ' · Nuevos: ' + res.nuevos + ' · Quedan para después: ' + res.despues + '\n' + resumenSinc_(s);
    console.log(msg);
    return msg;
  } finally { lock.releaseLock(); }
}

// Los que quedaron con "confirmar" vacío en la revisión no se crean solos (para no duplicar a nadie).
function pendientesEmparejar_() {
  const o = {};
  if (!hojaExiste_(HOJA_EMPAREJAR)) return o;
  tabla_(HOJA_EMPAREJAR).filas.forEach(r => { if (r.supabase_id && !texto_(r.confirmar)) o[String(r.supabase_id)] = true; });
  return o;
}

// Trae planes y estudiantes del admin y actualiza la planilla. Debe correr con el lock tomado.
function sincronizar_(ses) {
  if (!adminConectado_()) throw err_('Falta el emparejamiento inicial con el admin.');
  const admin = leerAdmin_();
  const r = { planes_nuevos: 0, planes_actualizados: 0, nuevos: [], actualizados: [], inactivados: [], pendientes: 0 };
  const ahora = new Date();
  // Planes
  const tp = tabla_(H.PLANES);
  const planPorNombre = indicePorNombre_(tp.filas.filter(f => f.id));
  const nuevosPlanes = [];
  admin.planes.forEach(p => {
    const f = planPorNombre[norm_(p.nombre)];
    const activo = p.activo ? 'Sí' : 'No';
    if (!f) { nuevosPlanes.push({ id: '', nombre: p.nombre, valor_mensual: p.valor_mensual || '', activo: activo, nota: 'Del admin' }); return; }
    const c = {};
    if (f.nombre !== p.nombre) c.nombre = p.nombre;
    if (num_(f.valor_mensual) !== p.valor_mensual) c.valor_mensual = p.valor_mensual || '';
    if (String(f.activo) !== activo) c.activo = activo;
    if (Object.keys(c).length) { actualizar_(tp, f, c); r.planes_actualizados++; }
  });
  if (nuevosPlanes.length) {
    let n = numeroId_(siguienteId_(H.PLANES, 'id', 'PL', 2));
    nuevosPlanes.forEach(p => p.id = 'PL' + pad_(n++, 2));
    insertar_(H.PLANES, nuevosPlanes);
    r.planes_nuevos = nuevosPlanes.length;
  }
  // Estudiantes
  const te = tabla_(H.ESTUDIANTES);
  const porSupa = {}; te.filas.forEach(f => { if (f.supabase_id) porSupa[String(f.supabase_id)] = f; });
  const pendientes = pendientesEmparejar_();
  const vistos = {}, nuevos = [];
  let siguiente = numeroId_(siguienteId_(H.ESTUDIANTES, 'id', 'E', 3));
  admin.estudiantes.forEach(a => {
    vistos[a.supabase_id] = true;
    const activo = esActivoAdmin_(a.estado) ? 'Sí' : 'No';
    const f = porSupa[a.supabase_id];
    if (!f) {
      if (pendientes[a.supabase_id]) { r.pendientes++; return; }
      const e = { id: 'E' + pad_(siguiente++, 3), nombre: a.nombre, plan: a.plan, activo: activo, nota: 'Del admin desde ' + ymd_(ahora),
        supabase_id: a.supabase_id, estado_admin: a.estado, valor_mensual: a.valor_mensual || '', sincronizado_en: ahora };
      nuevos.push(e); r.nuevos.push(e.id + ' ' + e.nombre);
      return;
    }
    const c = {};
    if (f.nombre !== a.nombre) c.nombre = a.nombre;
    if (String(f.plan || '') !== a.plan) c.plan = a.plan;
    if (String(f.activo) !== activo) c.activo = activo;
    if (String(f.estado_admin || '') !== a.estado) c.estado_admin = a.estado;
    if (num_(f.valor_mensual) !== a.valor_mensual) c.valor_mensual = a.valor_mensual || '';
    if (!Object.keys(c).length) return;
    const antes = {}; Object.keys(c).forEach(k => antes[k] = f[k]);
    c.sincronizado_en = ahora;
    actualizar_(te, f, c);
    let renombrados = 0;
    if (c.nombre) [H.PAGOS, H.CARGOS, H.PEDIDOS, H.VENTAS].forEach(h => renombrados += renombrar_(h, f.id, c.nombre));
    r.actualizados.push(f.id + ' ' + a.nombre);
    bitacora_(ses, 'sincronizarEstudiante', H.ESTUDIANTES, f.id, { antes: antes, despues: c, registros_renombrados: renombrados });
  });
  if (nuevos.length) { insertar_(H.ESTUDIANTES, nuevos); bitacora_(ses, 'estudiantesDelAdmin', H.ESTUDIANTES, '', { nuevos: r.nuevos }); }
  // Los que ya no están en el admin (cuenta eliminada) quedan inactivos; su historial se conserva.
  te.filas.filter(f => f.supabase_id && !vistos[String(f.supabase_id)] && norm_(f.activo) !== 'no').forEach(f => {
    actualizar_(te, f, { activo: 'No', estado_admin: 'No está en el admin', sincronizado_en: ahora });
    r.inactivados.push(f.id + ' ' + f.nombre);
    bitacora_(ses, 'sincronizarEstudiante', H.ESTUDIANTES, f.id, { inactivado: 'ya no aparece en el admin' });
  });
  PropertiesService.getScriptProperties().setProperty('ADMIN_ULTIMA', ahora.toISOString());
  return r;
}

function resumenSinc_(r) {
  const partes = [];
  if (r.nuevos.length) partes.push(r.nuevos.length + ' estudiante(s) nuevo(s)');
  if (r.actualizados.length) partes.push(r.actualizados.length + ' actualizado(s)');
  if (r.inactivados.length) partes.push(r.inactivados.length + ' inactivado(s)');
  if (r.planes_nuevos || r.planes_actualizados) partes.push((r.planes_nuevos + r.planes_actualizados) + ' plan(es) actualizado(s)');
  if (r.pendientes) partes.push(r.pendientes + ' pendiente(s) por emparejar');
  return partes.length ? partes.join(' · ') : 'Todo estaba al día';
}

// Botón "Traer estudiantes del admin" de la página.
function traerDelAdmin_(d, ses) {
  const r = sincronizar_(ses);
  return { resumen: resumenSinc_(r), nuevos: r.nuevos, actualizados: r.actualizados, inactivados: r.inactivados, pendientes: r.pendientes };
}

function estadoAdmin_() {
  const p = PropertiesService.getScriptProperties();
  return { conectado: adminConectado_(), ultima: p.getProperty('ADMIN_ULTIMA') || '' };
}

/** Lo ejecuta el activador cada 15 minutos. Si alguien está guardando, espera a la próxima vuelta. */
function sincronizarAdminAuto() {
  if (!adminConectado_()) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try { const r = sincronizar_(SES_ADMIN); SpreadsheetApp.flush(); console.log(resumenSinc_(r)); }
  catch (e) { console.log('No se pudo sincronizar: ' + e.message); }
  finally { lock.releaseLock(); }
}

/** Paso 4 (editor): crea el activador de cada 15 minutos (una sola vez). */
function activarSincronizacionAuto() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'sincronizarAdminAuto').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sincronizarAdminAuto').timeBased().everyMinutes(15).create();
  console.log('Listo: los estudiantes del admin se traen cada 15 minutos.');
}
