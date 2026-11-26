import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AdsDailyMetric } from '../types.ts';
import {
  ADS_CONTA,
  ShopeeConnector,
  combinarAdsShopee,
  dataShopeeAds,
  diaShopeeAds,
  metricaAdsShopee,
  shopeeSign,
  toShopeeItem,
  type ShopeeAdsDia,
} from './connector.ts';

// Tarefa 4 (anúncios e Shopee Ads). Chave, tokens e loja FICTÍCIOS — nenhum valor real.
const app = { partnerId: 2001887, partnerKey: 'chave-ficticia-de-teste' };
const SHOP_ID = 123456;

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Chamada { url: URL; method: string }

/** Servidor falso da Shopee: responde por caminho; caminho desconhecido = 404 error_not_found. */
function servidor(rotas: Record<string, (u: URL) => Response>): Chamada[] {
  const chamadas: Chamada[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(url);
    chamadas.push({ url: u, method: init?.method ?? 'GET' });
    const rota = rotas[u.pathname];
    if (!rota) return json({ error: 'error_not_found', message: 'acc-1' }, 404);
    return rota(u);
  }) as typeof fetch;
  return chamadas;
}

const provider = async (force = false) => (force ? 'acc-novo' : 'acc-1');

// ------------------------------------------------------------------------
// Step 1 — métrica diária do Ads sem somar o mesmo dia duas vezes
// ------------------------------------------------------------------------

const contaDia = (day: string, cost: number, extra: Partial<ShopeeAdsDia> = {}): ShopeeAdsDia => ({
  day, impressions: 1000, clicks: 50, cost, directAmount: 300, broadAmount: 400, directUnits: 3, broadUnits: 5, raw: {}, ...extra,
});
const zerado = { impressions: 0, clicks: 0, directAmount: 0, broadAmount: 0, directUnits: 0, broadUnits: 0 };
const met = (itemId: string, day: string, campaignId: string, cost: number, extra: Partial<AdsDailyMetric> = {}): AdsDailyMetric => ({
  itemId, day, campaignId, impressions: 100, clicks: 10, cost, directAmount: 50, indirectAmount: 10,
  directUnits: 1, indirectUnits: 1, organicUnits: 0, ...extra,
});

test('datas do Ads: AAAA-MM-DD <-> DD-MM-AAAA; data inválida vira null', () => {
  assert.equal(dataShopeeAds('2026-11-05'), '05-11-2026');
  assert.equal(diaShopeeAds('05-11-2026'), '2026-11-05');
  assert.equal(diaShopeeAds('2026-11-05'), '2026-11-05');
  assert.equal(diaShopeeAds('31-02-2026'), null);
  assert.equal(diaShopeeAds('x'), null);
  assert.equal(diaShopeeAds(undefined), null);
});

test('linha diária do Ads: campos da Shopee viram as métricas do painel', () => {
  const d = metricaAdsShopee({
    date: '05-11-2026', expense: 12.346, impression: 900, clicks: 40, direct_gmv: 100, broad_gmv: 160,
    direct_item_sold: 2, broad_item_sold: 3, direct_order: 2, broad_order: 3, ctr: 4.4, direct_roas: 8.1, broad_roas: 12.9, cost_per_conversion: 4.1,
  })!;
  assert.deepEqual({ ...d, raw: undefined }, {
    day: '2026-11-05', cost: 12.35, impressions: 900, clicks: 40, directAmount: 100, broadAmount: 160, directUnits: 2, broadUnits: 3, raw: undefined,
  });
  assert.deepEqual(d.raw, { direct_order: 2, broad_order: 3, ctr: 4.4, direct_roas: 8.1, broad_roas: 12.9, cost_per_conversion: 4.1 });
  assert.equal(metricaAdsShopee({ expense: 1 }), null, 'sem data: descartada');
});

test('Ads só da conta: um registro por dia na pseudo-campanha "conta" (indireta = ampla - direta)', () => {
  assert.deepEqual(combinarAdsShopee([contaDia('2026-11-05', 60)], null), [{
    itemId: ADS_CONTA, day: '2026-11-05', campaignId: ADS_CONTA, status: null, impressions: 1000, clicks: 50, cost: 60,
    directAmount: 300, indirectAmount: 100, directUnits: 3, indirectUnits: 2, organicUnits: 0,
  }]);
});

