import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brl, num, pct, variacao } from './formato.ts';

const limpo = (s: string) => s.replace(/\s/g, ' ');

test('brl formata em reais e mostra traco para nulo', () => {
  assert.equal(limpo(brl(1234.5)), 'R$ 1.234,50');
  assert.equal(limpo(brl(-200)), '-R$ 200,00');
  assert.equal(brl(null), '—');
});

test('num e pct', () => {
  assert.equal(num(2400), '2.400');
  assert.equal(pct(18.734), '18,7%');
  assert.equal(pct(null), '—');
});

test('variacao: crescimento em %', () => {
  assert.deepEqual(variacao(108, 100), { valor: 8, rotulo: '▲ 8,0%' });
  assert.deepEqual(variacao(95, 100), { valor: -5, rotulo: '▼ 5,0%' });
});

test('variacao: periodo anterior zerado vira "novo"', () => {
  assert.deepEqual(variacao(10, 0), { valor: null, rotulo: 'novo' });
});

test('variacao: os dois zerados ou nulos', () => {
  assert.deepEqual(variacao(0, 0), { valor: null, rotulo: '—' });
  assert.deepEqual(variacao(null, 100), { valor: null, rotulo: '—' });
});
