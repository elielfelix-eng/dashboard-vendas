// Períodos do dashboard (datas 'YYYY-MM-DD', horário de Brasília). Sem dependências: testado com node --test.

export type Canal = 'consolidado' | 'mercadolivre' | 'shopee';
export type PeriodoChave = 'hoje' | '7d' | '30d' | 'mes' | 'mes_anterior' | 'ano' | 'personalizado';

export interface Periodo {
  de: string;
  ate: string;
  anteriorDe: string;
  anteriorAte: string;
  rotulo: string;
}

export const CANAIS: Canal[] = ['consolidado', 'mercadolivre', 'shopee'];
export const PERIODOS: { chave: PeriodoChave; rotulo: string }[] = [
  { chave: 'hoje', rotulo: 'Hoje' },
  { chave: '7d', rotulo: '7 dias' },
  { chave: '30d', rotulo: '30 dias' },
  { chave: 'mes', rotulo: 'Mês atual' },
  { chave: 'mes_anterior', rotulo: 'Mês anterior' },
  { chave: 'ano', rotulo: 'Ano' },
  { chave: 'personalizado', rotulo: 'Personalizado' },
];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DIA = 86_400_000;

const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const addDias = (s: string, n: number) => toIso(new Date(toDate(s).getTime() + n * DIA));
const diasEntre = (de: string, ate: string) => Math.round((toDate(ate).getTime() - toDate(de).getTime()) / DIA);
const ymd = (s: string) => s.split('-').map(Number) as [number, number, number];
const montar = (y: number, m: number, d: number) => toIso(new Date(Date.UTC(y, m - 1, d)));
const fimDoMes = (y: number, m: number) => montar(y, m + 1, 0);
const valida = (s?: string) => !!s && ISO.test(s) && !Number.isNaN(toDate(s).getTime()) && toIso(toDate(s)) === s;

const dm = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;

function comRotulo(p: Omit<Periodo, 'rotulo'>): Periodo {
  return { ...p, rotulo: `${dm(p.de)} – ${dm(p.ate)} · comparado a ${dm(p.anteriorDe)} – ${dm(p.anteriorAte)}` };
}

/** Janela anterior com o mesmo número de dias, terminando na véspera de `de`. */
function anteriorMesmoTamanho(de: string, ate: string) {
  const n = diasEntre(de, ate);
  const anteriorAte = addDias(de, -1);
  return { anteriorDe: addDias(anteriorAte, -n), anteriorAte };
}

export function resolverPeriodo(chave: PeriodoChave, hoje: string, de?: string, ate?: string): Periodo {
  const [y, m, d] = ymd(hoje);
  switch (chave) {
    case 'hoje':
      return comRotulo({ de: hoje, ate: hoje, ...anteriorMesmoTamanho(hoje, hoje) });
    case '7d': {
      const ini = addDias(hoje, -6);
      return comRotulo({ de: ini, ate: hoje, ...anteriorMesmoTamanho(ini, hoje) });
    }
    case '30d': {
      const ini = addDias(hoje, -29);
      return comRotulo({ de: ini, ate: hoje, ...anteriorMesmoTamanho(ini, hoje) });
    }
    case 'mes_anterior': {
      const ini = montar(y, m - 1, 1);
      const [py, pm] = ymd(ini);
      return comRotulo({ de: ini, ate: fimDoMes(py, pm), anteriorDe: montar(py, pm - 1, 1), anteriorAte: montar(py, pm, 0) });
    }
    case 'ano': {
      const anteriorAte = d === 29 && m === 2 ? montar(y - 1, 2, 28) : montar(y - 1, m, d);
      return comRotulo({ de: montar(y, 1, 1), ate: hoje, anteriorDe: montar(y - 1, 1, 1), anteriorAte });
    }
    case 'personalizado':
      if (valida(de) && valida(ate) && de! <= ate!) return comRotulo({ de: de!, ate: ate!, ...anteriorMesmoTamanho(de!, ate!) });
      return resolverPeriodo('mes', hoje);
    case 'mes':
    default: {
      const anteriorDe = montar(y, m - 1, 1);
      const [py, pm] = ymd(anteriorDe);
      const fimAnterior = fimDoMes(py, pm);
      const mesmoDia = montar(py, pm, d);
      return comRotulo({
        de: montar(y, m, 1), ate: hoje, anteriorDe,
        anteriorAte: mesmoDia > fimAnterior || ymd(mesmoDia)[1] !== pm ? fimAnterior : mesmoDia,
      });
    }
  }
}

type Params = Record<string, string | string[] | undefined>;
const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function lerFiltros(searchParams: Params, hoje: string): { canal: Canal; chave: PeriodoChave; periodo: Periodo } {
  const c = um(searchParams.canal);
  const p = um(searchParams.periodo);
  const canal = CANAIS.includes(c as Canal) ? (c as Canal) : 'consolidado';
  const chave = PERIODOS.some((x) => x.chave === p) ? (p as PeriodoChave) : 'mes';
  return { canal, chave, periodo: resolverPeriodo(chave, hoje, um(searchParams.de), um(searchParams.ate)) };
}

export function hojeBrasilia(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}
