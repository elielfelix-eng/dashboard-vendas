import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CACHE_SEGUNDOS, chaveCache, identidadeCache } from './cache-chave.ts';

const args = { p_canal: 'mercadolivre', p_de: '2026-11-01', p_ate: '2026-11-27' };

test('identidade: ordem dos canais e das permissoes nao importa', () => {
  assert.equal(
    identidadeCache('gestor', ['shopee', 'mercadolivre', 'crm'], ['vendas', 'custos', 'visao_geral']),
    identidadeCache('gestor', ['crm', 'mercadolivre', 'shopee'], new Set(['visao_geral', 'vendas', 'custos'])),
  );
});

test('identidade: canais ou permissoes repetidos nao mudam a chave', () => {
  assert.equal(identidadeCache('admin', ['shopee', 'shopee'], ['custos', 'custos']), identidadeCache('admin', ['shopee'], ['custos']));
});

test('perfis diferentes dao chaves diferentes', () => {
  const a = identidadeCache('admin', ['mercadolivre'], ['custos'])!;
  const c = identidadeCache('comercial', ['mercadolivre'], ['custos'])!;
  assert.notEqual(chaveCache('dash_resumo', args, a), chaveCache('dash_resumo', args, c));
});

test('canais ou permissoes diferentes dao chaves diferentes', () => {
  const base = identidadeCache('gestor', ['mercadolivre', 'shopee'], ['custos', 'vendas'])!;
  const semShopee = identidadeCache('gestor', ['mercadolivre'], ['custos', 'vendas'])!;
  const semCustos = identidadeCache('gestor', ['mercadolivre', 'shopee'], ['vendas'])!;
  const chaves = new Set([base, semShopee, semCustos].map((i) => chaveCache('dash_resumo', args, i)));
  assert.equal(chaves.size, 3);
});

test('sem perfil nao ha identidade (nao usa cache)', () => {
  assert.equal(identidadeCache(null, ['mercadolivre'], ['custos']), null);
  assert.equal(identidadeCache(undefined, ['mercadolivre'], ['custos']), null);
  assert.equal(identidadeCache('', ['mercadolivre'], ['custos']), null);
});

test('chave: funcao e argumentos entram; ordem das chaves dos argumentos nao importa', () => {
  const i = identidadeCache('admin', ['mercadolivre'], [])!;
  assert.equal(chaveCache('dash_resumo', { p_ate: '2026-11-27', p_de: '2026-11-01', p_canal: 'mercadolivre' }, i), chaveCache('dash_resumo', args, i));
  assert.notEqual(chaveCache('dash_serie', args, i), chaveCache('dash_resumo', args, i));
  assert.notEqual(chaveCache('dash_resumo', { ...args, p_canal: 'shopee' }, i), chaveCache('dash_resumo', args, i));
  assert.notEqual(chaveCache('dash_skus', { ...args, p_modelo: null }, i), chaveCache('dash_skus', { ...args, p_modelo: 'AAA11' }, i));
});

test('o token de acesso nao entra na chave', () => {
  const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3VhcmlvLTEifQ.assinatura-secreta';
  const i = identidadeCache('admin', ['mercadolivre'], ['custos'])!;
  const chave = chaveCache('dash_resumo', args, i);
  assert.ok(!chave.includes(token));
  assert.ok(!chave.includes('assinatura-secreta'));
  assert.ok(!/eyJ/.test(chave));
  // A chave e a mesma para dois usuarios (tokens diferentes) com o mesmo perfil, canais e permissoes
  assert.equal(chave, chaveCache('dash_resumo', args, identidadeCache('admin', ['mercadolivre'], ['custos'])!));
});

test('cache de 10 minutos', () => {
  assert.equal(CACHE_SEGUNDOS, 600);
});
