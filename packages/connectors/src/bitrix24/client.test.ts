import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { BitrixClient, normalizarWebhook, paraQuery } from './client.ts';

test('bitrix: limpa a URL do webhook (espaço, aspas, exemplo "profile/")', () => {
  const ok = 'https://p.bitrix24.com.br/rest/9/abc123/';
  assert.equal(normalizarWebhook('https://p.bitrix24.com.br/rest/9/abc123'), ok);
  assert.equal(normalizarWebhook('  "https://p.bitrix24.com.br/rest/9/abc123/"\n'), ok);
  assert.equal(normalizarWebhook('https://p.bitrix24.com.br/rest/9/abc123/profile/'), ok);
  assert.equal(normalizarWebhook('https://p.bitrix24.com.br/rest/9/abc123/profile.json'), ok);
  assert.throws(() => normalizarWebhook('https://p.bitrix24.com.br/rest/9/profile/'), /falta a chave/);
  assert.throws(() => normalizarWebhook('p.bitrix24.com.br'), /não é um endereço/);
  assert.throws(() => normalizarWebhook('https://p.bitrix24.com.br/crm/'), /esperado/);
});

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

const SEGREDO = 'https://exemplo.bitrix24.com.br/rest/9/chave-secreta-xyz/';

function fakeFetch(responder: (method: string, body: Record<string, unknown>) => Response) {
  const chamadas: { method: string; body: Record<string, unknown> }[] = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const method = String(input).slice(SEGREDO.length);
    const body = JSON.parse(String(init?.body ?? '{}'));
    chamadas.push({ method, body });
    return responder(method, body);
  }) as typeof fetch;
  return chamadas;
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

test('bitrix: percorre todas as páginas pelo "next"', async () => {
  const chamadas = fakeFetch((_m, body) =>
    body.start === 0 ? json({ result: [{ ID: '1' }, { ID: '2' }], next: 2, total: 3 }) : json({ result: [{ ID: '3' }], total: 3 }));
  const bx = new BitrixClient(SEGREDO, { intervaloMs: 0 });
  const tudo = await bx.listarTudo<{ ID: string }>('crm.lead.list', { select: ['ID'] });
  assert.deepEqual(tudo.map((x) => x.ID), ['1', '2', '3']);
  assert.deepEqual(chamadas.map((c) => [c.method, c.body.start]), [['crm.lead.list', 0], ['crm.lead.list', 2]]);
});

test('bitrix: erro nunca mostra a URL do webhook', async () => {
  fakeFetch(() => json({ error: 'insufficient_scope', error_description: 'sem escopo' }, 401));
  const bx = new BitrixClient(SEGREDO, { intervaloMs: 0 });
  await assert.rejects(bx.call('crm.deal.list'), (e: Error) => {
    assert.ok(!e.message.includes('chave-secreta-xyz'), e.message);
    assert.ok(e.message.includes('bitrix:crm.deal.list'), e.message);
    return true;
  });
});

test('bitrix: erro no corpo com HTTP 200 vira exceção', async () => {
  fakeFetch(() => json({ error: 'ACCESS_DENIED', error_description: 'negado' }));
  const bx = new BitrixClient(SEGREDO, { intervaloMs: 0 });
  await assert.rejects(bx.call('crm.lead.add'), /ACCESS_DENIED/);
});

test('bitrix: sem URL configurada falha com mensagem clara', () => {
  assert.throws(() => new BitrixClient(''), /BITRIX_WEBHOOK_URL/);
});

// ---- batch e paginação por ID ----

function lerQuery(qs: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const par of qs.split('&')) {
    const i = par.indexOf('=');
    o[decodeURIComponent(par.slice(0, i))] = decodeURIComponent(par.slice(i + 1));
  }
  return o;
}

