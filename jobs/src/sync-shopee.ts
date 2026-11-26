/**
 * Sincronização da Shopee: pedidos (mkt.orders / mkt.order_items, channel 'shopee'),
 * pagamentos (mkt.shopee_escrow, uma linha por tarifa), anúncios (mkt.items / mkt.item_variations)
 * e Shopee Ads (mkt.ads_campaign_daily, mkt.ads_metrics_daily, mkt.ads_campaigns, mkt.ads_anuncios).
 * Só lê da Shopee. Nenhum log leva token, partner key, assinatura, corpo de resposta ou dado de comprador.
 * Anúncios e Ads são opcionais: falha deles fica nas estatísticas e no log, e não derruba pedidos nem pagamentos.
 */
import {
  ShopeeAuthError, ShopeeConnector, combinarAdsShopee, refreshShopeeTokens, tarifasDoEscrow,
  type AdsDailyMetric, type Order, type ShopeeAdsCampanha, type ShopeeAppCredentials,
} from '@dash/connectors';
import { requireEnv, upsert, type Sql } from './db.ts';
import { createTokenProvider } from './token-store.ts';
import { diasRebuscaAds } from './ads-janela.ts';

const DAY = 86_400_000;
/** Carga inicial: 12 meses (a loja tem pedidos desde 06/2026). */
const CARGA_INICIAL_DIAS = 365;
/** Releitura: o escrow sai depois da entrega, então os últimos 30 dias são lidos de novo a cada execução. */
const RELEITURA_DIAS = 30;
/** Pedidos mais antigos ainda sem pagamento final, buscados de novo por execução. */
const PENDENTES_MAX = 500;

/** Início do período da lista de pedidos. */
export function inicioShopee(ultimoSucesso: Date | null, agora = new Date()): Date {
  const limite = agora.getTime() - CARGA_INICIAL_DIAS * DAY;
  if (!ultimoSucesso) return new Date(limite);
  const inicio = Math.min(agora.getTime() - RELEITURA_DIAS * DAY, ultimoSucesso.getTime() - DAY);
  return new Date(Math.max(inicio, limite));
}

const dataSP = (isoDate: string) => new Date(isoDate).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

/** Data de referência das tarifas: dia do pagamento em Brasília (sem pagamento: dia da criação). */
export function dataRefTarifas(o: Pick<Order, 'dateClosed' | 'dateCreated'>): string {
  return dataSP(o.dateClosed ?? o.dateCreated);
}

/**
 * Pede escrow só de pedido pago, ou cancelado DEPOIS de pago (devolução pode gerar tarifa).
 * Não pede: não pagos (unpaid), desconhecidos e cancelados sem pagamento (tag shopee:sem_pagamento).
 */
export function precisaEscrow(o: Pick<Order, 'status' | 'tags'>): boolean {
  if (o.status === 'paid') return true;
  return o.status === 'cancelled' && !o.tags.includes('shopee:sem_pagamento');
}

/**
 * Período do Ads: `dias` dias terminando ONTEM (Brasília). A sonda confirmou a leitura até ontem;
 * o dia de hoje (ainda aberto) entra na execução de amanhã, que relê os últimos dias (diasRebuscaAds).
 */
export function periodoAdsShopee(dias: number, agora = new Date()): { de: string; ate: string } {
  const hoje = dataSP(agora.toISOString());
  const ate = new Date(Date.parse(`${hoje}T00:00:00Z`) - DAY);
  const de = new Date(ate.getTime() - (Math.max(dias, 1) - 1) * DAY);
  return { de: de.toISOString().slice(0, 10), ate: ate.toISOString().slice(0, 10) };
}

