import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CACHE_SEGUNDOS, LIMITE_BYTES_CACHE, chaveCache, dataBrasilia, decidirCache, donoDoToken, identidadeCache, janelaCache } from './cache-chave.ts';

const T0 = new Date('2026-11-27T15:00:00Z');
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
  assert.notEqual(chaveCache('dash_resumo', args, a, T0), chaveCache('dash_resumo', args, c, T0));
});

test('canais ou permissoes diferentes dao chaves diferentes', () => {
  const base = identidadeCache('gestor', ['mercadolivre', 'shopee'], ['custos', 'vendas'])!;
  const semShopee = identidadeCache('gestor', ['mercadolivre'], ['custos', 'vendas'])!;
  const semCustos = identidadeCache('gestor', ['mercadolivre', 'shopee'], ['vendas'])!;
  const chaves = new Set([base, semShopee, semCustos].map((i) => chaveCache('dash_resumo', args, i, T0)));
  assert.equal(chaves.size, 3);
});

test('sem perfil nao ha identidade (nao usa cache)', () => {
  assert.equal(identidadeCache(null, ['mercadolivre'], ['custos']), null);
  assert.equal(identidadeCache(undefined, ['mercadolivre'], ['custos']), null);
  assert.equal(identidadeCache('', ['mercadolivre'], ['custos']), null);
});

test('chave: funcao e argumentos entram; ordem das chaves dos argumentos nao importa', () => {
  const i = identidadeCache('admin', ['mercadolivre'], [])!;
  assert.equal(chaveCache('dash_resumo', { p_ate: '2026-11-27', p_de: '2026-11-01', p_canal: 'mercadolivre' }, i, T0), chaveCache('dash_resumo', args, i, T0));
  assert.notEqual(chaveCache('dash_serie', args, i, T0), chaveCache('dash_resumo', args, i, T0));
  assert.notEqual(chaveCache('dash_resumo', { ...args, p_canal: 'shopee' }, i, T0), chaveCache('dash_resumo', args, i, T0));
  assert.notEqual(chaveCache('dash_skus', { ...args, p_modelo: null }, i, T0), chaveCache('dash_skus', { ...args, p_modelo: 'AAA11' }, i, T0));
});

test('o token de acesso nao entra na chave', () => {
  const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c3VhcmlvLTEifQ.assinatura-secreta';
  const i = identidadeCache('admin', ['mercadolivre'], ['custos'])!;
  const chave = chaveCache('dash_resumo', args, i, T0);
  assert.ok(!chave.includes(token));
  assert.ok(!chave.includes('assinatura-secreta'));
  assert.ok(!/eyJ/.test(chave));
  // A chave e a mesma para dois usuarios (tokens diferentes) com o mesmo perfil, canais e permissoes
  assert.equal(chave, chaveCache('dash_resumo', args, identidadeCache('admin', ['mercadolivre'], ['custos'])!, T0));
});

test('cache de 10 minutos', () => {
  assert.equal(CACHE_SEGUNDOS, 600);
});

// ---------- Fix round 1: data de Brasilia, janela de 10 minutos e decisao de usar o cache ----------
const jwt = (sub: string) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub, role: 'authenticated' })).toString('base64url')}.assinatura`;
const I = identidadeCache('admin', ['mercadolivre'], ['custos'])!;

test('data de Brasilia: 02:30 UTC do dia 28 ainda e dia 27 em Brasilia', () => {
  assert.equal(dataBrasilia(new Date('2026-11-28T02:30:00Z')), '2026-11-27');
  assert.equal(dataBrasilia(new Date('2026-11-28T03:00:00Z')), '2026-11-28');
});

test('mesmos argumentos em datas de Brasilia diferentes dao chaves diferentes', () => {
  const ontem = new Date('2026-11-28T02:59:00Z'); // 27/11 23:59 em Brasilia (ja 28/11 em UTC)
  const hoje = new Date('2026-11-28T03:01:00Z');  // 28/11 00:01 em Brasilia
  assert.ok(chaveCache('dash_metas', args, I, ontem).includes(':2026-11-27:'));
  assert.ok(chaveCache('dash_metas', args, I, hoje).includes(':2026-11-28:'));
  assert.notEqual(chaveCache('dash_metas', args, I, ontem), chaveCache('dash_metas', args, I, hoje));
});

test('janela de 10 minutos: mesma janela = mesma chave; janela seguinte = chave nova', () => {
  const t = (iso: string) => new Date(iso);
  assert.equal(janelaCache(t('2026-11-27T15:00:00Z')), Math.floor(Date.parse('2026-11-27T15:00:00Z') / 600_000));
  assert.equal(janelaCache(t('2026-11-27T15:00:00Z')), janelaCache(t('2026-11-27T15:09:59.999Z')));
  assert.equal(janelaCache(t('2026-11-27T15:10:00Z')), janelaCache(t('2026-11-27T15:00:00Z')) + 1);
  assert.equal(chaveCache('dash_resumo', args, I, t('2026-11-27T15:01:00Z')), chaveCache('dash_resumo', args, I, t('2026-11-27T15:09:00Z')));
  assert.notEqual(chaveCache('dash_resumo', args, I, t('2026-11-27T15:09:00Z')), chaveCache('dash_resumo', args, I, t('2026-11-27T15:11:00Z')));
  // Horas depois (periodo parado): chave diferente, nunca reaproveita a entrada antiga
  assert.notEqual(chaveCache('dash_resumo', args, I, t('2026-11-27T15:01:00Z')), chaveCache('dash_resumo', args, I, t('2026-11-27T19:01:00Z')));
});

test('limite de tamanho abaixo dos 2 MB do Next', () => {
  assert.ok(LIMITE_BYTES_CACHE < 2 * 1024 * 1024 && LIMITE_BYTES_CACHE >= 1_800_000);
});

test('donoDoToken le o sub do JWT; token invalido = null', () => {
  assert.equal(donoDoToken(jwt('u-1')), 'u-1');
  assert.equal(donoDoToken('lixo'), null);
  assert.equal(donoDoToken(null), null);
});

const ok = { userId: 'u-1', role: 'admin', canais: ['mercadolivre'], permissoes: ['custos'], erroPermissoes: false, token: jwt('u-1') };
test('decidirCache: sessao coerente usa o cache com a identidade do perfil', () => {
  assert.equal(decidirCache(ok), I);
});
test('decidirCache: token de outro usuario (sub diferente) = sem cache', () => {
  assert.equal(decidirCache({ ...ok, token: jwt('u-2') }), null);
});
test('decidirCache: sem perfil = sem cache', () => {
  assert.equal(decidirCache({ ...ok, role: null }), null);
  assert.equal(decidirCache({ ...ok, role: undefined }), null);
});
test('decidirCache: erro ao ler as permissoes = sem cache', () => {
  assert.equal(decidirCache({ ...ok, erroPermissoes: true }), null);
});
test('decidirCache: sem login ou sem token = sem cache', () => {
  assert.equal(decidirCache({ ...ok, userId: null }), null);
  assert.equal(decidirCache({ ...ok, token: null }), null);
  assert.equal(decidirCache({ ...ok, token: 'nao-e-jwt' }), null);
});
