import { MercadoLivreConnector, refreshTokens, type MlAppCredentials, type Order } from '@dash/connectors';
import { requireEnv, upsert, type Sql } from './db.ts';
import { createTokenProvider } from './token-store.ts';

const DAY = 86_400_000;

export async function syncMercadoLivre(sql: Sql) {
  const app: MlAppCredentials = {
    clientId: requireEnv('ML_CLIENT_ID'),
    clientSecret: requireEnv('ML_CLIENT_SECRET'),
  };
  const accounts = await sql<{ id: string; external_id: string; nickname: string }[]>`
    select id, external_id, nickname from core.accounts where channel = 'mercadolivre' and active`;
  if (!accounts.length) console.log('Nenhuma conta do Mercado Livre conectada.');

  let failures = 0;
  for (const acc of accounts) {
    const [run] = await sql<{ id: number }[]>`
      insert into core.sync_runs (source, account_id) values ('mercadolivre', ${acc.id}) returning id`;
    const stats: Record<string, number> = {};
    try {
      const getToken = createTokenProvider(sql, acc.id, (rt) => refreshTokens(app, rt));
      const ml = new MercadoLivreConnector(acc.external_id, getToken);

      const [last] = await sql<{ started_at: Date | null }[]>`
        select max(started_at) as started_at from core.sync_runs
         where source = 'mercadolivre' and account_id = ${acc.id} and status = 'success'`;
      const backfillDays = Number(process.env.BACKFILL_DAYS ?? 365);
      const isFirstRun = !last?.started_at;
      const from = isFirstRun ? new Date(Date.now() - backfillDays * DAY) : new Date(last.started_at!.getTime() - DAY);
      const to = new Date();
      console.log(`[ML ${acc.nickname}] período ${from.toISOString()} -> ${to.toISOString()}`);

      stats.items = await syncItems(sql, ml, acc.id);
      stats.orders = await syncOrders(sql, ml, acc.id, from, to);
      stats.shipping = await syncShippingCosts(sql, ml);
      stats.cancelled_shipments = await syncCancelledShipments(sql, ml);
      try {
        stats.billing_rows = await syncBilling(sql, ml);
      } catch (err) {
        console.warn('[ML] Falha ao buscar a fatura (será tentada de novo):', (err as Error).message);
        stats.billing_rows = -1;
      }
      stats.visits = await syncVisits(sql, ml, isFirstRun ? 90 : 3);
      // Ads: a API guarda 90 dias (inclui hoje). Na 1ª vez (ou se a tabela estiver vazia), busca tudo.
      const [{ n: adsDays }] = await sql<{ n: number }[]>`
        select count(distinct day)::int as n from mkt.ads_campaign_daily where channel = 'mercadolivre'`;
      stats.ads_campaign_days = await syncAdsCampaigns(sql, ml, adsDays === 0 ? 89 : 3);
      stats.ads_items = await syncAds(sql, ml, isFirstRun ? 89 : 3);

      await sql`update core.sync_runs set status = 'success', finished_at = now(), stats = ${sql.json(stats)} where id = ${run.id}`;
      console.log(`[ML ${acc.nickname}] OK`, stats);
    } catch (err) {
      failures++;
      const msg = (err as Error).message;
      console.error(`[ML ${acc.nickname}] ERRO:`, msg);
      await sql`update core.sync_runs set status = 'error', finished_at = now(), error = ${msg}, stats = ${sql.json(stats)} where id = ${run.id}`;
    }
  }
  return failures;
}

async function syncItems(sql: Sql, ml: MercadoLivreConnector, accountId: string) {
  let total = 0;
  for await (const batch of ml.listItems()) {
    await upsert(sql, 'mkt.items', batch.map((i) => ({
      channel: i.channel, item_id: i.itemId, account_id: accountId, title: i.title, sku: i.sku,
      price: i.price, status: i.status, category_id: i.categoryId, listing_type: i.listingType,
      logistic_type: i.logisticType, available_qty: i.availableQty, sold_qty: i.soldQty,
      health: i.health, permalink: i.permalink, thumbnail: i.thumbnail, date_created: i.dateCreated,
      updated_at: new Date(), raw: sql.json(i.raw as never),
    })), ['channel', 'item_id']);
    await upsert(sql, 'mkt.item_variations', batch.flatMap((i) => i.variations.map((v) => ({
      channel: i.channel, item_id: i.itemId, variation_id: v.variationId, sku: v.sku, price: v.price,
      available_qty: v.availableQty, sold_qty: v.soldQty, attributes: sql.json((v.attributes ?? null) as never),
    }))), ['channel', 'item_id', 'variation_id']);
    total += batch.length;
  }
  return total;
}

