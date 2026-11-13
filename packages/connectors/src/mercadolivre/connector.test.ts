import { afterEach, test } from 'node:test';
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
