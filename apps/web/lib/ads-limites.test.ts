import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMPOS_LIMITES, validarLimites } from './ads-limites.ts';

const valido = Object.fromEntries(CAMPOS_LIMITES.map((c) => [c.chave, c.padrao.toString().replace('.', ',')]));

test('aceita valores validos e converte virgula decimal', () => {
  const r = validarLimites(valido);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.valores.reduzir_fator, 0.7);
    assert.equal(r.valores.pausar_cliques_min, 100);
  }
});

test('recusa negativo, texto e vazio', () => {
  assert.equal(validarLimites({ ...valido, pausar_gasto_min: '-1' }).ok, false);
  assert.equal(validarLimites({ ...valido, pausar_gasto_min: 'abc' }).ok, false);
  assert.equal(validarLimites({ ...valido, pausar_gasto_min: '' }).ok, false);
});

test('porcentagens ficam entre 0 e 100', () => {
  assert.equal(validarLimites({ ...valido, teste_reserva_pct: '101' }).ok, false);
  assert.equal(validarLimites({ ...valido, alerta_sobra_pct: '100' }).ok, true);
});

test('campos inteiros recusam decimais', () => {
  const r = validarLimites({ ...valido, min_dias_dados: '7,5' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.erro, /inteiro/i);
});

test('fatores de reducao ficam entre 0 e 1 e teto fator ao menos 1', () => {
  assert.equal(validarLimites({ ...valido, reduzir_fator: '1,5' }).ok, false);
  assert.equal(validarLimites({ ...valido, teto_fator: '0,5' }).ok, false);
});
