// Campos e validacao dos limites de Ads (core.parametros_ads). Funcao pura, sem acesso a banco.
export type ChaveLimite =
  | 'pausar_gasto_min' | 'pausar_cliques_min' | 'min_dias_dados' | 'revisar_cliques_min'
  | 'revisar_conversao_max_pct' | 'escalar_folga_pp' | 'escalar_unidades_min' | 'testar_margem_min_pct'
  | 'testar_unidades_min' | 'teste_reserva_pct' | 'teste_max_modelos' | 'reduzir_fator' | 'teto_fator'
  | 'alerta_sobra_pct';

export type CampoLimite = {
  chave: ChaveLimite;
  rotulo: string;
  inteiro: boolean;
  min: number;
  max?: number;
  padrao: number;
};

export const CAMPOS_LIMITES: CampoLimite[] = [
  { chave: 'pausar_gasto_min', rotulo: 'Pausar: gasto mínimo sem venda (R$)', inteiro: false, min: 0, padrao: 50 },
  { chave: 'pausar_cliques_min', rotulo: 'Pausar: cliques mínimos sem venda (cliques)', inteiro: true, min: 0, padrao: 100 },
  { chave: 'min_dias_dados', rotulo: 'Dias mínimos de dados para sugerir (dias)', inteiro: true, min: 0, padrao: 7 },
  { chave: 'revisar_cliques_min', rotulo: 'Revisar: cliques mínimos (cliques)', inteiro: true, min: 0, padrao: 100 },
  { chave: 'revisar_conversao_max_pct', rotulo: 'Revisar: conversão máxima (%)', inteiro: false, min: 0, max: 100, padrao: 1 },
  { chave: 'escalar_folga_pp', rotulo: 'Escalar: folga mínima sobre o ACOS de equilíbrio (pontos percentuais)', inteiro: false, min: 0, max: 100, padrao: 10 },
  { chave: 'escalar_unidades_min', rotulo: 'Escalar: unidades vendidas mínimas (unidades)', inteiro: true, min: 0, padrao: 3 },
  { chave: 'testar_margem_min_pct', rotulo: 'Testar: margem mínima (%)', inteiro: false, min: 0, max: 100, padrao: 20 },
  { chave: 'testar_unidades_min', rotulo: 'Testar: unidades vendidas mínimas (unidades)', inteiro: true, min: 0, padrao: 3 },
  { chave: 'teste_reserva_pct', rotulo: 'Reserva para teste (% do valor diário)', inteiro: false, min: 0, max: 100, padrao: 10 },
  { chave: 'teste_max_modelos', rotulo: 'Máximo de modelos em teste (modelos)', inteiro: true, min: 0, padrao: 5 },
  { chave: 'reduzir_fator', rotulo: 'Reduzir: fator aplicado ao orçamento (0 a 1)', inteiro: false, min: 0, max: 1, padrao: 0.7 },
  { chave: 'teto_fator', rotulo: 'Teto por modelo (× gasto médio)', inteiro: false, min: 1, padrao: 2 },
  { chave: 'alerta_sobra_pct', rotulo: 'Alerta de sobra de orçamento (% do valor diário)', inteiro: false, min: 0, max: 100, padrao: 80 },
];

const lerNumero = (v: unknown): number => {
  const t = String(v ?? '').trim();
  if (t === '') return NaN;
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
};

export type ResultadoLimites =
  | { ok: true; valores: Record<ChaveLimite, number> }
  | { ok: false; erro: string };

export function validarLimites(entrada: Record<string, unknown>): ResultadoLimites {
  const valores = {} as Record<ChaveLimite, number>;
  for (const c of CAMPOS_LIMITES) {
    const n = lerNumero(entrada[c.chave]);
    const nome = c.rotulo.replace(/\s*\(.*\)\s*$/, '');
    if (!Number.isFinite(n)) return { ok: false, erro: `Preencha "${nome}" com um número, por exemplo 5 ou 1,5.` };
    if (n < c.min) return { ok: false, erro: `"${nome}" não pode ser menor que ${c.min}.` };
    if (c.max !== undefined && n > c.max) return { ok: false, erro: `"${nome}" não pode passar de ${c.max}.` };
    if (c.inteiro && !Number.isInteger(n)) return { ok: false, erro: `"${nome}" deve ser um número inteiro.` };
    valores[c.chave] = n;
  }
  return { ok: true, valores };
}
