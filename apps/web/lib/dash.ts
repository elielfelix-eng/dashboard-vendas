import { cache } from 'react';
import { createClient } from './supabase/server';
import { medir } from './tempo';
import type { Canal } from './periodo';
import { shopeeAtiva, type CoberturaShopee } from './canais';

// Chamadas tipadas às funções analytics.dash_* (o banco calcula; RLS e permissões valem).
// Valores numeric chegam como string pela API: são convertidos para number aqui.

export interface Resumo {
  pedidos: number; vendas_brutas: number; unidades: number; ticket_medio: number;
  cancelados: number; devolvidos: number; pct_cancel_devol: number; receita: number;
  comissao: number; frete: number; parcelamento: number; product_ads: number; seguidores: number;
  estornos: number; difal: number; outras: number;
  custo_produto: number | null; imposto: number | null; embalagem: number | null;
  margem_bruta: number | null; margem_contribuicao: number | null; pedidos_sem_custo: number | null;
  canceladas_valor: number; devolvidas_valor: number; estimados: number;
}
export interface LinhaMensal extends Resumo { mes: string }
export interface LinhaAlerta { codigo: string | null; tipo: 'sem_custo' | 'faixa_atual'; pedidos: number }
export type Abc = 'A' | 'B' | 'C' | 'prejuizo' | null;
export interface SeriePonto { periodo: string; vendas_brutas: number; pedidos: number; receita: number }
export interface LinhaModelo {
  modelo: string; pedidos: number; unidades: number; vendas_brutas: number; ticket_medio: number;
  pct_cancel_devol: number; receita: number; custo_produto: number | null; tarifas_frete: number;
  custos_rateados: number; imposto_embalagem: number | null; contribuicao: number | null;
  contribuicao_pct: number | null; abc: Abc; sem_custo: number | null; produto: string | null; abc_receita: Abc;
  foto: string | null; link: string | null;
}
export interface LinhaSku {
  sku: string; kit: number | null; pedidos: number; unidades: number; vendas_brutas: number;
  receita: number; custo_produto: number | null; contribuicao: number | null;
  modelo: string | null; produto: string | null; tarifas_frete: number; contribuicao_pct: number | null; abc: Abc; abc_receita: Abc;
  foto: string | null; link: string | null;
}
export interface LinhaPedido {
  order_id: string; data_venda: string; sku: string | null; sku_anuncio: string | null; qtd: number;
  valor_venda: number; classe: string; custo_produto: number | null; alerta_custo: string | null;
}
export interface LinhaMeta {
  mes: string; situacao: 'realizado' | 'em_andamento' | 'projetado'; realizado: number | null;
  crescimento_pct: number | null; crescimento_editado: boolean | null; projecao: number | null; meta: number | null;
}
export type Grao = 'dia' | 'semana' | 'mes';
export type CanalMeta = Canal | 'brindedobem';

const TEXTO = new Set(['modelo', 'sku', 'sku_anuncio', 'order_id', 'data_venda', 'classe', 'alerta_custo', 'abc', 'abc_receita',
  'periodo', 'mes', 'situacao', 'produto', 'codigo', 'tipo', 'foto', 'link', 'canal']);

function numeros<T>(linha: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(linha)) {
    out[k] = v == null || typeof v === 'boolean' || TEXTO.has(k) ? v : Number(v);
  }
  return out as T;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const supabase = await createClient();
  const { data, error } = await medir(fn, async () => supabase.schema('analytics').rpc(fn, args));
  if (error) {
    console.error(`[dash] ${fn}:`, error.message);
    throw new Error('Não foi possível carregar os dados agora. Tente de novo em alguns minutos.');
  }
  return ((data as Record<string, unknown>[] | null) ?? []).map((l) => numeros<T>(l));
}

export async function resumo(canal: Canal, de: string, ate: string): Promise<Resumo> {
  return (await rpc<Resumo>('dash_resumo', { p_canal: canal, p_de: de, p_ate: ate }))[0];
}
export const serie = (canal: Canal, de: string, ate: string, grao: Grao) =>
  rpc<SeriePonto>('dash_serie', { p_canal: canal, p_de: de, p_ate: ate, p_grao: grao });
export const modelos = (canal: Canal, de: string, ate: string) =>
  rpc<LinhaModelo>('dash_modelos', { p_canal: canal, p_de: de, p_ate: ate });
export const skus = (canal: Canal, de: string, ate: string, modelo: string | null) =>
  rpc<LinhaSku>('dash_skus', { p_canal: canal, p_de: de, p_ate: ate, p_modelo: modelo });
export const resultadoMensal = (canal: Canal, de: string, ate: string) =>
  rpc<LinhaMensal>('dash_resultado_mensal', { p_canal: canal, p_de: de, p_ate: ate });
export const alertas = (canal: Canal, de: string, ate: string) =>
  rpc<LinhaAlerta>('dash_alertas', { p_canal: canal, p_de: de, p_ate: ate });
export const pedidos = (canal: Canal, de: string, ate: string, modelo: string | null) =>
  rpc<LinhaPedido>('dash_pedidos', { p_canal: canal, p_de: de, p_ate: ate, p_modelo: modelo });
