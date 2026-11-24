import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isShopeeState, shopeeRedirectUrl } from './shopee.ts';

const STATE = 'Ab3_-xYz0123456789abcdefGHIJKLMN';

test('URL de retorno da Shopee leva o state no caminho, sem query string', () => {
  const u = new URL(shopeeRedirectUrl('https://painel.exemplo.test/api/oauth/shopee/start?x=1', STATE));
  assert.equal(u.toString(), `https://painel.exemplo.test/api/oauth/shopee/callback/${STATE}`);
  assert.equal(u.search, '');
  // A Shopee acrescenta ?code=..&shop_id=..: o state continua intacto no caminho
  const volta = new URL(`${u.toString()}?code=c&shop_id=1`);
  assert.equal(volta.pathname.split('/').pop(), STATE);
});

test('state válido: só [A-Za-z0-9_-], tamanho razoável', () => {
  assert.equal(isShopeeState(STATE), true);
  assert.equal(isShopeeState(''), false);
  assert.equal(isShopeeState('curto'), false);
  assert.equal(isShopeeState(`${STATE}?code=x`), false);
  assert.equal(isShopeeState(`${STATE.slice(0, 20)}/../x`), false);
  assert.equal(isShopeeState(`${STATE}%20`), false);
  assert.equal(isShopeeState('a'.repeat(200)), false);
});
