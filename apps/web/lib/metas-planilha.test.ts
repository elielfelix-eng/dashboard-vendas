import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarLinhasMetas } from './metas-planilha.ts';

const CAB = ['Marketplace', 'Ano', 'Mês', 'Meta'];

test('linha valida do Mercado Livre', () => {
  const r = validarLinhasMetas([CAB, ['Mercado livre', 2027, 'Jan', 26711]]);
  assert.deepEqual(r.erros, []);
  assert.deepEqual(r.validas, [{ channel: 'mercadolivre', ano: 2027, mes: 1, valor: 26711 }]);
});

test('meses por nome, abreviado, minusculo, acentuado ou numero', () => {
  const r = validarLinhasMetas([CAB,
    ['Shopee', 2027, 'mar', 1], ['Shopee', 2028, 'Mar', 1], ['Shopee', 2029, 3, 1], ['Shopee', 2030, 'Março', 1], ['Shopee', 2031, '3', 1]]);
  assert.deepEqual(r.erros, []);
  assert.deepEqual(r.validas.map((v) => v.mes), [3, 3, 3, 3, 3]);
});

test('canais com variacao de escrita', () => {
  const r = validarLinhasMetas([CAB, ['Brinde do Bem', 2027, 1, 1], ['SHOPEE', 2027, 1, 1], ['MercadoLivre', 2027, 2, 1]]);
  assert.deepEqual(r.validas.map((v) => v.channel), ['brindedobem', 'shopee', 'mercadolivre']);
});

test('valor com virgula decimal e ponto de milhar', () => {
  const r = validarLinhasMetas([CAB, ['Shopee', 2027, 1, '26.711,50'], ['Shopee', 2027, 2, 561463.659]]);
  assert.deepEqual(r.validas.map((v) => v.valor), [26711.5, 561463.66]);
});

test('colunas em outra ordem e cabecalho "Canal"', () => {
  const r = validarLinhasMetas([['Meta', 'Mês', 'Canal', 'Ano'], [100, 'Fev', 'Shopee', '2027']]);
  assert.deepEqual(r.validas, [{ channel: 'shopee', ano: 2027, mes: 2, valor: 100 }]);
});

test('ano ausente, canal desconhecido, meta vazia, meta negativa, mes invalido', () => {
  const r = validarLinhasMetas([CAB,
    ['Shopee', null, 'Jan', 1], ['Amazon', 2027, 'Jan', 1], ['Shopee', 2027, 'Jan', null], ['Shopee', 2027, 'Fev', -5], ['Shopee', 2027, 'Xyz', 1]]);
  assert.deepEqual(r.erros, [
    { linha: 2, motivo: 'ano ausente' },
    { linha: 3, motivo: 'canal desconhecido: "Amazon"' },
    { linha: 4, motivo: 'meta ausente' },
    { linha: 5, motivo: 'meta negativa' },
    { linha: 6, motivo: 'mês inválido: "Xyz"' },
  ]);
  assert.deepEqual(r.validas, []);
});

test('ano que nao e numero ("Ano" na linha de dados)', () => {
  const r = validarLinhasMetas([CAB, ['Shopee', 'Ano', 'Dez', 96337]]);
  assert.deepEqual(r.erros, [{ linha: 2, motivo: 'ano inválido: "Ano"' }]);
});

test('linha duplicada', () => {
  const r = validarLinhasMetas([CAB, ['Shopee', 2027, 'Jan', 1], ['shopee', 2027, 1, 2]]);
  assert.deepEqual(r.erros, [{ linha: 3, motivo: 'repete canal, ano e mês da linha 2' }]);
});

test('linhas totalmente vazias sao ignoradas', () => {
  const r = validarLinhasMetas([CAB, ['Shopee', 2027, 'Jan', 1], [null, null, null, null], [null, null, null, '']]);
  assert.deepEqual(r.erros, []);
  assert.equal(r.validas.length, 1);
});

test('cabecalho sem coluna Ano', () => {
  const r = validarLinhasMetas([['Marketplace', 'Mês', 'Meta'], ['Shopee', 'Jan', 1]]);
  assert.deepEqual(r.erros, [{ linha: 1, motivo: 'coluna Ano não encontrada' }]);
  assert.deepEqual(r.validas, []);
});

test('totais por canal', () => {
  const r = validarLinhasMetas([CAB, ['Shopee', 2027, 1, 10], ['Shopee', 2027, 2, 5.5], ['Mercado livre', 2027, 1, 7]]);
  assert.deepEqual(r.totais, { shopee: 15.5, mercadolivre: 7 });
});