test('o mesmo dia repetido na resposta da conta não é somado duas vezes', () => {
  const r = combinarAdsShopee([contaDia('2026-11-05', 60), contaDia('2026-11-05', 60), contaDia('2026-11-06', 10)], null);
  assert.equal(r.length, 2);
  assert.equal(r.find((x) => x.day === '2026-11-05')!.cost, 60);
  assert.equal(r.reduce((s, x) => s + x.cost, 0), 70);
});

test('por anúncio: mesma campanha/anúncio/dia repetido não soma; campanhas diferentes do mesmo anúncio somam; resto fica na "conta"', () => {
  const r = combinarAdsShopee([contaDia('2026-11-05', 60)], [
    met('111', '2026-11-05', 'c1', 20),
    met('111', '2026-11-05', 'c1', 20),   // repetido (ex.: página repetida): não soma
    met('111', '2026-11-05', 'c2', 5),    // outra campanha do mesmo anúncio: soma
    met('222', '2026-11-05', 'c3', 15),
  ]);
  assert.equal(r.filter((x) => x.itemId === '111').length, 1);
  const a = r.find((x) => x.itemId === '111')!;
  assert.equal(a.cost, 25);
  assert.equal(a.campaignId, 'c1', 'campanha de maior gasto');
  assert.equal(r.find((x) => x.itemId === '222')!.cost, 15);
  // O resto da conta (Ads de loja etc.) fica na linha "conta": o total do dia = o da conta
  assert.equal(r.find((x) => x.itemId === ADS_CONTA)!.cost, 20);
  assert.equal(r.reduce((s, x) => s + x.cost, 0), 60);
  assert.equal(r.find((x) => x.itemId === ADS_CONTA)!.directAmount, 300 - 150);
});

test('por anúncio: dia fora da resposta da conta é descartado; resto negativo vira zero; dia zerado não vira linha', () => {
  const r = combinarAdsShopee(
    [contaDia('2026-11-05', 10, { ...zerado, impressions: 50, clicks: 5 }), contaDia('2026-11-07', 0, zerado)],
    [met('111', '2026-11-05', 'c1', 12), met('111', '2026-11-06', 'c1', 99)],
  );
  assert.deepEqual(r.map((x) => [x.itemId, x.day, x.cost]), [['111', '2026-11-05', 12]]);
});

test('getAdsConta: GET assinado, datas DD-MM-AAAA, janelas de até 30 dias, sem repetir o dia', async () => {
  const janelas: [string, string][] = [];
  const chamadas = servidor({
    '/api/v2/ads/get_all_cpc_ads_daily_performance': (u) => {
      const ini = u.searchParams.get('start_date')!;
      janelas.push([ini, u.searchParams.get('end_date')!]);
      const linha = { date: ini, expense: 10, impression: 100, clicks: 5, direct_gmv: 50, broad_gmv: 70, direct_item_sold: 1, broad_item_sold: 2 };
      return json({ error: '', message: '', response: [linha, linha] });
    },
  });
  const r = await new ShopeeConnector(app, SHOP_ID, provider).getAdsConta('2026-09-01', '2026-11-04');
  assert.deepEqual(janelas, [['01-09-2026', '30-09-2026'], ['01-10-2026', '30-10-2026'], ['31-10-2026', '04-11-2026']]);
  assert.ok(chamadas.every((c) => c.method === 'GET'));
  assert.deepEqual(r.map((d) => d.day), ['2026-09-01', '2026-10-01', '2026-10-31']);
  const u = chamadas[0].url;
  const ts = Number(u.searchParams.get('timestamp'));
  assert.equal(u.searchParams.get('sign'), shopeeSign(app, '/api/v2/ads/get_all_cpc_ads_daily_performance', ts, 'acc-1', SHOP_ID));
});

test('getAdsProdutos: 404 (endpoint inexistente) falha com o rótulo e o código da Shopee, sem token', async () => {
  servidor({});
  await assert.rejects(
    () => new ShopeeConnector(app, SHOP_ID, provider).getAdsProdutos('2026-11-01', '2026-11-05'),
    (e: unknown) => /error_not_found/.test((e as Error).message) && /get_product_level_campaign_id_list/.test((e as Error).message)
      && !(e as Error).message.includes('acc-1'),
  );
});

