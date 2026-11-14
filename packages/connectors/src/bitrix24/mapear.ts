/**
 * Conversão das respostas do Bitrix24 para as linhas das tabelas crm.*.
 * Funções puras: '' e null viram null, IDs viram number e as datas ficam como a
 * string ISO recebida (com o fuso, ex. +03:00), que o Postgres grava como timestamptz.
 */

/** Campo do negócio "Área de Negócio" (enumeração). */
export const CAMPO_AREA = 'UF_CRM_1740402485';

/** Campos buscados dos leads: sem título, e-mail nem telefone (privacidade). */
export const CAMPOS_LEAD = [
  'ID', 'STATUS_ID', 'SOURCE_ID', 'ASSIGNED_BY_ID', 'DATE_CREATE', 'DATE_MODIFY', 'DATE_CLOSED',
  'CONTACT_ID', 'COMPANY_ID', 'OPPORTUNITY',
];

/** Campos buscados dos negócios (o único UF_* é a Área de Negócio). */
export const CAMPOS_DEAL = [
  'ID', 'CATEGORY_ID', 'STAGE_ID', 'STAGE_SEMANTIC_ID', 'SOURCE_ID', 'ASSIGNED_BY_ID', 'LEAD_ID',
  'CONTACT_ID', 'COMPANY_ID', 'OPPORTUNITY', 'CURRENCY_ID', 'DATE_CREATE', 'DATE_MODIFY', 'CLOSEDATE',
  'CLOSED', CAMPO_AREA,
];

/** Funil do Brinde do Bem. */
export const FUNIL_BRINDE = 10;

type Bruto = Record<string, unknown>;

export interface LinhaLead {
  id: number; status_id: string | null; source_id: string | null; assigned_by_id: number | null;
  date_create: string | null; date_modify: string | null; date_closed: string | null;
  contact_id: number | null; company_id: number | null; opportunity: number | null;
}

export interface LinhaDeal {
  id: number; category_id: number | null; stage_id: string | null; stage_semantic_id: string | null;
  source_id: string | null; assigned_by_id: number | null; lead_id: number | null; contact_id: number | null;
  company_id: number | null; opportunity: number | null; currency_id: string | null; date_create: string | null;
  date_modify: string | null; closedate: string | null; closed: boolean | null; area: string | null;
}

export type Semantica = 'andamento' | 'ganho' | 'perdido';

export interface LinhaStage {
  entity: 'lead' | 'deal'; status_id: string; category_id: number | null; nome: string | null;
  ordem: number | null; semantica: Semantica;
}

export interface LinhaHistorico { id: number; deal_id: number | null; stage_id: string | null; entrou_em: string | null }

export interface LinhaUser { bitrix_id: number; nome: string | null; email: string | null; ativo: boolean | null }

/** Texto: '' / null / undefined → null. */
function txt(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v);
  return s === '' ? null : s;
}

