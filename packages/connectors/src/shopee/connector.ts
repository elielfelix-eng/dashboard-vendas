import { createHmac } from 'node:crypto';
import type { AdsDailyMetric, Item, MarketplaceConnector, Order, VisitsDaily } from '../types.ts';

/**
 * Shopee Open Platform v2 — PREPARADO, ainda não ativo.
 * Será concluído na Fase 6, quando a conta no Shopee Open Platform for aprovada.
 *
 * Endpoints previstos:
 *  - /api/v2/product/get_item_list + get_item_base_info   -> anúncios
 *  - /api/v2/order/get_order_list + get_order_detail      -> pedidos
 *  - /api/v2/payment/get_escrow_detail                    -> tarifas reais e frete
 *  - /api/v2/ads/get_all_cpc_ads_daily_performance        -> Ads
 * Tokens: access 4h, refresh 30 dias.
 */
export const SHOPEE_API = 'https://partner.shopeemobile.com';

export interface ShopeeAppCredentials {
  partnerId: number;
  partnerKey: string;
}

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

export class ShopeeConnector implements MarketplaceConnector {
  readonly channel = 'shopee' as const;

  constructor(
    private readonly app: ShopeeAppCredentials,
    private readonly shopId: number,
  ) {}

  private notReady(): never {
    throw new Error(`Conector Shopee ainda não ativado (shop ${this.shopId}, partner ${this.app.partnerId}).`);
  }

  // eslint-disable-next-line require-yield
  async *listItems(): AsyncIterable<Item[]> { this.notReady(); }
  // eslint-disable-next-line require-yield
  async *listOrders(_from: Date, _to: Date): AsyncIterable<Order[]> { this.notReady(); }
  async getShipmentSellerCost(_id: string): Promise<number | null> { this.notReady(); }
  async getVisits(_itemId: string, _days: number): Promise<VisitsDaily[]> { this.notReady(); }
  // eslint-disable-next-line require-yield
  async *listAdsMetrics(_from: Date, _to: Date): AsyncIterable<AdsDailyMetric[]> { this.notReady(); }
}