test('getAdsProdutos: lista as campanhas, liga cada campanha ao anúncio e lê o desempenho diário', async () => {
  const chamadas = servidor({
    '/api/v2/ads/get_product_level_campaign_id_list': (u) => json({ error: '', response: Number(u.searchParams.get('offset')) === 0
      ? { has_next_page: true, campaign_list: [{ campaign_id: 1, ad_type: 'manual' }, { campaign_id: 2, ad_type: 'auto' }] }
      : { has_next_page: false, campaign_list: [{ campaign_id: 3, ad_type: 'auto' }] } }),
    '/api/v2/ads/get_product_level_campaign_setting_info': (u) => {
      assert.equal(u.searchParams.get('campaign_id_list'), '1,2,3');
      return json({ error: '', response: { campaign_list: [
        { campaign_id: 1, common_info: { ad_type: 'manual', ad_name: 'Caneca', campaign_status: 'ongoing', campaign_budget: 20, item_id_list: [111] } },
        { campaign_id: 2, common_info: { ad_type: 'auto', ad_name: 'Loja toda', campaign_status: 'paused', campaign_budget: 0, item_id_list: [111, 222] } },
        { campaign_id: 3, common_info: { ad_type: 'auto', ad_name: 'Sem itens', campaign_status: 'ended', item_id_list: [] } },
      ] } });
    },
    '/api/v2/ads/get_product_campaign_daily_performance': (u) => {
      assert.equal(u.searchParams.get('start_date'), '01-11-2026');
      assert.equal(u.searchParams.get('end_date'), '05-11-2026');
      return json({ error: '', response: { campaign_list: [
        { campaign_id: 1, metrics_list: [{ date: '05-11-2026', expense: 7, impression: 70, clicks: 7, direct_gmv: 30, broad_gmv: 40, direct_order_amount: 1, broad_order_amount: 2 }] },
        { campaign_id: 2, metrics_list: [{ date: '05-11-2026', expense: 3, impression: 30, clicks: 3, direct_gmv: 0, broad_gmv: 0 }] },
      ] } });
    },
  });
  const r = await new ShopeeConnector(app, SHOP_ID, provider).getAdsProdutos('2026-11-01', '2026-11-05');
  assert.ok(chamadas.every((c) => c.method === 'GET'));
  assert.deepEqual(r.metricas.map((m) => [m.itemId, m.campaignId, m.day, m.cost, m.directAmount, m.indirectAmount, m.directUnits, m.indirectUnits]), [
    ['111', '1', '2026-11-05', 7, 30, 10, 1, 1],
    ['campanha:2', '2', '2026-11-05', 3, 0, 0, 0, 0],   // campanha com vários anúncios: não é dividida (vai para "sem modelo")
  ]);
  assert.deepEqual(r.campanhas.map((c) => [c.campaignId, c.name, c.status, c.budget, c.automatica, c.itemIds]), [
    ['1', 'Caneca', 'active', 20, false, ['111']],
    ['2', 'Loja toda', 'paused', 0, true, ['111', '222']],
    ['3', 'Sem itens', 'ended', null, true, []],
  ]);
});

test('getAdsProdutos: sem o cadastro das campanhas, cada campanha fica como "campanha:<id>"', async () => {
  servidor({
    '/api/v2/ads/get_product_level_campaign_id_list': () => json({ error: '', response: { has_next_page: false, campaign_list: [{ campaign_id: 9 }] } }),
    '/api/v2/ads/get_product_campaign_daily_performance': () => json({ error: '', response: { campaign_list: [
      { campaign_id: 9, metrics_list: [{ date: '02-11-2026', expense: 4 }] },
    ] } }),
  });
  const r = await new ShopeeConnector(app, SHOP_ID, provider).getAdsProdutos('2026-11-01', '2026-11-05');
  assert.deepEqual(r.metricas.map((m) => [m.itemId, m.cost]), [['campanha:9', 4]]);
  assert.deepEqual(r.campanhas, []);
});

