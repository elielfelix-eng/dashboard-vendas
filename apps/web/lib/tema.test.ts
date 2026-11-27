import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAVE_TEMA, resolverTema } from './tema.ts';

test("resolverTema: escolha salva 'escuro' vence o sistema claro", () => {
  assert.equal(resolverTema('escuro', false), 'escuro');
});

test("resolverTema: escolha salva 'claro' vence o sistema escuro", () => {
  assert.equal(resolverTema('claro', true), 'claro');
});

test('resolverTema: sem escolha salva, segue o sistema escuro', () => {
  assert.equal(resolverTema(null, true), 'escuro');
});

test('resolverTema: valor inválido salvo cai no tema do sistema claro', () => {
  assert.equal(resolverTema('qualquer', false), 'claro');
});

test('resolverTema: valor inválido salvo cai no tema do sistema escuro', () => {
  assert.equal(resolverTema('qualquer', true), 'escuro');
});

test('chave de armazenamento do tema', () => {
  assert.equal(CHAVE_TEMA, 'bdb-tema');
});
