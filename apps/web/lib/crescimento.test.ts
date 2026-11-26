import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sugestaoCrescimento, sugestaoParaTela, validarParametrosCrescimento, PARAMETROS_CRESCIMENTO_PADRAO,
  rotuloSugestaoCanal, tomSugestaoCanal, textoCrescimento, textoMargem,
  type DadosCrescimento,
} from './crescimento.ts';

const P = PARAMETROS_CRESCIMENTO_PADRAO; // { pct_crescimento: 10, pct_queda: 10 }
const d = (o: Partial<DadosCrescimento> = {}): DadosCrescimento => ({
  vendas_atual: 1124, vendas_anterior: 1000, vendas_ano_passado: 977.39,
  margem_pos_ads_atual: 8.2, margem_pos_ads_anterior: 7.5, ...o,
});
const sug = (o: Partial<DadosCrescimento> = {}, p = P) => sugestaoCrescimento(d(o), p).sugestao;

// ---------------- Step 1: regra aprovada ----------------
test('cresce >= 10% nos dois comparativos, margem positiva e nao caindo: investir_mais', () => {
  assert.equal(sug(), 'investir_mais');
  assert.equal(sug({ margem_pos_ads_atual: 7.5 }), 'investir_mais'); // margem igual = nao caindo
});

test('margem caindo, zero ou desconhecida impede investir_mais (vira manter)', () => {
  assert.equal(sug({ margem_pos_ads_atual: 7.4 }), 'manter');
  assert.equal(sug({ margem_pos_ads_atual: 0, margem_pos_ads_anterior: -1 }), 'manter');
  assert.equal(sug({ margem_pos_ads_anterior: null }), 'manter');
  assert.equal(sug({ margem_pos_ads_atual: null, margem_pos_ads_anterior: null }), 'manter');
});

test('crescimento em so um comparativo: manter', () => {
  assert.equal(sug({ vendas_ano_passado: 1100 }), 'manter');   // +2,2% sobre o ano passado
  assert.equal(sug({ vendas_anterior: 1100 }), 'manter');      // +2,2% sobre o anterior
});

test('queda >= 10% em qualquer comparativo: reduzir (mesmo com margem boa)', () => {
  assert.equal(sug({ vendas_atual: 900 }), 'reduzir');                          // -10% exatos sobre o anterior
  assert.equal(sug({ vendas_atual: 1124, vendas_ano_passado: 1300 }), 'reduzir'); // -13,5% sobre o ano passado
});

test('margem negativa: reduzir', () => {
  assert.equal(sug({ margem_pos_ads_atual: -0.01 }), 'reduzir');
  assert.equal(sug({ vendas_atual: 1000, margem_pos_ads_atual: -3 }), 'reduzir');
});

test('qualquer outro caso: manter', () => {
  assert.equal(sug({ vendas_atual: 1050, vendas_ano_passado: 1000 }), 'manter');
  assert.equal(sug({ vendas_atual: 1000, vendas_ano_passado: 1000 }), 'manter');
});

test('bordas: 10% exatos contam, 9,99% nao contam (crescimento e queda)', () => {
  assert.equal(sug({ vendas_atual: 1100, vendas_ano_passado: 1000 }), 'investir_mais'); // +10% e +10%
  assert.equal(sug({ vendas_atual: 1.1, vendas_anterior: 1, vendas_ano_passado: 1 }), 'investir_mais'); // sem ruido de ponto flutuante
  assert.equal(sug({ vendas_atual: 1099.9, vendas_ano_passado: 1000 }), 'manter');      // +9,99%
  assert.equal(sug({ vendas_atual: 1100, vendas_ano_passado: 1000.1 }), 'manter');      // +9,99% sobre o ano passado
  assert.equal(sug({ vendas_atual: 900, vendas_ano_passado: 1000 }), 'reduzir');        // -10%
  assert.equal(sug({ vendas_atual: 0.9, vendas_anterior: 1, vendas_ano_passado: 1 }), 'reduzir'); // -10% sem ruido
  assert.equal(sug({ vendas_atual: 900.1, vendas_ano_passado: 1000 }), 'manter');       // -9,99%
});

test('percentuais editados por canal mudam a sugestao', () => {
  assert.equal(sug({}, { pct_crescimento: 15, pct_queda: 10 }), 'manter');                     // +12,4% < 15%
  assert.equal(sug({ vendas_atual: 950, vendas_ano_passado: 1000 }, { pct_crescimento: 10, pct_queda: 5 }), 'reduzir'); // -5%
});

