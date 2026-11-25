import { createClient } from './supabase/server';

// Chamadas tipadas às funções analytics.alertas_* e analytics.reputacao_* (o banco calcula; permissão 'operacao').
// Valores numeric chegam como string pela API: são convertidos para number aqui.

export type SituacaoAlerta = 'atrasada' | 'em_risco' | 'prazo_desconhecido';

export interface AlertaEnvio {
  situacao: SituacaoAlerta; shipment_id: string; order_id: string | null; pack_id: string | null; item_id: string | null;
  titulo: string | null; grupo: string | null; antecedencia: number; prazo: string | null; faltam: number | null;
  status_envio: string | null; substatus: string | null; despachado: boolean; origem_prazo: OrigemPrazo | null;
}
/** De onde vem o prazo: prazo para terminar o produto, prazo do envio ou estimativa (2 dias úteis antes da entrega). */
export type OrigemPrazo = 'producao' | 'envio' | 'estimado';
export interface IndicadorReputacao {
  level_id: string | null; power_seller_status: string | null; capturado_em: string; indicador: 'reclamacoes' | 'cancelamentos' | 'atrasos';
  valor_pct: number | null; limite_pct: number | null; perto: boolean | null; acima: boolean | null;
}
export interface PontoReputacao {
  dia: string; level_id: string | null; reclamacoes: number | null; cancelamentos: number | null; atrasos: number | null;
}

const num = (v: unknown): number | null => (v == null ? null : Number(v));

async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const supabase = await createClient();
  const { data, error } = await supabase.schema('analytics').rpc(fn, args);
  if (error) {
    console.error(`[alertas] ${fn}`);
    throw new Error('Não foi possível carregar os alertas agora. Tente de novo em alguns minutos.');
  }
  return data;
}

export async function listarAlertas(tipo: 'despacho' | 'entrega'): Promise<AlertaEnvio[]> {
  const data = ((await rpc('alertas_envio', { p_tipo: tipo })) as Record<string, unknown>[] | null) ?? [];
  return data.map((l) => ({
    situacao: l.situacao as SituacaoAlerta, shipment_id: String(l.shipment_id),
    order_id: (l.order_id as string | null) ?? null, pack_id: (l.pack_id as string | null) ?? null,
    item_id: (l.item_id as string | null) ?? null, titulo: (l.titulo as string | null) ?? null,
    grupo: (l.grupo as string | null) ?? null, antecedencia: Number(l.antecedencia),
    prazo: (l.prazo as string | null) ?? null, faltam: num(l.faltam),
    status_envio: (l.status_envio as string | null) ?? null, substatus: (l.substatus as string | null) ?? null,
    despachado: l.despachado === true, origem_prazo: (l.origem_prazo as OrigemPrazo | null) ?? null,
  }));
}

export async function contarAlertas(): Promise<number> {
  return Number(await rpc('alertas_contagem', {})) || 0;
}

export async function reputacaoAtual(): Promise<IndicadorReputacao[]> {
  const data = ((await rpc('reputacao_atual', {})) as Record<string, unknown>[] | null) ?? [];
  return data.map((l) => ({
    level_id: (l.level_id as string | null) ?? null, power_seller_status: (l.power_seller_status as string | null) ?? null,
    capturado_em: String(l.capturado_em), indicador: l.indicador as IndicadorReputacao['indicador'],
    valor_pct: num(l.valor_pct), limite_pct: num(l.limite_pct),
    perto: (l.perto as boolean | null) ?? null, acima: (l.acima as boolean | null) ?? null,
  }));
}

export async function reputacaoSerie(dias = 180): Promise<PontoReputacao[]> {
  const data = ((await rpc('reputacao_serie', { p_dias: dias })) as Record<string, unknown>[] | null) ?? [];
  return data.map((l) => ({
    dia: String(l.dia), level_id: (l.level_id as string | null) ?? null,
    reclamacoes: num(l.reclamacoes), cancelamentos: num(l.cancelamentos), atrasos: num(l.atrasos),
  }));
}
