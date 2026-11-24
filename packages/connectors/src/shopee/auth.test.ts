import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { shopeeSign, SHOPEE_API } from './connector.ts';
import {
  SHOPEE_AUTH_EXPIRED,
  ShopeeAuthError,
  exchangeShopeeCode,
  refreshShopeeTokens,
  shopeeAuthUrl,
} from './auth.ts';

// Chave e tokens FICTÍCIOS — nenhum valor real.
const app = { partnerId: 2001887, partnerKey: 'chave-ficticia-de-teste' };
const SHOP_ID = 123456;

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

interface Chamada { url: URL; body: Record<string, unknown> }

function responder(lista: Response[]): Chamada[] {
  const chamadas: Chamada[] = [];
  let i = 0;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    chamadas.push({ url: new URL(url), body: JSON.parse(String(init?.body ?? '{}')) });
    return lista[Math.min(i++, lista.length - 1)];
  }) as typeof fetch;
  return chamadas;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// --- Assinatura (Step 2) ---------------------------------------------------
// Base da assinatura conforme a documentação v2: partner_id + path + timestamp
// (+ access_token + shop_id nas chamadas da loja), HMAC-SHA256 com a partner key.
// Valores esperados calculados à parte (openssl dgst -sha256 -hmac) com a chave fictícia.

test('assinatura de chamada pública (auth) bate com o HMAC esperado', () => {
  assert.equal(
    shopeeSign(app, '/api/v2/shop/auth_partner', 1655714431),
    'd4f2a4d39a9fbc7f28cef7a822ba84d150c8f84f381636256687d3cc9d174a1d',
  );
});

test('assinatura de chamada da loja inclui access_token e shop_id', () => {
  assert.equal(
    shopeeSign(app, '/api/v2/shop/get_shop_info', 1655714431, 'token-ficticio', 123456),
    'c14aac6d732b332387682ffe1ba7c8110fea46638e02b207b3856355834ec4c3',
  );
});

test('URL de autorização: auth_partner com partner_id, timestamp, sign e redirect; sem a partner key', () => {
  const redirect = 'https://painel.exemplo.test/api/oauth/shopee/callback?state=abc';
  const u = new URL(shopeeAuthUrl(app, redirect, 1655714431));
  assert.equal(u.origin + u.pathname, `${SHOPEE_API}/api/v2/shop/auth_partner`);
  assert.equal(u.searchParams.get('partner_id'), '2001887');
  assert.equal(u.searchParams.get('timestamp'), '1655714431');
  assert.equal(u.searchParams.get('sign'), 'd4f2a4d39a9fbc7f28cef7a822ba84d150c8f84f381636256687d3cc9d174a1d');
  assert.equal(u.searchParams.get('redirect'), redirect);
  assert.ok(!u.toString().includes(app.partnerKey));
});

// --- Troca do código e renovação (Step 3) ----------------------------------

test('troca do código: POST em /auth/token/get, assinado, com code, shop_id e partner_id', async () => {
  const chamadas = responder([json({ access_token: 'acc-1', refresh_token: 'ref-1', expire_in: 14400, error: '', message: '' })]);
  const antes = Date.now();
  const t = await exchangeShopeeCode(app, 'codigo-ficticio', SHOP_ID);

  assert.equal(chamadas.length, 1);
  const { url, body } = chamadas[0];
  assert.equal(url.origin + url.pathname, `${SHOPEE_API}/api/v2/auth/token/get`);
  const ts = Number(url.searchParams.get('timestamp'));
  assert.equal(url.searchParams.get('partner_id'), '2001887');
  assert.equal(url.searchParams.get('sign'), shopeeSign(app, '/api/v2/auth/token/get', ts));
  assert.deepEqual(body, { code: 'codigo-ficticio', shop_id: SHOP_ID, partner_id: 2001887 });

  assert.equal(t.accessToken, 'acc-1');
  assert.equal(t.refreshToken, 'ref-1');
  assert.equal(t.externalUserId, String(SHOP_ID));
  const validade = t.expiresAt.getTime() - antes;
  assert.ok(validade >= 14400_000 && validade < 14400_000 + 5000);
});