// ---------------- Step 2 (decisao do dono, 26/11): sem ano passado usa so o periodo anterior ----------------
test('sem vendas no periodo anterior (nem no ano passado): sem_historico, nunca investir_mais', () => {
  for (const o of [{ vendas_anterior: 0, vendas_ano_passado: 0 }, { vendas_anterior: null, vendas_ano_passado: null },
    { vendas_anterior: 0, vendas_ano_passado: 0, vendas_atual: 5000, margem_pos_ads_atual: 30 }]) {
    assert.equal(sug(o), 'sem_historico');
  }
});

test('sem vendas no periodo anterior, mesmo com o ano passado: sem_historico (sem base para a margem nao caindo)', () => {
  assert.equal(sug({ vendas_anterior: 0 }), 'sem_historico');
});

test('sem ano passado e com periodo anterior: so o anterior decide, e o motivo avisa', () => {
  const r = sugestaoCrescimento(d({ vendas_ano_passado: 0 }), P);
  assert.equal(r.sugestao, 'investir_mais');
  assert.match(r.motivo, /sem dado do ano passado/);
  assert.equal(sug({ vendas_ano_passado: null, vendas_atual: 900 }), 'reduzir');        // queda de 10% sobre o anterior
  assert.equal(sug({ vendas_ano_passado: 0, margem_pos_ads_atual: -2 }), 'reduzir');    // margem negativa
  assert.equal(sug({ vendas_ano_passado: 0, vendas_atual: 1050 }), 'manter');           // +5%
  assert.equal(sug({ vendas_ano_passado: 0, margem_pos_ads_atual: 7 }), 'manter');      // margem caindo
  assert.equal(sug({ vendas_ano_passado: 0, vendas_atual: 1099.9 }), 'manter');         // 9,99% nao conta
  assert.equal(sug({ vendas_ano_passado: 0, vendas_atual: 1100 }), 'investir_mais');    // 10% conta
});

// ---------------- Step 3: o motivo traz os numeros ----------------
test('motivo com os numeros que dispararam a sugestao', () => {
  assert.equal(sugestaoCrescimento(d(), P).motivo,
    'Vendas +12,4% sobre o período anterior e +15,0% sobre o ano passado; margem depois do Ads de 8,2%');
  assert.equal(sugestaoCrescimento(d({ vendas_atual: 850 }), P).motivo,
    'Vendas -15,0% sobre o período anterior e -13,0% sobre o ano passado; margem depois do Ads de 8,2%');
  assert.equal(sugestaoCrescimento(d({ margem_pos_ads_atual: -3.25 }), P).motivo,
    'Vendas +12,4% sobre o período anterior e +15,0% sobre o ano passado; margem depois do Ads de -3,2% (era 7,5%)');
  assert.equal(sugestaoCrescimento(d({ vendas_ano_passado: 0 }), P).motivo,
    'Vendas +12,4% sobre o período anterior (sem dado do ano passado); margem depois do Ads de 8,2%');
  assert.equal(sugestaoCrescimento(d({ margem_pos_ads_atual: 7 }), P).motivo,
    'Vendas +12,4% sobre o período anterior e +15,0% sobre o ano passado; margem depois do Ads de 7,0% (era 7,5%)');
  assert.equal(sugestaoCrescimento(d({ vendas_anterior: 0, vendas_ano_passado: 0 }), P).motivo,
    'Sem vendas no período anterior nem no mesmo período do ano passado para comparar');
  assert.equal(sugestaoCrescimento(d({ vendas_anterior: 0 }), P).motivo,
    'Sem vendas no período anterior para comparar');
});

test('motivo nunca mostra 10,0% para 9,99% (o numero nao cruza o limite)', () => {
  assert.match(sugestaoCrescimento(d({ vendas_atual: 1099.9, vendas_ano_passado: 1000 }), P).motivo, /\+9,9% sobre o período anterior/);
  assert.match(sugestaoCrescimento(d({ vendas_atual: 900.1, vendas_ano_passado: 1000 }), P).motivo, /-9,9% sobre o período anterior/);
  assert.match(sugestaoCrescimento(d({ margem_pos_ads_atual: -0.03 }), P).motivo, /margem depois do Ads de -0,03%/);
});

