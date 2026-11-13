import { HttpError, chunk } from '../http.ts';
import type {
  AdsDailyMetric,
  Item,
  ItemVariation,
  MarketplaceConnector,
  Order,
  TokenProvider,
  VisitsDaily,
} from '../types.ts';
import { MercadoLivreClient } from './client.ts';

/* ---------- Tipos parciais das respostas da API do ML ---------- */
interface MlAttribute { id: string; value_name: string | null }
interface MlVariation {
  id: number;
  price: number;
  available_quantity: number;
  sold_quantity: number;
  seller_custom_field: string | null;
  attribute_combinations: unknown;
  attributes?: MlAttribute[];
}
interface MlItem {
  id: string;
  title: string;
  price: number;
  status: string;
  category_id: string;
  listing_type_id: string;
  shipping?: { logistic_type?: string };
  available_quantity: number;
  sold_quantity: number;
  health?: number | null;
  permalink: string;
  thumbnail: string;
  date_created: string;
  seller_custom_field: string | null;
  attributes?: MlAttribute[];
  variations?: MlVariation[];
}
interface MlOrder {
  id: number;
  pack_id: number | null;
  status: string;
  date_created: string;
  date_closed: string | null;
  last_updated?: string | null;
  date_last_updated?: string | null;
  total_amount: number;
  paid_amount: number | null;
  currency_id: string;
  buyer?: { id: number };
  shipping?: { id: number | null };
  tags: string[];
  order_items: {
    item: { id: string; title: string; variation_id: number | null; seller_sku: string | null; seller_custom_field?: string | null };
    quantity: number;
    unit_price: number;
    sale_fee: number | null;
    listing_type_id: string | null;
  }[];
}
interface Paging { total: number; offset: number; limit: number }

const skuFrom = (customField: string | null | undefined, attrs?: MlAttribute[]) =>
  customField || attrs?.find((a) => a.id === 'SELLER_SKU')?.value_name || null;

