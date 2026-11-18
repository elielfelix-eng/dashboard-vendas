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

// Sugestões por modelo (calculadas no banco; aqui só rótulo, tom e contagem).
export type SugestaoAds = 'pausar' | 'reduzir' | 'revisar' | 'escalar' | 'testar' | 'manter';
export type TomSugestao = 'ruim' | 'alerta' | 'bom' | 'info' | 'neutro';

/** Ordem fixa de exibição dos filtros rápidos e da ordenação da coluna. */
export const ORDEM_SUGESTOES: readonly SugestaoAds[] = ['pausar', 'reduzir', 'revisar', 'escalar', 'testar', 'manter'];

const ROTULOS: Record<SugestaoAds, string> = {
  pausar: 'Pausar', reduzir: 'Reduzir', revisar: 'Revisar anúncio', escalar: 'Escalar', testar: 'Testar Ads', manter: 'Manter',
};
const TONS: Record<SugestaoAds, TomSugestao> = {
  pausar: 'ruim', reduzir: 'ruim', revisar: 'alerta', escalar: 'bom', testar: 'info', manter: 'neutro',
};

export const rotuloSugestao = (s: SugestaoAds | null | undefined) => (s ? ROTULOS[s] : '—');
export const tomSugestao = (s: SugestaoAds | null | undefined): TomSugestao => (s ? TONS[s] : 'neutro');
/** Posição na ordem de exibição; sem sugestão vem depois de todas. */
export const ordemSugestao = (s: SugestaoAds | null | undefined) => (s ? ORDEM_SUGESTOES.indexOf(s) : ORDEM_SUGESTOES.length);

/** Quantos modelos há por sugestão; ignora sem sugestão e a linha "não atribuído". */
export function contarSugestoes(linhas: { modelo: string | null; sugestao: SugestaoAds | null }[]): Record<SugestaoAds, number> {
  const c = { pausar: 0, reduzir: 0, revisar: 0, escalar: 0, testar: 0, manter: 0 };
  for (const l of linhas) if (l.modelo != null && l.sugestao != null) c[l.sugestao]++;
  return c;
}

/** Lê ?sug= da URL; valor desconhecido vira nulo (sem filtro). */
export function lerSugestao(v: string | string[] | undefined): SugestaoAds | null {
  const x = Array.isArray(v) ? v[0] : v;
  return ORDEM_SUGESTOES.find((s) => s === x) ?? null;
}
