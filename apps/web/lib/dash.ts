import { createClient } from './supabase/server';
import type { Canal } from './periodo';

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
}
export interface LinhaSku {
  sku: string; kit: number | null; pedidos: number; unidades: number; vendas_brutas: number;
  receita: number; custo_produto: number | null; contribuicao: number | null;
  modelo: string | null; produto: string | null; tarifas_frete: number; contribuicao_pct: number | null; abc: Abc; abc_receita: Abc;
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
  'periodo', 'mes', 'situacao', 'produto', 'codigo', 'tipo']);

function numeros<T>(linha: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(linha)) {
    out[k] = v == null || typeof v === 'boolean' || TEXTO.has(k) ? v : Number(v);
  }
  return out as T;
}

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.schema('analytics').rpc(fn, args);
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

/** Última sincronização de cada fonte (para o selo "Atualizado às" e o aviso de falha). */
export async function sincronizacoes(): Promise<Record<string, { status: string; quando: string | null; ultimoSucesso: string | null }>> {
  const supabase = await createClient();
  const { data } = await supabase
    .schema('core')
    .from('sync_runs')
    .select('source, status, started_at, finished_at')
    .order('started_at', { ascending: false })
    .limit(60);
  const out: Record<string, { status: string; quando: string | null; ultimoSucesso: string | null }> = {};
  for (const r of data ?? []) {
    const quando = (r.finished_at ?? r.started_at) as string | null;
    if (!out[r.source]) out[r.source] = { status: r.status, quando, ultimoSucesso: null };
    if (r.status === 'success' && !out[r.source].ultimoSucesso) out[r.source].ultimoSucesso = quando;
  }
  return out;
}
