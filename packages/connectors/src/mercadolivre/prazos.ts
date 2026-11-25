/**
 * Leitura dos prazos de envio e da reputação do vendedor (funções puras).
 * Prazos: YYYY-MM-DD em America/Sao_Paulo. Eventos: ISO.
 */

export interface PrazosEnvio {
  status: string | null;
  substatus: string | null;
  prazoDespacho: string | null;
  prazoEntrega: string | null;
  despachadoEm: string | null;
  entregueEm: string | null;
}

export interface Reputacao {
  levelId: string | null;
  powerSellerStatus: string | null;
  reclamacoesPct: number | null;
  cancelamentosPct: number | null;
  atrasosPct: number | null;
  vendasPeriodo: number | null;
  periodo: string | null;
}

type Obj = Record<string, unknown>;
type Origem = 'envio' | 'sla';

/**
 * ESCOLHA DOS CAMPOS (ordem padrão do plano). CONFIRMAR contra
 * docs/alertas/levantamento-ml.md; para mudar, edite só esta constante.
 * Caminho = chaves aninhadas a partir do objeto de origem; vale o primeiro que trouxer data válida.
 */
export const CAMPOS_PRAZO: Record<'despacho' | 'entrega' | 'despachadoEm' | 'entregueEm', { origem: Origem; caminho: string[] }[]> = {
  despacho: [
    { origem: 'sla', caminho: ['expected_date'] },
    { origem: 'envio', caminho: ['lead_time', 'estimated_handling_limit', 'date'] },
  ],
  entrega: [
    { origem: 'envio', caminho: ['lead_time', 'estimated_delivery_time', 'date'] },
    { origem: 'envio', caminho: ['lead_time', 'estimated_delivery_final', 'date'] },
  ],
  // Eventos: não definidos no plano; suposição (status_history do envio). Conferir no levantamento.
  despachadoEm: [{ origem: 'envio', caminho: ['status_history', 'date_shipped'] }],
  entregueEm: [{ origem: 'envio', caminho: ['status_history', 'date_delivered'] }],
};

function obj(v: unknown): Obj | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function pegar(base: unknown, caminho: string[]): unknown {
  let cur: unknown = base;
  for (const k of caminho) {
    const o = obj(cur);
    if (!o) return undefined;
    cur = o[k];
  }
  return cur;
}

const FMT_BRT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
});

function diaBrasilia(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const t = new Date(s);
  if (Number.isNaN(t.getTime())) return null;
  return FMT_BRT.format(t);
}

function iso(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const t = new Date(s);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

function primeiro<T>(
  campos: { origem: Origem; caminho: string[] }[], envio: unknown, sla: unknown, conv: (v: unknown) => T | null,
): T | null {
  for (const c of campos) {
    const r = conv(pegar(c.origem === 'sla' ? sla : envio, c.caminho));
    if (r != null) return r;
  }
  return null;
}

export function lerPrazosEnvio(envio: unknown, sla: unknown): PrazosEnvio {
  const e = obj(envio);
  return {
    status: str(e?.status),
    substatus: str(e?.substatus),
    prazoDespacho: primeiro(CAMPOS_PRAZO.despacho, envio, sla, diaBrasilia),
    prazoEntrega: primeiro(CAMPOS_PRAZO.entrega, envio, sla, diaBrasilia),
    despachadoEm: primeiro(CAMPOS_PRAZO.despachadoEm, envio, sla, iso),
    entregueEm: primeiro(CAMPOS_PRAZO.entregueEm, envio, sla, iso),
  };
}

/**
 * SUPOSIÇÃO (formato real a confirmar no levantamento): valor <= 1 é fração
 * (x100); valor > 1 já é percentual.
 */
export function paraPercentual(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  const p = v <= 1 ? v * 100 : v;
  return Math.round(p * 1e6) / 1e6;
}

export function lerReputacao(sellerReputation: unknown): Reputacao {
  const r = obj(sellerReputation);
  const m = obj(r?.metrics);
  const vendas = obj(m?.sales);
  const completed = vendas?.completed;
  return {
    levelId: str(r?.level_id),
    powerSellerStatus: str(r?.power_seller_status),
    reclamacoesPct: paraPercentual(obj(m?.claims)?.rate),
    cancelamentosPct: paraPercentual(obj(m?.cancellations)?.rate),
    atrasosPct: paraPercentual(obj(m?.delayed_handling_time)?.rate),
    vendasPeriodo: typeof completed === 'number' && Number.isFinite(completed) ? completed : null,
    periodo: str(vendas?.period),
  };
}