export const metas = (canal: CanalMeta, ano: number) =>
  rpc<LinhaMeta>('dash_metas', { p_canal: canal, p_ano: ano });

export interface Sincronizacao {
  status: string; quando: string | null; ultimoSucesso: string | null; stats: Record<string, unknown> | null;
  /** Texto do erro da última execução (só para classificar, ex.: autorização da Shopee vencida; nunca mostrado inteiro). */
  erro: string | null;
}

const ERRO_CARGA = 'Não foi possível carregar os dados agora. Tente de novo em alguns minutos.';

/**
 * Última sincronização de cada fonte (para o selo "Atualizado às" e o aviso de falha). Uma consulta por
 * requisição (o layout e a página usam a mesma). Erro do banco vira exceção, como em rpc().
 */
export const sincronizacoes = cache(async (): Promise<Record<string, Sincronizacao>> => {
  const supabase = await createClient();
  const { data, error } = await medir('sync_runs', async () => supabase
    .schema('core')
    .from('sync_runs')
    .select('source, status, started_at, finished_at, stats, error')
    .order('started_at', { ascending: false })
    .limit(60));
  if (error) {
    console.error('[dash] sync_runs:', error.message);
    throw new Error(ERRO_CARGA);
  }
  const out: Record<string, Sincronizacao> = {};
  for (const r of data ?? []) {
    const quando = (r.finished_at ?? r.started_at) as string | null;
    if (!out[r.source]) {
      out[r.source] = { status: r.status, quando, ultimoSucesso: null, stats: (r.stats as Record<string, unknown> | null) ?? null, erro: (r.error as string | null) ?? null };
    }
    if (r.status === 'success' && !out[r.source].ultimoSucesso) out[r.source].ultimoSucesso = quando;
  }
  return out;
});

/** Data (Brasília) de um timestamp ISO. */
const diaBrasilia = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(iso));

/**
 * Loja da Shopee conectada (core.accounts), canal liberado para o perfil (core.can_see_channel) e o primeiro dia
 * com venda guardada (para mostrar "sem dados da Shopee" em vez de zero antes disso). Uma vez por requisição.
 * Erro do banco vira exceção (a tela mostra o erro, nunca "sem dados").
 */
const lojaShopee = cache(async (): Promise<Omit<CoberturaShopee, 'ultimoSucesso'>> => {
  const supabase = await createClient();
  const [contas, primeira, canal] = await Promise.all([
    medir('shopee_conta', async () => supabase.schema('core').from('accounts').select('id').eq('channel', 'shopee').eq('active', true).limit(1)),
    medir('shopee_primeira_venda', async () => supabase.schema('mkt').from('orders').select('date_created').eq('channel', 'shopee')
      .order('date_created', { ascending: true }).limit(1)),
    medir('can_see_channel', async () => supabase.schema('core').rpc('can_see_channel', { ch: 'shopee' })),
  ]);
  const erro = contas.error ?? primeira.error ?? canal.error;
  if (erro) {
    console.error('[dash] cobertura da Shopee:', erro.message);
    throw new Error(ERRO_CARGA);
  }
  const d = primeira.data?.[0]?.date_created as string | undefined;
  return { conectada: (contas.data ?? []).length > 0, inicio: d ? diaBrasilia(d) : null, visivel: canal.data === true };
});

/** O perfil vê o canal Shopee (para os avisos da Shopee no layout). */
export const veShopee = async () => (await lojaShopee()).visivel;

/**
 * Sincronizações e situação da Shopee de uma vez (consultas em paralelo, para entrar no Promise.all da tela).
 * `ativa`: o botão da Shopee aparece nos filtros (loja conectada, sincronizada, canal liberado e com vendas).
 */
export async function sincEShopee(): Promise<{ sinc: Record<string, Sincronizacao>; shopee: { cob: CoberturaShopee; ativa: boolean } }> {
  const [sinc, loja] = await Promise.all([sincronizacoes(), lojaShopee()]);
  const cob: CoberturaShopee = { ...loja, ultimoSucesso: sinc.shopee?.ultimoSucesso ?? null };
  return { sinc, shopee: { cob, ativa: shopeeAtiva(cob) && !!cob.inicio && cob.visivel } };
}

/** Crescimento por canal (analytics.crescimento_canal, migration 0022). Uma chamada por tela: no consolidado
 *  o banco calcula 3 períodos × 2 canais de uma vez. */
export interface LinhaCrescimento {
  canal: 'mercadolivre' | 'shopee';
  vendas_atual: number; vendas_anterior: number | null; vendas_ano_passado: number | null;
  margem_pos_ads_atual: number | null; margem_pos_ads_anterior: number | null;
  pct_crescimento: number | null; pct_queda: number | null;
}
export const crescimentoCanal = (canal: Canal, de: string, ate: string, anteriorDe: string, anteriorAte: string) =>
  rpc<LinhaCrescimento>('crescimento_canal', { p_canal: canal, p_de: de, p_ate: ate, p_anterior_de: anteriorDe, p_anterior_ate: anteriorAte });
