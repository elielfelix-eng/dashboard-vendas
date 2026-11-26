import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  atualizadoEmCanal, avisoSemDadosShopee, canaisDaMeta, metaDoMes, nomeCanal, precisaReconectarShopee, rotuloLinkAnuncio,
  shopeeAtiva, textosEstimados,
} from './canais.ts';

test('meta da Visao Geral: consolidado soma as metas dos canais com vendas no painel', () => {
  assert.deepEqual(canaisDaMeta('consolidado', false), ['mercadolivre']);
  assert.deepEqual(canaisDaMeta('consolidado', true), ['mercadolivre', 'shopee']);
});

test('meta da Visao Geral: canal especifico usa a propria meta', () => {
  assert.deepEqual(canaisDaMeta('mercadolivre', true), ['mercadolivre']);
  assert.deepEqual(canaisDaMeta('shopee', false), ['shopee']);
});

test('meta do mes: soma so os canais que tem meta (realizado de canal sem meta nao entra)', () => {
  assert.deepEqual(metaDoMes([{ realizado: 100, meta: 200 }, { realizado: 50, meta: 100 }]), { realizado: 150, meta: 300 });
  assert.deepEqual(metaDoMes([{ realizado: 100, meta: 200 }, { realizado: 50, meta: null }]), { realizado: 100, meta: 200 });
  assert.deepEqual(metaDoMes([{ realizado: null, meta: 200 }]), { realizado: 0, meta: 200 });
  assert.equal(metaDoMes([{ realizado: 100, meta: null }]), null);
  assert.equal(metaDoMes([]), null);
});

test('shopeeAtiva: so com loja conectada e ao menos uma sincronizacao bem-sucedida', () => {
  assert.equal(shopeeAtiva({ conectada: true, ultimoSucesso: '2026-11-26T11:00:00Z' }), true);
  assert.equal(shopeeAtiva({ conectada: false, ultimoSucesso: '2026-11-26T11:00:00Z' }), false);
  assert.equal(shopeeAtiva({ conectada: true, ultimoSucesso: null }), false);
});

// ---------------- Tarefa 7, Step 2: periodo sem dados da Shopee nao vira zero (Review Focus 5) ----------------
const COB = { conectada: true, ultimoSucesso: '2026-11-26T11:00:00Z', inicio: '2026-06-01' };
const P = (de: string, ate: string, anteriorDe = '2020-01-01') => ({ de, ate, anteriorDe });
const SEM = { semDados: true, texto: 'Sem dados da Shopee neste período.' };

test('Shopee: periodo antes da primeira venda sincronizada mostra "sem dados da Shopee neste período", nao zero', () => {
  assert.deepEqual(avisoSemDadosShopee('shopee', P('2026-01-01', '2026-05-31'), COB), SEM);
  assert.deepEqual(avisoSemDadosShopee('shopee', P('2025-11-01', '2025-11-30'), COB), SEM);
});

test('Shopee: sem sincronizacao bem-sucedida (ou sem loja) qualquer periodo fica sem dados', () => {
  assert.deepEqual(avisoSemDadosShopee('shopee', P('2026-11-01', '2026-11-26'), { ...COB, ultimoSucesso: null }), SEM);
  assert.deepEqual(avisoSemDadosShopee('shopee', P('2026-11-01', '2026-11-26'), { ...COB, conectada: false }), SEM);
  assert.deepEqual(avisoSemDadosShopee('shopee', P('2026-11-01', '2026-11-26'), { ...COB, inicio: null }), SEM);
});

test('Shopee: periodo coberto mostra os numeros (sem aviso)', () => {
  assert.equal(avisoSemDadosShopee('shopee', P('2026-11-01', '2026-11-26', '2026-10-01'), COB), null);
});

test('Shopee: periodo que comeca antes dos dados avisa a data de inicio (nao e zero)', () => {
  assert.deepEqual(avisoSemDadosShopee('shopee', P('2026-05-15', '2026-06-10'), COB),
    { semDados: false, texto: 'A Shopee tem dados a partir de 01/06/2026; antes disso o período fica sem dados da Shopee (não é zero).' });
});

