import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  roas, percentual, rotuloModelo, avisoSemDetalhe, AVISO_SEM_DETALHE, ROTULO_NAO_ATRIBUIDO,
  ORDEM_SUGESTOES, rotuloSugestao, tomSugestao, ordemSugestao, contarSugestoes, lerSugestao,
} from './ads-regras.ts';

test('roas formata com virgula e sufixo x, traco para nulo', () => {
  assert.equal(roas(4.37), '4,37x');
  assert.equal(roas(10), '10,00x');
  assert.equal(roas(0), '0,00x');
  assert.equal(roas(null), '—');
  assert.equal(roas(undefined), '—');
});

test('ACOS, TACOS e percentuais usam uma casa e %', () => {
  assert.equal(percentual(12.34), '12,3%');
  assert.equal(percentual(0), '0,0%');
  assert.equal(percentual(null), '—');
});

test('linha sem modelo vira "não atribuído a anúncio"', () => {
  assert.equal(ROTULO_NAO_ATRIBUIDO, 'não atribuído a anúncio');
  assert.equal(rotuloModelo(null), 'não atribuído a anúncio');
  assert.equal(rotuloModelo('CANECA-01'), 'CANECA-01');
});

test('aviso aparece so quando nao ha detalhe por anuncio', () => {
  assert.equal(avisoSemDetalhe(false), 'sem detalhe por anúncio neste período (a API do Mercado Livre guarda 90 dias)');
  assert.equal(AVISO_SEM_DETALHE, avisoSemDetalhe(false));
  assert.equal(avisoSemDetalhe(true), null);
});

test('rotulos e tons das sugestoes', () => {
  assert.deepEqual(ORDEM_SUGESTOES, ['pausar', 'reduzir', 'revisar', 'escalar', 'testar', 'manter']);
  assert.equal(rotuloSugestao('pausar'), 'Pausar');
  assert.equal(rotuloSugestao('reduzir'), 'Reduzir');
  assert.equal(rotuloSugestao('revisar'), 'Revisar anúncio');
  assert.equal(rotuloSugestao('escalar'), 'Escalar');
  assert.equal(rotuloSugestao('testar'), 'Testar Ads');
  assert.equal(rotuloSugestao('manter'), 'Manter');
  assert.equal(rotuloSugestao(null), '—');
  assert.equal(tomSugestao('pausar'), 'ruim');
  assert.equal(tomSugestao('reduzir'), 'ruim');
  assert.equal(tomSugestao('revisar'), 'alerta');
  assert.equal(tomSugestao('escalar'), 'bom');
  assert.equal(tomSugestao('testar'), 'info');
  assert.equal(tomSugestao('manter'), 'neutro');
  assert.equal(tomSugestao(null), 'neutro');
});

test('ordem de exibicao das sugestoes; nulo por ultimo', () => {
  assert.equal(ordemSugestao('pausar'), 0);
  assert.equal(ordemSugestao('manter'), 5);
  assert.equal(ordemSugestao(null), 6);
});

test('contagem por sugestao ignora nulo e nao atribuido', () => {
  const linhas = [
    { modelo: 'A', sugestao: 'pausar' as const },
    { modelo: 'B', sugestao: 'pausar' as const },
    { modelo: 'C', sugestao: 'escalar' as const },
    { modelo: 'D', sugestao: null },
    { modelo: null, sugestao: 'manter' as const },
  ];
  assert.deepEqual(contarSugestoes(linhas), { pausar: 2, reduzir: 0, revisar: 0, escalar: 1, testar: 0, manter: 0 });
});

test('valida o parametro sug da URL', () => {
  assert.equal(lerSugestao('escalar'), 'escalar');
  assert.equal(lerSugestao('xyz'), null);
  assert.equal(lerSugestao(undefined), null);
  assert.equal(lerSugestao(['pausar']), 'pausar');
});

// ---- Orçamento (T027-T029) ----
import {
  validarOrcamento, primeiroDiaProximoMes, textoAlertaOrcamento, estadoOrcamento, textoValorDiario, type LinhaOrcamento,
  agregarSeriePorMes,
} from './ads-regras.ts';

test('agregarSeriePorMes: soma os dias de cada mês e ordena por mês', () => {
  const serie = [
    { dia: '2026-10-02', investimento: 100.1, vendas_ads: 50 },
    { dia: '2026-09-30', investimento: 20, vendas_ads: 10 },
    { dia: '2026-10-31', investimento: 0.3, vendas_ads: 0 },
  ];
  assert.deepEqual(agregarSeriePorMes(serie), [
    { dia: '2026-09-01', investimento: 20, vendas_ads: 10 },
    { dia: '2026-10-01', investimento: 100.4, vendas_ads: 50 },
  ]);
  assert.deepEqual(agregarSeriePorMes([]), []);
});

