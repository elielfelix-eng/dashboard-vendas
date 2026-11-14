import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { BitrixClient, normalizarWebhook } from './client.ts';

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
