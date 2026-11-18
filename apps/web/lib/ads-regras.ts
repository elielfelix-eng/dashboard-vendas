import { pct } from './formato.ts';

// Rótulos e formatos da tela Ads (pt-BR). Funções puras, testadas com node --test.

export const ROTULO_NAO_ATRIBUIDO = 'não atribuído a anúncio';
export const AVISO_SEM_DETALHE = 'sem detalhe por anúncio neste período (a API do Mercado Livre guarda 90 dias)';

const ROAS = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ROAS como "4,37x"; nulo vira traço. */
export const roas = (v: number | null | undefined) => (v == null ? '—' : `${ROAS.format(v)}x`);

/** ACOS, TACOS e demais percentuais (pontos 0–100). */
export const percentual = pct;

/** Nome do modelo; a linha sem modelo é o que o cartão tem a mais que a tabela. */
export const rotuloModelo = (modelo: string | null | undefined) => (modelo ? modelo : ROTULO_NAO_ATRIBUIDO);

/** Aviso quando o período não tem dados por anúncio; nulo se tem. */
export const avisoSemDetalhe = (temDetalhe: boolean) => (temDetalhe ? null : AVISO_SEM_DETALHE);
