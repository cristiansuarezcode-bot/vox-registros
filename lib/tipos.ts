export type Estudiante = { id: string; nombre: string; plan: string };
export type Producto = { id: string; nombre: string; precio: number; stock?: number | null };
export type Plan = { id: string; nombre: string; valor_mensual: number };
export type PrendaCat = { id: string; nombre: string; precio: number; incluye: string[] };
export type Concepto = { id: string; nombre: string; valor_base: number; usa_cargos: string };
export type Profe = { id: string; nombre: string; valor_clase: number };
export type Cuenta = { id: string; nombre: string; tipo: string; sugerida_dias: string };

export type Catalogos = {
  usuario: { nombre: string; rol: string };
  hoy: string;
  estudiantes: Estudiante[];
  productos: Producto[];
  prendas: PrendaCat[];
  conceptos: Concepto[];
  profes: Profe[];
  cuentas: Cuenta[];
  cuentas_todas?: string[];
  planes?: Plan[];
  cuenta_sugerida: string;
  listas: Record<string, (string | number)[]>;
};

/** A quién se le registra algo: un estudiante de la lista o una persona escrita a mano. */
export type Quien = { estudiante_id?: string; persona?: string; nombre: string } | null;
