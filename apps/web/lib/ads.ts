import { createClient } from './supabase/server';
import type { Canal } from './periodo';

// Chamadas tipadas às funções analytics.ads_* (o banco calcula; RLS e permissões valem).
// Valores numeric chegam como string pela API: são convertidos para number aqui.

export interface AdsResumo {
  investimento: number; vendas_ads: number; roas: number | null; acos: number | null; tacos: number | null;
  pct_vendas_ads: number | null; vendas_brutas_canal: number; nao_atribuido: number; tem_detalhe: boolean;
}
export interface AdsSeriePonto { dia: string; investimento: number; vendas_ads: number }
import type { SugestaoAds } from './ads-regras';
export type { SugestaoAds };
export interface AdsModelo {
  modelo: string | null; produto: string | null; foto: string | null; investimento: number;
  impressoes: number; cliques: number; ctr: number | null; cpc: number | null; conversao: number | null;
  vendas_ads: number; unidades_ads: number; acos: number | null;
  acos_equilibrio: number | null; lucro_pos_ads: number | null; contribuicao_pct: number | null;
  sugestao: SugestaoAds | null; motivo: string | null; pausado: boolean | null; campanha_id: string | null; modo: string | null;
}
export interface AdsCampanha {
  campanha_id: string; nome: string; status: string | null; automatica: boolean | null;
  orcamento_diario: number | null; roas_target: number | null; acos_equivalente: number | null;
  investimento: number; vendas_ads: number; acos: number | null; roas: number | null;
  modelos: number | null; modo: string | null;
}

const TEXTO = new Set(['modelo', 'produto', 'foto', 'sugestao', 'motivo', 'campanha_id', 'nome', 'status', 'modo', 'dia']);

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
    console.error(`[ads] ${fn}`);
    throw new Error('Não foi possível carregar os dados de Ads agora. Tente de novo em alguns minutos.');
  }
  return ((data as Record<string, unknown>[] | null) ?? []).map((l) => numeros<T>(l));
}

export async function adsResumo(canal: Canal, de: string, ate: string): Promise<AdsResumo> {
  return (await rpc<AdsResumo>('ads_resumo', { p_canal: canal, p_de: de, p_ate: ate }))[0];
}
export const adsSerie = (canal: Canal, de: string, ate: string) =>
  rpc<AdsSeriePonto>('ads_serie', { p_canal: canal, p_de: de, p_ate: ate });
export const adsModelos = (canal: Canal, de: string, ate: string) =>
  rpc<AdsModelo>('ads_modelos', { p_canal: canal, p_de: de, p_ate: ate });
export const adsCampanhas = (canal: Canal, de: string, ate: string) =>
  rpc<AdsCampanha>('ads_campanhas', { p_canal: canal, p_de: de, p_ate: ate });

// Orçamento do mês (sempre o mês corrente; independe do período escolhido na tela).
import type { LinhaOrcamento } from './ads-regras';
export type { LinhaOrcamento };
export const adsOrcamento = (canal: Canal) => rpc<LinhaOrcamento>('ads_orcamento', { p_canal: canal });

export interface VigenciaOrcamento { channel: string; vigente_desde: string; valor_mensal: number }
/** Histórico de vigências (leitura liberada a quem está logado). */
export async function orcamentoVigencias(): Promise<VigenciaOrcamento[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.schema('core').from('orcamento_ads')
    .select('channel, vigente_desde, valor_mensal').order('channel').order('vigente_desde', { ascending: false });
  if (error) {
    console.error('[ads] orcamento_ads');
    throw new Error('Não foi possível carregar o orçamento agora. Tente de novo em alguns minutos.');
  }
  return (data ?? []).map((l) => ({ channel: l.channel as string, vigente_desde: l.vigente_desde as string, valor_mensal: Number(l.valor_mensal) }));
}
