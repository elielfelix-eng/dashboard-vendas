import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textoFaltam, corDoNivel } from './alertas-formato.ts';

test('textoFaltam: dias úteis restantes', () => {
  assert.equal(textoFaltam(4, 'em_risco'), '4 dias úteis');
  assert.equal(textoFaltam(1, 'em_risco'), '1 dia útil');
  assert.equal(textoFaltam(0, 'em_risco'), 'vence hoje');
});
test('textoFaltam: atrasada e prazo desconhecido', () => {
  assert.equal(textoFaltam(-2, 'atrasada'), 'atrasada há 2 dias úteis');
  assert.equal(textoFaltam(-1, 'atrasada'), 'atrasada há 1 dia útil');
  assert.equal(textoFaltam(0, 'atrasada'), 'atrasada');
  assert.equal(textoFaltam(null, 'atrasada'), 'atrasada');
  assert.equal(textoFaltam(null, 'prazo_desconhecido'), 'prazo desconhecido');
});
test('corDoNivel: nomes dos níveis', () => {
  assert.equal(corDoNivel('5_green').nome, 'Verde');
  assert.equal(corDoNivel('4_light_green').nome, 'Verde-claro');
  assert.equal(corDoNivel('3_yellow').nome, 'Amarelo');
  assert.equal(corDoNivel('2_orange').nome, 'Laranja');
  assert.equal(corDoNivel('1_red').nome, 'Vermelho');
  assert.equal(corDoNivel(null).nome, 'Sem reputação');
});