async function syncOrders(sql: Sql, ml: MercadoLivreConnector, accountId: string, from: Date, to: Date) {
  let total = 0;
  for await (const batch of ml.listOrders(from, to)) {
    await saveOrders(sql, batch, accountId);
    total += batch.length;
  }
  return total;
}

async function saveOrders(sql: Sql, orders: Order[], accountId: string) {
  if (!orders.length) return;
  await sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    await upsert(t, 'mkt.orders', orders.map((o) => ({
      channel: o.channel, order_id: o.orderId, account_id: accountId, pack_id: o.packId, status: o.status,
      date_created: o.dateCreated, date_closed: o.dateClosed, date_last_updated: o.dateLastUpdated,
      total_amount: o.totalAmount, paid_amount: o.paidAmount, currency: o.currency, buyer_id: o.buyerId,
      shipment_id: o.shipmentId, tags: o.tags, raw: sql.json(o.raw as never),
      // Pedido alterado: a situação do envio é buscada de novo (só para cancelados)
      shipment_status: null, shipment_substatus: null,
    })), ['channel', 'order_id']);
    // Itens do pedido: apaga e regrava (um pedido pode mudar)
    for (const o of orders) await t`delete from mkt.order_items where channel = ${o.channel} and order_id = ${o.orderId}`;
    await upsert(t, 'mkt.order_items', orders.flatMap((o) => o.items.map((li) => ({
      channel: o.channel, order_id: o.orderId, line_no: li.lineNo, item_id: li.itemId,
      variation_id: li.variationId, sku: li.sku, title: li.title, quantity: li.quantity,
      unit_price: li.unitPrice, sale_fee: li.saleFee, listing_type: li.listingType,
    }))), ['channel', 'order_id', 'line_no']);
  });
}

/** Busca o frete pago pelo vendedor apenas dos pedidos que ainda não têm esse valor. */
async function syncShippingCosts(sql: Sql, ml: MercadoLivreConnector) {
  const pending = await sql<{ shipment_id: string }[]>`
    select distinct shipment_id from mkt.orders
     where channel = 'mercadolivre' and shipment_id is not null and shipping_cost_seller is null
     limit 3000`;
  for (const p of pending) {
    const cost = await ml.getShipmentSellerCost(p.shipment_id);
    // Rateia o frete entre os pedidos ATIVOS do mesmo envio (carrinho).
    // Cancelados (ex.: "dividido") ficam com 0, para o pago receber o custo inteiro.
    await sql`
      update mkt.orders o
         set shipping_cost_seller = case when o.status = 'cancelled' then 0
                                         else round(${cost ?? 0}::numeric / greatest(n.cnt, 1), 2) end
        from (select count(*) filter (where status <> 'cancelled') as cnt
                from mkt.orders where channel = 'mercadolivre' and shipment_id = ${p.shipment_id}) n
       where o.channel = 'mercadolivre' and o.shipment_id = ${p.shipment_id}`;
  }
  return pending.length;
}

/** Situação do envio dos cancelados, para separar devolvido / dividido / cancelado. */
async function syncCancelledShipments(sql: Sql, ml: MercadoLivreConnector) {
  const pending = await sql<{ shipment_id: string }[]>`
    select distinct shipment_id from mkt.orders
     where channel = 'mercadolivre' and status = 'cancelled'
       and shipment_id is not null and shipment_status is null
     limit 3000`;
  for (const p of pending) {
    const s = await ml.getShipmentStatus(p.shipment_id);
    await sql`
      update mkt.orders
         set shipment_status = ${s?.status ?? 'sem_envio'}, shipment_substatus = ${s?.substatus ?? null}
       where channel = 'mercadolivre' and shipment_id = ${p.shipment_id}`;
  }
  return pending.length;
}

/**
 * Fatura do ML: relê sempre os 2 períodos mais recentes (ainda podem mudar)
 * e busca os mais antigos só se ainda não estiverem no banco.
 */
