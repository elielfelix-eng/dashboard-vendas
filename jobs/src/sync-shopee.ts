/**
 * Sincronização da Shopee: pedidos (mkt.orders / mkt.order_items, channel 'shopee')
 * e pagamentos (mkt.shopee_escrow, uma linha por tarifa).
 * Só lê da Shopee. Nenhum log leva token, partner key, assinatura, corpo de resposta ou dado de comprador.
 */
import {
  ShopeeAuthError, ShopeeConnector, refreshShopeeTokens, tarifasDoEscrow,
  type Order, type ShopeeAppCredentials,
} from '@dash/connectors';
import { requireEnv, upsert, type Sql } from './db.ts';
import { createTokenProvider } from './token-store.ts';

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
