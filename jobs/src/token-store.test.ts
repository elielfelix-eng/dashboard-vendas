import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { refreshShopeeTokens } from '@dash/connectors';
import { createTokenProvider } from './token-store.ts';
import type { Sql } from './db.ts';

// Tokens e chave FICTÍCIOS.
const app = { partnerId: 2001887, partnerKey: 'chave-ficticia-de-teste' };

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

/** Banco falso: registra a ordem dos eventos e o que foi gravado. */
function bancoFalso(eventos: string[], gravados: unknown[][]) {
  const tx = (strings: TemplateStringsArray, ...valores: unknown[]) => {
    const q = strings.join('?');
    if (q.includes('read_oauth_tokens')) {
      return Promise.resolve([{ access_token: 'acc-velho', refresh_token: 'ref-velho', expires_at: new Date(Date.now() - 1000) }]);
    }
    if (q.includes('save_oauth_tokens')) {
      eventos.push('gravou');
      gravados.push(valores);
    }
    return Promise.resolve([]);
  };
  return { begin: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as Sql;
}

test('Shopee: token vencido é renovado e o novo refresh token é gravado antes de devolver o access token', async () => {
  const eventos: string[] = [];
  const gravados: unknown[][] = [];
  globalThis.fetch = (async () => {
    eventos.push('renovou');
    return new Response(JSON.stringify({ access_token: 'acc-novo', refresh_token: 'ref-novo', expire_in: 14400, error: '' }), { status: 200 });
  }) as typeof fetch;

  const provider = createTokenProvider(bancoFalso(eventos, gravados), 'conta-1', (rt) => refreshShopeeTokens(app, 123456, rt));
  const token = await provider();
  eventos.push('devolveu');

  assert.equal(token, 'acc-novo');
  assert.deepEqual(eventos, ['renovou', 'gravou', 'devolveu']);
  assert.equal(gravados.length, 1);
  assert.equal(gravados[0][0], 'conta-1');
  assert.equal(gravados[0][1], 'acc-novo');
  assert.equal(gravados[0][2], 'ref-novo');
});