export async function syncShopee(sql: Sql): Promise<number> {
  const contas = await sql<{ id: string; external_id: string; nickname: string | null }[]>`
    select id, external_id, nickname from core.accounts where channel = 'shopee' and active`;
  if (!contas.length) {
    console.log('Nenhuma loja da Shopee conectada.');
    return 0;
  }

  let falhas = 0;
  for (const acc of contas) {
    const nome = acc.nickname ?? `loja ${acc.external_id}`;
    const [run] = await sql<{ id: number }[]>`
      insert into core.sync_runs (source, account_id) values ('shopee', ${acc.id}) returning id`;
    const stats: Record<string, number> = { pedidos: 0, pendentes: 0, status_desconhecido: 0, escrow_pedidos: 0, escrow_linhas: 0, escrow_campos: 0, sem_escrow: 0 };
    try {
      const app: ShopeeAppCredentials = {
        partnerId: Number(requireEnv('SHOPEE_PARTNER_ID')),
        partnerKey: requireEnv('SHOPEE_PARTNER_KEY'),
      };
      const shopId = Number(acc.external_id);
      const getToken = createTokenProvider(sql, acc.id, (rt) => refreshShopeeTokens(app, shopId, rt));
      const shopee = new ShopeeConnector(app, shopId, getToken);

      const [last] = await sql<{ started_at: Date | null }[]>`
        select max(started_at) as started_at from core.sync_runs
         where source = 'shopee' and account_id = ${acc.id} and status = 'success'`;
      const agora = new Date();
      const from = inicioShopee(last?.started_at ?? null, agora);
      console.log(`[Shopee ${nome}] período ${from.toISOString()} -> ${agora.toISOString()}`);

      // Pedidos gravados nesta execução (para o escrow)
      const gravados = new Map<string, Order>();
      const salvar = async (pedidos: Order[]) => {
        for (const o of pedidos) {
          if (o.status === 'unknown') {
            stats.status_desconhecido++;
            const st = (o.tags[0] ?? '').replace(/[^A-Za-z0-9_:]/g, '').slice(0, 60);
            console.warn(`[Shopee] Pedido com status desconhecido (${st}): gravado sem contar como venda.`);
          }
          gravados.set(o.orderId, o);
        }
        await salvarPedidos(sql, pedidos, acc.id);
      };

      for await (const lote of shopee.listOrders(from, agora)) {
        await salvar(lote);
        stats.pedidos += lote.length;
      }

      // Pagos mais antigos ainda sem pagamento final (fora da janela): status e escrow de novo
      const pend = (await sql<{ order_id: string }[]>`
        select p as order_id from mkt.shopee_pedidos_pendentes(${PENDENTES_MAX}) as p`)
        .map((r) => r.order_id).filter((id) => !gravados.has(id));
      if (pend.length) {
        const pedidos = await shopee.getOrders(pend);
        await salvar(pedidos);
        stats.pendentes = pedidos.length;
      }

      // Escrow: dos pagos e dos cancelados depois de pagos. Sem escrow: nada é gravado.
      const candidatos = [...gravados.values()].filter(precisaEscrow);
      const escrows = new Map((await shopee.getEscrowBatch(candidatos.map((o) => o.orderId))).map((e) => [e.orderSn, e]));
      const comEscrow: string[] = [];
      const linhas: { order_id: string; categoria: string; valor: number; data_ref: string }[] = [];
      for (const o of candidatos) {
        const tarifas = tarifasDoEscrow(escrows.get(o.orderId));
        if (!tarifas) { stats.sem_escrow++; continue; }
        comEscrow.push(o.orderId);
        const dataRef = dataRefTarifas(o);
        for (const t of tarifas) linhas.push({ order_id: o.orderId, categoria: t.categoria, valor: t.valor, data_ref: dataRef });
      }
      if (comEscrow.length) {
        // Todos os campos em dinheiro do pagamento (conferência), gravados junto com as tarifas
        const campos = Object.fromEntries(comEscrow.map((id) => [id, escrows.get(id)?.campos ?? {}]));
        await sql.begin(async (tx) => {
          const t = tx as unknown as Sql;
          const [{ n }] = await t<{ n: number }[]>`
            select mkt.shopee_gravar_escrow(${t.array(comEscrow)}::text[], ${t.json(linhas)}::jsonb) as n`;
          stats.escrow_linhas = n;
          const [{ c }] = await t<{ c: number }[]>`
            select mkt.shopee_gravar_escrow_campos(${t.array(comEscrow)}::text[], ${t.json(campos)}::jsonb) as c`;
          stats.escrow_campos = c;
        });
      }
      stats.escrow_pedidos = comEscrow.length;

      // Anúncios e Ads: opcionais (falha só vai para as estatísticas e o log, com rótulo e código da Shopee)
      try {
        stats.itens = await syncItensShopee(sql, shopee, acc.id);
      } catch (err) {
        console.warn('[Shopee] Falha ao buscar os anúncios (pedidos seguem normalmente):', (err as Error).message);
        stats.itens = -1;
      }
      if (shopee.avisos.includes('visitas')) stats.visitas_indisponiveis = 1;
      if (shopee.avisos.includes('modelos')) stats.variacoes_falhas = 1;
      Object.assign(stats, await etapaAdsShopee(sql, shopee)); // só com SHOPEE_ADS=1 (ver etapaAdsShopee)

      await sql`update core.sync_runs set status = 'success', finished_at = now(), stats = ${sql.json(stats)} where id = ${run.id}`;
      console.log(`[Shopee ${nome}] OK`, stats);
    } catch (err) {
      falhas++;
      // Autorização vencida: a mensagem é o aviso de reconexão (sem token); nada de nova renovação.
      const msg = err instanceof ShopeeAuthError ? err.message : (err as Error).message;
      console.error(`[Shopee ${nome}] ERRO:`, msg);
      await sql`update core.sync_runs set status = 'error', finished_at = now(), error = ${msg}, stats = ${sql.json(stats)} where id = ${run.id}`;
    }
  }
  return falhas;
}