const orc = (o: Partial<LinhaOrcamento> = {}): LinhaOrcamento => ({
  canal: 'mercadolivre', orcamento: 5000, gasto_mes: 1000, gasto_product_ads: 900, gasto_seguidores: 100, gasto_ate_ontem: 900,
  dias_mes: 30, dias_completos: 9, dias_restantes: 21, pct_gasto: 20, pct_mes: 30, projecao: 3000, saldo: 4000, valor_diario: 190.48, alerta: null, ...o,
});

test('primeiroDiaProximoMes: mes comum e virada de ano', () => {
  assert.equal(primeiroDiaProximoMes('2026-11-18'), '2026-12-01');
  assert.equal(primeiroDiaProximoMes('2026-12-31'), '2027-01-01');
});

test('validarOrcamento aceita valor com virgula e normaliza', () => {
  const r = validarOrcamento({ channel: 'mercadolivre', vigente_desde: '2026-12-01', valor_mensal: '5.000,50' });
  assert.deepEqual(r, { ok: true, valores: { channel: 'mercadolivre', vigente_desde: '2026-12-01', valor_mensal: 5000.5 } });
});

test('validarOrcamento recusa canal, data e valor invalidos', () => {
  const base = { channel: 'shopee', vigente_desde: '2026-12-01', valor_mensal: '100' };
  assert.equal(validarOrcamento({ ...base, channel: 'x' }).ok, false);
  assert.equal(validarOrcamento({ ...base, vigente_desde: '01/12/2026' }).ok, false);
  assert.equal(validarOrcamento({ ...base, vigente_desde: '2026-02-31' }).ok, false);
  assert.equal(validarOrcamento({ ...base, valor_mensal: '' }).ok, false);
  assert.equal(validarOrcamento({ ...base, valor_mensal: '0' }).ok, false);
  assert.equal(validarOrcamento({ ...base, valor_mensal: '-5' }).ok, false);
  assert.equal(validarOrcamento({ ...base, valor_mensal: 'abc' }).ok, false);
});

test('estadoOrcamento cobre os estados especiais', () => {
  assert.equal(estadoOrcamento(orc({ orcamento: null })), 'sem_orcamento');
  assert.equal(estadoOrcamento(orc({ gasto_mes: 5000, saldo: 0 })), 'esgotado');
  assert.equal(estadoOrcamento(orc({ dias_completos: 0, projecao: null })), 'primeiro_dia');
  assert.equal(estadoOrcamento(orc()), 'normal');
});

test('textoAlertaOrcamento: estouro, sobra e nenhum', () => {
  const e = textoAlertaOrcamento(orc({ alerta: 'estouro', projecao: 6000 }));
  assert.equal(e?.tom, 'ruim');
  assert.match(e!.texto, /No ritmo atual o mês fecha em R\$\s6\.000,00, R\$\s1\.000,00 acima do orçamento/);
  const s = textoAlertaOrcamento(orc({ alerta: 'sobra' }));
  assert.equal(s?.tom, 'alerta');
  assert.match(s!.texto, /verba sobrando/);
  assert.equal(textoAlertaOrcamento(orc()), null);
  assert.equal(textoAlertaOrcamento(orc({ alerta: 'estouro', projecao: null })), null);
});

test('textoValorDiario: normal e esgotado', () => {
  assert.match(textoValorDiario(orc())!, /Pode gastar R\$\s190,48 por dia até o fim do mês/);
  assert.equal(textoValorDiario(orc({ gasto_mes: 5000, saldo: 0, valor_diario: 0 })), 'Orçamento do mês esgotado.');
  assert.equal(textoValorDiario(orc({ orcamento: null, valor_diario: null })), null);
});

// ---- Final review: aviso de falha do Ads, retorno do formulario, rotulo da linha sem campanha ----
import { avisoFalhaAds, urlRetornoOrcamento, ROTULO_SEM_CAMPANHA } from './ads-regras.ts';

test('avisoFalhaAds: nulo sem stats ou sem falha', () => {
  assert.equal(avisoFalhaAds(null), null);
  assert.equal(avisoFalhaAds({ ads_campaign_days: 10, ads_items: 5, ads_campanhas: 3 }), null);
});

test('avisoFalhaAds: investimento ou metricas por anuncio (-1) deixam os dados incompletos', () => {
  assert.match(avisoFalhaAds({ ads_campaign_days: -1, ads_items: 5 })!, /investimento por campanha/);
  assert.match(avisoFalhaAds({ ads_campaign_days: 3, ads_items: -1 })!, /métricas por anúncio/);
  const ambos = avisoFalhaAds({ ads_campaign_days: -1, ads_items: -1 })!;
  assert.match(ambos, /investimento por campanha e as métricas por anúncio/);
  assert.match(ambos, /podem estar incompletos/);
});

test('avisoFalhaAds: cadastro de campanhas e status dos anuncios', () => {
  assert.match(avisoFalhaAds({ erro_ads_campanhas: 1 })!, /as campanhas/);
  assert.match(avisoFalhaAds({ erro_ads_anuncios: 1 })!, /o status dos anúncios/);
  assert.match(avisoFalhaAds({ ads_items: -1, erro_ads_anuncios: 1 })!, /métricas por anúncio e o status dos anúncios/);
});

