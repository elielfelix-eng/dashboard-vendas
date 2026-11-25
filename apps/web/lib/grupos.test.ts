import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validarGrupo } from './grupos.ts';

test('aceita nome com espacos nas pontas e antecedencia inteira', () => {
  assert.deepEqual(validarGrupo(' Personalizados ', '6'), { ok: true, nome: 'Personalizados', antecedencia: 6 });
});
test('recusa nome vazio', () => {
  assert.equal(validarGrupo('', '3').ok, false);
  assert.equal(validarGrupo('   ', '3').ok, false);
});
test('recusa nome com mais de 60 caracteres', () => {
  assert.equal(validarGrupo('x'.repeat(61), '3').ok, false);
  assert.equal(validarGrupo('x'.repeat(60), '3').ok, true);
});
test('recusa antecedencia acima de 30 ou nao inteira', () => {
  assert.equal(validarGrupo('X', '31').ok, false);
  assert.equal(validarGrupo('X', '2.5').ok, false);
  assert.equal(validarGrupo('X', '-1').ok, false);
  assert.equal(validarGrupo('X', '').ok, false);
});
test('aceita antecedencia zero', () => {
  assert.equal(validarGrupo('X', '0').ok, true);
});
