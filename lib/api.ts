// Cliente del backend en Google Apps Script.
// POST sin Content-Type para que el navegador no haga la consulta previa de CORS.

export const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
const LLAVE_SESION = 'vox-registros-sesion';

export type Sesion = { token: string; nombre: string; rol: string };

export class ErrorApi extends Error {
  codigo: string;
  constructor(mensaje: string, codigo = '') {
    super(mensaje);
    this.codigo = codigo;
  }
}

let alCerrarSesion: (() => void) | null = null;
export function cuandoSeCierreSesion(fn: () => void) {
  alCerrarSesion = fn;
}

export function leerSesion(): Sesion | null {
  try {
    const raw = localStorage.getItem(LLAVE_SESION);
    return raw ? (JSON.parse(raw) as Sesion) : null;
  } catch {
    return null;
  }
}

function guardarSesion(s: Sesion | null) {
  try {
    if (s) localStorage.setItem(LLAVE_SESION, JSON.stringify(s));
    else localStorage.removeItem(LLAVE_SESION);
  } catch {
    /* el navegador no deja guardar: la sesión dura mientras la pestaña esté abierta */
  }
}

let sesionMemoria: Sesion | null = null;

async function enviar(cuerpo: unknown) {
  if (!API_URL) throw new ErrorApi('Falta configurar la dirección del backend (NEXT_PUBLIC_API_URL).');
  let res: Response;
  try {
    res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(cuerpo) });
  } catch {
    throw new ErrorApi('No hay conexión. Revisa el internet e intenta de nuevo.', 'red');
  }
  let json: { ok: boolean; data?: unknown; error?: string; codigo?: string };
  try {
    json = await res.json();
  } catch {
    throw new ErrorApi('El servidor respondió algo inesperado. Intenta de nuevo.', 'respuesta');
  }
  if (!json.ok) throw new ErrorApi(json.error || 'Error desconocido', json.codigo || '');
  return json.data;
}

export async function entrar(usuario: string, clave: string): Promise<Sesion> {
  const d = (await enviar({ accion: 'login', usuario, clave })) as Sesion;
  const s = { token: d.token, nombre: d.nombre, rol: d.rol };
  sesionMemoria = s;
  guardarSesion(s);
  return s;
}

export async function salir() {
  const s = sesionMemoria || leerSesion();
  sesionMemoria = null;
  guardarSesion(null);
  if (s) {
    try {
      await enviar({ accion: 'logout', token: s.token });
    } catch {
      /* da igual si falla */
    }
  }
}

export async function api<T = any>(accion: string, datos: Record<string, unknown> = {}): Promise<T> {
  const s = sesionMemoria || leerSesion();
  if (!s) {
    alCerrarSesion?.();
    throw new ErrorApi('Tu sesión terminó. Vuelve a entrar.', 'sesion');
  }
  try {
    return (await enviar({ accion, token: s.token, datos })) as T;
  } catch (e) {
    if (e instanceof ErrorApi && e.codigo === 'sesion') {
      sesionMemoria = null;
      guardarSesion(null);
      alCerrarSesion?.();
    }
    throw e;
  }
}
