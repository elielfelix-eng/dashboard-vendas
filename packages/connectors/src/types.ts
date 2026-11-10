/**
 * Modelo comum a todos os marketplaces. Cada conector (Mercado Livre, Shopee...)
 * converte os dados da sua API para estes formatos, e o resto do sistema
 * (banco, dashboard) não precisa saber de onde o dado veio.
 */

export type Channel = 'mercadolivre' | 'shopee';

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  externalUserId: string;
  scope?: string;
}

/** Função que devolve um access token válido; force=true pede renovação. */
export type TokenProvider = (force?: boolean) => Promise<string>;

export interface ItemVariation {
  variationId: string;
  sku: string | null;
  price: number | null;
  availableQty: number | null;
  soldQty: number | null;
  attributes: unknown;
}

export interface Item {
  channel: Channel;
  itemId: string;
  title: string;
  sku: string | null;
  price: number | null;
  status: string;
  categoryId: string | null;
  listingType: string | null;
  logisticType: string | null;
  availableQty: number | null;
  soldQty: number | null;
  health: number | null;
  permalink: string | null;
  thumbnail: string | null;
  dateCreated: string | null;
  variations: ItemVariation[];
  raw: unknown;
}

export interface OrderItem {
  lineNo: number;
  itemId: string;
  variationId: string | null;
  sku: string | null;
  title: string;
  quantity: number;
  unitPrice: number;
  saleFee: number | null;
  listingType: string | null;
}

export interface Order {
  channel: Channel;
  orderId: string;
  packId: string | null;
  status: string;
  dateCreated: string;
  dateClosed: string | null;
  dateLastUpdated: string | null;
  totalAmount: number;
  paidAmount: number | null;
  currency: string;
  buyerId: string | null;
  shipmentId: string | null;
  tags: string[];
  items: OrderItem[];
  raw: unknown;
}

export interface VisitsDaily {
  itemId: string;
  day: string; // YYYY-MM-DD
  visits: number;
}

export interface AdsDailyMetric {
  itemId: string;
  day: string; // YYYY-MM-DD
  campaignId: string | null;
  impressions: number;
  clicks: number;
  cost: number;
  directAmount: number;
  indirectAmount: number;
  directUnits: number;
  indirectUnits: number;
  organicUnits: number;
}

/** Contrato que todo marketplace precisa cumprir. */
export interface MarketplaceConnector {
  readonly channel: Channel;
  /** Lista todos os anúncios da conta, em lotes. */
  listItems(): AsyncIterable<Item[]>;
  /** Pedidos criados OU alterados no intervalo, em lotes. */
  listOrders(from: Date, to: Date): AsyncIterable<Order[]>;
  /** Custo de frete pago pelo vendedor em um envio. */
  getShipmentSellerCost(shipmentId: string): Promise<number | null>;
  /** Visitas diárias dos últimos `days` dias de um anúncio. */
  getVisits(itemId: string, days: number): Promise<VisitsDaily[]>;
  /** Métricas diárias de Ads por anúncio. */
  listAdsMetrics(from: Date, to: Date): AsyncIterable<AdsDailyMetric[]>;
}
