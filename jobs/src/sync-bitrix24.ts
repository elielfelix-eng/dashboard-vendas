/**
 * Sincronização do CRM (Bitrix24) → schema crm.
 * Só lê do Bitrix (*.list, *.fields, *.get e batch). Os leads vêm só das origens
 * ativas do Brinde do Bem e sem dados pessoais; os negócios, só do funil 10.
 * A URL do webhook nunca aparece em log nem em erro (o cliente usa "bitrix:<método>").
 */
import {
  BitrixClient, CAMPOS_DEAL, CAMPOS_LEAD, FUNIL_BRINDE, chunk, domingoEmBrasilia, mapDeal, mapHistorico,
  mapLead, mapStage, mapUser, mapaAreas, origensNovas, paraFiltroBitrix, separarNegocios,
  type BitrixResponse,
} from '@dash/connectors';
import { requireEnv, upsert, type Sql } from './db.ts';

const HORA = 3_600_000;
const LOTE = 500;

type Item = { ID: string } & Record<string, unknown>;
type Linha = Record<string, unknown>;

export async function syncBitrix24(sql: Sql): Promise<number> {
  const [run] = await sql<{ id: number }[]>`insert into core.sync_runs (source) values ('bitrix24') returning id`;
  const stats = {
    leads: 0, leads_origens_novas: 0, deals: 0, fora_do_funil: 0, historico: 0, atividades: 0, apagados: 0,
    origens: [] as string[],
  };
  try {
    const bx = new BitrixClient(requireEnv('BITRIX_WEBHOOK_URL'));
    const agora = new Date();

    const [last] = await sql<{ started_at: Date; stats: { origens?: unknown } | null }[]>`
      select started_at, stats from core.sync_runs where source = 'bitrix24' and status = 'success'
       order by started_at desc limit 1`;
    const completa = !last?.started_at;
    const desde = completa ? null : paraFiltroBitrix(new Date(last.started_at!.getTime() - HORA));
    console.log(`[Bitrix] ${completa ? 'carga completa' : `incremental desde ${desde}`}`);

    const areas = await syncConfiguracao(sql, bx, agora);

    const origens = (await sql<{ source_id: string }[]>`
      select source_id from crm.origens_brinde where ativo`).map((o) => o.source_id).sort();
    stats.origens = origens;
    if (!origens.length) console.warn('[Bitrix] Nenhuma origem ativa em crm.origens_brinde: leads não sincronizados.');
    else {
      stats.leads = await syncLeads(sql, bx, origens, desde, agora);
      // Origem ativada depois da última execução com sucesso: os leads antigos dela
      // não chegam pelo >DATE_MODIFY, então ganham uma busca completa só dessas origens.
      if (!completa) {
        const anteriores = Array.isArray(last?.stats?.origens) ? (last!.stats!.origens as unknown[]).map(String) : null;
        const novas = origensNovas(origens, anteriores);
        if (novas.length) {
          console.log(`[Bitrix] origens novas (${novas.join(', ')}): buscando todos os leads delas`);
          stats.leads_origens_novas = await syncLeads(sql, bx, novas, null, agora);
        }
      }
    }

    const negocios = await syncNegocios(sql, bx, areas, desde, agora);
    stats.deals = negocios.gravados;
    stats.fora_do_funil = negocios.removidos.size;

    stats.historico = await syncHistorico(sql, bx, negocios.removidos, agora);
    stats.atividades = await syncPrimeiraAtividade(sql, bx, completa ? 365 : 30, agora);

    if (completa || domingoEmBrasilia(agora)) stats.apagados = await reconciliar(sql, bx, origens);

    await sql`update core.sync_runs set status = 'success', finished_at = now(), stats = ${sql.json(stats)} where id = ${run.id}`;
    console.log('[Bitrix] OK', stats);
    return 0;
  } catch (err) {
    const msg = (err as Error).message;
    console.error('[Bitrix] ERRO:', msg);
    await sql`update core.sync_runs set status = 'error', finished_at = now(), error = ${msg}, stats = ${sql.json(stats)} where id = ${run.id}`;
    return 1;
  }
}

/** Remove linhas repetidas pela chave (o upsert falha com a mesma chave duas vezes no mesmo INSERT). */
function unicos<T>(rows: T[], chave: (r: T) => string): T[] {
  return [...new Map(rows.map((r) => [chave(r), r])).values()];
}

