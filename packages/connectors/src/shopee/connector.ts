import { createHmac } from 'node:crypto';
import { chunk, fetchJson, HttpError } from '../http.ts';
import type { AdsDailyMetric, Item, MarketplaceConnector, Order, OrderItem, TokenProvider, VisitsDaily } from '../types.ts';
import { ShopeeAuthError } from './auth.ts';

/**
 * Shopee Open Platform v2 (somente leitura).
 *  - /api/v2/order/get_order_list + get_order_detail      -> pedidos (Tarefa 3)
 *  - /api/v2/payment/get_escrow_detail_batch              -> tarifas reais e frete (Tarefa 3)
 *  - anúncios, visitas e Ads: tarefas seguintes do projeto Shopee.
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

  private notReady(): never {
    throw new Error('Conector Shopee: recurso ainda não ativado (tarefas seguintes).');
  }

  // eslint-disable-next-line require-yield
  async *listItems(): AsyncIterable<Item[]> { this.notReady(); }
  async getShipmentSellerCost(_id: string): Promise<number | null> { this.notReady(); }
  async getVisits(_itemId: string, _days: number): Promise<VisitsDaily[]> { this.notReady(); }
  // eslint-disable-next-line require-yield
  async *listAdsMetrics(_from: Date, _to: Date): AsyncIterable<AdsDailyMetric[]> { this.notReady(); }
}
