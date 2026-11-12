import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canalMetaVisaoGeral } from './canais.ts';

test('consolidado compara so com a meta dos canais que ja tem vendas no painel', () => {
  assert.equal(canalMetaVisaoGeral('consolidado'), 'mercadolivre');
});

test('canal especifico usa a propria meta', () => {
  assert.equal(canalMetaVisaoGeral('mercadolivre'), 'mercadolivre');
  assert.equal(canalMetaVisaoGeral('shopee'), 'shopee');
});
