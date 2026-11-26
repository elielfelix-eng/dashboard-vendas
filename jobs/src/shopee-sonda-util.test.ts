import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { urlDaLoja, caminhosDeCampos, janelasPorMes, dataAds } from './shopee-sonda-util.ts';

// Valores FICTÍCIOS.
const app = { partnerId: 1000001, partnerKey: 'chave-ficticia' };

test('assinatura da loja: HMAC-SHA256 de partner_id+path+timestamp+access_token+shop_id', () => {
  const path = '/api/v2/order/get_order_list';
  const u = urlDaLoja(app, path, 1700000000, 'acesso-ficticio', 555, { page_size: 100 });
  const esperado = createHmac('sha256', 'chave-ficticia')
    .update('1000001' + path + '1700000000' + 'acesso-ficticio' + '555')
    .digest('hex');
  assert.equal(u.searchParams.get('sign'), esperado);
  assert.equal(u.searchParams.get('shop_id'), '555');
  assert.equal(u.searchParams.get('partner_id'), '1000001');
  assert.equal(u.searchParams.get('page_size'), '100');
  assert.equal(u.origin + u.pathname, 'https://partner.shopeemobile.com' + path);
});

test('caminhosDeCampos devolve só nomes, nunca valores', () => {
  const r = caminhosDeCampos({ response: { order_list: [{ order_sn: 'SEGREDO1' }, { order_sn: 'SEGREDO2' }], more: true } });
  assert.deepEqual(r, ['response.more', 'response.order_list[].order_sn']);
  assert.ok(!JSON.stringify(r).includes('SEGREDO'));
});

test('janelasPorMes: no máximo 15 dias, sem atravessar mês, cobre tudo sem sobreposição', () => {
  const ini = Date.UTC(2025, 10, 26, 3); // 26/11/2025 00:00 SP
  const fim = Date.UTC(2026, 10, 26, 3);
  const js = janelasPorMes(ini, fim);
  assert.equal(js[0]!.de, ini / 1000);
  assert.equal(js[js.length - 1]!.ate, fim / 1000 - 1);
  for (let i = 0; i < js.length; i++) {
    const j = js[i]!;
    assert.ok(j.ate - j.de + 1 <= 15 * 86400);
    if (i > 0) assert.equal(j.de, js[i - 1]!.ate + 1);
  }
  assert.equal(new Set(js.map((j) => j.mes)).size, 13); // nov/2025 .. nov/2026
});

test('dataAds usa dd-mm-yyyy', () => {
  assert.equal(dataAds(Date.UTC(2026, 0, 5, 12)), '05-01-2026');
});
