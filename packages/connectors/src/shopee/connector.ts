import { createHmac } from 'node:crypto';
import { chunk, fetchJson, HttpError } from '../http.ts';
import type { AdsDailyMetric, Item, MarketplaceConnector, Order, OrderItem, TokenProvider, VisitsDaily } from '../types.ts';
import { ShopeeAuthError } from './auth.ts';

/**
 * Shopee Open Platform v2 (somente leitura).
 *  - /api/v2/order/get_order_list + get_order_detail      -> pedidos (Tarefa 3)
 *  - /api/v2/payment/get_escrow_detail_batch              -> tarifas reais e frete (Tarefa 3)
 *  - /api/v2/product/get_item_list + get_item_base_info + get_model_list -> anúncios e variações (Tarefa 4)
 *  - /api/v2/product/get_item_extra_info                  -> visualizações e vendas ACUMULADAS (sem série diária)
 *  - /api/v2/ads/get_all_cpc_ads_daily_performance        -> Shopee Ads da conta, por dia (Tarefa 4)
 *  - /api/v2/ads/get_product_level_campaign_id_list + get_product_level_campaign_setting_info
 *    + get_product_campaign_daily_performance             -> Ads por campanha/anúncio, se a loja tiver acesso
 * Só leitura: tudo GET, exceto o POST de leitura do escrow em lote.
 * Tokens: access 4h, refresh 30 dias (uso único).
 * Nenhuma mensagem de erro daqui leva token, partner key, assinatura, corpo de resposta ou dado de comprador.
 */
export const SHOPEE_API = 'https://partner.shopeemobile.com';

export interface ShopeeAppCredentials {
  partnerId: number;
  partnerKey: string;
}

export {
  SHOPEE_AUTH_EXPIRED,
  ShopeeAuthError,
  exchangeShopeeCode,
  refreshShopeeTokens,
  shopeeAuthUrl,
} from './auth.ts';

/** Assinatura HMAC-SHA256 exigida em toda chamada da Shopee. */
export function shopeeSign(
  app: ShopeeAppCredentials,
  path: string,
  timestamp: number,
  accessToken = '',
  shopId: number | '' = '',
): string {
  const base = `${app.partnerId}${path}${timestamp}${accessToken}${shopId}`;
  return createHmac('sha256', app.partnerKey).update(base).digest('hex');
}

/* ------------------------------------------------------------------------ */
/* Status do pedido                                                          */
/* ------------------------------------------------------------------------ */

const PAGOS = new Set(['READY_TO_SHIP', 'PROCESSED', 'SHIPPED', 'TO_CONFIRM_RECEIVE', 'COMPLETED', 'RETRY_SHIP', 'TO_RETURN']);
const CANCELADOS = new Set(['CANCELLED', 'IN_CANCEL']);

/**
 * Status da Shopee -> status do painel (o mesmo vocabulário do Mercado Livre):
 * pagos -> 'paid'; CANCELLED/IN_CANCEL -> 'cancelled'; UNPAID -> 'unpaid'; qualquer outro -> 'unknown'.
 * Só 'paid' conta como venda. O status original fica nas tags (shopee:<STATUS>) e no raw.
 */
export function mapShopeeStatus(status: unknown): 'paid' | 'cancelled' | 'unpaid' | 'unknown' {
  const s = typeof status === 'string' ? status : '';
  if (PAGOS.has(s)) return 'paid';
  if (CANCELADOS.has(s)) return 'cancelled';
  if (s === 'UNPAID') return 'unpaid';
  return 'unknown';
}

/* ------------------------------------------------------------------------ */
/* Pedido                                                                   */
/* ------------------------------------------------------------------------ */

/** Campos opcionais pedidos no detalhe. Nada de comprador, endereço, CPF ou nota fiscal. */
const DETAIL_FIELDS = 'item_list,pay_time,total_amount,cancel_by,cancel_reason,fulfillment_flag,edt';

/** Chaves que nunca vão para o banco (dados do comprador e do destinatário). */
const PRIVADOS = new Set(['message_to_seller', 'dropshipper', 'dropshipper_phone', 'invoice_data', 'note', 'buyer_cancel_reason']);
const ehPrivado = (k: string) => k.startsWith('buyer_') || k.startsWith('recipient') || PRIVADOS.has(k);

/** Cópia sem dados do comprador/destinatário, em qualquer nível. */
export function semDadosPessoais(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(semDadosPessoais);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (!ehPrivado(k)) out[k] = semDadosPessoais(x);
    return out;
  }
  return v;
}

type ShopeeOrderDetail = Record<string, unknown> & {
  order_sn?: string;
  order_status?: string;
  create_time?: number;
  update_time?: number;
  pay_time?: number | null;
  currency?: string;
  total_amount?: number | null;
  item_list?: Record<string, unknown>[] | null;
};

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const iso = (seg: unknown): string | null => (num(seg) ? new Date(num(seg)! * 1000).toISOString() : null);