/**
 * Anúncios da Shopee em mkt.items (sku = item_sku, status active/paused, listing_type nulo, Full = 'fulfillment';
 * visualizações e vendas ACUMULADAS em raw.extra_info) e variações em mkt.item_variations (sku = model_sku).
 * Visitas diárias (mkt.visits_daily) não são gravadas: a Shopee não tem série diária.
 */
async function syncItensShopee(sql: Sql, shopee: ShopeeConnector, accountId: string) {
  let total = 0;
  for await (const lote of shopee.listItems()) {
    const itens = [...new Map(lote.map((i) => [i.itemId, i])).values()];
    await upsert(sql, 'mkt.items', itens.map((i) => ({
      channel: i.channel, item_id: i.itemId, account_id: accountId, title: i.title, sku: i.sku,
      price: i.price, status: i.status, category_id: i.categoryId, listing_type: i.listingType,
      logistic_type: i.logisticType, available_qty: i.availableQty, sold_qty: i.soldQty,
      health: i.health, permalink: i.permalink, thumbnail: i.thumbnail, date_created: i.dateCreated,
      updated_at: new Date(), raw: sql.json(i.raw as never),
    })), ['channel', 'item_id']);
    await upsert(sql, 'mkt.item_variations', itens.flatMap((i) => [...new Map(i.variations.map((v) => [v.variationId, v])).values()].map((v) => ({
      channel: i.channel, item_id: i.itemId, variation_id: v.variationId, sku: v.sku, price: v.price,
      available_qty: v.availableQty, sold_qty: v.soldQty, attributes: sql.json((v.attributes ?? null) as never),
    }))), ['channel', 'item_id', 'variation_id']);
    total += itens.length;
  }
  return total;
}

/** Linhas de mkt.ads_metrics_daily no formato de mkt.shopee_gravar_ads. */
const linhaAds = (m: AdsDailyMetric) => ({
  item_id: m.itemId, day: m.day, campaign_id: m.campaignId, impressions: m.impressions, clicks: m.clicks, cost: m.cost,
  direct_amount: m.directAmount, indirect_amount: m.indirectAmount, direct_units: m.directUnits,
  indirect_units: m.indirectUnits, organic_units: m.organicUnits,
});

/**
 * Shopee Ads (0032). Período: diasRebuscaAds dias até ontem (89 na primeira vez, sem Ads da Shopee no banco).
 *  - Conta (garantido): obrigatório para gravar; se falhar, nada do Ads muda nesta execução (ads_conta = -1).
 *  - Por anúncio (pode não existir: 404/sem permissão): falha vira ads_produto_indisponivel = 1 e o log
 *    mostra só o rótulo e o código da Shopee; segue só com a conta (tudo em "sem modelo").
 * Os dias lidos são apagados e regravados juntos (mkt.shopee_gravar_ads): nada é somado duas vezes.
 */
/** Contrato mínimo do conector usado pela etapa de Ads (permite testar sem a API). */
type AdsShopeeFonte = Pick<ShopeeConnector, 'getAdsConta' | 'getAdsProdutos' | 'avisos'>;

/**
 * Etapa opcional de Ads: só grava com SHOPEE_ADS=1 (padrão DESLIGADO; não está no sync.yml).
 * Motivo: até a Tarefa 5, analytics.dash_ads_periodo só soma o investimento do Mercado Livre; gravar o Ads da
 * Shopee já mudaria a tela Ads no consolidado (vendas por Ads e atribuição da Shopee sem o investimento:
 * ROAS/ACOS inflados, "não atribuído" negativo). A Tarefa 5 deve:
 *  (a) incluir o investimento da Shopee (mkt.ads_campaign_daily, 'conta') em dash_ads_periodo e ads_serie;
 *  (b) tratar campanhas, modelos e "não atribuído" no consolidado (ads_resumo, ads_campanhas, ads_modelos, ads_sugestoes);
 *  (c) só então ligar SHOPEE_ADS=1 (a 1ª execução, sem Ads da Shopee no banco, relê 89 dias e recupera o histórico).
 * Qualquer erro aqui (API ou banco) fica nas estatísticas; nunca marca a execução da Shopee como falha.
 */
export async function etapaAdsShopee(sql: Sql, shopee: AdsShopeeFonte, env: Record<string, string | undefined> = process.env): Promise<Record<string, number>> {
  if (env.SHOPEE_ADS !== '1') {
    console.log('[Shopee] Shopee Ads: desligado até a Tarefa 5');
    return { ads_desligado: 1 };
  }
  try {
    return await syncAdsShopee(sql, shopee, env);
  } catch (err) {
    console.warn('[Shopee] Falha no Ads (será tentada de novo):', (err as Error).message);
    return { ads_conta: -1 };
  }
}