test('urlRetornoOrcamento: mantem canal/periodo validos e descarta o resto', () => {
  const u = urlRetornoOrcamento({ canal: 'mercadolivre', periodo: '7d', de: '2026-11-01', ate: '2026-11-18', aba: 'x', evil: 'y' }, 'ok', 'Orçamento salvo.');
  const q = new URL(u, 'http://x').searchParams;
  assert.ok(u.startsWith('/ads?'));
  assert.equal(q.get('canal'), 'mercadolivre');
  assert.equal(q.get('periodo'), '7d');
  assert.equal(q.get('de'), '2026-11-01');
  assert.equal(q.get('ate'), '2026-11-18');
  assert.equal(q.get('aba'), 'orcamento');
  assert.equal(q.get('ok'), 'Orçamento salvo.');
  assert.equal(q.get('evil'), null);
});

test('urlRetornoOrcamento: valores invalidos nao entram', () => {
  const u = urlRetornoOrcamento({ canal: 'brindedobem', periodo: 'a&b=c', de: '01/11/2026', ate: null }, 'erro', 'falhou');
  const q = new URL(u, 'http://x').searchParams;
  assert.deepEqual([...q.keys()].sort(), ['aba', 'erro']);
});

test('rotulo da linha sem campanha', () => {
  assert.equal(ROTULO_SEM_CAMPANHA, 'não atribuído a campanha');
});

// ---- Tarefa 7: textos com o canal certo e ruido de centavos da Shopee ----
import { ocultarRuidoNaoAtribuido } from './ads-regras.ts';

test('avisoFalhaAds: Mercado Livre continua citando o Mercado Livre', () => {
  assert.match(avisoFalhaAds({ ads_campaign_days: -1 })!, /do Mercado Livre\./);
  assert.match(avisoFalhaAds({ ads_campaign_days: -1 }, 'mercadolivre')!, /do Mercado Livre\./);
});

test('avisoFalhaAds: Shopee cita a Shopee (conta, por anuncio e campanhas)', () => {
  assert.equal(avisoFalhaAds({ itens: 10 }, 'shopee'), null);
  const conta = avisoFalhaAds({ ads_conta: -1 }, 'shopee')!;
  assert.match(conta, /o investimento da conta da Shopee\./);
  assert.match(conta, /podem estar incompletos/);
  assert.doesNotMatch(conta, /Mercado Livre/);
  assert.match(avisoFalhaAds({ ads_produto_indisponivel: 1 }, 'shopee')!, /as métricas por anúncio da Shopee/);
  assert.match(avisoFalhaAds({ erro_ads_campanhas: 1 }, 'shopee')!, /as campanhas da Shopee\. O status de pausa e as campanhas/);
  // as chaves do ML nao valem para a Shopee
  assert.equal(avisoFalhaAds({ ads_campaign_days: -1 }, 'shopee'), null);
});

test('avisoSemDetalhe: texto do canal (ML igual ao de antes)', () => {
  assert.equal(avisoSemDetalhe(false, 'mercadolivre'), AVISO_SEM_DETALHE);
  assert.equal(avisoSemDetalhe(false, 'shopee'), 'sem detalhe por anúncio neste período (o painel busca o Ads por anúncio da Shopee dos últimos 90 dias)');
  assert.equal(avisoSemDetalhe(false, 'consolidado'), 'sem detalhe por anúncio neste período (o Mercado Livre e a Shopee guardam o Ads por anúncio de cerca de 90 dias)');
  assert.equal(avisoSemDetalhe(true, 'shopee'), null);
});

test('ruido de centavos: Shopee e consolidado escondem nao atribuido < R$ 0,05 ou negativo; ML nao muda', () => {
  const l = (investimento: number, vendas_ads = 0) => ({ investimento, vendas_ads, outro: 'x' });
  assert.equal(ocultarRuidoNaoAtribuido('shopee', l(-0.01)), null);
  assert.equal(ocultarRuidoNaoAtribuido('shopee', l(0.04)), null);
  assert.equal(ocultarRuidoNaoAtribuido('consolidado', l(0.03, 0.02)), null);
  assert.deepEqual(ocultarRuidoNaoAtribuido('shopee', l(0.05)), l(0.05));
  assert.deepEqual(ocultarRuidoNaoAtribuido('shopee', l(8, 40)), l(8, 40));
  // investimento negativo nunca aparece; com vendas de verdade a linha fica, com investimento 0
  assert.deepEqual(ocultarRuidoNaoAtribuido('shopee', l(-0.5, 10)), l(0, 10));
  // Mercado Livre: exatamente como antes
  assert.deepEqual(ocultarRuidoNaoAtribuido('mercadolivre', l(-0.01)), l(-0.01));
  assert.deepEqual(ocultarRuidoNaoAtribuido('mercadolivre', l(0.01)), l(0.01));
});