/** Fake do Bitrix com registros de ID 1..total; resolve $result dentro do batch. */
function fakeBitrix(total: number, opts: { comItems?: boolean } = {}) {
  const metodos: string[] = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const method = String(input).slice(SEGREDO.length);
    metodos.push(method);
    const body = JSON.parse(String(init?.body ?? '{}'));
    assert.equal(method, 'batch');
    assert.equal(body.halt, 0);
    const resultados: Record<string, unknown> = {};
    for (const [chave, cmd] of Object.entries(body.cmd as Record<string, string>)) {
      const [m, qs] = cmd.split('?');
      metodos.push(m);
      const q = lerQuery(qs);
      assert.equal(q.start, '-1');
      assert.equal(q['order[ID]'], 'ASC');
      let de = Number(q['filter[>ID]'] ?? 0);
      const ref = q['filter[>ID]']?.match(/^\$result\[(c\d+)\](\[items\])?\[49\]\[ID\]$/);
      if (ref) {
        const anterior = resultados[ref[1]];
        const lista = (ref[2] ? (anterior as { items: { ID: string }[] }).items : anterior) as { ID: string }[];
        de = Number(lista[49]?.ID ?? total);
      }
      const itens: { ID: string }[] = [];
      for (let id = de + 1; id <= total && itens.length < 50; id++) itens.push({ ID: String(id) });
      resultados[chave] = opts.comItems ? { items: itens } : itens;
    }
    return json({ result: { result: resultados, result_error: [], result_total: {}, result_time: {} } });
  }) as typeof fetch;
  return metodos;
}

type Params = Parameters<BitrixClient['listarPorId']>[1];
type Opts = Parameters<BitrixClient['listarPorId']>[2];
async function todos(bx: BitrixClient, params: Params, opts?: Opts) {
  const ids: string[] = [];
  for await (const p of bx.listarPorId<{ ID: string }>('crm.lead.list', params, opts)) ids.push(...p.map((x) => x.ID));
  return ids;
}
const de1a = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1));
const semEscrita = (m: string[]) => m.every((x) => !/\.(add|update|delete)$/.test(x));

test('bitrix: paraQuery no formato PHP', () => {
  const q = paraQuery({ filter: { '>ID': 5, '@SOURCE_ID': ['19', '10|WHATSAPP'] }, order: { ID: 'ASC' }, select: ['ID'], start: -1 });
  assert.equal(q, 'filter%5B%3EID%5D=5&filter%5B%40SOURCE_ID%5D%5B0%5D=19&filter%5B%40SOURCE_ID%5D%5B1%5D=10%7CWHATSAPP&order%5BID%5D=ASC&select%5B0%5D=ID&start=-1');
  assert.equal(decodeURIComponent(q), 'filter[>ID]=5&filter[@SOURCE_ID][0]=19&filter[@SOURCE_ID][1]=10|WHATSAPP&order[ID]=ASC&select[0]=ID&start=-1');
  assert.ok(paraQuery({ filter: { '>ID': '$result[c0][49][ID]' } }).endsWith('=$result[c0][49][ID]'));
});

test('bitrix: listarPorId com 120 registros, sem repetir', async () => {
  const metodos = fakeBitrix(120);
  const bx = new BitrixClient(SEGREDO, { intervaloMs: 0 });
  assert.deepEqual(await todos(bx, { select: ['ID'] }), de1a(120));
  assert.ok(semEscrita(metodos));
});

test('bitrix: listarPorId com 100 registros (última página cheia) termina sem repetir', async () => {
  const metodos = fakeBitrix(100);
  const bx = new BitrixClient(SEGREDO, { intervaloMs: 0 });
  assert.deepEqual(await todos(bx, { select: ['ID'] }), de1a(100));
  assert.ok(semEscrita(metodos));
});

test('bitrix: listarPorId com resposta em items e parâmetro extra', async () => {
  const metodos = fakeBitrix(120, { comItems: true });
  const bx = new BitrixClient(SEGREDO, { intervaloMs: 0 });
  const ids = await todos(bx, { select: ['ID'], entityTypeId: 2 }, { itens: (r) => (r as { items: { ID: string }[] }).items });
  assert.deepEqual(ids, de1a(120));
  assert.ok(semEscrita(metodos));
});

test('bitrix: batch com 51 comandos dá erro', async () => {
  const metodos = fakeBitrix(1);
  const bx = new BitrixClient(SEGREDO, { intervaloMs: 0 });
  const cmds: Record<string, [string, Record<string, unknown>]> = {};
  for (let i = 0; i < 51; i++) cmds[`c${i}`] = ['crm.lead.list', {}];
  await assert.rejects(bx.batch(cmds), /50/);
  assert.ok(semEscrita(metodos));
});