/** Funis, etapas, origens, áreas de negócio e usuários. Devolve o mapa das áreas. */
async function syncConfiguracao(sql: Sql, bx: BitrixClient, agora: Date): Promise<Map<string, string>> {
  type Funis = { categories: { id: number; name: string }[] };
  const funis: Funis['categories'] = [];
  for (let start: number | undefined = 0; start !== undefined;) {
    const r: BitrixResponse<Funis> = await bx.call<Funis>('crm.category.list', { entityTypeId: 2, start });
    funis.push(...(r.result?.categories ?? []));
    start = r.next;
  }
  await upsert(sql, 'crm.pipelines', unicos(funis.map((c) => ({ category_id: Number(c.id), nome: c.name, synced_at: agora })),
    (r) => String(r.category_id)), ['category_id']);

  const status = await bx.listarTudo<Record<string, string | null>>('crm.status.list', { order: { ENTITY_ID: 'ASC', SORT: 'ASC' } });
  const etapas = status
    .filter((s) => s.ENTITY_ID === 'STATUS' || s.ENTITY_ID === `DEAL_STAGE_${FUNIL_BRINDE}`)
    .map((s) => ({ ...mapStage(s), synced_at: agora }));
  await upsert(sql, 'crm.stages', unicos(etapas, (r) => `${r.entity}|${r.status_id}`), ['entity', 'status_id']);
  const origens = status
    .filter((s) => s.ENTITY_ID === 'SOURCE' && s.STATUS_ID)
    .map((s) => ({ status_id: String(s.STATUS_ID), nome: s.NAME ?? null, synced_at: agora }));
  await upsert(sql, 'crm.sources', unicos(origens, (r) => r.status_id), ['status_id']);

  const campos = (await bx.call<Record<string, { items?: { ID: string; VALUE: string }[] }>>('crm.deal.fields')).result ?? {};
  const areas = mapaAreas(campos);
  if (!areas.size) console.warn('[Bitrix] Campo Área de Negócio sem opções: a área ficará vazia.');

  const usuarios = await bx.listarTudo<Record<string, unknown>>('user.get', {});
  await upsert(sql, 'crm.users', unicos(usuarios.map((u) => ({ ...mapUser(u), synced_at: agora })), (r) => String(r.bitrix_id)),
    ['bitrix_id']);
  console.log(`[Bitrix] configuração: ${funis.length} funis, ${etapas.length} etapas, ${origens.length} origens, ${usuarios.length} usuários`);
  return areas;
}

/** Junta as páginas e grava de 500 em 500. */
function gravarEmLotes(gravar: (rows: Linha[]) => Promise<unknown>) {
  let buf: Linha[] = [];
  let total = 0;
  return {
    async add(rows: Linha[]) {
      buf.push(...rows);
      total += rows.length;
      if (buf.length >= LOTE) { await gravar(buf); buf = []; }
    },
    async fim() {
      if (buf.length) await gravar(buf);
      buf = [];
      return total;
    },
  };
}

async function syncLeads(sql: Sql, bx: BitrixClient, origens: string[], desde: string | null, agora: Date) {
  const filter = { '@SOURCE_ID': origens, ...(desde ? { '>DATE_MODIFY': desde } : {}) };
  const lote = gravarEmLotes((rows) => upsert(sql, 'crm.leads', rows, ['id']));
  for await (const pagina of bx.listarPorId<Item>('crm.lead.list', { filter, select: CAMPOS_LEAD })) {
    await lote.add(pagina.map((r) => ({ ...mapLead(r), deleted_at: null, synced_at: agora })));
  }
  return lote.fim();
}

/**
 * Negócios. O incremental NÃO filtra por funil: um negócio movido do funil 10 para
 * outro só é percebido assim. Esses saem de crm.deals e do crm.stage_history.
 */
async function syncNegocios(sql: Sql, bx: BitrixClient, areas: Map<string, string>, desde: string | null, agora: Date) {
  const filter = desde ? { '>DATE_MODIFY': desde } : { CATEGORY_ID: FUNIL_BRINDE };
  const removidos = new Set<number>();
  const lote = gravarEmLotes((rows) => upsert(sql, 'crm.deals', rows, ['id']));
  for await (const pagina of bx.listarPorId<Item>('crm.deal.list', { filter, select: CAMPOS_DEAL })) {
    const { manter, remover } = separarNegocios(pagina.map((r) => mapDeal(r, areas)));
    for (const id of remover) removidos.add(id);
    await lote.add(manter.map((d) => ({ ...d, deleted_at: null, synced_at: agora })));
  }
  const gravados = await lote.fim();
  if (removidos.size) {
    const ids = [...removidos];
    await sql.begin(async (tx) => {
      const t = tx as unknown as Sql;
      await t`delete from crm.stage_history where deal_id = any(${t.array(ids)}::bigint[])`;
      const r = await t`delete from crm.deals where id = any(${t.array(ids)}::bigint[])`;
      if (r.count) console.log(`[Bitrix] ${r.count} negócio(s) saíram do funil ${FUNIL_BRINDE} e foram removidos`);
    });
  }
  return { gravados, removidos };
}

