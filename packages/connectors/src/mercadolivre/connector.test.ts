import { afterEach, test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { MercadoLivreConnector } from './connector.ts';

// fetch falso: responde por caminho (/items?ids=... recusado como o ML passou a fazer em 13/11/2026)
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

function fakeFetch(rotas: Record<string, () => Response>) {
  const chamadas: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    const u = new URL(String(input));
    const chave = u.pathname + (u.searchParams.has('ids') ? '?ids' : '');
    chamadas.push(chave);
    const r = rotas[chave];
    if (!r) return new Response('{"message":"nao esperado"}', { status: 404 });
    return r();
  }) as typeof fetch;
  return chamadas;
}
const json = (b: unknown, status = 200) => () => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
const item = (id: string) => ({ id, title: `T ${id}`, price: 10, status: 'active', permalink: `https://p/${id}`, thumbnail: `http://t/${id}.jpg`, variations: [] });

test('anúncios: lote recusado (ResourceDeprecated) -> busca um por um', async () => {
  const chamadas = fakeFetch({
    '/users/1/items/search': json({ results: ['MLB1', 'MLB2'] }),
    '/items?ids': json({ message: 'Resource deprecated - client no longer allowed to consume this resource', error: 'ResourceDeprecated', status: 403 }, 403),
    '/items/MLB1': json(item('MLB1')),
    '/items/MLB2': json(item('MLB2')),
  });
  const ml = new MercadoLivreConnector('1', async () => 'token');
  const lotes = [];
  for await (const lote of ml.listItems()) lotes.push(lote);
  assert.deepEqual(lotes.flat().map((i) => [i.itemId, i.permalink]), [['MLB1', 'https://p/MLB1'], ['MLB2', 'https://p/MLB2']]);
  assert.equal(chamadas.filter((c) => c === '/items?ids').length, 1, 'tenta o lote só uma vez');
});

test('anúncios: lote funcionando continua usado', async () => {
  const chamadas = fakeFetch({
    '/users/1/items/search': json({ results: ['MLB1'] }),
    '/items?ids': json([{ code: 200, body: item('MLB1') }]),
  });
  const ml = new MercadoLivreConnector('1', async () => 'token');
  const lotes = [];
  for await (const lote of ml.listItems()) lotes.push(lote);
  assert.deepEqual(lotes.flat().map((i) => i.itemId), ['MLB1']);
  assert.ok(!chamadas.includes('/items/MLB1'));
});

test('anúncios: um anúncio que falha sozinho não derruba os outros', async () => {
  fakeFetch({
    '/users/1/items/search': json({ results: ['MLB1', 'MLB2'] }),
    '/items?ids': json({ error: 'ResourceDeprecated' }, 403),
    '/items/MLB1': json({ message: 'forbidden' }, 403),
    '/items/MLB2': json(item('MLB2')),
  });
  const ml = new MercadoLivreConnector('1', async () => 'token');
  const lotes = [];
  for await (const lote of ml.listItems()) lotes.push(lote);
  assert.deepEqual(lotes.flat().map((i) => i.itemId), ['MLB2']);
});

/* ---------------- Ads: campanhas e status do anúncio (002) ---------------- */
interface Chamada { path: string; params: URLSearchParams; headers: Record<string, string> }

// fetch falso que registra caminho, parâmetros e cabeçalhos; `ads` responde por caminho
function fakeAds(rotas: Record<string, (c: Chamada) => Response>) {
  const chamadas: Chamada[] = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    const h = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    const c = { path: u.pathname, params: u.searchParams, headers: h };
    chamadas.push(c);
    const r = rotas[u.pathname];
    return r ? r(c) : new Response('{}', { status: 404 });
  }) as typeof fetch;
  return chamadas;
}
const ADV = '/advertising/advertisers';
const CAMP = '/advertising/MLB/advertisers/9/product_ads/campaigns/search';
const ADS = '/advertising/MLB/advertisers/9/product_ads/ads/search';
const advertiser = json({ advertisers: [{ advertiser_id: 9, site_id: 'MLB' }] });

