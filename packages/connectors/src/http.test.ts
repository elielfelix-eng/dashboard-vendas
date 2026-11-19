import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson, HttpError } from './http.ts';

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

const noSleep = <T>(fn: () => Promise<T>): Promise<T> => {
  const real = globalThis.setTimeout;
  globalThis.setTimeout = ((f: () => void) => real(f, 0)) as unknown as typeof setTimeout;
  return fn().finally(() => { globalThis.setTimeout = real; });
};

function respostas(lista: Response[]) {
  let i = 0;
  globalThis.fetch = (async () => lista[Math.min(i++, lista.length - 1)]) as typeof fetch;
  return () => i;
}

test('limite de requisições devolvido como 400 ("code 429") é tentado de novo e depois funciona', async () => {
  const chamadas = respostas([
    new Response('{"timestamp":"x","status":400,"type":"BAD_REQUEST_ERROR","message":"Http status error with code 429","path":"/monthly/periods"}', { status: 400 }),
    new Response('{"results":[1]}', { status: 200 }),
  ]);
  const r = await noSleep(() => fetchJson<{ results: number[] }>('https://exemplo.test/x'));
  assert.deepEqual(r.results, [1]);
  assert.equal(chamadas(), 2);
});

test('400 comum (sem limite de requisições) não é tentado de novo', async () => {
  const chamadas = respostas([new Response('{"message":"parametro invalido"}', { status: 400 })]);
  await assert.rejects(() => noSleep(() => fetchJson('https://exemplo.test/x')), (e: unknown) => e instanceof HttpError && e.status === 400);
  assert.equal(chamadas(), 1);
});

test('429 continua sendo tentado de novo', async () => {
  const chamadas = respostas([
    new Response('{"message":"local_rate_limited"}', { status: 429 }),
    new Response('{"ok":true}', { status: 200 }),
  ]);
  const r = await noSleep(() => fetchJson<{ ok: boolean }>('https://exemplo.test/x'));
  assert.equal(r.ok, true);
  assert.equal(chamadas(), 2);
});
