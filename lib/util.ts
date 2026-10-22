export const pesos = (n: number | string | null | undefined) => {
  const v = Number(n) || 0;
  return (v < 0 ? '−$' : '$') + Math.abs(Math.round(v)).toLocaleString('es-CO');
};

export const norm = (s: unknown) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** Fecha de hoy en Bogotá, YYYY-MM-DD */
export const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());

export const primeroDelMes = () => hoy().slice(0, 8) + '01';

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const fechaCorta = (ymd: string) => {
  const m = String(ymd || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return ymd || '';
  return `${Number(m[3])} ${MESES[Number(m[2]) - 1]}${m[1] !== hoy().slice(0, 4) ? ' ' + m[1] : ''}`;
};

/** Solo dígitos → número. "$ 150.000" → 150000 */
export const aNumero = (s: string) => Number(String(s).replace(/\D/g, '')) || 0;

export const mesActual = () => {
  const nombres = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const [, m, d] = hoy().split('-').map(Number);
  return `${nombres[m - 1]} (${d <= 15 ? 1 : 2})`;
};