test('campanhas: pagina de 50 em 50, sem aggregation_type, com api-version 2, e mapeia os campos', async () => {
  const chamadas = fakeAds({
    [ADV]: advertiser,
    [CAMP]: (c) => {
      const off = Number(c.params.get('offset'));
      const paging = { total: 51 };
      if (off === 0) return json({ paging, results: Array.from({ length: 50 }, (_, i) => ({ id: i + 1, name: `C${i + 1}`, status: 'active', budget: 100, roas_target: 5, strategy: 'manual' })) })();
      return json({ paging, results: [{ id: 51, name: 'Auto', status: 'paused', budget: { amount: 30 }, target_roas: 3.5, strategy: 'AUTOMATIC' }] })();
    },
  });
  const ml = new MercadoLivreConnector('1', async () => 'token');
  const todas = [];
  for await (const lote of ml.listAdsCampaigns()) todas.push(...lote);
  const camp = chamadas.filter((c) => c.path === CAMP);
  assert.equal(camp.length, 2);
  assert.deepEqual(camp.map((c) => c.params.get('offset')), ['0', '50']);
  for (const c of camp) {
    assert.equal(c.params.get('limit'), '50');
    assert.ok(!c.params.has('aggregation_type'));
    assert.equal(c.headers['api-version'], '2');
  }
  assert.equal(todas.length, 51);
  assert.deepEqual({ ...todas[0], raw: undefined }, { campaignId: '1', name: 'C1', status: 'active', budget: 100, roasTarget: 5, automatica: false, raw: undefined });
  assert.deepEqual({ ...todas[50], raw: undefined }, { campaignId: '51', name: 'Auto', status: 'paused', budget: 30, roasTarget: 3.5, automatica: true, raw: undefined });
  assert.equal((todas[50].raw as { id: number }).id, 51);
});

test('campanhas: campos ausentes viram null (nunca inventa)', async () => {
  fakeAds({ [ADV]: advertiser, [CAMP]: json({ paging: { total: 1 }, results: [{ id: 7 }] }) });
  const ml = new MercadoLivreConnector('1', async () => 'token');
  const todas = [];
  for await (const lote of ml.listAdsCampaigns()) todas.push(...lote);
  assert.deepEqual({ ...todas[0], raw: undefined }, { campaignId: '7', name: null, status: null, budget: null, roasTarget: null, automatica: null, raw: undefined });
});

test('campanhas: 429 e depois 200 funciona', async () => {
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: () => void) => realSetTimeout(fn, 0)) as unknown as typeof setTimeout;
  try {
    let n = 0;
    fakeAds({
      [ADV]: advertiser,
      [CAMP]: () => (++n === 1 ? new Response('{"message":"local_rate_limited"}', { status: 429 }) : json({ paging: { total: 1 }, results: [{ id: 1, name: 'A' }] })()),
    });
    const ml = new MercadoLivreConnector('1', async () => 'token');
    const todas = [];
    for await (const lote of ml.listAdsCampaigns()) todas.push(...lote);
    assert.equal(n, 2);
    assert.deepEqual(todas.map((c) => c.campaignId), ['1']);
  } finally {
    globalThis.setTimeout = realSetTimeout;
  }
});

test('métricas por anúncio: devolve status (null se ausente)', async () => {
  fakeAds({
    [ADV]: advertiser,
    [ADS]: json({ paging: { total: 2 }, results: [
      { item_id: 'MLB1', campaign_id: 5, status: 'active', metrics: { prints: 10, cost: 1 } },
      { item_id: 'MLB2', metrics: { prints: 3 } },
    ] }),
  });
  const ml = new MercadoLivreConnector('1', async () => 'token');
  const d = new Date('2026-11-10T12:00:00Z');
  const rows = [];
  for await (const lote of ml.listAdsMetrics(d, d)) rows.push(...lote);
  assert.deepEqual(rows.map((r) => [r.itemId, r.status]), [['MLB1', 'active'], ['MLB2', null]]);
});

