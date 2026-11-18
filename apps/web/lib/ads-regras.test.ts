import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  roas, percentual, rotuloModelo, avisoSemDetalhe, AVISO_SEM_DETALHE, ROTULO_NAO_ATRIBUIDO,
  ORDEM_SUGESTOES, rotuloSugestao, tomSugestao, ordemSugestao, contarSugestoes, lerSugestao,
} from './ads-regras.ts';

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

test('rotulos e tons das sugestoes', () => {
  assert.deepEqual(ORDEM_SUGESTOES, ['pausar', 'reduzir', 'revisar', 'escalar', 'testar', 'manter']);
  assert.equal(rotuloSugestao('pausar'), 'Pausar');
  assert.equal(rotuloSugestao('reduzir'), 'Reduzir');
  assert.equal(rotuloSugestao('revisar'), 'Revisar anúncio');
  assert.equal(rotuloSugestao('escalar'), 'Escalar');
  assert.equal(rotuloSugestao('testar'), 'Testar Ads');
  assert.equal(rotuloSugestao('manter'), 'Manter');
  assert.equal(rotuloSugestao(null), '—');
  assert.equal(tomSugestao('pausar'), 'ruim');
  assert.equal(tomSugestao('reduzir'), 'ruim');
  assert.equal(tomSugestao('revisar'), 'alerta');
  assert.equal(tomSugestao('escalar'), 'bom');
  assert.equal(tomSugestao('testar'), 'info');
  assert.equal(tomSugestao('manter'), 'neutro');
  assert.equal(tomSugestao(null), 'neutro');
});

test('ordem de exibicao das sugestoes; nulo por ultimo', () => {
  assert.equal(ordemSugestao('pausar'), 0);
  assert.equal(ordemSugestao('manter'), 5);
  assert.equal(ordemSugestao(null), 6);
});

test('contagem por sugestao ignora nulo e nao atribuido', () => {
  const linhas = [
    { modelo: 'A', sugestao: 'pausar' as const },
    { modelo: 'B', sugestao: 'pausar' as const },
    { modelo: 'C', sugestao: 'escalar' as const },
    { modelo: 'D', sugestao: null },
    { modelo: null, sugestao: 'manter' as const },
  ];
  assert.deepEqual(contarSugestoes(linhas), { pausar: 2, reduzir: 0, revisar: 0, escalar: 1, testar: 0, manter: 0 });
});

test('valida o parametro sug da URL', () => {
  assert.equal(lerSugestao('escalar'), 'escalar');
  assert.equal(lerSugestao('xyz'), null);
  assert.equal(lerSugestao(undefined), null);
  assert.equal(lerSugestao(['pausar']), 'pausar');
});
