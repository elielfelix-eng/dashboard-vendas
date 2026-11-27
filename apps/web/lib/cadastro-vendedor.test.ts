import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deveConvidar, emailValido, normalizarEmail } from './cadastro-vendedor.ts';

test('normalizarEmail tira espacos e poe em minusculas', () => {
  assert.equal(normalizarEmail('  Allison.Santos@BrindeDoBem.com.br '), 'allison.santos@brindedobem.com.br');
});

test('emailValido aceita um e-mail comum', () => {
  assert.equal(emailValido('allison.santos@brindedobem.com.br'), true);
});

test('emailValido recusa texto sem arroba, sem dominio ou com espacos no meio', () => {
  assert.equal(emailValido('allison'), false);
  assert.equal(emailValido('allison@'), false);
  assert.equal(emailValido('@brindedobem.com.br'), false);
  assert.equal(emailValido('alli son@brindedobem.com.br'), false);
  assert.equal(emailValido(''), false);
});

test('emailValido recusa mais de uma arroba', () => {
  assert.equal(emailValido('a@b@brindedobem.com.br'), false);
});

test('deveConvidar so vale com elegibilidade verdadeira e sem erro', () => {
  assert.equal(deveConvidar({ data: true, error: null }), true);
  assert.equal(deveConvidar({ data: false, error: null }), false);
  assert.equal(deveConvidar({ data: null, error: null }), false);
  assert.equal(deveConvidar({ data: true, error: { message: 'falha' } }), false);
});