test('métricas por anúncio: dia sem custo e sem impressões, mas com venda atribuída, é mantido', async () => {
  fakeAds({
    [ADV]: advertiser,
    [ADS]: json({ paging: { total: 3 }, results: [
      { item_id: 'MLB3', campaign_id: 5, status: 'active', metrics: { prints: 0, cost: 0, direct_amount: 120, direct_units_quantity: 1, indirect_amount: 0 } },
      { item_id: 'MLB4', campaign_id: 5, status: 'active', metrics: { prints: 0, cost: 0, indirect_amount: 0, direct_amount: 0 } },
      { item_id: 'MLB5', campaign_id: 5, status: 'active', metrics: { prints: 0, cost: 0, indirect_units_quantity: 2, indirect_amount: 80 } },
    ] }),
  });
  const ml = new MercadoLivreConnector('1', async () => 'token');
  const rows = [];
  for await (const lote of ml.listAdsMetrics(new Date('2026-10-15T12:00:00Z'), new Date('2026-10-15T12:00:00Z'))) rows.push(...lote);
  // MLB4 não tem nenhuma atividade: continua descartado
  assert.deepEqual(rows.map((r) => [r.itemId, r.directAmount, r.indirectAmount, r.indirectUnits]), [['MLB3', 120, 0, 0], ['MLB5', 0, 80, 2]]);
});

test('status dos anúncios: traz todos, mesmo sem impressões e custo, numa única passada', async () => {
  const chamadas = fakeAds({
    [ADV]: advertiser,
    [ADS]: json({ paging: { total: 2 }, results: [
      { item_id: 'MLB1', campaign_id: 5, status: 'paused', metrics: { prints: 0, cost: 0 } },
      { item_id: 'MLB2', status: 'active' },
    ] }),
  });
  const ml = new MercadoLivreConnector('1', async () => 'token');
  const rows = [];
  for await (const lote of ml.listAdsStatus(new Date('2026-11-10T12:00:00Z'))) rows.push(...lote);
  assert.deepEqual(rows, [
    { itemId: 'MLB1', campaignId: '5', status: 'paused' },
    { itemId: 'MLB2', campaignId: null, status: 'active' },
  ]);
  const ch = chamadas.filter((c) => c.path === ADS);
  assert.equal(ch.length, 1);
  // janela de 30 dias terminando no dia pedido (cobertura maior que um único dia)
  assert.equal(ch[0].params.get('date_to'), '2026-11-10');
  assert.equal(ch[0].params.get('date_from'), '2026-10-12');
});

test('somente leitura: nenhuma escrita HTTP no conector do ML nem no cliente HTTP compartilhado', () => {
  const dir = fileURLToPath(new URL('.', import.meta.url));
  const arquivos = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).map((f) => dir + f);
  arquivos.push(dir + '../http.ts'); // fetchJson, usado por client.ts e auth.ts
  // Qualquer propriedade `method` (também a forma abreviada `{ method }` ou `method: variavel`) é suspeita.
  const metodo = /\bmethod\s*[:,}]/g;
  const escrita = /\b(api|client|http|ml|axios)\.(post|put|patch|delete)\s*\(/i;
  const achados: string[] = [];
  for (const f of arquivos) {
    const src = readFileSync(f, 'utf8');
    const nome = f.split('\\').join('/').split('/').slice(-2).join('/');
    const usos = src.match(metodo) ?? [];
    if (nome.endsWith('mercadolivre/auth.ts')) {
      // Única exceção: o POST do /oauth/token (troca/renovação do token, não escreve na conta de anúncios)
      assert.equal(usos.length, 1, 'auth.ts: só um `method`');
      assert.match(src, /method:\s*'POST'/);
      assert.ok(src.includes('/oauth/token'));
    } else if (usos.length) achados.push(`${nome}: method`);
    if (escrita.test(src)) achados.push(`${nome}: chamada de escrita`);
  }
  assert.deepEqual(achados, []);
});