/** Formato de data aceito pelos filtros do ML. */
const mlDate = (d: Date) => d.toISOString().replace('Z', '-00:00');
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export class MercadoLivreConnector implements MarketplaceConnector {
  readonly channel = 'mercadolivre' as const;
  private readonly api: MercadoLivreClient;
  /** O ML recusou a consulta de anúncios em lote: daqui em diante, um por um. */
  private loteRecusado = false;

  constructor(private readonly sellerId: string, getToken: TokenProvider) {
    this.api = new MercadoLivreClient(getToken);
  }

  me() {
    return this.api.get<{ id: number; nickname: string; seller_reputation?: unknown }>('/users/me');
  }

  /* ----------------------------- Anúncios ----------------------------- */
  async *listItems(): AsyncIterable<Item[]> {
    let scrollId: string | undefined;
    for (;;) {
      const page = await this.api.get<{ results: string[]; scroll_id?: string }>(
        `/users/${this.sellerId}/items/search`,
        { search_type: 'scan', limit: 100, scroll_id: scrollId },
      );
      if (!page.results.length) return;
      scrollId = page.scroll_id;
      const items: Item[] = [];
      for (const ids of chunk(page.results, 20)) {
        if (!this.loteRecusado) {
          try {
            const multi = await this.api.get<{ code: number; body: MlItem }[]>('/items', { ids: ids.join(',') });
            for (const r of multi) if (r.code === 200) items.push(this.toItem(r.body));
            continue;
          } catch (err) {
            // Em 13/11/2026 o ML passou a recusar a consulta em lote (403 ResourceDeprecated) para este app.
            if (!(err instanceof HttpError && err.status === 403)) throw err;
            this.loteRecusado = true;
            console.warn('[ML] Consulta de anúncios em lote recusada; buscando um por um.');
          }
        }
        for (const id of ids) {
          try {
            items.push(this.toItem(await this.api.get<MlItem>(`/items/${id}`)));
          } catch (err) {
            if (!(err instanceof HttpError && err.status < 500 && err.status !== 429)) throw err;
            console.warn(`[ML] Anúncio ${id} não pôde ser lido (HTTP ${err.status}); seguindo com os demais.`);
          }
        }
      }
      yield items;
      if (!scrollId) return;
    }
  }

  private toItem(it: MlItem): Item {
    const variations: ItemVariation[] = (it.variations ?? []).map((v) => ({
      variationId: String(v.id),
      sku: skuFrom(v.seller_custom_field, v.attributes),
      price: v.price,
      availableQty: v.available_quantity,
      soldQty: v.sold_quantity,
      attributes: v.attribute_combinations,
    }));
    return {
      channel: 'mercadolivre',
      itemId: it.id,
      title: it.title,
      sku: skuFrom(it.seller_custom_field, it.attributes),
      price: it.price,
      status: it.status,
      categoryId: it.category_id,
      listingType: it.listing_type_id,
      logisticType: it.shipping?.logistic_type ?? null,
      availableQty: it.available_quantity,
      soldQty: it.sold_quantity,
      health: it.health ?? null,
      permalink: it.permalink,
      thumbnail: it.thumbnail,
      dateCreated: it.date_created,
      variations,
      raw: it,
    };
  }

  /* ------------------------------ Pedidos ----------------------------- */
  async *listOrders(from: Date, to: Date): AsyncIterable<Order[]> {
    const LIMIT = 50;
    const MAX_OFFSET = 9000; // a busca do ML não pagina além de ~10.000 registros
    const search = (offset: number, f: Date, t: Date) =>
      this.api.get<{ results: MlOrder[]; paging: Paging }>('/orders/search', {
        seller: this.sellerId,
        'order.date_last_updated.from': mlDate(f),
        'order.date_last_updated.to': mlDate(t),
        sort: 'date_asc',
        limit: LIMIT,
        offset,
      });

    const first = await search(0, from, to);
    if (first.paging.total > MAX_OFFSET && to.getTime() - from.getTime() > 60_000) {
      // Muitos pedidos: divide o período ao meio e busca cada metade
      const mid = new Date((from.getTime() + to.getTime()) / 2);
      yield* this.listOrders(from, mid);
      yield* this.listOrders(new Date(mid.getTime() + 1), to);
      return;
    }
    yield first.results.map((o) => this.toOrder(o));
    for (let offset = LIMIT; offset < first.paging.total; offset += LIMIT) {
      const page = await search(offset, from, to);
      if (!page.results.length) break;
      yield page.results.map((o) => this.toOrder(o));
    }
  }

  private toOrder(o: MlOrder): Order {
    return {
      channel: 'mercadolivre',
      orderId: String(o.id),
      packId: o.pack_id ? String(o.pack_id) : null,
      status: o.status,
      dateCreated: o.date_created,
      dateClosed: o.date_closed,
      dateLastUpdated: o.date_last_updated ?? o.last_updated ?? null,
      totalAmount: o.total_amount,
      paidAmount: o.paid_amount,
      currency: o.currency_id,
      buyerId: o.buyer?.id ? String(o.buyer.id) : null,
      shipmentId: o.shipping?.id ? String(o.shipping.id) : null,
      tags: o.tags ?? [],
      items: o.order_items.map((li, i) => ({
        lineNo: i + 1,
        itemId: li.item.id,
        variationId: li.item.variation_id ? String(li.item.variation_id) : null,
        sku: li.item.seller_sku ?? li.item.seller_custom_field ?? null,
        title: li.item.title,
        quantity: li.quantity,
        unitPrice: li.unit_price,
        saleFee: li.sale_fee,
        listingType: li.listing_type_id,
      })),
      raw: o,
    };
  }

  /* ------------------------------- Frete ------------------------------ */
  async getShipmentSellerCost(shipmentId: string): Promise<number | null> {
    try {
      const c = await this.api.get<{ senders?: { cost: number }[] }>(`/shipments/${shipmentId}/costs`, {}, { 'x-format-new': 'true' });
      return (c.senders ?? []).reduce((s, x) => s + (x.cost ?? 0), 0);
    } catch (err) {
      if (err instanceof HttpError && (err.status === 404 || err.status === 403)) return null;
      throw err;
    }
  }

  /* ------------------------------ Visitas ----------------------------- */
  async getVisits(itemId: string, days: number): Promise<VisitsDaily[]> {
    const r = await this.api.get<{ results: { date: string; total: number }[] }>(
      `/items/${itemId}/visits/time_window`,
      { last: days, unit: 'day' },
    );
    return r.results.map((x) => ({ itemId, day: x.date.slice(0, 10), visits: x.total }));
  }

  /* ------------------------- Mercado Ads (PADS) ----------------------- */
  // ATENÇÃO (validar na Fase 1): a API de Product Ads pode exigir liberação de
  // escopo no app do ML. Buscamos dia a dia para que cada resultado seja o
  // total daquele dia por anúncio. O ML guarda ~90 dias de histórico de Ads.
  private advertiser?: { id: number; siteId: string } | null;

  private async getAdvertiser() {
    if (this.advertiser !== undefined) return this.advertiser;
    const r = await this.api.get<{ advertisers: { advertiser_id: number; site_id: string }[] }>(
      '/advertising/advertisers',
      { product_id: 'PADS' },
      { 'Api-Version': '1' },
    );
    const a = r.advertisers?.[0];
    this.advertiser = a ? { id: a.advertiser_id, siteId: a.site_id } : null;
    return this.advertiser;
  }

  async *listAdsMetrics(from: Date, to: Date): AsyncIterable<AdsDailyMetric[]> {
    const adv = await this.getAdvertiser();
    if (!adv) return;
    const metrics = 'prints,clicks,cost,direct_amount,indirect_amount,direct_units_quantity,indirect_units_quantity,organic_units_quantity';
    for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86_400_000)) {
      const day = ymd(d);
      for (let offset = 0; ; offset += 50) {
        const r = await this.api.get<{
          paging: Paging;
          results: { item_id: string; campaign_id?: number; metrics?: Record<string, number> }[];
        }>(
          `/advertising/${adv.siteId}/advertisers/${adv.id}/product_ads/ads/search`,
          { date_from: day, date_to: day, metrics, limit: 50, offset },
          { 'api-version': '2' },
        );
        const rows = r.results
          .map((x) => ({ x, m: x.metrics ?? {} }))
          .filter(({ m }) => (m.prints ?? 0) > 0 || (m.cost ?? 0) > 0)
          .map(({ x, m }) => ({
            itemId: x.item_id,
            day,
            campaignId: x.campaign_id ? String(x.campaign_id) : null,
            impressions: m.prints ?? 0,
            clicks: m.clicks ?? 0,
            cost: m.cost ?? 0,
            directAmount: m.direct_amount ?? 0,
            indirectAmount: m.indirect_amount ?? 0,
            directUnits: m.direct_units_quantity ?? 0,
            indirectUnits: m.indirect_units_quantity ?? 0,
            organicUnits: m.organic_units_quantity ?? 0,
          }));
        if (rows.length) yield rows;
        if (offset + 50 >= (r.paging?.total ?? 0)) break;
      }
    }
  }

  /**
   * Ads por campanha (endpoint validado na V1, bate com o painel de Publicidade).
   * Busca dia a dia para que cada resultado seja o custo daquele dia.
   */
  async *listAdsCampaignDaily(from: Date, to: Date): AsyncIterable<MlAdsCampaignDay[]> {
    const adv = await this.getAdvertiser();
    if (!adv) return;
    for (let d = new Date(from); d <= to; d = new Date(d.getTime() + 86_400_000)) {
      const day = ymd(d);
      const rows: MlAdsCampaignDay[] = [];
      for (let offset = 0; ; offset += 50) {
        const r = await this.api.get<{
          paging?: Paging;
          results?: { id?: number | string; campaign_id?: number | string; date?: string; cost?: number; metrics?: { cost?: number } }[];
        }>(
          `/advertising/${adv.siteId}/advertisers/${adv.id}/product_ads/campaigns/search`,
          { date_from: day, date_to: day, metrics: 'cost', aggregation_type: 'DAILY', limit: 50, offset },
          { 'api-version': '2' },
        );
        for (const x of r.results ?? []) {
          const cost = Number(x.metrics?.cost ?? x.cost ?? 0);
          rows.push({ campaignId: String(x.id ?? x.campaign_id ?? 'total'), day: x.date?.slice(0, 10) ?? day, cost, raw: x });
        }
        if (offset + 50 >= (r.paging?.total ?? 0)) break;
      }
      if (rows.length) yield rows;
    }
  }

  /* ------------------------ Envio dos cancelados ---------------------- */
  async getShipmentStatus(shipmentId: string): Promise<{ status: string | null; substatus: string | null } | null> {
    try {
      const s = await this.api.get<{ status?: string; substatus?: string | null }>(
        `/shipments/${shipmentId}`, {}, { 'x-format-new': 'true' },
      );
      return { status: s.status ?? null, substatus: s.substatus ?? null };
    } catch (err) {
      if (err instanceof HttpError && (err.status === 404 || err.status === 403)) return null;
      throw err;
    }
  }

  /* ------------------------------- Fatura ------------------------------ */
  async listBillingPeriods(): Promise<MlBillingPeriod[]> {
    const r = await this.api.get<{ results?: { key?: string; period?: { date_from?: string; date_to?: string } }[] }>(
      '/billing/integration/monthly/periods',
      { group: 'ML', document_type: 'BILL', limit: 12 },
    );
    return (r.results ?? [])
      .filter((p) => p.key)
      .map((p) => ({ key: p.key!, dateFrom: p.period?.date_from ?? null, dateTo: p.period?.date_to ?? null, raw: p }));
  }

  private async readBillingDetailsOnce(key: string): Promise<MlBillingDetail[]> {
    const LIMIT = 1000;
    const out: MlBillingDetail[] = [];
    // Avança pelo que veio de fato (a API pode devolver menos que o limite por página)
    // e só para quando atingir o total informado ou receber uma página vazia.
    for (let offset = 0; ; ) {
      const r = await this.api.get<{ results?: MlRawBillingDetail[]; total?: number; paging?: { total?: number } }>(
        `/billing/integration/periods/key/${encodeURIComponent(key)}/group/ML/details`,
        { document_type: 'BILL', limit: LIMIT, offset },
      );
      const page = r.results ?? [];
      page.forEach((x, i) => out.push(toBillingDetail(key, x, offset + i)));
      offset += page.length;
      const total = r.total ?? r.paging?.total;
      if (!page.length || (total != null && offset >= total)) break;
    }
    return out;
  }

  /**
   * A API às vezes devolve um período incompleto: lê de novo até duas leituras
   * seguidas terem o mesmo número de linhas e fica com a mais completa.
   */
  async getBillingDetails(key: string, maxReads = 5): Promise<MlBillingDetail[]> {
    let best: MlBillingDetail[] = [];
    let previous = -1;
    for (let i = 0; i < maxReads; i++) {
      const rows = await this.readBillingDetailsOnce(key);
      if (rows.length > best.length) best = rows;
      if (rows.length === previous) break;
      previous = rows.length;
    }
    return best;
  }
}

