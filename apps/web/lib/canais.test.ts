import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  atualizadoEmCanal, avisoSemDadosShopee, canaisDaMeta, crescimentoComBase, metaDoMes, nomeCanal, precisaReconectarShopee,
  rotuloLinkAnuncio, semBaseAnteriorShopee, shopeeAtiva, textosEstimados,
} from './canais.ts';
import { PARAMETROS_CRESCIMENTO_PADRAO, sugestaoCrescimento, textoCrescimento } from './crescimento.ts';

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
const COB = { conectada: true, ultimoSucesso: '2026-11-26T11:00:00Z', inicio: '2026-06-01', visivel: true };
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

// ---------------- Fix round 1: quem nao ve o canal Shopee nao recebe avisos da Shopee ----------------
test('sem o canal Shopee liberado: nenhum aviso da Shopee (consolidado) e a Shopee fica "sem vendas"', () => {
  const inv = { ...COB, visivel: false };
  assert.equal(avisoSemDadosShopee('consolidado', P('2026-01-01', '2026-01-31'), inv), null);
  assert.deepEqual(avisoSemDadosShopee('shopee', P('2026-01-01', '2026-01-31'), inv), { semDados: true, texto: 'Sem vendas no período.' });
  assert.deepEqual(avisoSemDadosShopee('shopee', P('2026-11-01', '2026-11-26', '2026-10-01'), inv), { semDados: true, texto: 'Sem vendas no período.' });
});

// ---------------- Fix round 1: comparacao com periodo antes da 1a venda da Shopee = sem dado ----------------
const L = (o = {}) => ({
  canal: 'shopee' as const, vendas_atual: 1300, vendas_anterior: 1000, vendas_ano_passado: 0,
  margem_pos_ads_atual: 9, margem_pos_ads_anterior: 8, ...o,
});
const PER = (de: string, ate: string, anteriorDe: string) => ({ de, ate, anteriorDe });

test('setas dos cartoes: Shopee com periodo anterior antes da 1a venda nao tem base; consolidado e ML mantem', () => {
  assert.equal(semBaseAnteriorShopee('shopee', PER('2026-06-01', '2026-06-30', '2026-05-01'), COB), true);
  assert.equal(semBaseAnteriorShopee('shopee', PER('2026-07-01', '2026-07-31', '2026-06-01'), COB), false);
  assert.equal(semBaseAnteriorShopee('consolidado', PER('2026-06-01', '2026-06-30', '2026-05-01'), COB), false);
  assert.equal(semBaseAnteriorShopee('mercadolivre', PER('2026-06-01', '2026-06-30', '2026-05-01'), COB), false);
});

test('crescimento: anterior antes da 1a venda vira nulo (com a margem anterior); sugestao sem_historico, "sem dado"', () => {
  const x = crescimentoComBase(L(), PER('2026-06-01', '2026-06-30', '2026-05-01'), '2026-06-01');
  assert.equal(x.vendas_anterior, null);
  assert.equal(x.margem_pos_ads_anterior, null);
  assert.equal(x.vendas_ano_passado, null);
  assert.equal(textoCrescimento(x.vendas_atual, x.vendas_anterior).rotulo, 'sem dado');
  assert.equal(sugestaoCrescimento(x, PARAMETROS_CRESCIMENTO_PADRAO).sugestao, 'sem_historico');
});

test('crescimento: anterior parcial (comeca antes da 1a venda) tambem fica sem base; nunca investir_mais', () => {
  // periodo 10/06-24/06, anterior 26/05-09/06: so em parte com dados -> sem base
  const x = crescimentoComBase(L({ vendas_anterior: 100 }), PER('2026-06-10', '2026-06-24', '2026-05-26'), '2026-06-01');
  assert.equal(x.vendas_anterior, null);
  assert.notEqual(sugestaoCrescimento(x, PARAMETROS_CRESCIMENTO_PADRAO).sugestao, 'investir_mais');
});

test('crescimento: ano passado antes da 1a venda vira nulo; so o periodo anterior decide (motivo avisa)', () => {
  const x = crescimentoComBase(L({ vendas_ano_passado: 50 }), PER('2026-08-01', '2026-08-31', '2026-07-01'), '2026-06-01');
  assert.equal(x.vendas_anterior, 1000);
  assert.equal(x.vendas_ano_passado, null);
  assert.equal(textoCrescimento(x.vendas_atual, x.vendas_ano_passado).rotulo, 'sem dado');
  const r = sugestaoCrescimento(x, PARAMETROS_CRESCIMENTO_PADRAO);
  assert.equal(r.sugestao, 'investir_mais'); // +30% sobre o anterior, margem subindo
  assert.match(r.motivo, /sem dado do ano passado/);
});

test('crescimento: ano passado coberto continua valendo; Mercado Livre nunca muda', () => {
  const x = crescimentoComBase(L({ vendas_ano_passado: 900 }), PER('2027-07-01', '2027-07-31', '2027-06-01'), '2026-06-01');
  assert.deepEqual([x.vendas_anterior, x.vendas_ano_passado], [1000, 900]);
  const ml = L({ canal: 'mercadolivre' as never, vendas_ano_passado: 50 });
  assert.deepEqual(crescimentoComBase(ml, PER('2026-06-01', '2026-06-30', '2026-05-01'), '2026-06-01'), ml);
  // sem data de inicio (sem vendas da Shopee): sem base nenhuma
  const y = crescimentoComBase(L(), PER('2026-07-01', '2026-07-31', '2026-06-01'), null);
  assert.deepEqual([y.vendas_anterior, y.vendas_ano_passado], [null, null]);
});