test('listAdsMetrics: por anúncio indisponível (404) cai para a linha da conta, sem falhar', async () => {
  servidor({
    '/api/v2/ads/get_all_cpc_ads_daily_performance': () => json({ error: '', response: [{ date: '02-11-2026', expense: 8, impression: 10, clicks: 1 }] }),
  });
  const shopee = new ShopeeConnector(app, SHOP_ID, provider);
  const out: AdsDailyMetric[] = [];
  for await (const l of shopee.listAdsMetrics(new Date('2026-11-02T12:00:00Z'), new Date('2026-11-02T12:00:00Z'))) out.push(...l);
  assert.deepEqual(out.map((m) => [m.itemId, m.day, m.cost]), [[ADS_CONTA, '2026-11-02', 8]]);
  assert.ok(shopee.avisos.includes('ads_produto'));
});

// ------------------------------------------------------------------------
// Anúncios (itens), variações e visualizações acumuladas
// ------------------------------------------------------------------------

function base(id: number, extra: Record<string, unknown> = {}) {
  return {
    item_id: id, item_name: `Item ${id}`, item_sku: `AAA${id}-AZU`, category_id: 100, item_status: 'NORMAL', create_time: 1_780_000_000,
    price_info: [{ currency: 'BRL', original_price: 39.9, current_price: 29.9 }],
    stock_info_v2: { summary_info: { total_available_stock: 12, total_reserved_stock: 1 } },
    image: { image_url_list: [`https://cf.shopee.com.br/file/${id}`] },
    has_model: false, is_fulfillment_by_shopee: false, description: 'texto longo do anuncio',
    ...extra,
  };
}

test('toShopeeItem: SKU, preço, estoque, status, Full, sem tipo de anúncio; visualizações acumuladas no raw', () => {
  const it = toShopeeItem(base(1, { is_fulfillment_by_shopee: true }), null,
    { item_id: 1, sale: 33, views: 1500, likes: 7, rating_star: 4.8, comment_count: 9 }, SHOP_ID);
  assert.equal(it.channel, 'shopee');
  assert.equal(it.itemId, '1');
  assert.equal(it.sku, 'AAA1-AZU');
  assert.equal(it.title, 'Item 1');
  assert.equal(it.price, 29.9);
  assert.equal(it.status, 'active');
  assert.equal(it.categoryId, '100');
  assert.equal(it.listingType, null);
  assert.equal(it.logisticType, 'fulfillment');
  assert.equal(it.availableQty, 12);
  assert.equal(it.soldQty, 33);
  assert.equal(it.health, null);
  assert.equal(it.thumbnail, 'https://cf.shopee.com.br/file/1');
  assert.equal(it.permalink, `https://shopee.com.br/product/${SHOP_ID}/1`);
  assert.equal(it.dateCreated, new Date(1_780_000_000_000).toISOString());
  assert.deepEqual((it.raw as { extra_info: unknown }).extra_info, { sale: 33, views: 1500, likes: 7, rating_star: 4.8, comment_count: 9 });
  assert.ok(!JSON.stringify(it.raw).includes('texto longo'), 'descrição fora do raw');
  const sem = toShopeeItem(base(2, { item_status: 'UNLIST', item_sku: '' }), null, null, SHOP_ID);
  assert.equal(sem.status, 'paused');
  assert.equal(sem.sku, null);
  assert.equal(sem.logisticType, null);
  assert.equal(sem.soldQty, null);
  assert.equal(toShopeeItem(base(3, { item_status: 'BANNED' }), null, null, SHOP_ID).status, 'banned');
});

test('extra_info aceita view_count como nome alternativo de views', () => {
  const it = toShopeeItem(base(1), null, { item_id: 1, view_count: 20 }, SHOP_ID);
  assert.deepEqual((it.raw as { extra_info: unknown }).extra_info, { views: 20 });
});

test('toShopeeItem com variações: SKU da variação, preço e estoque por variação; nome da opção', () => {
  const it = toShopeeItem(base(3, { has_model: true, item_sku: '', price_info: undefined, stock_info_v2: undefined }), {
    tier_variation: [{ name: 'Cor', option_list: [{ option: 'Azul' }, { option: 'Rosa' }] }],
    model: [
      { model_id: 31, model_sku: 'AAA3-AZU', tier_index: [0], price_info: [{ current_price: 25 }], stock_info_v2: { summary_info: { total_available_stock: 4 } } },
      { model_id: 32, model_sku: '', tier_index: [1], price_info: [{ current_price: 27 }], stock_info_v2: { summary_info: { total_available_stock: 0 } } },
    ],
  }, null, SHOP_ID);
  assert.equal(it.sku, null);
  assert.equal(it.price, 25, 'sem preço no item: menor preço das variações');
  assert.equal(it.availableQty, 4, 'sem estoque no item: soma das variações');
  assert.deepEqual(it.variations, [
    { variationId: '31', sku: 'AAA3-AZU', price: 25, availableQty: 4, soldQty: null, attributes: { tier_index: [0], opcoes: ['Azul'] } },
    { variationId: '32', sku: null, price: 27, availableQty: 0, soldQty: null, attributes: { tier_index: [1], opcoes: ['Rosa'] } },
  ]);
});

