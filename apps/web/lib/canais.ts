// Canais com vendas no painel. Sem dependências: testado com node --test.
import type { Canal } from './periodo.ts';

/** Canais cujas vendas já chegam ao painel (o "consolidado" soma só estes). Shopee entra quando for conectada. */
export const CANAIS_COM_DADOS = ['mercadolivre'] as const;

/**
 * Canal cuja meta o cartão "Mês atual: realizado × meta" da Visão Geral deve usar.
 * No consolidado, compara só com a meta dos canais que já têm vendas (hoje, o Mercado Livre).
 */
export function canalMetaVisaoGeral(canal: Canal): Canal {
  return canal === 'consolidado' && CANAIS_COM_DADOS.length === 1 ? CANAIS_COM_DADOS[0] : canal;
}
