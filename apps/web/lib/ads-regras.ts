import { brl, pct } from './formato.ts';

// Rótulos e formatos da tela Ads (pt-BR). Funções puras, testadas com node --test.

export const ROTULO_NAO_ATRIBUIDO = 'não atribuído a anúncio';
export const ROTULO_SEM_CAMPANHA = 'não atribuído a campanha';
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

const juntar = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`);

/**
 * Aviso quando a última sincronização do Mercado Livre falhou em alguma parte do Ads
 * (stats de core.sync_runs, jobs/src/sync-mercadolivre.ts): ads_campaign_days / ads_items = -1
 * (investimento e métricas incompletos) e erro_ads_campanhas / erro_ads_anuncios (cadastro e pausa).
 * Nulo se nada falhou.
 */
export function avisoFalhaAds(stats: Record<string, unknown> | null | undefined): string | null {
  if (!stats) return null;
  const dados: string[] = [];
  if (Number(stats.ads_campaign_days) === -1) dados.push('o investimento por campanha');
  if (Number(stats.ads_items) === -1) dados.push('as métricas por anúncio');
  const cadastro: string[] = [];
  if (stats.erro_ads_campanhas) cadastro.push('as campanhas');
  if (stats.erro_ads_anuncios) cadastro.push('o status dos anúncios');
  if (!dados.length && !cadastro.length) return null;
  const efeito = dados.length
    ? 'Os números de Ads dos últimos dias podem estar incompletos'
    : 'O status de pausa e as campanhas podem estar desatualizados';
  return `A última atualização não conseguiu buscar ${juntar([...dados, ...cadastro])} do Mercado Livre. ${efeito}; a próxima atualização tenta de novo.`;
}

const CANAIS_URL = new Set(['consolidado', 'mercadolivre', 'shopee']);
const DATA_URL = /^\d{4}-\d{2}-\d{2}$/;

/** URL de volta à aba Orçamento depois de salvar, mantendo só canal/período válidos (lista fechada de chaves). */
export function urlRetornoOrcamento(filtros: Record<string, unknown>, tipo: 'ok' | 'erro', msg: string): string {
  const q = new URLSearchParams();
  const s = (k: string) => (typeof filtros[k] === 'string' ? (filtros[k] as string) : '');
  if (CANAIS_URL.has(s('canal'))) q.set('canal', s('canal'));
  if (/^[a-z0-9_]{1,20}$/.test(s('periodo'))) q.set('periodo', s('periodo'));
  for (const k of ['de', 'ate']) if (DATA_URL.test(s(k))) q.set(k, s(k));
  q.set('aba', 'orcamento');
  q.set(tipo, msg);
  return `/ads?${q.toString()}`;
}

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

// ---- Orçamento do mês (aba Orçamento) ----
export interface LinhaOrcamento {
  canal: string; orcamento: number | null; gasto_mes: number; gasto_product_ads: number; gasto_seguidores: number; gasto_ate_ontem: number;
  dias_mes: number; dias_completos: number; dias_restantes: number; pct_gasto: number | null; pct_mes: number; projecao: number | null;
  saldo: number | null; valor_diario: number | null; alerta: 'estouro' | 'sobra' | null;
}
export type EstadoOrcamento = 'sem_orcamento' | 'esgotado' | 'primeiro_dia' | 'normal';

export function estadoOrcamento(o: LinhaOrcamento): EstadoOrcamento {
  if (o.orcamento == null) return 'sem_orcamento';
  if (o.gasto_mes >= o.orcamento) return 'esgotado';
  if (o.projecao == null) return 'primeiro_dia';
  return 'normal';
}

/** Aviso de estouro (vermelho) ou sobra (amarelo); nulo se não há alerta ou não há projeção. */
export function textoAlertaOrcamento(o: LinhaOrcamento): { tom: 'ruim' | 'alerta'; texto: string } | null {
  if (o.orcamento == null || o.projecao == null) return null;
  if (o.alerta === 'estouro') {
    return { tom: 'ruim', texto: `No ritmo atual o mês fecha em ${brl(o.projecao)}, ${brl(o.projecao - o.orcamento)} acima do orçamento.` };
  }
  if (o.alerta === 'sobra') {
    return { tom: 'alerta', texto: `No ritmo atual o mês fecha em ${brl(o.projecao)}, ${brl(o.orcamento - o.projecao)} abaixo do orçamento: verba sobrando.` };
  }
  return null;
}

export function textoValorDiario(o: LinhaOrcamento): string | null {
  const e = estadoOrcamento(o);
  if (e === 'sem_orcamento') return null;
  if (e === 'esgotado') return 'Orçamento do mês esgotado.';
  return o.valor_diario == null ? null : `Pode gastar ${brl(o.valor_diario)} por dia até o fim do mês.`;
}

/** 1º dia do mês seguinte a `hoje` (YYYY-MM-DD). */
/** Soma a série diária do Ads por mês. O ponto de cada mês vem com `dia` = primeiro dia do mês (AAAA-MM-01). */
export function agregarSeriePorMes(serie: { dia: string; investimento: number; vendas_ads: number }[]) {
  const porMes = new Map<string, { investimento: number; vendas_ads: number }>();
  for (const p of serie) {
    const mes = `${p.dia.slice(0, 7)}-01`;
    const acumulado = porMes.get(mes) ?? { investimento: 0, vendas_ads: 0 };
    acumulado.investimento += p.investimento;
    acumulado.vendas_ads += p.vendas_ads;
    porMes.set(mes, acumulado);
  }
  return [...porMes.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([dia, v]) => ({ dia, investimento: Math.round(v.investimento * 100) / 100, vendas_ads: Math.round(v.vendas_ads * 100) / 100 }));
}

export function primeiroDiaProximoMes(hoje: string): string {
  const a = Number(hoje.slice(0, 4)), m = Number(hoje.slice(5, 7));
  return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01`;
}

export type ResultadoOrcamento =
  | { ok: true; valores: { channel: string; vigente_desde: string; valor_mensal: number } }
  | { ok: false; erro: string };

export function validarOrcamento(e: Record<string, unknown>): ResultadoOrcamento {
  const channel = String(e.channel ?? '');
  if (channel !== 'mercadolivre' && channel !== 'shopee') return { ok: false, erro: 'Escolha o canal.' };
  const data = String(e.vigente_desde ?? '');
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(data) && new Date(`${data}T00:00:00Z`).toISOString().slice(0, 10) === data;
  if (!ok) return { ok: false, erro: 'Informe a data a partir da qual o orçamento vale.' };
  const t = String(e.valor_mensal ?? '').trim();
  const n = t === '' ? NaN : Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  if (!Number.isFinite(n)) return { ok: false, erro: 'Informe o valor mensal com um número, por exemplo 5000 ou 5.000,50.' };
  if (n <= 0) return { ok: false, erro: 'O valor mensal precisa ser maior que zero.' };
  return { ok: true, valores: { channel, vigente_desde: data, valor_mensal: Math.round(n * 100) / 100 } };
}
