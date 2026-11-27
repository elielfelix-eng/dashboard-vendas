import { test } from 'node:test';
import assert from 'node:assert/strict';
import { manterPeriodoGravado } from './sync-mercadolivre.ts';

test('fatura: leitura vazia nunca apaga um período já gravado', () => {
  assert.equal(manterPeriodoGravado(0, 261), true);
});

test('fatura: leitura com menos linhas que o gravado mantém o gravado', () => {
  assert.equal(manterPeriodoGravado(200, 261), true);
});

test('fatura: leitura com o mesmo número ou mais linhas substitui', () => {
  assert.equal(manterPeriodoGravado(261, 261), false);
  assert.equal(manterPeriodoGravado(300, 261), false);
});

test('fatura: período ainda não gravado sempre grava, mesmo vazio', () => {
  assert.equal(manterPeriodoGravado(0, undefined), false);
  assert.equal(manterPeriodoGravado(10, undefined), false);
});
