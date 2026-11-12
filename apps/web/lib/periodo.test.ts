import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerFiltros, resolverPeriodo } from './periodo.ts';

const datas = (p: { de: string; ate: string; anteriorDe: string; anteriorAte: string }) =>
  [p.de, p.ate, p.anteriorDe, p.anteriorAte];

test('mes atual compara com o mesmo trecho do mes anterior', () => {
  assert.deepEqual(datas(resolverPeriodo('mes', '2026-11-12')), ['2026-11-01', '2026-11-12', '2026-10-01', '2026-10-12']);
});

test('mes atual no dia 31: trecho anterior limitado ao fim do mes anterior', () => {
  assert.deepEqual(datas(resolverPeriodo('mes', '2026-03-31')), ['2026-03-01', '2026-03-31', '2026-02-01', '2026-02-28']);
});

test('7 dias e o periodo anterior de mesmo tamanho', () => {
  assert.deepEqual(datas(resolverPeriodo('7d', '2026-11-12')), ['2026-11-06', '2026-11-12', '2026-10-30', '2026-11-05']);
});

test('hoje compara com ontem', () => {
  assert.deepEqual(datas(resolverPeriodo('hoje', '2026-11-12')), ['2026-11-12', '2026-11-12', '2026-11-11', '2026-11-11']);
});

test('30 dias', () => {
  assert.deepEqual(datas(resolverPeriodo('30d', '2026-11-12')), ['2026-10-14', '2026-11-12', '2026-09-14', '2026-10-13']);
});

test('mes anterior compara com o mes antes dele', () => {
  assert.deepEqual(datas(resolverPeriodo('mes_anterior', '2026-11-12')), ['2026-10-01', '2026-10-31', '2026-09-01', '2026-09-30']);
});

test('ano compara com o mesmo trecho do ano anterior', () => {
  assert.deepEqual(datas(resolverPeriodo('ano', '2026-11-12')), ['2026-01-01', '2026-11-12', '2025-01-01', '2025-11-12']);
});

test('personalizado usa as datas e o periodo anterior de mesmo tamanho', () => {
  assert.deepEqual(datas(resolverPeriodo('personalizado', '2026-11-12', '2026-10-01', '2026-10-31')),
    ['2026-10-01', '2026-10-31', '2026-08-31', '2026-09-30']);
});

test('personalizado sem datas validas cai no mes atual', () => {
  assert.deepEqual(datas(resolverPeriodo('personalizado', '2026-11-12')), ['2026-11-01', '2026-11-12', '2026-10-01', '2026-10-12']);
  assert.deepEqual(datas(resolverPeriodo('personalizado', '2026-11-12', '2026-10-31', '2026-10-01')), ['2026-11-01', '2026-11-12', '2026-10-01', '2026-10-12']);
});

test('lerFiltros: padrao consolidado e mes', () => {
  const f = lerFiltros({}, '2026-11-12');
  assert.equal(f.canal, 'consolidado');
  assert.equal(f.chave, 'mes');
  assert.equal(f.periodo.de, '2026-11-01');
});

test('lerFiltros: valores invalidos voltam ao padrao', () => {
  const f = lerFiltros({ canal: 'amazon', periodo: 'xyz' }, '2026-11-12');
  assert.equal(f.canal, 'consolidado');
  assert.equal(f.chave, 'mes');
});

test('lerFiltros: personalizado com datas', () => {
  const f = lerFiltros({ canal: 'mercadolivre', periodo: 'personalizado', de: '2026-10-01', ate: '2026-10-31' }, '2026-11-12');
  assert.equal(f.canal, 'mercadolivre');
  assert.deepEqual([f.periodo.de, f.periodo.ate], ['2026-10-01', '2026-10-31']);
});