/** Detalhe do pedido da Shopee -> pedido do painel. Itens ausentes ou incompletos não quebram. */
export function toShopeeOrder(o: ShopeeOrderDetail): Order {
  const bruto = typeof o.order_status === 'string' ? o.order_status : 'SEM_STATUS';
  const status = mapShopeeStatus(o.order_status);
  const itens = Array.isArray(o.item_list) ? o.item_list : [];
  const items: OrderItem[] = itens.map((li, i) => {
    const modelId = num(li.model_id) ?? (texto(li.model_id) ? Number(li.model_id) : null);
    return {
      lineNo: i + 1,
      itemId: li.item_id != null ? String(li.item_id) : '',
      variationId: modelId ? String(modelId) : null,
      sku: texto(li.model_sku) ?? texto(li.item_sku),
      title: texto(li.item_name) ?? '',
      quantity: num(li.model_quantity_purchased) ?? 0,
      unitPrice: num(li.model_discounted_price) || num(li.model_original_price) || 0,
      saleFee: null,
      listingType: null,
    };
  });
  const total = num(o.total_amount) ?? 0;
  const tags = [`shopee:${bruto}`];
  if (!num(o.pay_time)) tags.push('shopee:sem_pagamento');
  return {
    channel: 'shopee',
    orderId: String(o.order_sn ?? ''),
    packId: null,
    status,
    dateCreated: iso(o.create_time) ?? new Date(0).toISOString(),
    dateClosed: iso(o.pay_time),
    dateLastUpdated: iso(o.update_time),
    totalAmount: total,
    paidAmount: status === 'paid' ? total : null,
    currency: texto(o.currency) ?? 'BRL',
    buyerId: null,
    shipmentId: null,
    tags,
    items,
    raw: semDadosPessoais(o),
  };
}

/* ------------------------------------------------------------------------ */
/* Pagamento (escrow)                                                        */
/* ------------------------------------------------------------------------ */

/**
 * Campos de dinheiro do order_income que o painel usa (lista explícita). Todo o resto do escrow,
 * inclusive buyer_user_name, buyer_payment_info e qualquer nome/endereço/contato, é descartado.
 * buyer_paid_shipping_fee é um VALOR (frete pago pelo comprador), não dado pessoal.
 */
export const CAMPOS_ESCROW = [
  'escrow_amount', 'commission_fee', 'service_fee', 'seller_transaction_fee',
  'actual_shipping_fee', 'shopee_shipping_rebate', 'buyer_paid_shipping_fee', 'voucher_from_seller', 'seller_voucher',
  'campaign_fee', 'seller_order_processing_fee', 'return_handling_fee', 'reverse_shipping_fee',
  'shipping_seller_protection_fee_amount', 'delivery_seller_protection_fee_premium_amount', 'seller_return_refund',
] as const;

function soDinheiro(inc: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of CAMPOS_ESCROW) {
    const v = num(inc[k]);
    if (v !== null) out[k] = v;
  }
  return out;
}

/** Pagamento de um pedido: só os campos de CAMPOS_ESCROW do order_income. */
export interface ShopeeEscrow {
  orderSn: string;
  /** Campos de CAMPOS_ESCROW (base do mapeamento das tarifas). */
  income: Record<string, unknown>;
  /** Todos os valores em dinheiro do order_income (para conferência; ver camposNumericos). */
  campos?: Record<string, number>;
}

/** Únicos campos buyer_* aceitos na conferência: são valores, não dados pessoais. */
const BUYER_DINHEIRO = new Set(['buyer_paid_shipping_fee']);

/**
 * Valores em dinheiro do order_income, para conferência (genérico: não depende de conhecer os campos).
 * Entra todo campo do nível de cima cujo valor é um número finito e diferente de zero.
 * Ficam fora: textos (order_sn, códigos de cupom, nomes), listas e objetos (itens), zeros,
 * campos buyer_* (exceto buyer_paid_shipping_fee) e identificadores (nome "id" ou terminado em "_id").
 */
export function camposNumericos(inc: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!inc || typeof inc !== 'object' || Array.isArray(inc)) return out;
  for (const [k, v] of Object.entries(inc as Record<string, unknown>)) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) continue;
    if (k.startsWith('buyer_') && !BUYER_DINHEIRO.has(k)) continue;
    if (k === 'id' || k.endsWith('_id')) continue;
    out[k] = v;
  }
  return out;
}

export type ShopeeCategoria =
  | 'comissao' | 'taxa_servico' | 'taxa_transacao' | 'frete' | 'cupom_vendedor'
  | 'campanha' | 'processamento' | 'devolucao' | 'protecao_frete' | 'reembolso' | 'liquido';

