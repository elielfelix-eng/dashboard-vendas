import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roas, percentual, rotuloModelo, avisoSemDetalhe, AVISO_SEM_DETALHE, ROTULO_NAO_ATRIBUIDO } from './ads-regras.ts';

test('roas formata com virgula e sufixo x, traco para nulo', () => {
  assert.equal(roas(4.37), '4,37x');
  assert.equal(roas(10), '10,00x');
  assert.equal(roas(0), '0,00x');
  assert.equal(roas(null), '—');
  assert.equal(roas(undefined), '—');
});

test('ACOS, TACOS e percentuais usam uma casa e %', () => {
  assert.equal(percentual(12.34), '12,3%');
  assert.equal(percentual(0), '0,0%');
  assert.equal(percentual(null), '—');
});

test('linha sem modelo vira "não atribuído a anúncio"', () => {
  assert.equal(ROTULO_NAO_ATRIBUIDO, 'não atribuído a anúncio');
  assert.equal(rotuloModelo(null), 'não atribuído a anúncio');
  assert.equal(rotuloModelo('CANECA-01'), 'CANECA-01');
});

test('aviso aparece so quando nao ha detalhe por anuncio', () => {
  assert.equal(avisoSemDetalhe(false), 'sem detalhe por anúncio neste período (a API do Mercado Livre guarda 90 dias)');
  assert.equal(AVISO_SEM_DETALHE, avisoSemDetalhe(false));
  assert.equal(avisoSemDetalhe(true), null);
});