test('zero truncado aparece como 0,0%, sem sinal (nunca -0,0% nem -0,00%)', () => {
  assert.match(sugestaoCrescimento(d({ margem_pos_ads_atual: -0.004 }), P).motivo, /margem depois do Ads de 0,0%/);
  assert.doesNotMatch(sugestaoCrescimento(d({ margem_pos_ads_atual: -0.004 }), P).motivo, /-0,0/);
  // -0,01% sobre o periodo anterior e 0% sobre o ano passado
  const r = sugestaoCrescimento(d({ vendas_atual: 999.9, vendas_anterior: 1000, vendas_ano_passado: 999.9 }), P).motivo;
  assert.match(r, /^Vendas 0,0% sobre o período anterior e 0,0% sobre o ano passado/);
});

test('sem margem (sem custos): o motivo nao fala de margem', () => {
  const r = sugestaoCrescimento(d({ margem_pos_ads_atual: null, margem_pos_ads_anterior: null }), P);
  assert.equal(r.motivo, 'Vendas +12,4% sobre o período anterior e +15,0% sobre o ano passado');
});

// ---------------- Step 4b: na tela, sem custos nao aparecem a sugestao nem o motivo ----------------
test('tela: sem custos, sem sugestao e sem motivo; com custos, igual a sugestaoCrescimento', () => {
  assert.equal(sugestaoParaTela(d({ margem_pos_ads_atual: null, margem_pos_ads_anterior: null }), P, false), null);
  assert.equal(sugestaoParaTela(d(), P, false), null);
  assert.deepEqual(sugestaoParaTela(d(), P, true), sugestaoCrescimento(d(), P));
  assert.equal(sugestaoParaTela(d(), null, true), null); // sem parametros vigentes
});

// ---------------- Tarefa 7, Step 1: rotulo e tom de cada sugestao na aba Canais ----------------
test('rotulo e tom: investir_mais verde, reduzir vermelho, manter neutro, sem_historico cinza', () => {
  assert.deepEqual(
    (['investir_mais', 'reduzir', 'manter', 'sem_historico'] as const).map((s) => [s, rotuloSugestaoCanal(s), tomSugestaoCanal(s)]),
    [['investir_mais', 'Investir mais', 'bom'], ['reduzir', 'Reduzir', 'ruim'], ['manter', 'Manter', 'neutro'],
      ['sem_historico', 'Sem histórico', 'cinza']]);
});

test('crescimento na tela: sinal, uma casa truncada, 0,0% sem sinal e "sem dado" sem base', () => {
  assert.deepEqual(textoCrescimento(1124, 1000), { valor: 12.4, rotulo: '+12,4%' });
  assert.deepEqual(textoCrescimento(850, 1000), { valor: -15, rotulo: '-15,0%' });
  assert.deepEqual(textoCrescimento(1099.9, 1000), { valor: 9.99, rotulo: '+9,9%' });
  assert.equal(textoCrescimento(999.9, 1000).rotulo, '0,0%');
  assert.equal(textoCrescimento(1000, 1000).rotulo, '0,0%');
  assert.deepEqual(textoCrescimento(500, 0), { valor: null, rotulo: 'sem dado' });
  assert.deepEqual(textoCrescimento(500, null), { valor: null, rotulo: 'sem dado' });
});

test('margem na tela: uma casa, 0,0% sem sinal, traco sem custos', () => {
  assert.equal(textoMargem(8.25), '8,2%');
  assert.equal(textoMargem(-3.25), '-3,2%');
  assert.equal(textoMargem(-0.004), '0,0%');
  assert.equal(textoMargem(null), '—');
});

// ---------------- Parametros (tela de Parametros) ----------------
test('validarParametrosCrescimento: aceita virgula, recusa vazio, negativo e queda acima de 100', () => {
  assert.deepEqual(validarParametrosCrescimento({ pct_crescimento: '12,5', pct_queda: '8' }), { ok: true, valores: { pct_crescimento: 12.5, pct_queda: 8 } });
  assert.equal(validarParametrosCrescimento({ pct_crescimento: '', pct_queda: '8' }).ok, false);
  assert.equal(validarParametrosCrescimento({ pct_crescimento: '-1', pct_queda: '8' }).ok, false);
  assert.equal(validarParametrosCrescimento({ pct_crescimento: '10', pct_queda: '101' }).ok, false);
  assert.equal(validarParametrosCrescimento({ pct_crescimento: '0', pct_queda: '10' }).ok, false);
  assert.equal(validarParametrosCrescimento({ pct_crescimento: 'abc', pct_queda: '10' }).ok, false);
});
