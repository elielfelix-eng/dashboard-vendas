import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diasRebuscaAds } from './ads-janela.ts';

test('janela de Ads: padrão 30 dias quando não informado ou inválido', () => {
  assert.equal(diasRebuscaAds(undefined, false), 30);
  assert.equal(diasRebuscaAds('', false), 30);
  assert.equal(diasRebuscaAds('abc', false), 30);
  assert.equal(diasRebuscaAds('0', false), 30);
  assert.equal(diasRebuscaAds('-5', false), 30);
  assert.equal(diasRebuscaAds('2.5', false), 30);
});

test('janela de Ads: valor informado, limitado a 89 (a API guarda 90 dias)', () => {
  assert.equal(diasRebuscaAds('7', false), 7);
  assert.equal(diasRebuscaAds(' 89 ', false), 89);
  assert.equal(diasRebuscaAds('365', false), 89);
});

test('janela de Ads: primeira sincronização busca tudo (89)', () => {
  assert.equal(diasRebuscaAds('7', true), 89);
});