/** Número: '' / null / não numérico → null. */
function num(v: unknown): number | null {
  const s = txt(v);
  if (s === null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function id(v: unknown): number {
  const n = num(v);
  if (n === null) throw new Error(`Bitrix: registro sem ID válido (${String(v)})`);
  return n;
}

function simNao(v: unknown): boolean | null {
  if (v === true || v === 'Y') return true;
  if (v === false || v === 'N') return false;
  return null;
}

export function semantica(s: { SEMANTICS?: string | null }): Semantica {
  if (s.SEMANTICS === 'S') return 'ganho';
  if (s.SEMANTICS === 'F') return 'perdido';
  return 'andamento';
}

export function mapLead(r: Bruto): LinhaLead {
  return {
    id: id(r.ID), status_id: txt(r.STATUS_ID), source_id: txt(r.SOURCE_ID), assigned_by_id: num(r.ASSIGNED_BY_ID),
    date_create: txt(r.DATE_CREATE), date_modify: txt(r.DATE_MODIFY), date_closed: txt(r.DATE_CLOSED),
    contact_id: num(r.CONTACT_ID), company_id: num(r.COMPANY_ID), opportunity: num(r.OPPORTUNITY),
  };
}

export function mapDeal(r: Bruto, areas: Map<string, string>): LinhaDeal {
  const bruta = r[CAMPO_AREA];
  const areaId = txt(Array.isArray(bruta) ? bruta[0] : bruta);
  return {
    id: id(r.ID), category_id: num(r.CATEGORY_ID), stage_id: txt(r.STAGE_ID), stage_semantic_id: txt(r.STAGE_SEMANTIC_ID),
    source_id: txt(r.SOURCE_ID), assigned_by_id: num(r.ASSIGNED_BY_ID), lead_id: num(r.LEAD_ID),
    contact_id: num(r.CONTACT_ID), company_id: num(r.COMPANY_ID), opportunity: num(r.OPPORTUNITY),
    currency_id: txt(r.CURRENCY_ID), date_create: txt(r.DATE_CREATE), date_modify: txt(r.DATE_MODIFY),
    closedate: txt(r.CLOSEDATE), closed: simNao(r.CLOSED), area: areaId === null ? null : (areas.get(areaId) ?? null),
  };
}

/** Etapa de `crm.status.list`: ENTITY_ID 'STATUS' = lead; 'DEAL_STAGE_<n>' = negócio do funil n. */
export function mapStage(s: Bruto & { SEMANTICS?: string | null }): LinhaStage {
  const ent = String(s.ENTITY_ID ?? '');
  const lead = ent === 'STATUS';
  const funil = ent.match(/^DEAL_STAGE_(\d+)$/)?.[1];
  return {
    entity: lead ? 'lead' : 'deal',
    status_id: String(s.STATUS_ID),
    category_id: lead ? null : (num(s.CATEGORY_ID) ?? (funil ? Number(funil) : null)),
    nome: txt(s.NAME),
    ordem: num(s.SORT),
    semantica: semantica(s),
  };
}

export function mapHistorico(h: Bruto): LinhaHistorico {
  return { id: id(h.ID), deal_id: num(h.OWNER_ID), stage_id: txt(h.STAGE_ID), entrou_em: txt(h.CREATED_TIME) };
}

export function mapUser(u: Bruto): LinhaUser {
  const nome = [txt(u.NAME), txt(u.LAST_NAME)].filter(Boolean).join(' ').trim();
  return { bitrix_id: id(u.ID), nome: nome || null, email: txt(u.EMAIL), ativo: simNao(u.ACTIVE) };
}

/** Mapa ID do item → rótulo da Área de Negócio, a partir de `crm.deal.fields`. */
export function mapaAreas(campos: Record<string, { items?: { ID: string | number; VALUE: string }[]; [k: string]: unknown } | undefined>): Map<string, string> {
  return new Map((campos[CAMPO_AREA]?.items ?? []).map((i) => [String(i.ID), i.VALUE]));
}

/** Negócios do funil 10 ficam; os que vieram de outro funil (foram movidos) saem do banco. */
export function separarNegocios<T extends Pick<LinhaDeal, 'id' | 'category_id'>>(rows: T[]): { manter: T[]; remover: number[] } {
  const manter: T[] = [];
  const remover: number[] = [];
  for (const r of rows) {
    if (r.category_id === FUNIL_BRINDE) manter.push(r);
    else remover.push(r.id);
  }
  return { manter, remover };
}

/** Hoje é domingo no horário de Brasília? */
export function domingoEmBrasilia(d: Date): boolean {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }).format(d) === 'Sun';
}

/** Data para filtros do Bitrix (ex. >DATE_MODIFY), em UTC com fuso explícito e sem milissegundos. */
export function paraFiltroBitrix(d: Date): string {
  return d.toISOString().slice(0, 19) + '+00:00';
}