/** Histórico de etapas do funil 10, a partir do maior ID já gravado. */
async function syncHistorico(sql: Sql, bx: BitrixClient, removidos: Set<number>, agora: Date) {
  const [{ maior }] = await sql<{ maior: string | null }[]>`select max(id)::text as maior from crm.stage_history`;
  const filter = { CATEGORY_ID: FUNIL_BRINDE, ...(maior ? { '>ID': maior } : {}) };
  const lote = gravarEmLotes((rows) => upsert(sql, 'crm.stage_history', rows, ['id']));
  for await (const pagina of bx.listarPorId<Item>(
    'crm.stagehistory.list',
    { entityTypeId: 2, filter, select: ['ID', 'OWNER_ID', 'STAGE_ID', 'CREATED_TIME'] },
    { itens: (r) => ((r as { items?: Item[] } | null)?.items ?? []) },
  )) {
    const linhas = pagina.map(mapHistorico).filter((h) => h.deal_id === null || !removidos.has(h.deal_id));
    await lote.add(linhas.map((h) => ({ ...h, synced_at: agora })));
  }
  return lote.fim();
}

/** 1ª atividade dos leads recentes que ainda não a têm (lotes de 50 comandos por batch). */
async function syncPrimeiraAtividade(sql: Sql, bx: BitrixClient, dias: number, agora: Date) {
  const pendentes = (await sql<{ id: string }[]>`
    select l.id::text as id from crm.leads l
     where l.deleted_at is null
       and l.date_create >= now() - make_interval(days => ${dias})
       and not exists (select 1 from crm.first_activity f where f.lead_id = l.id)
     order by l.id`).map((r) => r.id);
  console.log(`[Bitrix] 1ª atividade: ${pendentes.length} leads a consultar`);
  const lote = gravarEmLotes((rows) => upsert(sql, 'crm.first_activity', rows, ['lead_id']));
  let falhas = 0;
  for (const grupo of chunk(pendentes, 50)) {
    const cmds: Record<string, [string, Record<string, unknown>]> = {};
    for (const id of grupo) {
      cmds[`l${id}`] = ['crm.activity.list', {
        filter: { OWNER_TYPE_ID: 1, OWNER_ID: id }, order: { CREATED: 'ASC' }, select: ['OWNER_ID', 'CREATED'], start: -1,
      }];
    }
    const { result, erros } = await bx.batch<{ OWNER_ID: string; CREATED: string }[]>(cmds);
    falhas += Object.keys(erros).length;
    const linhas: Linha[] = [];
    for (const id of grupo) {
      const primeira = result[`l${id}`]?.[0];
      if (primeira?.CREATED) linhas.push({ lead_id: Number(id), primeira_em: primeira.CREATED, synced_at: agora });
    }
    await lote.add(linhas);
  }
  if (falhas) console.warn(`[Bitrix] 1ª atividade: ${falhas} consulta(s) falharam (serão tentadas de novo)`);
  return lote.fim();
}

async function listarIds(bx: BitrixClient, method: string, filter: Record<string, unknown>) {
  const ids: number[] = [];
  for await (const pagina of bx.listarPorId<Item>(method, { filter, select: ['ID'] })) ids.push(...pagina.map((r) => Number(r.ID)));
  return ids;
}

/**
 * Reconciliação (domingo ou carga completa): quem está no banco e não existe mais no
 * Bitrix (ou saiu das origens/funil) recebe deleted_at; quem voltou perde o deleted_at.
 * Lista vazia não apaga nada (proteção contra resposta incompleta).
 */
async function reconciliar(sql: Sql, bx: BitrixClient, origens: string[]) {
  let apagados = 0;
  const marcar = async (tabela: 'crm.leads' | 'crm.deals', ids: number[]) => {
    if (!ids.length) { console.warn(`[Bitrix] reconciliação de ${tabela}: nenhum ID recebido, nada foi marcado`); return; }
    const arr = sql.array(ids);
    const r = await sql`update ${sql(tabela)} set deleted_at = now()
                         where deleted_at is null and not (id = any(${arr}::bigint[]))`;
    await sql`update ${sql(tabela)} set deleted_at = null where deleted_at is not null and id = any(${arr}::bigint[])`;
    apagados += r.count;
  };
  if (origens.length) await marcar('crm.leads', await listarIds(bx, 'crm.lead.list', { '@SOURCE_ID': origens }));
  else console.warn('[Bitrix] reconciliação de leads pulada: nenhuma origem ativa');
  await marcar('crm.deals', await listarIds(bx, 'crm.deal.list', { CATEGORY_ID: FUNIL_BRINDE }));
  console.log(`[Bitrix] reconciliação: ${apagados} registro(s) marcados como apagados`);
  return apagados;
}