export interface ShopeeTarifa { categoria: ShopeeCategoria; valor: number }

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Tarifas do pagamento, uma linha por categoria com valor diferente de zero.
 * Convenção igual à de analytics.ml_fatura: custo POSITIVO, crédito negativo. Cada campo entra com o
 * SINAL que a Shopee manda (tarifa positiva = custo; ajuste negativo = crédito); nada de abs().
 *  - comissao        = commission_fee (não net_commission_fee: o descontado é o commission_fee)
 *  - taxa_servico    = service_fee (não net_service_fee)
 *  - taxa_transacao  = seller_transaction_fee. credit_card_transaction_fee NÃO entra: os dados reais
 *                      mostram que ela não é descontada do escrow_amount (pedido 260821UJHT4HEC).
 *  - frete           = actual_shipping_fee - shopee_shipping_rebate - buyer_paid_shipping_fee
 *                      (negativo = crédito, quando subsídio + frete pago pelo comprador passam do frete real)
 *  - cupom_vendedor  = voucher_from_seller (ou seller_voucher). seller_discount NÃO entra: já está no
 *                      preço com desconto do item (model_discounted_price), entraria duas vezes.
 *  - campanha        = campaign_fee
 *  - processamento   = seller_order_processing_fee
 *  - devolucao       = return_handling_fee + reverse_shipping_fee
 *  - protecao_frete  = shipping_seller_protection_fee_amount + delivery_seller_protection_fee_premium_amount
 *  - reembolso       = -seller_return_refund (a Shopee manda negativo; vira custo positivo)
 *  - liquido         = escrow_amount (valor que a loja recebe; positivo). Não é tarifa: fica fora da view.
 * Sem escrow (ou sem escrow_amount numérico) devolve null: nenhuma linha, e o pedido é buscado de novo.
 */
export function tarifasDoEscrow(e: ShopeeEscrow | undefined | null): ShopeeTarifa[] | null {
  const inc = e?.income;
  if (!inc || num(inc.escrow_amount) === null) return null;
  const a = (k: string) => num(inc[k]) ?? 0;
  const cupom = num(inc.voucher_from_seller) !== null ? a('voucher_from_seller') : a('seller_voucher');
  const valores: [ShopeeCategoria, number][] = [
    ['comissao', a('commission_fee')],
    ['taxa_servico', a('service_fee')],
    ['taxa_transacao', a('seller_transaction_fee')],
    ['frete', a('actual_shipping_fee') - a('shopee_shipping_rebate') - a('buyer_paid_shipping_fee')],
    ['cupom_vendedor', cupom],
    ['campanha', a('campaign_fee')],
    ['processamento', a('seller_order_processing_fee')],
    ['devolucao', a('return_handling_fee') + a('reverse_shipping_fee')],
    ['protecao_frete', a('shipping_seller_protection_fee_amount') + a('delivery_seller_protection_fee_premium_amount')],
    ['reembolso', -a('seller_return_refund')],
    ['liquido', num(inc.escrow_amount)!],
  ];
  return valores.map(([categoria, v]) => ({ categoria, valor: r2(v) })).filter((t) => t.valor !== 0);
}

/* ------------------------------------------------------------------------ */
/* Anúncios (itens)                                                          */
/* ------------------------------------------------------------------------ */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const idTexto = (v: unknown): string | null => (num(v) !== null ? String(v) : texto(v));

/** Status do anúncio -> vocabulário do painel (o mesmo do Mercado Livre). Os demais ficam em minúsculas. */
function statusItem(s: unknown): string {
  if (s === 'NORMAL') return 'active';
  if (s === 'UNLIST') return 'paused';
  return typeof s === 'string' && s ? s.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40) : 'unknown';
}

const precoAtual = (v: unknown): number | null => {
  const p = obj(lista(v)[0]);
  return num(p.current_price) ?? num(p.original_price);
};
const estoque = (v: Obj): number | null =>
  num(obj(obj(v.stock_info_v2).summary_info).total_available_stock)
  ?? num(obj(lista(v.stock_info)[0]).current_stock);

/** Campos do get_item_extra_info guardados no raw (só números). views = visualizações ACUMULADAS. */
const CAMPOS_EXTRA = ['sale', 'views', 'likes', 'rating_star', 'comment_count'] as const;
function extraInfo(e: Obj | null): Record<string, number> | undefined {
  if (!e) return undefined;
  const out: Record<string, number> = {};
  for (const k of CAMPOS_EXTRA) {
    const v = num(e[k]) ?? (k === 'views' ? num(e.view_count) : null);
    if (v !== null) out[k] = v;
  }
  return out;
}

/**
 * Anúncio da Shopee -> anúncio do painel.
 *  - sku = item_sku; nas variações, sku = model_sku (vazio vira null: cai em "sem modelo").
 *  - status: NORMAL -> active, UNLIST -> paused (como no Mercado Livre); outros em minúsculas.
 *  - listingType sempre null (a Shopee não tem clássico/premium).
 *  - logisticType 'fulfillment' quando is_fulfillment_by_shopee (= Full do Mercado Livre); senão null.
 *  - soldQty = sale do get_item_extra_info (acumulado); as visualizações acumuladas ficam em raw.extra_info.views.
 *  - raw = base_info sem a descrição.
 */
