import type { PrazosEnvio, Reputacao } from '@dash/connectors';
import type { Sql } from './db.ts';

/** Envios de pedidos pagos dos últimos 45 dias cujo prazo ainda não está salvo ou não está em estado final. */
export async function enviosParaAtualizar(sql: Sql, limite = 1500): Promise<string[]> {
  const rows = await sql<{ shipment_id: string }[]>`
    select o.shipment_id
      from mkt.orders o
      left join mkt.envios_prazos p on p.channel = o.channel and p.shipment_id = o.shipment_id
     where o.channel = 'mercadolivre' and o.status = 'paid' and o.shipment_id is not null
       and o.date_created >= now() - interval '45 days'
       and (p.shipment_id is null or p.status is null
            or p.status not in ('delivered', 'not_delivered', 'cancelled', 'sem_envio'))
     group by o.shipment_id
     order by min(o.date_created) asc
     limit ${limite}`;
  return rows.map((r) => r.shipment_id);
}

/** Upsert dos prazos. `null` (envio inexistente/sem acesso) vira status 'sem_envio', que conta como final. */
export async function salvarPrazos(sql: Sql, accountId: string, shipmentId: string, p: PrazosEnvio | null): Promise<void> {
  const status = p ? p.status : 'sem_envio';
  await sql`
    insert into mkt.envios_prazos
      (channel, shipment_id, account_id, status, substatus, prazo_despacho, prazo_entrega, despachado_em, entregue_em, atualizado_em)
    values
      ('mercadolivre', ${shipmentId}, ${accountId}, ${status ?? null}, ${p?.substatus ?? null}, ${p?.prazoDespacho ?? null},
       ${p?.prazoEntrega ?? null}, ${p?.despachadoEm ?? null}, ${p?.entregueEm ?? null}, now())
    on conflict (channel, shipment_id) do update set
      account_id = excluded.account_id, status = excluded.status, substatus = excluded.substatus,
      prazo_despacho = excluded.prazo_despacho, prazo_entrega = excluded.prazo_entrega,
      despachado_em = excluded.despachado_em, entregue_em = excluded.entregue_em, atualizado_em = now()`;
}

/** Foto da reputação (taxas já em percentual, como vêm do conector). */
export async function salvarReputacao(sql: Sql, accountId: string, r: Reputacao): Promise<void> {
  await sql`
    insert into mkt.reputacao_fotos
      (account_id, level_id, power_seller_status, reclamacoes_taxa, cancelamentos_taxa, atrasos_taxa, vendas_periodo, periodo)
    values
      (${accountId}, ${r.levelId ?? null}, ${r.powerSellerStatus ?? null}, ${r.reclamacoesPct ?? null},
       ${r.cancelamentosPct ?? null}, ${r.atrasosPct ?? null}, ${r.vendasPeriodo ?? null}, ${r.periodo ?? null})`;
}

/**
 * Busca e grava os prazos de cada envio pendente, isolando cada um: a falha de um (429, timeout, 5xx)
 * é contada e não impede os demais. O log mostra só um rótulo e a mensagem, sem token nem corpo.
 */
export async function atualizarPrazos(
  sql: Sql, ml: { getPrazosEnvio(id: string): Promise<PrazosEnvio | null> }, accountId: string,
): Promise<{ processados: number; falhas: number }> {
  const ids = await enviosParaAtualizar(sql);
  let processados = 0;
  let falhas = 0;
  for (const id of ids) {
    try {
      await salvarPrazos(sql, accountId, id, await ml.getPrazosEnvio(id));
      processados++;
    } catch (err) {
      falhas++;
      console.warn('[ML] Falha ao atualizar o prazo de um envio (será tentado de novo):', (err as Error).message);
    }
  }
  return { processados, falhas };
}
