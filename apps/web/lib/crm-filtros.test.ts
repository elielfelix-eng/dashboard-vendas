import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerFiltrosCrm } from './crm-filtros.ts';

test('le area, vendedor e origem da URL e resolve o periodo', () => {
  const f = lerFiltrosCrm({ periodo: 'mes', area: 'Pedido Online', vendedor: '7', origem: '19' }, '2026-11-14');
  assert.equal(f.area, 'Pedido Online');
  assert.equal(f.vendedor, 7);
  assert.equal(f.origem, '19');
  assert.equal(f.chave, 'mes');
  assert.equal(f.periodo.de, '2026-11-01');
});

test('vendedor invalido e area vazia viram null', () => {
  const f = lerFiltrosCrm({ vendedor: 'abc', area: '' }, '2026-11-14');
  assert.equal(f.vendedor, null);
  assert.equal(f.area, null);
  assert.equal(f.origem, null);
});

test('vendedor so aceita inteiro positivo', () => {
  for (const v of ['0', '-3', '1.5', '1e3', ' ']) assert.equal(lerFiltrosCrm({ vendedor: v }, '2026-11-14').vendedor, null);
});
