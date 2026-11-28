import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarTrocaSenha, validarNovaSenha } from './senha.ts';

test('nova senha precisa ter pelo menos 8 caracteres', () => {
  assert.equal(validarNovaSenha('1234567', '1234567'), 'A senha precisa ter pelo menos 8 caracteres.');
  assert.equal(validarNovaSenha('12345678', '12345678'), null);
});

test('confirmação precisa ser igual', () => {
  assert.equal(validarNovaSenha('senha-nova-1', 'senha-nova-2'), 'As senhas não conferem.');
});

test('troca exige a senha atual', () => {
  assert.equal(validarTrocaSenha('', 'senha-nova-1', 'senha-nova-1'), 'Informe a senha atual.');
});

test('troca não aceita a mesma senha', () => {
  assert.equal(validarTrocaSenha('senha-igual-1', 'senha-igual-1', 'senha-igual-1'), 'A nova senha precisa ser diferente da atual.');
});

test('troca válida', () => {
  assert.equal(validarTrocaSenha('senha-antiga', 'senha-nova-1', 'senha-nova-1'), null);
});