async function syncAdsShopee(sql: Sql, shopee: AdsShopeeFonte, env: Record<string, string | undefined>): Promise<Record<string, number>> {
  const st: Record<string, number> = {};
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from mkt.ads_campaign_daily where channel = 'shopee'`;
  const { de, ate } = periodoAdsShopee(diasRebuscaAds(env.ADS_REFETCH_DAYS, n === 0));
  let conta;
  try {
    conta = await shopee.getAdsConta(de, ate);
  } catch (err) {
    console.warn('[Shopee] Falha ao buscar o Ads da conta (será tentada de novo):', (err as Error).message);
    st.ads_conta = -1;
    return st;
  }
  let produtos: AdsDailyMetric[] | null = null;
  let campanhas: ShopeeAdsCampanha[] = [];
  try {
    const p = await shopee.getAdsProdutos(de, ate);
    produtos = p.metricas;
    campanhas = p.campanhas;
  } catch (err) {
    console.warn('[Shopee] Ads por produto indisponível (segue só com a conta):', (err as Error).message);
    st.ads_produto_indisponivel = 1;
  }
  if (shopee.avisos.includes('ads_campanhas')) st.erro_ads_campanhas = 1;

  const metricas = combinarAdsShopee(conta, produtos);
  const dias = conta.map((d) => d.day);
  const contaJson = conta.map((d) => ({
    day: d.day, cost: d.cost,
    raw: { expense: d.cost, impression: d.impressions, clicks: d.clicks, direct_gmv: d.directAmount, broad_gmv: d.broadAmount,
           direct_item_sold: d.directUnits, broad_item_sold: d.broadUnits, ...d.raw },
  }));
  try {
    await sql.begin(async (tx) => {
      const t = tx as unknown as Sql;
      const [{ g }] = await t<{ g: number }[]>`
        select mkt.shopee_gravar_ads(${t.array(dias)}::text[]::date[], ${t.json(metricas.map(linhaAds))}::jsonb, ${t.json(contaJson as never)}::jsonb) as g`;
      st.ads_linhas = g;
      if (campanhas.length) {
        await upsert(t, 'mkt.ads_campaigns', campanhas.map((c) => ({
          channel: 'shopee', campaign_id: c.campaignId, name: c.name, status: c.status, budget: c.budget,
          automatica: c.automatica, raw: sql.json(c.raw as never), atualizado_em: new Date(),
        })), ['channel', 'campaign_id']);
        // Anúncio de campanha de um só anúncio; em mais de uma, fica a ativa
        const porItem = new Map<string, ShopeeAdsCampanha>();
        for (const c of [...campanhas].sort((a, b) => Number(a.status === 'active') - Number(b.status === 'active'))) {
          if (c.itemIds.length === 1) porItem.set(c.itemIds[0], c);
        }
        await upsert(t, 'mkt.ads_anuncios', [...porItem].map(([item, c]) => ({
          channel: 'shopee', item_id: item, campaign_id: c.campaignId, status: c.status, atualizado_em: new Date(),
        })), ['channel', 'item_id']);
        st.ads_campanhas = campanhas.length;
      }
    });
    st.ads_conta_dias = dias.length;
  } catch (err) {
    console.warn('[Shopee] Falha ao gravar o Ads (será tentada de novo):', (err as Error).message);
    st.ads_conta = -1;
  }
  return st;
}

/** Grava pedidos e itens (itens: apaga e regrava, porque o pedido pode mudar). */
async function salvarPedidos(sql: Sql, pedidos: Order[], accountId: string) {
  if (!pedidos.length) return;
  await sql.begin(async (tx) => {
    const t = tx as unknown as Sql;
    await upsert(t, 'mkt.orders', pedidos.map((o) => ({
      channel: o.channel, order_id: o.orderId, account_id: accountId, pack_id: o.packId, status: o.status,
      date_created: o.dateCreated, date_closed: o.dateClosed, date_last_updated: o.dateLastUpdated,
      total_amount: o.totalAmount, paid_amount: o.paidAmount, currency: o.currency, buyer_id: null,
      shipment_id: o.shipmentId, tags: o.tags, raw: sql.json(o.raw as never),
    })), ['channel', 'order_id']);
    await t`delete from mkt.order_items where channel = 'shopee' and order_id = any(${t.array(pedidos.map((o) => o.orderId))}::text[])`;
    await upsert(t, 'mkt.order_items', pedidos.flatMap((o) => o.items.map((li) => ({
      channel: o.channel, order_id: o.orderId, line_no: li.lineNo, item_id: li.itemId,
      variation_id: li.variationId, sku: li.sku, title: li.title, quantity: li.quantity,
      unit_price: li.unitPrice, sale_fee: li.saleFee, listing_type: li.listingType,
    }))), ['channel', 'order_id', 'line_no']);
  });
}