test('renovação devolve o NOVO refresh token (uso único)', async () => {
  const chamadas = responder([json({ access_token: 'acc-2', refresh_token: 'ref-novo', expire_in: 14400, error: '' })]);
  const t = await refreshShopeeTokens(app, SHOP_ID, 'ref-velho');

  const { url, body } = chamadas[0];
  assert.equal(url.origin + url.pathname, `${SHOPEE_API}/api/v2/auth/access_token/get`);
  const ts = Number(url.searchParams.get('timestamp'));
  assert.equal(url.searchParams.get('sign'), shopeeSign(app, '/api/v2/auth/access_token/get', ts));
  assert.deepEqual(body, { refresh_token: 'ref-velho', shop_id: SHOP_ID, partner_id: 2001887 });
  assert.equal(t.accessToken, 'acc-2');
  assert.equal(t.refreshToken, 'ref-novo');
});

// --- Autorização vencida e erros sem segredo (Step 4) ----------------------

const SEGREDOS = ['ref-velho', 'codigo-ficticio', app.partnerKey, 'acc-vazado', 'ref-vazado'];
const semSegredo = (e: unknown) => {
  const texto = `${(e as Error).message} ${(e as Error).stack ?? ''}`;
  for (const s of SEGREDOS) assert.ok(!texto.includes(s), 'segredo no texto do erro');
  return true;
};

const casosAuth: [string, () => Response][] = [
  ['HTTP 401', () => json({ error: 'error_auth', message: 'refresh ref-velho invalido' }, 401)],
  ['HTTP 403', () => json({ error: 'error_permission', message: 'sem permissao' }, 403)],
  ['error_auth com HTTP 200', () => json({ error: 'error_auth', message: 'Invalid refresh_token ref-velho' })],
  ['invalid_acceess_token com HTTP 200', () => json({ error: 'invalid_acceess_token', message: 'x' })],
  ['error_auth com HTTP 400', () => json({ error: 'error_auth', message: 'x' }, 400)],
];

for (const [nome, resposta] of casosAuth) {
  test(`autorização vencida (${nome}) vira o aviso de reconexão, sem token no texto`, async () => {
    responder([resposta()]);
    await assert.rejects(
      () => refreshShopeeTokens(app, SHOP_ID, 'ref-velho'),
      (e: unknown) => e instanceof ShopeeAuthError && (e as Error).message === SHOPEE_AUTH_EXPIRED && semSegredo(e),
    );
  });
}

test('mensagem de autorização vencida é a combinada', () => {
  assert.equal(SHOPEE_AUTH_EXPIRED, 'Autorização da Shopee vencida: reconecte em Configurações › Conexões');
});

test('outro erro da Shopee (error preenchido) vira erro com o código, sem segredo', async () => {
  responder([json({ error: 'error_param', message: 'code codigo-ficticio is invalid' })]);
  await assert.rejects(
    () => exchangeShopeeCode(app, 'codigo-ficticio', SHOP_ID),
    (e: unknown) => !(e instanceof ShopeeAuthError) && /error_param/.test((e as Error).message) && semSegredo(e),
  );
});

test('HTTP 400 comum vira erro com o código, sem segredo', async () => {
  responder([json({ error: 'error_param', message: 'refresh_token ref-velho' }, 400)]);
  await assert.rejects(
    () => refreshShopeeTokens(app, SHOP_ID, 'ref-velho'),
    (e: unknown) => !(e instanceof ShopeeAuthError) && /HTTP 400/.test((e as Error).message) && semSegredo(e),
  );
});

test('resposta sem refresh token vira erro, sem expor o access token', async () => {
  responder([json({ access_token: 'acc-vazado', expire_in: 14400, error: '' })]);
  await assert.rejects(() => refreshShopeeTokens(app, SHOP_ID, 'ref-velho'), semSegredo);
});
