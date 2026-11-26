import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textoFaltam, corDoNivel, rotuloOrigem, rotuloStatusEnvio, separarProducao } from './alertas-formato.ts';

test('rotuloStatusEnvio: ready_to_ship postado, coletado ou no centro', () => {
  assert.equal(rotuloStatusEnvio('ready_to_ship', 'dropped_off'), 'Postado');
  assert.equal(rotuloStatusEnvio('ready_to_ship', 'picked_up'), 'Coletado');
  assert.equal(rotuloStatusEnvio('ready_to_ship', 'in_hub'), 'No centro de distribuição');
});
test('rotuloStatusEnvio: demais casos sem mudança', () => {
  assert.equal(rotuloStatusEnvio('ready_to_ship', 'ready_to_print'), 'Pronto para envio');
  assert.equal(rotuloStatusEnvio('ready_to_ship', null), 'Pronto para envio');
  assert.equal(rotuloStatusEnvio('pending', 'manufacturing'), 'Pendente');
  assert.equal(rotuloStatusEnvio('shipped', 'picked_up'), 'A caminho');
  assert.equal(rotuloStatusEnvio('outro', null), 'outro');
  assert.equal(rotuloStatusEnvio(null, null), '—');
});

test('separarProducao: em_producao fora dos riscos, ordenado pelo prazo', () => {
  const l = [
    { id: 1, situacao: 'em_risco', prazo: '2026-12-01' },
    { id: 2, situacao: 'em_producao', prazo: '2026-12-05' },
    { id: 3, situacao: 'prazo_desconhecido', prazo: null },
    { id: 4, situacao: 'em_producao', prazo: '2026-12-04' },
  ];
  const r = separarProducao(l);
  assert.deepEqual(r.riscos.map((x) => x.id), [1, 3]);
  assert.deepEqual(r.emProducao.map((x) => x.id), [4, 2]);
  assert.deepEqual(separarProducao([]), { riscos: [], emProducao: [] });
});
test('textoFaltam: em_producao mostra dias úteis positivos', () => {
  assert.equal(textoFaltam(5, 'em_producao'), '5 dias úteis');
});

test('rotuloOrigem: origem do prazo', () => {
  assert.equal(rotuloOrigem('producao'), 'Terminar produto');
  assert.equal(rotuloOrigem('envio'), 'Despacho');
  assert.equal(rotuloOrigem('estimado'), 'Estimado');
  assert.equal(rotuloOrigem(null), '—');
});

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