test('Shopee: periodo anterior antes dos dados avisa que a comparacao nao tem base', () => {
  assert.deepEqual(avisoSemDadosShopee('shopee', P('2026-06-01', '2026-06-30', '2026-05-01'), COB),
    { semDados: false, texto: 'A Shopee tem dados a partir de 01/06/2026: a comparação com o período anterior fica sem base.' });
});

test('Consolidado: sem dados da Shopee no periodo avisa que so o Mercado Livre entra', () => {
  assert.deepEqual(avisoSemDadosShopee('consolidado', P('2026-01-01', '2026-01-31'), COB),
    { semDados: false, texto: 'Sem dados da Shopee neste período: o consolidado mostra só o Mercado Livre.' });
  assert.equal(avisoSemDadosShopee('consolidado', P('2026-11-01', '2026-11-26', '2026-10-01'), COB), null);
  // Shopee nao conectada: o consolidado e so o Mercado Livre, sem aviso
  assert.equal(avisoSemDadosShopee('consolidado', P('2026-01-01', '2026-01-31'), { ...COB, conectada: false }), null);
});

test('Mercado Livre: nunca tem aviso da Shopee', () => {
  assert.equal(avisoSemDadosShopee('mercadolivre', P('2026-01-01', '2026-01-31'), COB), null);
  assert.equal(avisoSemDadosShopee('mercadolivre', P('2026-01-01', '2026-01-31'), { ...COB, ultimoSucesso: null }), null);
});

test('"Atualizado em" do canal: ML, Shopee ou a mais antiga das duas no consolidado', () => {
  const s = { mercadolivre: { ultimoSucesso: '2026-11-26T11:00:00Z' }, shopee: { ultimoSucesso: '2026-11-26T10:00:00Z' } };
  assert.equal(atualizadoEmCanal('mercadolivre', s, true), '2026-11-26T11:00:00Z');
  assert.equal(atualizadoEmCanal('shopee', s, true), '2026-11-26T10:00:00Z');
  assert.equal(atualizadoEmCanal('consolidado', s, true), '2026-11-26T10:00:00Z');
  assert.equal(atualizadoEmCanal('consolidado', s, false), '2026-11-26T11:00:00Z');
  assert.equal(atualizadoEmCanal('shopee', {}, true), null);
});

test('reconectar a Shopee: so quando a ultima sincronizacao falhou por autorizacao', () => {
  assert.equal(precisaReconectarShopee({ status: 'error', erro: 'Autorização da Shopee vencida: reconecte em Configurações › Conexões' }), true);
  assert.equal(precisaReconectarShopee({ status: 'error', erro: 'fetch failed' }), false);
  assert.equal(precisaReconectarShopee({ status: 'success', erro: null }), false);
  assert.equal(precisaReconectarShopee(undefined), false);
});

test('textos de tarifas estimadas por canal; o Mercado Livre continua igual', () => {
  const ml = textosEstimados('mercadolivre');
  assert.equal(ml.titulo, 'Aguardando a fatura do ML');
  assert.equal(ml.detalhe, 'frete e comissão estimados; acertam sozinhos quando a fatura chegar');
  assert.match(ml.atencao, /^ pedido\(s\) do período ainda não aparecem na fatura do Mercado Livre/);
  const sh = textosEstimados('shopee');
  assert.equal(sh.titulo, 'Aguardando o pagamento da Shopee');
  assert.doesNotMatch(`${sh.titulo} ${sh.detalhe} ${sh.ajuda} ${sh.atencao}`, /Mercado Livre|\bML\b/);
  const co = textosEstimados('consolidado');
  assert.match(`${co.ajuda}`, /Mercado Livre/);
  assert.match(`${co.ajuda}`, /Shopee/);
});

test('link do anuncio cita o canal certo', () => {
  assert.equal(rotuloLinkAnuncio('https://shopee.com.br/product/1/2'), 'Ver anúncio na Shopee ↗');
  assert.equal(rotuloLinkAnuncio('https://produto.mercadolivre.com.br/MLB-1'), 'Ver anúncio no Mercado Livre ↗');
});

test('nome do canal', () => {
  assert.deepEqual((['consolidado', 'mercadolivre', 'shopee'] as const).map(nomeCanal), ['Consolidado', 'Mercado Livre', 'Shopee']);
});
