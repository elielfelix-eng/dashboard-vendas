import { createClient } from './supabase/server';
import type { lerFiltrosCrm } from './crm-filtros';

// Chamadas tipadas às funções analytics.crm_* (o banco calcula; RLS e permissões valem).
// Valores numeric chegam como string pela API: são convertidos para number aqui.

export type FiltrosCrm = ReturnType<typeof lerFiltrosCrm>;

export interface LinhaResumoCrm {
  leads_novos: number; leads_com_negocio: number; negocios_coorte: number; ganhos_coorte: number;
  ganhos: number; perdidos: number; valor_ganho: number | null; ciclo_medio_dias: number | null;
}
export interface LinhaFunil { ordem: number; etapa: string; quantidade: number }
export interface LinhaEtapa {
  status_id: string; nome: string; ordem: number | null; em_aberto: number; valor_aberto: number | null;
  tempo_medio_dias: number | null; gargalo: boolean;
}
export interface LinhaMotivoPerda { status_id: string; motivo: string; perdidos: number; pct: number | null }
/** bitrix_id é null nas linhas "Média da equipe" e "Sem responsável". */
export interface LinhaVendedor {
  bitrix_id: number | null; vendedor: string; leads: number; primeiro_contato_horas: number | null;
  sem_contato: number; negocios: number; ganhos: number; perdidos: number; conversao: number | null;
  valor_ganho: number | null; ticket_medio: number | null;
}
export interface LinhaOrigem {
  source_id: string; origem: string; leads: number; pct_negocio: number | null; pct_ganho: number | null;
  valor_ganho: number | null; ticket_medio: number | null;
}
export interface LinhaOpcao { tipo: 'area' | 'vendedor' | 'origem'; valor: string; rotulo: string }

const TEXTO = new Set(['etapa', 'status_id', 'nome', 'motivo', 'vendedor', 'source_id', 'origem', 'tipo', 'valor', 'rotulo']);

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
    console.error(`[crm] ${fn}:`, error.message);
    throw new Error('Não foi possível carregar os dados agora. Tente de novo em alguns minutos.');
  }
  return ((data as Record<string, unknown>[] | null) ?? []).map((l) => numeros<T>(l));
}

const args = (f: FiltrosCrm, de?: string, ate?: string) => ({
  p_de: de ?? f.periodo.de,
  p_ate: ate ?? f.periodo.ate,
  p_area: f.area,
  p_vendedor: f.vendedor,
  p_origem: f.origem,
});

export const resumo = (f: FiltrosCrm, de?: string, ate?: string) => rpc<LinhaResumoCrm>('crm_resumo', args(f, de, ate));
export const funil = (f: FiltrosCrm, de?: string, ate?: string) => rpc<LinhaFunil>('crm_funil', args(f, de, ate));
export const etapas = (f: FiltrosCrm, de?: string, ate?: string) => rpc<LinhaEtapa>('crm_etapas', args(f, de, ate));
export const motivosPerda = (f: FiltrosCrm, de?: string, ate?: string) => rpc<LinhaMotivoPerda>('crm_motivos_perda', args(f, de, ate));
export const vendedores = (f: FiltrosCrm, de?: string, ate?: string) => rpc<LinhaVendedor>('crm_vendedores', args(f, de, ate));
export const origens = (f: FiltrosCrm, de?: string, ate?: string) => rpc<LinhaOrigem>('crm_origens', args(f, de, ate));
export const opcoes = (_f?: FiltrosCrm, _de?: string, _ate?: string) => rpc<LinhaOpcao>('crm_opcoes', {});
