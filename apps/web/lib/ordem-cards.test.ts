import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aplicarOrdem, lerOrdemGravada } from './ordem-cards.ts';

const itens = [{ chave: 'a' }, { chave: 'b' }, { chave: 'c' }];

test('aplica a ordem salva', () => {
  assert.deepEqual(aplicarOrdem(itens, ['c', 'a', 'b']).map((i) => i.chave), ['c', 'a', 'b']);
});

test('chave que sumiu é ignorada e item novo vai para o fim', () => {
  const com = [{ chave: 'b' }, { chave: 'x' }, { chave: 'a' }];
  assert.deepEqual(aplicarOrdem(com, ['c', 'a', 'b']).map((i) => i.chave), ['a', 'b', 'x']);
});

test('chave repetida na ordem salva não duplica o card', () => {
  assert.deepEqual(aplicarOrdem(itens, ['a', 'a', 'b']).map((i) => i.chave), ['a', 'b', 'c']);
});

test('sem ordem salva: ordem padrão', () => {
  assert.deepEqual(aplicarOrdem(itens, []).map((i) => i.chave), ['a', 'b', 'c']);
});

test('leitura da ordem gravada: só lista de textos válida', () => {
  assert.deepEqual(lerOrdemGravada('["a","b"]'), ['a', 'b']);
  assert.equal(lerOrdemGravada(null), null);
  assert.equal(lerOrdemGravada('{não é json'), null);
  assert.equal(lerOrdemGravada('[1,2]'), null);
  assert.equal(lerOrdemGravada('"texto"'), null);
});
