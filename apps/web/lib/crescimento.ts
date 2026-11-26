// Crescimento e sugestao por canal (projeto Shopee, Tarefa 6). Funcoes puras, sem acesso a banco.
// Os dados vem de analytics.crescimento_canal (migration 0022); os percentuais, de core.parametros_crescimento.
//
// Regra aprovada (spec 2026-11-24-shopee, "Sugestao por canal"), com a decisao do dono de 26/11:
//   * reduzir: vendas caem pct_queda% ou mais em qualquer comparativo, ou margem depois do Ads negativa;
//   * investir_mais: vendas crescem pct_crescimento% ou mais em todos os comparativos disponiveis, com a
//     margem depois do Ads positiva e nao caindo (atual >= anterior);
//   * manter: qualquer outro caso;
//   * sem_historico: sem vendas no periodo anterior (nao ha base para o crescimento nem para a margem
//     "nao caindo"). Sem vendas no mesmo periodo do ano passado, mas com o periodo anterior, a sugestao
//     usa so o periodo anterior e o motivo avisa "sem dado do ano passado".
// Bordas: o limite exato conta (10% conta; 9,99% nao conta). As variacoes sao arredondadas em 6 casas
// antes da comparacao, para que o ruido do ponto flutuante nao mude a sugestao.

export type Sugestao = 'investir_mais' | 'manter' | 'reduzir' | 'sem_historico';

export type DadosCrescimento = {
  vendas_atual: number | null;
  vendas_anterior: number | null;
  vendas_ano_passado: number | null;
  /** Margem depois do Ads em % da receita; nula sem a permissao 'custos'. */
  margem_pos_ads_atual: number | null;
  margem_pos_ads_anterior: number | null;
};

export type ParametrosCrescimento = { pct_crescimento: number; pct_queda: number };

export const PARAMETROS_CRESCIMENTO_PADRAO: ParametrosCrescimento = { pct_crescimento: 10, pct_queda: 10 };

const arred = (x: number) => Math.round(x * 1e6) / 1e6;

/** Variacao % de atual sobre a referencia; nula quando a referencia nao tem vendas. */
export function variacaoVendas(atual: number | null, referencia: number | null): number | null {
  if (referencia == null || !(referencia > 0)) return null;
  return arred((((atual ?? 0) - referencia) / referencia) * 100);
}

// Trunca em direcao ao zero: o numero exibido nunca passa do limite (9,99% vira 9,9%, nunca 10,0%).
const truncar = (v: number, casas: number) => {
  const f = 10 ** casas;
  return Math.trunc(Math.round(Math.abs(v) * 1e6) / (1e6 / f)) / f;
};
const decimal = (v: number, casas: number) => v.toFixed(casas).replace('.', ',');
const fmtVariacao = (v: number) => `${v < 0 ? '-' : '+'}${decimal(truncar(v, 1), 1)}%`;
const fmtMargem = (v: number) => {
  const t = truncar(v, 1);
  const casas = t === 0 && v !== 0 ? 2 : 1;
  return `${v < 0 ? '-' : ''}${decimal(truncar(v, casas), casas)}%`;
};

export function sugestaoCrescimento(dados: DadosCrescimento, parametros: ParametrosCrescimento): { sugestao: Sugestao; motivo: string } {
  const vAnt = variacaoVendas(dados.vendas_atual, dados.vendas_anterior);
  const vAno = variacaoVendas(dados.vendas_atual, dados.vendas_ano_passado);

  if (vAnt == null) {
    return {
      sugestao: 'sem_historico',
      motivo: vAno == null
        ? 'Sem vendas no período anterior nem no mesmo período do ano passado para comparar'
        : 'Sem vendas no período anterior para comparar',
    };
  }

  const comparativos = vAno == null ? [vAnt] : [vAnt, vAno];
  const mAtual = dados.margem_pos_ads_atual;
  const mAnt = dados.margem_pos_ads_anterior;

  let motivo = vAno == null
    ? `Vendas ${fmtVariacao(vAnt)} sobre o período anterior (sem dado do ano passado)`
    : `Vendas ${fmtVariacao(vAnt)} sobre o período anterior e ${fmtVariacao(vAno)} sobre o ano passado`;
  if (mAtual != null) {
    motivo += `; margem depois do Ads de ${fmtMargem(mAtual)}`;
    if (mAnt != null && mAtual < mAnt) motivo += ` (era ${fmtMargem(mAnt)})`;
  }

  const queda = comparativos.some((v) => v <= -parametros.pct_queda);
  const margemNegativa = mAtual != null && mAtual < 0;
  if (queda || margemNegativa) return { sugestao: 'reduzir', motivo };

  const cresce = comparativos.every((v) => v >= parametros.pct_crescimento);
  const margemBoa = mAtual != null && mAtual > 0 && mAnt != null && mAtual >= mAnt;
  if (cresce && margemBoa) return { sugestao: 'investir_mais', motivo };

  return { sugestao: 'manter', motivo };
}

/** O que a tela mostra: sem 'custos' (decisao do dono) ou sem parametros vigentes, nem sugestao nem motivo. */
export function sugestaoParaTela(dados: DadosCrescimento, parametros: ParametrosCrescimento | null, verCustos: boolean) {
  if (!verCustos || !parametros) return null;
  return sugestaoCrescimento(dados, parametros);
}

// ---------------------------------------------------------------------
// Parametros editaveis (tela de Parametros, so o administrador)
// ---------------------------------------------------------------------
export const CAMPOS_CRESCIMENTO: { chave: keyof ParametrosCrescimento; rotulo: string; max?: number }[] = [
  { chave: 'pct_crescimento', rotulo: 'Investir mais: crescimento mínimo das vendas (%)' },
  { chave: 'pct_queda', rotulo: 'Reduzir: queda mínima das vendas (%)', max: 100 },
];

const lerNumero = (v: unknown): number => {
  const t = String(v ?? '').trim();
  if (t === '') return NaN;
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
};

export type ResultadoParametrosCrescimento =
  | { ok: true; valores: ParametrosCrescimento }
  | { ok: false; erro: string };

export function validarParametrosCrescimento(entrada: Record<string, unknown>): ResultadoParametrosCrescimento {
  const valores = {} as ParametrosCrescimento;
  for (const c of CAMPOS_CRESCIMENTO) {
    const n = lerNumero(entrada[c.chave]);
    const nome = c.rotulo.replace(/\s*\(.*\)\s*$/, '');
    if (!Number.isFinite(n)) return { ok: false, erro: `Preencha "${nome}" com um número, por exemplo 10 ou 7,5.` };
    if (n <= 0) return { ok: false, erro: `"${nome}" deve ser maior que zero.` };
    if (c.max !== undefined && n > c.max) return { ok: false, erro: `"${nome}" não pode passar de ${c.max}.` };
    valores[c.chave] = n;
  }
  return { ok: true, valores };
}
