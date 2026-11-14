// Filtros do CRM lidos da URL. Sem imports de servidor: testado com node --test.
import { PERIODOS, resolverPeriodo, type Periodo, type PeriodoChave } from './periodo.ts';

type Params = Record<string, string | string[] | undefined>;
const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const texto = (v: string | string[] | undefined) => {
  const t = um(v)?.trim();
  return t ? t : null;
};

export function lerFiltrosCrm(
  params: Params,
  hoje: string,
): { chave: PeriodoChave; periodo: Periodo; area: string | null; vendedor: number | null; origem: string | null } {
  const p = um(params.periodo);
  const chave = PERIODOS.some((x) => x.chave === p) ? (p as PeriodoChave) : 'mes';
  const v = texto(params.vendedor);
  const vendedor = v && /^\d+$/.test(v) && Number(v) > 0 && Number.isSafeInteger(Number(v)) ? Number(v) : null;
  return {
    chave,
    periodo: resolverPeriodo(chave, hoje, um(params.de), um(params.ate)),
    area: texto(params.area),
    vendedor,
    origem: texto(params.origem),
  };
}