test('listItems: ativos e pausados, base em lotes de 50, variações só de quem tem; falha das visualizações não derruba', async () => {
  const ativos = Array.from({ length: 60 }, (_, i) => i + 1);
  const chamadas = servidor({
    '/api/v2/product/get_item_list': (u) => {
      const st = u.searchParams.get('item_status');
      const off = Number(u.searchParams.get('offset'));
      const ids = st === 'NORMAL' ? ativos : [999];
      const pag = ids.slice(off, off + 50);
      const mais = off + pag.length < ids.length;
      return json({ error: '', response: { item: pag.map((id) => ({ item_id: id, item_status: st })), has_next_page: mais, next_offset: off + pag.length, total_count: ids.length } });
    },
    '/api/v2/product/get_item_base_info': (u) => {
      const ids = (u.searchParams.get('item_id_list') ?? '').split(',').map(Number);
      assert.ok(ids.length <= 50);
      return json({ error: '', response: { item_list: ids.map((id) => base(id, id === 5 ? { has_model: true } : id === 999 ? { item_status: 'UNLIST' } : {})) } });
    },
    '/api/v2/product/get_model_list': (u) => {
      assert.equal(u.searchParams.get('item_id'), '5');
      return json({ error: '', response: { tier_variation: [], model: [{ model_id: 51, model_sku: 'AAA5-ROS', price_info: [{ current_price: 1 }] }] } });
    },
    '/api/v2/product/get_item_extra_info': () => json({ error: 'error_permission', message: 'x' }, 403),
  });
  const shopee = new ShopeeConnector(app, SHOP_ID, provider);
  const itens = [];
  for await (const lote of shopee.listItems()) itens.push(...lote);
  assert.equal(itens.length, 61);
  assert.equal(new Set(itens.map((i) => i.itemId)).size, 61);
  assert.equal(itens.find((i) => i.itemId === '999')!.status, 'paused');
  assert.deepEqual(itens.find((i) => i.itemId === '5')!.variations.map((v) => v.sku), ['AAA5-ROS']);
  assert.ok(chamadas.every((c) => c.method === 'GET'));
  assert.equal(chamadas.filter((c) => c.url.pathname.endsWith('get_model_list')).length, 1);
  assert.ok(shopee.avisos.includes('visitas'), 'falha das visualizações fica registrada');
  assert.equal((itens[0].raw as { extra_info?: unknown }).extra_info, undefined);
});

test('listItems: visualizações acumuladas de cada anúncio (get_item_extra_info, 50 por chamada)', async () => {
  servidor({
    '/api/v2/product/get_item_list': (u) => json({ error: '', response: u.searchParams.get('item_status') === 'NORMAL'
      ? { item: [{ item_id: 1 }], has_next_page: false } : { item: [], has_next_page: false } }),
    '/api/v2/product/get_item_base_info': () => json({ error: '', response: { item_list: [base(1)] } }),
    '/api/v2/product/get_item_extra_info': (u) => {
      assert.equal(u.searchParams.get('item_id_list'), '1');
      return json({ error: '', response: { item_list: [{ item_id: 1, views: 77, sale: 5 }] } });
    },
  });
  const shopee = new ShopeeConnector(app, SHOP_ID, provider);
  const itens = [];
  for await (const lote of shopee.listItems()) itens.push(...lote);
  assert.deepEqual((itens[0].raw as { extra_info: unknown }).extra_info, { views: 77, sale: 5 });
  assert.equal(itens[0].soldQty, 5);
  assert.deepEqual(shopee.avisos, []);
});

test('getVisits: a Shopee só tem visualizações acumuladas; nenhuma série diária inventada', async () => {
  assert.deepEqual(await new ShopeeConnector(app, SHOP_ID, provider).getVisits('1', 30), []);
});