export function toShopeeItem(b: Obj, modelos: Obj | null, extra: Obj | null, shopId: number): Item {
  const itemId = String(b.item_id ?? '');
  const tiers = lista(modelos?.tier_variation).map((t) => lista(obj(t).option_list).map((o) => texto(obj(o).option)));
  const variations = lista(modelos?.model).map((m0) => {
    const m = obj(m0);
    const idx = lista(m.tier_index).map((i) => num(i) ?? -1);
    return {
      variationId: String(m.model_id ?? ''),
      sku: texto(m.model_sku),
      price: precoAtual(m.price_info),
      availableQty: estoque(m),
      soldQty: null,
      attributes: { tier_index: idx, opcoes: idx.map((i, t) => tiers[t]?.[i] ?? null) },
    };
  }).filter((v) => v.variationId);
  const precos = variations.map((v) => v.price).filter((p): p is number => p !== null);
  const estoques = variations.map((v) => v.availableQty).filter((q): q is number => q !== null);
  const ex = extraInfo(extra);
  const { description: _d, description_info: _di, ...resto } = b;
  return {
    channel: 'shopee',
    itemId,
    title: texto(b.item_name) ?? '',
    sku: texto(b.item_sku),
    price: precoAtual(b.price_info) ?? (precos.length ? Math.min(...precos) : null),
    status: statusItem(b.item_status),
    categoryId: idTexto(b.category_id),
    listingType: null,
    logisticType: b.is_fulfillment_by_shopee === true ? 'fulfillment' : null,
    availableQty: estoque(b) ?? (estoques.length ? estoques.reduce((s, q) => s + q, 0) : null),
    soldQty: ex?.sale ?? null,
    health: null,
    permalink: itemId ? `https://shopee.com.br/product/${shopId}/${itemId}` : null,
    thumbnail: texto(lista(obj(b.image).image_url_list)[0]),
    dateCreated: iso(b.create_time),
    variations,
    raw: ex ? { ...resto, extra_info: ex } : resto,
  };
}

/* ------------------------------------------------------------------------ */
/* Shopee Ads                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Pseudo-campanha e pseudo-anúncio do Ads da CONTA. A Shopee garante o desempenho do Ads só no nível da
 * conta (get_all_cpc_ads_daily_performance). Ele é gravado:
 *  - em mkt.ads_campaign_daily como campaign_id 'conta' (investimento do dia: fonte do cartão);
 *  - em mkt.ads_metrics_daily como item_id 'conta' com o que não foi atribuído a anúncio (sem anúncio
 *    no cadastro: cai em "sem modelo" nas funções do Ads).
 */
export const ADS_CONTA = 'conta';

/** 'AAAA-MM-DD' -> 'DD-MM-AAAA' (formato das datas do Ads da Shopee). */
export function dataShopeeAds(dia: string): string {
  const [a, m, d] = dia.split('-');
  return `${d}-${m}-${a}`;
}