export interface MlAdsCampaignDay { campaignId: string; day: string; cost: number; raw: unknown }
export interface MlBillingPeriod { key: string; dateFrom: string | null; dateTo: string | null; raw: unknown }
export interface MlBillingDetail {
  detailId: string;
  periodKey: string;
  createdAt: string | null;
  detailType: string | null; // CHARGE | BONUS
  code: string | null;       // ex.: CVVML, PADS, CDLIT
  amount: number;
  orderId: string | null;
  description: string | null;
  raw: unknown;
}
interface MlRawBillingDetail {
  charge_info?: {
    detail_id?: number | string;
    creation_date_time?: string;
    detail_type?: string;
    detail_sub_type?: string;
    detail_amount?: number;
    transaction_detail?: string;
  };
  sales_info?: { order_id?: number | string }[];
}

function toBillingDetail(periodKey: string, x: MlRawBillingDetail, index: number): MlBillingDetail {
  const ci = x.charge_info ?? {};
  const orderId = x.sales_info?.[0]?.order_id;
  return {
    detailId: ci.detail_id != null ? String(ci.detail_id) : `${periodKey}#${index}`,
    periodKey,
    createdAt: ci.creation_date_time ?? null,
    detailType: ci.detail_type ?? null,
    code: ci.detail_sub_type ?? null,
    amount: Number(ci.detail_amount ?? 0),
    orderId: orderId != null ? String(orderId) : null,
    description: ci.transaction_detail ?? null,
    raw: x,
  };
}
