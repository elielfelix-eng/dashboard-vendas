// Quantos dias de métricas de Ads por anúncio buscar de novo a cada sincronização.
// O ML continua atribuindo vendas ao dia do clique por alguns dias depois; com só 3 dias,
// essas vendas ficavam de fora (outubro/2026: receita 7,6% abaixo do painel, custo igual).
// A API guarda 90 dias (inclui hoje), por isso o máximo é 89.
export const ADS_DIAS_PADRAO = 30;
export const ADS_DIAS_MAX = 89;

export function diasRebuscaAds(valor: string | undefined, primeiraVez: boolean): number {
  if (primeiraVez) return ADS_DIAS_MAX;
  const n = Number((valor ?? '').trim());
  if (!Number.isInteger(n) || n < 1) return ADS_DIAS_PADRAO;
  return Math.min(n, ADS_DIAS_MAX);
}