/** Data do Ads da Shopee ('DD-MM-AAAA' ou 'AAAA-MM-DD') -> 'AAAA-MM-DD'; inválida -> null. */
export function diaShopeeAds(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(v.trim());
  const ymd = m ? `${m[3]}-${m[2]}-${m[1]}` : (m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim())) ? m[0] : null;
  if (!ymd) return null;
  const d = new Date(`${ymd}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== ymd ? null : ymd;
}

/** Um dia de desempenho do Ads (conta ou campanha). */
export interface ShopeeAdsDia {
  day: string;
  impressions: number;
  clicks: number;
  cost: number;
  /** direct_gmv: vendas do próprio anúncio. */
  directAmount: number;
  /** broad_gmv: todas as vendas atribuídas (inclui as diretas). */
  broadAmount: number;
  directUnits: number;
  broadUnits: number;
  /** Demais números da Shopee (pedidos, ROAS, CTR, custo por conversão), para conferência. */
  raw: Record<string, number>;
}

const CAMPOS_ADS_USADOS = new Set(['date', 'expense', 'impression', 'clicks', 'direct_gmv', 'broad_gmv',
  'direct_item_sold', 'broad_item_sold', 'direct_order_amount', 'broad_order_amount']);

/** Linha diária do Ads da Shopee -> ShopeeAdsDia (sem data válida: null). */
export function metricaAdsShopee(r: unknown): ShopeeAdsDia | null {
  const o = obj(r);
  const day = diaShopeeAds(o.date);
  if (!day) return null;
  const n = (k: string) => num(o[k]) ?? 0;
  const raw: Record<string, number> = {};
  for (const [k, v] of Object.entries(o)) if (!CAMPOS_ADS_USADOS.has(k) && num(v) !== null) raw[k] = v as number;
  return {
    day,
    impressions: Math.round(n('impression')),
    clicks: Math.round(n('clicks')),
    cost: r2(n('expense')),
    directAmount: r2(n('direct_gmv')),
    broadAmount: r2(n('broad_gmv')),
    directUnits: Math.round(num(o.direct_item_sold) ?? n('direct_order_amount')),
    broadUnits: Math.round(num(o.broad_item_sold) ?? n('broad_order_amount')),
    raw,
  };
}

/** ShopeeAdsDia -> métrica do painel. Indireta = ampla - direta (nunca negativa). */
function paraMetrica(d: ShopeeAdsDia, itemId: string, campaignId: string | null): AdsDailyMetric {
  return {
    itemId, day: d.day, campaignId, status: null,
    impressions: d.impressions, clicks: d.clicks, cost: d.cost,
    directAmount: d.directAmount, indirectAmount: r2(Math.max(d.broadAmount - d.directAmount, 0)),
    directUnits: d.directUnits, indirectUnits: Math.max(d.broadUnits - d.directUnits, 0), organicUnits: 0,
  };
}

const temValor = (m: AdsDailyMetric) =>
  m.cost !== 0 || m.impressions !== 0 || m.clicks !== 0 || m.directAmount !== 0 || m.indirectAmount !== 0 || m.directUnits !== 0 || m.indirectUnits !== 0;

/**
 * Linhas de mkt.ads_metrics_daily dos dias que a CONTA devolveu, sem somar o mesmo dia duas vezes:
 *  - conta: um registro por dia (dia repetido na resposta: vale o último);
 *  - por anúncio (se houver): mesma campanha + anúncio + dia repetido vale uma vez; campanhas diferentes do
 *    mesmo anúncio no mesmo dia somam (fica a campanha de maior gasto). Dias que a conta não devolveu saem;
 *  - item 'conta' = conta - soma dos anúncios do dia, por métrica, nunca negativa (Ads de loja etc.).
 *    Sem dados por anúncio, é o dia inteiro da conta.
 * Linhas totalmente zeradas não entram.
 */
export function combinarAdsShopee(conta: ShopeeAdsDia[], produtos: AdsDailyMetric[] | null): AdsDailyMetric[] {
  const porDia = new Map(conta.map((d) => [d.day, d]));
  const unicos = new Map<string, AdsDailyMetric>();
  for (const m of produtos ?? []) if (porDia.has(m.day)) unicos.set(`${m.campaignId}|${m.itemId}|${m.day}`, m);
  const porAnuncio = new Map<string, { m: AdsDailyMetric; maior: number }>();
  for (const m of unicos.values()) {
    const k = `${m.itemId}|${m.day}`;
    const cur = porAnuncio.get(k);
    if (!cur) { porAnuncio.set(k, { m: { ...m, status: m.status ?? null }, maior: m.cost }); continue; }
    const a = cur.m;
    if (m.cost > cur.maior) { cur.maior = m.cost; a.campaignId = m.campaignId; }
    a.impressions += m.impressions; a.clicks += m.clicks; a.cost = r2(a.cost + m.cost);
    a.directAmount = r2(a.directAmount + m.directAmount); a.indirectAmount = r2(a.indirectAmount + m.indirectAmount);
    a.directUnits += m.directUnits; a.indirectUnits += m.indirectUnits; a.organicUnits += m.organicUnits;
  }
  const out: AdsDailyMetric[] = [];
  for (const d of [...porDia.values()].sort((a, b) => a.day.localeCompare(b.day))) {
    const doDia = [...porAnuncio.values()].map((x) => x.m).filter((m) => m.day === d.day)
      .sort((a, b) => a.itemId.localeCompare(b.itemId));
    const total = paraMetrica(d, ADS_CONTA, ADS_CONTA);
    const s = (k: keyof AdsDailyMetric) => doDia.reduce((t, m) => t + (m[k] as number), 0);
    const resto: AdsDailyMetric = {
      ...total,
      impressions: Math.max(total.impressions - s('impressions'), 0),
      clicks: Math.max(total.clicks - s('clicks'), 0),
      cost: r2(Math.max(total.cost - s('cost'), 0)),
      directAmount: r2(Math.max(total.directAmount - s('directAmount'), 0)),
      indirectAmount: r2(Math.max(total.indirectAmount - s('indirectAmount'), 0)),
      directUnits: Math.max(total.directUnits - s('directUnits'), 0),
      indirectUnits: Math.max(total.indirectUnits - s('indirectUnits'), 0),
    };
    for (const m of [...doDia, resto]) if (temValor(m)) out.push(m);
  }
  return out;
}

/** Cadastro de uma campanha de Ads por produto. */
export interface ShopeeAdsCampanha {
  campaignId: string;
  name: string | null;
  /** ongoing -> active (vocabulário do painel); os demais em minúsculas (paused, ended...). */
  status: string | null;
  budget: number | null;
  automatica: boolean | null;
  itemIds: string[];
  raw: unknown;
}

export interface ShopeeAdsProdutos {
  /** Uma linha por campanha, anúncio e dia. Campanha com 0 ou vários anúncios: itemId 'campanha:<id>'. */
  metricas: AdsDailyMetric[];
  campanhas: ShopeeAdsCampanha[];
}

const statusCampanha = (s: unknown): string | null => {
  const t = texto(s)?.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 40) ?? null;
  return t === 'ongoing' ? 'active' : t;
};

/** Janelas [de, ate] (AAAA-MM-DD) de até `max` dias, sem sobreposição. */
function janelasDias(de: string, ate: string, max = 30): [string, string][] {
  const out: [string, string][] = [];
  const fim = Date.parse(`${ate}T00:00:00Z`);
  for (let a = Date.parse(`${de}T00:00:00Z`); a <= fim; a += max * 86_400_000) {
    const b = Math.min(a + (max - 1) * 86_400_000, fim);
    out.push([new Date(a).toISOString().slice(0, 10), new Date(b).toISOString().slice(0, 10)]);
  }
  return out;
}

/** Data em Brasília (AAAA-MM-DD). */
const diaSP = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

/* ------------------------------------------------------------------------ */
/* Conector                                                                  */
/* ------------------------------------------------------------------------ */

/** Token recusado: só estes (ou HTTP 401 sem código) podem pedir renovação. */
const TOKEN_ERRORS = new Set(['error_auth', 'invalid_acceess_token', 'invalid_access_token']);
/** Só o código de erro da Shopee (ex.: order.order_list_invalid_time), nunca a mensagem. */
const codigoErro = (v: unknown) => (typeof v === 'string' ? v.replace(/[^a-z0-9_.]/gi, '').slice(0, 80) : '');

/** Janela máxima da lista de pedidos: 15 dias (com 16 a Shopee recusa). */
const JANELA_SEG = 15 * 86_400;
/** Teto de páginas por janela (proteção contra cursor que não termina). */
export const MAX_PAGINAS = 1000;

interface ShopeeEnvelope<T> { error?: string; message?: string; response?: T }

export class ShopeeConnector implements MarketplaceConnector {
  readonly channel = 'shopee' as const;

  constructor(
    private readonly app: ShopeeAppCredentials,
    private readonly shopId: number,
    private readonly getToken: TokenProvider = async () => { throw new Error('Conector Shopee sem token.'); },
  ) {}

  /** A renovação forçada acontece no máximo uma vez por instância (= por execução da loja). */
  private renovou = false;

  /**
   * Chamada da loja, assinada.
   *  - token recusado (error_auth / invalid_access_token / HTTP 401): renova UMA vez na execução e repete;
   *    recusado de novo -> ShopeeAuthError (aviso de reconexão);
   *  - sem permissão (error_permission / HTTP 403): erro "Sem permissão na API da Shopee (<código>)",
   *    sem renovar token e sem pedir reconexão.
   */
  private async call<T>(path: string, params: Record<string, string | number> = {}, body?: unknown): Promise<T> {
    const label = `Shopee ${path}`;
    const tentar = async (force: boolean): Promise<T> => {
      const token = await this.getToken(force);
      const ts = Math.floor(Date.now() / 1000);
      const u = new URL(SHOPEE_API + path);
      u.searchParams.set('partner_id', String(this.app.partnerId));
      u.searchParams.set('timestamp', String(ts));
      u.searchParams.set('access_token', token);
      u.searchParams.set('shop_id', String(this.shopId));
      u.searchParams.set('sign', shopeeSign(this.app, path, ts, token, this.shopId));
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
      const init: RequestInit = body === undefined
        ? { headers: { accept: 'application/json' } }
        : { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) };

      let data: ShopeeEnvelope<T>;
      let status = 200;
      try {
        data = await fetchJson<ShopeeEnvelope<T>>(u, init, { label });
      } catch (err) {
        if (!(err instanceof HttpError)) throw err; // falha de rede: a mensagem usa só o label
        status = err.status;
        try { data = JSON.parse(err.body) as ShopeeEnvelope<T>; } catch { data = {}; }
      }
      const code = codigoErro(data.error);
      if (TOKEN_ERRORS.has(code) || (status === 401 && !code)) {
        if (!force && !this.renovou) {
          this.renovou = true;
          return tentar(true);
        }
        throw new ShopeeAuthError(code || `http_${status}`);
      }
      if (code === 'error_permission' || status === 403) {
        throw new Error(`Sem permissão na API da Shopee (${code || `http_${status}`}) em ${label}`);
      }
      if (status !== 200) throw new Error(`HTTP ${status} em ${label}${code ? `: ${code}` : ''}`);
      if (code) throw new Error(`Erro da Shopee em ${label}: ${code}`);
      return data.response as T;
    };
    return tentar(false);
  }

  /**
   * Pedidos CRIADOS no intervalo, em janelas de até 15 dias (create_time, em segundos, limites inclusivos).
   * Janelas consecutivas se sobrepõem em 1 segundo (a próxima começa no último segundo da anterior),
   * para não depender de a Shopee tratar o limite como inclusivo; os repetidos são descartados.
   * Lista paginada por cursor (100 por página, no máximo MAX_PAGINAS por janela); detalhe em lotes de 50.
   * Um mesmo pedido nunca sai duas vezes.
   */
  async *listOrders(from: Date, to: Date): AsyncIterable<Order[]> {
    const ini = Math.floor(from.getTime() / 1000);
    const fim = Math.floor(to.getTime() / 1000);
    const vistos = new Set<string>();
    for (let a = ini; ; ) {
      const b = Math.min(a + JANELA_SEG - 1, fim);
      const sns: string[] = [];
      const cursores = new Set<string>();
      let cursor = '';
      for (let pagina = 1; ; pagina++) {
        const r = await this.call<{ more?: boolean; next_cursor?: string; order_list?: { order_sn?: string }[] }>(
          '/api/v2/order/get_order_list',
          { time_range_field: 'create_time', time_from: a, time_to: b, page_size: 100, cursor },
        );
        for (const o of r?.order_list ?? []) {
          if (o.order_sn && !vistos.has(o.order_sn)) { vistos.add(o.order_sn); sns.push(o.order_sn); }
        }
        if (!r?.more || !r.next_cursor) break;
        cursores.add(cursor);
        if (cursores.has(r.next_cursor)) {
          console.warn('[Shopee] get_order_list: cursor repetido, paginação interrompida');
          break;
        }
        if (pagina >= MAX_PAGINAS) {
          console.warn(`[Shopee] get_order_list: limite de ${MAX_PAGINAS} páginas atingido, paginação interrompida`);
          break;
        }
        cursor = r.next_cursor;
      }
      for (const lote of chunk(sns, 50)) yield await this.detalhes(lote);
      if (b >= fim) break;
      a = b; // sobreposição de 1 segundo
    }
  }

  /** Detalhe de pedidos já conhecidos (nova busca de status e de pagamento). */
  async getOrders(orderSns: string[]): Promise<Order[]> {
    const out: Order[] = [];
    for (const lote of chunk(orderSns, 50)) out.push(...(await this.detalhes(lote)));
    return out;
  }

  private async detalhes(sns: string[]): Promise<Order[]> {
    if (!sns.length) return [];
    const r = await this.call<{ order_list?: ShopeeOrderDetail[] }>('/api/v2/order/get_order_detail', {
      order_sn_list: sns.join(','),
      response_optional_fields: DETAIL_FIELDS,
    });
    return (r?.order_list ?? []).filter((o) => o?.order_sn).map(toShopeeOrder);
  }

  /** Pagamento (escrow) de até 50 pedidos por chamada (POST de leitura). Pedido sem escrow fica de fora. */
  async getEscrowBatch(orderSns: string[]): Promise<ShopeeEscrow[]> {
    const out: ShopeeEscrow[] = [];
    for (const lote of chunk(orderSns, 50)) {
      const r = await this.call<{ escrow_detail?: { order_sn?: string; order_income?: Record<string, unknown> } }[]>(
        '/api/v2/payment/get_escrow_detail_batch', {}, { order_sn_list: lote },
      );
      for (const x of Array.isArray(r) ? r : []) {
        const d = x?.escrow_detail;
        if (d?.order_sn && d.order_income && typeof d.order_income === 'object') {
          out.push({ orderSn: d.order_sn, income: soDinheiro(d.order_income), campos: camposNumericos(d.order_income) });
        }
      }
    }
    return out;
  }

  /**
   * Partes opcionais que falharam nesta execução (só rótulos fixos: 'visitas', 'modelos', 'ads_produto',
   * 'ads_campanhas'). A mensagem de cada falha vai para o log com o rótulo e o código da Shopee, nunca o corpo.
   */
  readonly avisos: string[] = [];

  private avisar(rotulo: string, err: unknown) {
    if (!this.avisos.includes(rotulo)) this.avisos.push(rotulo);
    console.warn(`[Shopee] ${rotulo} indisponível (segue sem esse dado): ${(err as Error).message}`);
  }

  /* ---------------------------- Anúncios ---------------------------- */

  /** IDs dos anúncios com o status pedido (get_item_list, 100 por página, por offset). */
  private async idsDosItens(status: 'NORMAL' | 'UNLIST'): Promise<number[]> {
    const ids: number[] = [];
    for (let offset = 0, pagina = 1; ; pagina++) {
      const r = obj(await this.call<unknown>('/api/v2/product/get_item_list', { offset, page_size: 100, item_status: status }));
      for (const it of lista(r.item)) {
        const id = num(obj(it).item_id);
        if (id !== null) ids.push(id);
      }
      const prox = num(r.next_offset);
      if (r.has_next_page !== true || prox === null || prox <= offset || pagina >= MAX_PAGINAS) break;
      offset = prox;
    }
    return ids;
  }

  /**
   * Anúncios ativos (NORMAL) e pausados (UNLIST), em lotes de 50 (get_item_base_info), com as variações
   * (get_model_list, só de quem tem has_model) e as visualizações/vendas acumuladas (get_item_extra_info).
   * Falha das variações ou das visualizações não derruba os anúncios (fica em `avisos`).
   */
  async *listItems(): AsyncIterable<Item[]> {
    const ids = [...new Set([...(await this.idsDosItens('NORMAL')), ...(await this.idsDosItens('UNLIST'))])];
    for (const lote of chunk(ids, 50)) {
      const r = obj(await this.call<unknown>('/api/v2/product/get_item_base_info', { item_id_list: lote.join(',') }));
      const bases = lista(r.item_list).map(obj).filter((b) => num(b.item_id) !== null);
      let extras = new Map<number, Obj>();
      if (!this.avisos.includes('visitas')) {
        try {
          const e = obj(await this.call<unknown>('/api/v2/product/get_item_extra_info', { item_id_list: lote.join(',') }));
          extras = new Map(lista(e.item_list).map(obj).filter((x) => num(x.item_id) !== null).map((x) => [num(x.item_id)!, x]));
        } catch (err) {
          this.avisar('visitas', err);
        }
      }
      const itens: Item[] = [];
      for (const b of bases) {
        let modelos: Obj | null = null;
        if (b.has_model === true) {
          try {
            modelos = obj(await this.call<unknown>('/api/v2/product/get_model_list', { item_id: num(b.item_id)! }));
          } catch (err) {
            this.avisar('modelos', err);
          }
        }
        itens.push(toShopeeItem(b, modelos, extras.get(num(b.item_id)!) ?? null, this.shopId));
      }
      if (itens.length) yield itens;
    }
  }

  async getShipmentSellerCost(_id: string): Promise<number | null> {
    throw new Error('Conector Shopee: o frete vem do pagamento (escrow), não do envio.');
  }

  /**
   * A Shopee não tem visitas por dia: get_item_extra_info dá só as visualizações ACUMULADAS, que ficam em
   * mkt.items.raw.extra_info.views (listItems). Nenhuma série diária é inventada.
   */
  async getVisits(_itemId: string, _days: number): Promise<VisitsDaily[]> {
    return [];
  }

  /* ---------------------------- Shopee Ads ---------------------------- */

  /** Ads da conta por dia, de `de` a `ate` (AAAA-MM-DD, inclusive), em janelas de até 30 dias. Dia repetido: vale o último. */
  async getAdsConta(de: string, ate: string): Promise<ShopeeAdsDia[]> {
    const dias = new Map<string, ShopeeAdsDia>();
    for (const [a, b] of janelasDias(de, ate)) {
      const r = await this.call<unknown>('/api/v2/ads/get_all_cpc_ads_daily_performance',
        { start_date: dataShopeeAds(a), end_date: dataShopeeAds(b) });
      const linhas = Array.isArray(r) ? r : lista(obj(r).result_list ?? obj(r).list);
      for (const l of linhas) {
        const d = metricaAdsShopee(l);
        if (d) dias.set(d.day, d);
      }
    }
    return [...dias.values()].sort((x, y) => x.day.localeCompare(y.day));
  }

  /**
   * Ads por campanha de produto (se a loja tiver acesso):
   *  1. get_product_level_campaign_id_list (todas as campanhas, por offset);
   *  2. get_product_level_campaign_setting_info (nome, status, orçamento e anúncios; 100 por chamada) — opcional;
   *  3. get_product_campaign_daily_performance (100 campanhas por chamada, janelas de até 30 dias).
   * Campanha com exatamente 1 anúncio: a métrica vai para o anúncio. Com 0 ou vários (ou sem cadastro):
   * itemId 'campanha:<id>' (não é dividida; cai em "sem modelo").
   * Erro nos passos 1 ou 3 (404, sem permissão...) é lançado: quem chama decide seguir só com a conta.
   */
  async getAdsProdutos(de: string, ate: string): Promise<ShopeeAdsProdutos> {
    const ids: string[] = [];
    for (let offset = 0, pagina = 1; ; pagina++) {
      const r = obj(await this.call<unknown>('/api/v2/ads/get_product_level_campaign_id_list', { offset, limit: 100 }));
      const l = lista(r.campaign_list).map((c) => idTexto(obj(c).campaign_id)).filter((x): x is string => !!x);
      ids.push(...l);
      if (r.has_next_page !== true || !l.length || pagina >= MAX_PAGINAS) break;
      offset += l.length;
    }
    const unicos = [...new Set(ids)];
    const campanhas: ShopeeAdsCampanha[] = [];
    try {
      for (const lote of chunk(unicos, 100)) {
        const r = obj(await this.call<unknown>('/api/v2/ads/get_product_level_campaign_setting_info',
          { info_type_list: '1', campaign_id_list: lote.join(',') }));
        for (const c0 of lista(r.campaign_list)) {
          const c = obj(c0);
          const ci = obj(c.common_info);
          const id = idTexto(c.campaign_id);
          if (!id) continue;
          const tipo = texto(ci.ad_type);
          campanhas.push({
            campaignId: id,
            name: texto(ci.ad_name),
            status: statusCampanha(ci.campaign_status),
            budget: num(ci.campaign_budget),
            automatica: tipo ? tipo === 'auto' : null,
            itemIds: lista(ci.item_id_list).map(idTexto).filter((x): x is string => !!x),
            raw: ci,
          });
        }
      }
    } catch (err) {
      this.avisar('ads_campanhas', err);
      campanhas.length = 0;
    }
    const anuncio = new Map(campanhas.map((c) => [c.campaignId, c.itemIds.length === 1 ? c.itemIds[0] : null]));
    const metricas: AdsDailyMetric[] = [];
    for (const lote of chunk(unicos, 100)) {
      for (const [a, b] of janelasDias(de, ate)) {
        const r = obj(await this.call<unknown>('/api/v2/ads/get_product_campaign_daily_performance',
          { start_date: dataShopeeAds(a), end_date: dataShopeeAds(b), campaign_id_list: lote.join(',') }));
        for (const c0 of lista(r.campaign_list)) {
          const c = obj(c0);
          const id = idTexto(c.campaign_id);
          if (!id) continue;
          for (const l of lista(c.metrics_list)) {
            const d = metricaAdsShopee(l);
            if (d) metricas.push(paraMetrica(d, anuncio.get(id) ?? `campanha:${id}`, id));
          }
        }
      }
    }
    return { metricas, campanhas };
  }

  /**
   * Métricas diárias do Ads para mkt.ads_metrics_daily (contrato comum): por anúncio quando a Shopee permitir,
   * mais o resto da conta no item 'conta' (ver combinarAdsShopee). Sem acesso por anúncio: só a conta.
   */
  async *listAdsMetrics(from: Date, to: Date): AsyncIterable<AdsDailyMetric[]> {
    const de = diaSP(from);
    const ate = diaSP(to);
    const conta = await this.getAdsConta(de, ate);
    let produtos: AdsDailyMetric[] | null = null;
    try {
      produtos = (await this.getAdsProdutos(de, ate)).metricas;
    } catch (err) {
      this.avisar('ads_produto', err);
    }
    yield combinarAdsShopee(conta, produtos);
  }
}
