import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agregarAnual, pctDe } from './anual.ts';

const mes = (m: string, o: Partial<Record<string, number | null>>) => ({
  mes: m, pedidos: 0, receita: 0, comissao: 0, frete: 0, parcelamento: 0, product_ads: 0, seguidores: 0,
  estornos: 0, difal: 0, outras: 0, custo_produto: 0 as number | null, margem_contribuicao: 0 as number | null, ...o,
});

test('soma os meses de cada ano e separa a publicidade', () => {
  const r = agregarAnual([
    mes('2025-12-01', { pedidos: 2, receita: 100, comissao: 10, frete: 5, product_ads: 20, custo_produto: 30, margem_contribuicao: 35 }),
    mes('2026-01-01', { pedidos: 3, receita: 200, frete: 10, product_ads: 30, seguidores: 5, estornos: -5, difal: 2, outras: 1, custo_produto: 50, margem_contribuicao: 107 }),
    mes('2026-02-01', { pedidos: 0 }),
  ]);
  assert.deepEqual(r, [
    { ano: 2025, meses_venda: 1, pedidos: 2, receita: 100, custos_ml: 35, publicidade: 20, custo_produto: 30, margem: 35, margem_pct: 35 },
    { ano: 2026, meses_venda: 1, pedidos: 3, receita: 200, custos_ml: 43, publicidade: 30, custo_produto: 50, margem: 107, margem_pct: 53.5 },
  ]);
});

test('sem permissao de custo: custo e margem ficam nulos', () => {
  const r = agregarAnual([mes('2026-01-01', { pedidos: 1, receita: 50, custo_produto: null, margem_contribuicao: null })]);
  assert.equal(r[0].custo_produto, null);
  assert.equal(r[0].margem, null);
  assert.equal(r[0].margem_pct, null);
});

test('pctDe evita divisao por zero', () => {
  assert.equal(pctDe(10, 0), null);
  assert.equal(pctDe(null, 10), null);
  assert.equal(pctDe(25, 100), 25);
});