async function syncBilling(sql: Sql, ml: MercadoLivreConnector) {
  const periods = (await ml.listBillingPeriods()).sort((a, b) => b.key.localeCompare(a.key));
  const stored = new Set(
    (await sql<{ period_key: string }[]>`select period_key from mkt.billing_periods where channel = 'mercadolivre'`)
      .map((r) => r.period_key),
  );
  let total = 0;
  for (const [i, p] of periods.entries()) {
    if (i >= 2 && stored.has(p.key)) continue;
    const rows = await ml.getBillingDetails(p.key);
    await sql.begin(async (tx) => {
      const t = tx as unknown as Sql;
      await t`delete from mkt.billing_details where channel = 'mercadolivre' and period_key = ${p.key}`;
      // Linha idêntica repetida na resposta: descarta. Mesmo id com conteúdo
      // diferente: mantém as duas (com sufixo), para não perder cobranças.
      const seen = new Map<string, string>();
      const unique: typeof rows = [];
      for (const r of rows) {
        const body = JSON.stringify(r.raw);
        let id = r.detailId;
        let n = 1;
        while (seen.has(id) && seen.get(id) !== body) id = `${r.detailId}#${++n}`;
        if (seen.get(id) === body) continue;
        seen.set(id, body);
        unique.push({ ...r, detailId: id });
      }
      await upsert(t, 'mkt.billing_details', unique.map((r) => ({
        channel: 'mercadolivre', period_key: p.key, detail_id: r.detailId, created_at: r.createdAt,
        detail_type: r.detailType, code: r.code, amount: r.amount, order_id: r.orderId,
        description: r.description, raw: sql.json(r.raw as never),
      })), ['channel', 'period_key', 'detail_id']);
      await upsert(t, 'mkt.billing_periods', [{
        channel: 'mercadolivre', period_key: p.key, date_from: p.dateFrom?.slice(0, 10) ?? null,
        date_to: p.dateTo?.slice(0, 10) ?? null, rows_count: unique.length, fetched_at: new Date(),
        raw: sql.json(p.raw as never),
      }], ['channel', 'period_key']);
    });
    total += rows.length;
    console.log(`[ML] fatura ${p.key}: ${rows.length} linhas`);
  }
  return total;
}

/** Product Ads por campanha (endpoint validado na V1). */
async function syncAdsCampaigns(sql: Sql, ml: MercadoLivreConnector, days: number) {
  const to = new Date();
  const from = new Date(Date.now() - days * DAY);
  let total = 0;
  try {
    for await (const batch of ml.listAdsCampaignDaily(from, to)) {
      // Soma linhas repetidas da mesma campanha/dia
      const agg = new Map<string, { campaign_id: string; day: string; cost: number; raw: unknown }>();
      for (const r of batch) {
        const k = `${r.campaignId}|${r.day}`;
        const cur = agg.get(k);
        if (cur) cur.cost += r.cost;
        else agg.set(k, { campaign_id: r.campaignId, day: r.day, cost: r.cost, raw: r.raw });
      }
      total += await upsert(sql, 'mkt.ads_campaign_daily', [...agg.values()].map((r) => ({
        channel: 'mercadolivre', campaign_id: r.campaign_id, day: r.day, cost: r.cost, raw: sql.json(r.raw as never),
      })), ['channel', 'campaign_id', 'day']);
    }
  } catch (err) {
    console.warn('[ML] Falha ao buscar Ads por campanha:', (err as Error).message);
    return -1;
  }
  return total;
}

async function syncVisits(sql: Sql, ml: MercadoLivreConnector, days: number) {
  const items = await sql<{ item_id: string }[]>`
    select item_id from mkt.items where channel = 'mercadolivre' and status in ('active', 'paused')`;
  let total = 0;
  for (const it of items) {
    const rows = await ml.getVisits(it.item_id, days);
    total += await upsert(sql, 'mkt.visits_daily', rows.map((r) => ({
      channel: 'mercadolivre', item_id: r.itemId, day: r.day, visits: r.visits,
    })), ['channel', 'item_id', 'day']);
  }
  return total;
}

async function syncAds(sql: Sql, ml: MercadoLivreConnector, days: number) {
  const to = new Date();
  const from = new Date(Date.now() - days * DAY);
  let total = 0;
  try {
    for await (const batch of ml.listAdsMetrics(from, to)) {
      total += await upsert(sql, 'mkt.ads_metrics_daily', batch.map((m) => ({
        channel: 'mercadolivre', item_id: m.itemId, day: m.day, campaign_id: m.campaignId,
        impressions: m.impressions, clicks: m.clicks, cost: m.cost, direct_amount: m.directAmount,
        indirect_amount: m.indirectAmount, direct_units: m.directUnits, indirect_units: m.indirectUnits,
        organic_units: m.organicUnits,
      })), ['channel', 'item_id', 'day']);
    }
  } catch (err) {
    // Ads não pode derrubar a sincronização de vendas; fica registrado no log
    console.warn('[ML] Falha ao buscar Ads por anúncio (opcional):', (err as Error).message);
    return -1;
  }
  return total;
}
