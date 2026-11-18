import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Ads e Orcamento (migrations 0018 e 0019): tabelas, sementes, permissoes, RLS e vigencia.
const repo = fileURLToPath(new URL('../..', import.meta.url));
const db = new PGlite();
let fails = 0;
const eq = (label, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  if (!ok) fails++;
  console.log(`${ok ? 'OK  ' : 'FALHA'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (esperado ${JSON.stringify(exp)})`}`);
};
const erro = async (label, sql, re) => {
  let msg = null;
  try { await db.exec(sql); } catch (e) { msg = e.message; }
  const ok = msg !== null && re.test(msg);
  if (!ok) fails++;
  console.log(`${ok ? 'OK  ' : 'FALHA'} ${label}: ${msg}`);
};
const mig = (f) => readFileSync(`${repo}/supabase/migrations/${f}`, 'utf8');
const rows = async (sql, p = []) => (await db.query(sql, p)).rows;
const val = async (sql) => Object.values((await rows(sql))[0])[0];

await db.exec(readFileSync(`${repo}/supabase/tests/stubs.sql`, 'utf8'));
for (const f of ['0002_marketplaces.sql', '0003_regras_v1.sql', '0006_custo_por_cotacao.sql', '0007_de_para_modelo.sql',
  '0008_dashboard_admin.sql', '0009_dashboard_funcoes.sql', '0010_dashboard_metas.sql', '0011_rls_desempenho.sql',
  '0012_crm.sql', '0013_crm_funcoes.sql', '0018_ads_tabelas.sql', '0019_ads_funcoes.sql'])
  await db.exec(mig(f));
console.log('Migrations 0002..0013 + 0018 + 0019 aplicadas');

// Perfil, usuario e canais controlados pelo teste
await db.exec(`
  create or replace function core.my_role() returns core.app_role language sql as $$ select coalesce(nullif(current_setting('teste.perfil', true), ''), 'admin')::core.app_role $$;
  create or replace function auth.uid() returns uuid language sql as $$ select nullif(current_setting('teste.uid', true), '')::uuid $$;
  create or replace function core.can_see_channel(ch text) returns boolean language sql as $$ select ch = any (string_to_array(coalesce(nullif(current_setting('teste.canais', true), ''), 'mercadolivre,shopee,crm'), ',')) $$;
  grant usage on schema core to authenticated;`);
const perfil = (p) => db.exec(`set teste.perfil = '${p}'`);
const canais = (c) => db.exec(`set teste.canais = '${c}'`);
const comoAuth = async (fn) => { await db.exec(`set role authenticated`); try { return await fn(); } finally { await db.exec(`reset role`); } };
const tenta = async (sql) => { try { await db.exec(sql); return 'ok'; } catch (e) { return /row-level security|permission denied/i.test(e.message) ? 'negado' : e.message; } };

// ---------------- Sementes ----------------
eq('orcamento inicial', await rows(`select channel, vigente_desde::text as d, valor_mensal::float as v from core.orcamento_ads order by channel`),
  [{ channel: 'mercadolivre', d: '2026-11-01', v: 5000 }, { channel: 'shopee', d: '2026-11-01', v: 5000 }]);
eq('parametros iniciais (ml)', (await rows(`select vigente_desde::text as d, pausar_gasto_min::float, pausar_cliques_min, min_dias_dados, revisar_cliques_min,
    revisar_conversao_max_pct::float, escalar_folga_pp::float, escalar_unidades_min, testar_margem_min_pct::float, testar_unidades_min,
    teste_reserva_pct::float, teste_max_modelos, reduzir_fator::float, teto_fator::float, alerta_sobra_pct::float
  from core.parametros_ads where channel = 'mercadolivre'`)),
  [{
    d: '2026-11-01', pausar_gasto_min: 50, pausar_cliques_min: 100, min_dias_dados: 7, revisar_cliques_min: 100,
    revisar_conversao_max_pct: 1, escalar_folga_pp: 10, escalar_unidades_min: 3, testar_margem_min_pct: 20, testar_unidades_min: 3,
    teste_reserva_pct: 10, teste_max_modelos: 5, reduzir_fator: 0.7, teto_fator: 2, alerta_sobra_pct: 80,
  }]);
eq('parametros: um por canal', await rows(`select channel from core.parametros_ads order by channel`), [{ channel: 'mercadolivre' }, { channel: 'shopee' }]);

// ---------------- Permissoes ----------------
eq('permissao ads', (await rows(`select role::text as r from core.role_permissions where permission = 'ads' and allowed order by role::core.app_role`)).map((x) => x.r),
  ['admin', 'gestor', 'comercial']);
eq('permissao ads: todos os perfis tem linha', await val(`select count(*)::int from core.role_permissions where permission = 'ads'`), 5);
eq('permissao editar_ads', (await rows(`select role::text as r from core.role_permissions where permission = 'editar_ads' and allowed order by role::core.app_role`)).map((x) => x.r),
  ['admin', 'gestor']);
eq('permissao editar_ads: todos os perfis tem linha', await val(`select count(*)::int from core.role_permissions where permission = 'editar_ads'`), 5);

// ---------------- Restricoes ----------------
await erro('orcamento: canal brindedobem recusado', `insert into core.orcamento_ads (channel, vigente_desde, valor_mensal) values ('brindedobem', '2026-12-01', 100)`, /check/i);
await erro('orcamento: valor zero recusado', `insert into core.orcamento_ads (channel, vigente_desde, valor_mensal) values ('shopee', '2026-12-01', 0)`, /check/i);
await erro('orcamento: valor negativo recusado', `insert into core.orcamento_ads (channel, vigente_desde, valor_mensal) values ('shopee', '2026-12-01', -5)`, /check/i);
await erro('orcamento: chave duplicada recusada', `insert into core.orcamento_ads (channel, vigente_desde, valor_mensal) values ('shopee', '2026-11-01', 10)`, /duplicate|unique/i);
await erro('modo: tipo invalido recusado', `insert into core.ads_modo (channel, tipo, chave, modo) values ('mercadolivre', 'produto', 'x', 'manual')`, /check/i);
await erro('modo: modo invalido recusado', `insert into core.ads_modo (channel, tipo, chave, modo) values ('mercadolivre', 'modelo', 'x', 'semi')`, /check/i);
await db.exec(`insert into core.ads_modo (channel, tipo, chave, modo) values ('mercadolivre', 'modelo', 'BLA68', 'automatico'), ('mercadolivre', 'campanha', 'c1', 'manual'), ('mercadolivre', 'anuncio', 'MLB1', 'manual')`);
eq('modo: tipos validos gravam', await val(`select count(*)::int from core.ads_modo`), 3);
await erro('modo: chave duplicada recusada', `insert into core.ads_modo (channel, tipo, chave, modo) values ('mercadolivre', 'modelo', 'BLA68', 'manual')`, /duplicate|unique/i);

// ---------------- Colunas novas e mkt.ads_anuncios ----------------
await db.exec(`insert into mkt.ads_campaigns (channel, campaign_id, name, status, budget, roas_target, automatica, atualizado_em)
  values ('mercadolivre', 'c1', 'Camp 1', 'active', 50, 8.5, true, now())`);
eq('ads_campaigns: colunas novas', await rows(`select roas_target::float as r, automatica as a, atualizado_em is not null as t from mkt.ads_campaigns where campaign_id = 'c1'`),
  [{ r: 8.5, a: true, t: true }]);
await db.exec(`insert into mkt.ads_anuncios (channel, item_id, campaign_id, status) values ('mercadolivre', 'MLB1', 'c1', 'active'), ('shopee', 'SH1', null, 'paused')`);
eq('ads_anuncios: atualizado_em padrao', await val(`select count(*)::int from mkt.ads_anuncios where atualizado_em is not null`), 2);
await erro('ads_anuncios: PK (canal, anuncio)', `insert into mkt.ads_anuncios (channel, item_id) values ('mercadolivre', 'MLB1')`, /duplicate|unique/i);

// ---------------- RLS (papel authenticated) ----------------
await perfil('gestor'); await canais('mercadolivre,shopee');
eq('RLS ads_anuncios: ve os dois canais', await comoAuth(() => rows(`select channel from mkt.ads_anuncios order by channel`)), [{ channel: 'mercadolivre' }, { channel: 'shopee' }]);
await canais('mercadolivre');
eq('RLS ads_anuncios: so o canal liberado', await comoAuth(() => rows(`select channel from mkt.ads_anuncios order by channel`)), [{ channel: 'mercadolivre' }]);
await canais('crm');
eq('RLS ads_anuncios: nenhum canal liberado', await comoAuth(() => rows(`select channel from mkt.ads_anuncios`)), []);
await canais('mercadolivre,shopee');
eq('RLS ads_anuncios: sem escrita para authenticated', await comoAuth(() => tenta(`insert into mkt.ads_anuncios (channel, item_id) values ('mercadolivre', 'X')`)), 'negado');
eq('RLS ads_anuncios: politica usa (select ...)', await val(`select qual ~* 'SELECT core\\.' from pg_policies where schemaname = 'mkt' and tablename = 'ads_anuncios'`), true);

for (const p of ['comercial', 'visualizador', 'vendedor']) {
  await perfil(p);
  eq(`RLS orcamento legivel por ${p}`, await comoAuth(() => val(`select count(*)::int from core.orcamento_ads`)), 2);
  eq(`RLS parametros legiveis por ${p}`, await comoAuth(() => val(`select count(*)::int from core.parametros_ads`)), 2);
}
const novo = (d) => `insert into core.orcamento_ads (channel, vigente_desde, valor_mensal) values ('shopee', '${d}', 7000)`;
await perfil('gestor');
eq('gestor grava orcamento', await comoAuth(() => tenta(novo('2026-12-01'))), 'ok');
eq('gestor altera orcamento', await comoAuth(async () => { await db.exec(`update core.orcamento_ads set valor_mensal = 7500 where channel='shopee' and vigente_desde='2026-12-01'`); return val(`select valor_mensal::float from core.orcamento_ads where channel='shopee' and vigente_desde='2026-12-01'`); }), 7500);
await perfil('comercial');
eq('comercial nao grava orcamento', await comoAuth(() => tenta(novo('2027-01-01'))), 'negado');
eq('comercial nao altera orcamento', await comoAuth(async () => { await db.exec(`update core.orcamento_ads set valor_mensal = 1`); return val(`select count(*)::int from core.orcamento_ads where valor_mensal = 1`); }), 0);
eq('comercial nao apaga orcamento', await comoAuth(async () => { await db.exec(`delete from core.orcamento_ads`); return val(`select count(*)::int from core.orcamento_ads`); }), 3);
await perfil('admin');
eq('admin grava orcamento', await comoAuth(() => tenta(novo('2027-02-01'))), 'ok');

const par = `insert into core.parametros_ads (channel, vigente_desde) values ('shopee', '2027-03-01')`;
await perfil('gestor');
eq('gestor nao grava parametros', await comoAuth(() => tenta(par)), 'negado');
eq('gestor nao altera parametros', await comoAuth(async () => { await db.exec(`update core.parametros_ads set teto_fator = 9`); return val(`select count(*)::int from core.parametros_ads where teto_fator = 9`); }), 0);
await perfil('admin');
eq('admin grava parametros', await comoAuth(() => tenta(par)), 'ok');
eq('admin altera parametros', await comoAuth(async () => { await db.exec(`update core.parametros_ads set teto_fator = 3 where vigente_desde = '2027-03-01'`); return val(`select teto_fator::float from core.parametros_ads where vigente_desde = '2027-03-01'`); }), 3);

// core.ads_modo: leitura so com a permissao ads; sem politica de escrita
await perfil('comercial');
eq('modo legivel com ads', await comoAuth(() => val(`select count(*)::int from core.ads_modo`)), 3);
await perfil('visualizador');
eq('modo invisivel sem ads', await comoAuth(() => val(`select count(*)::int from core.ads_modo`)), 0);
for (const p of ['admin', 'gestor']) {
  await perfil(p);
  eq(`modo: ${p} nao grava direto`, await comoAuth(() => tenta(`insert into core.ads_modo (channel, tipo, chave, modo) values ('shopee', 'modelo', 'Z', 'manual')`)), 'negado');
  eq(`modo: ${p} nao altera direto`, await comoAuth(() => tenta(`update core.ads_modo set modo = 'manual'`)), 'negado');
  eq(`modo: ${p} nao apaga direto`, await comoAuth(() => tenta(`delete from core.ads_modo`)), 'negado');
}
await perfil('admin');

// ---------------- Vigencia: vale a linha com o maior vigente_desde <= data ----------------
await db.exec(`insert into core.orcamento_ads (channel, vigente_desde, valor_mensal) values ('mercadolivre', '2027-01-01', 8000), ('mercadolivre', '2026-06-01', 3000)`);
const vig = (d) => val(`select valor_mensal::float from core.orcamento_ads where channel = 'mercadolivre' and vigente_desde <= '${d}' order by vigente_desde desc limit 1`);
eq('vigencia: antes da primeira linha', await val(`select count(*)::int from core.orcamento_ads where channel = 'mercadolivre' and vigente_desde <= '2026-05-31'`), 0);
eq('vigencia: no dia exato', await vig('2026-06-01'), 3000);
eq('vigencia: entre linhas', await vig('2026-12-15'), 5000);
eq('vigencia: dia da troca', await vig('2027-01-01'), 8000);
eq('vigencia: depois da ultima', await vig('2030-01-01'), 8000);

// ---------------- Atribuicao anuncio -> modelo (0019, research R3) ----------------
await db.exec(`
insert into mkt.orders (channel, order_id, status, date_created, date_closed, total_amount, raw) values
 ('mercadolivre','A1','paid','2026-10-10 12:00+00','2026-10-10 12:00+00', 400, '{}'),
 ('mercadolivre','A2','paid','2026-10-11 12:00+00','2026-10-11 12:00+00', 100, '{}'),
 ('mercadolivre','A3','paid','2026-09-20 12:00+00','2026-09-20 12:00+00', 900, '{}');
insert into mkt.order_items (channel, order_id, line_no, item_id, sku, title, quantity, unit_price) values
 ('mercadolivre','A1',1,'MLB10','AAA11-AZU','a',3,100),
 ('mercadolivre','A2',1,'MLB10','BBB22-AZU','b',1,100),
 ('mercadolivre','A3',1,'MLB11','ZZZ99-AZU','fora da janela',9,100);
insert into mkt.items (channel, item_id, sku) values
 ('mercadolivre','MLB10', null), ('mercadolivre','MLB11','CCC33-AZU-K0010-V1'), ('mercadolivre','MLB12', null),
 ('mercadolivre','MLB13', null), ('mercadolivre','MLB14','SQM148-AZU'), ('shopee','SH1','SHP01-X');
insert into mkt.item_variations (channel, item_id, variation_id, sku) values
 ('mercadolivre','MLB12','v1','DDD44-AZU'), ('mercadolivre','MLB12','v2','EEE55-PRE'), ('mercadolivre','MLB12','v3','DDD44-VER');
insert into map.modelo_de_para (modelo_anuncio, modelo_erp) values ('SQM148', 'BMS148');
insert into mkt.ads_metrics_daily (channel, item_id, day, impressions, clicks, cost, direct_amount, indirect_amount, direct_units, indirect_units, organic_units) values
 ('mercadolivre','MLB10','2026-10-05', 1000, 40, 80, 150, 0, 3, 0, 1),
 ('mercadolivre','MLB10','2026-10-06', 400, 10, 20, 0, 50, 0, 1, 0),
 ('mercadolivre','MLB10','2026-11-02', 999, 99, 999, 999, 999, 9, 9, 9),
 ('mercadolivre','MLB11','2026-10-07', 100, 4, 40, 0, 0, 0, 0, 0),
 ('mercadolivre','MLB12','2026-10-07', 200, 8, 60, 0, 0, 0, 0, 0),
 ('mercadolivre','MLB13','2026-10-07', 50, 2, 10, 0, 0, 0, 0, 0),
 ('mercadolivre','MLB14','2026-10-08', 80, 6, 20, 0, 0, 0, 0, 0),
 ('shopee','SH1','2026-10-09', 10, 1, 5, 0, 0, 0, 0, 0);
`);
const MET = `select modelo, investimento::float as inv, impressoes::int as imp, cliques::float as cli, vendas_ads::float as vend,
  unidades_ads::float as un, unidades_organicas::float as org, dias_com_dados::int as dias
  from analytics.ads_metricas_modelo($1, '2026-10-01', '2026-10-31') order by modelo nulls last`;
eq('metricas por modelo (consolidado)', await rows(MET, ['consolidado']), [
  { modelo: 'AAA11', inv: 75, imp: 1050, cli: 37.5, vend: 150, un: 3, org: 0.75, dias: 2 },
  { modelo: 'BBB22', inv: 25, imp: 350, cli: 12.5, vend: 50, un: 1, org: 0.25, dias: 2 },
  { modelo: 'BMS148', inv: 20, imp: 80, cli: 6, vend: 0, un: 0, org: 0, dias: 1 },
  { modelo: 'CCC33', inv: 40, imp: 100, cli: 4, vend: 0, un: 0, org: 0, dias: 1 },
  { modelo: 'DDD44', inv: 30, imp: 100, cli: 4, vend: 0, un: 0, org: 0, dias: 1 },
  { modelo: 'EEE55', inv: 30, imp: 100, cli: 4, vend: 0, un: 0, org: 0, dias: 1 },
  { modelo: 'SHP01', inv: 5, imp: 10, cli: 1, vend: 0, un: 0, org: 0, dias: 1 },
  { modelo: null, inv: 10, imp: 50, cli: 2, vend: 0, un: 0, org: 0, dias: 1 },
]);
eq('metricas: canal shopee so ve o shopee', (await rows(MET, ['shopee'])).map((r) => r.modelo), ['SHP01']);
eq('metricas: ml nao traz o shopee', (await rows(MET, ['mercadolivre'])).map((r) => r.modelo).includes('SHP01'), false);
eq('metricas: soma dos modelos = investimento dos anuncios', await val(
  `select sum(investimento)::float from analytics.ads_metricas_modelo('consolidado', '2026-10-01', '2026-10-31')`), 235);
const PESO = `select item_id, modelo, peso::float as peso from analytics.ads_peso_modelo('consolidado', '2026-10-01', '2026-10-31') order by item_id, modelo nulls last`;
eq('peso: 3:1 por vendas; SKU do anuncio; varios SKUs; sem modelo; de-para', await rows(PESO), [
  { item_id: 'MLB10', modelo: 'AAA11', peso: 0.75 }, { item_id: 'MLB10', modelo: 'BBB22', peso: 0.25 },
  { item_id: 'MLB11', modelo: 'CCC33', peso: 1 },
  { item_id: 'MLB12', modelo: 'DDD44', peso: 0.5 }, { item_id: 'MLB12', modelo: 'EEE55', peso: 0.5 },
  { item_id: 'MLB13', modelo: null, peso: 1 },
  { item_id: 'MLB14', modelo: 'BMS148', peso: 1 },
  { item_id: 'SH1', modelo: 'SHP01', peso: 1 },
]);
eq('peso: janela sem metricas = nada', await rows(`select * from analytics.ads_peso_modelo('consolidado', '2026-01-01', '2026-01-31')`), []);
eq('peso: a venda de setembro conta so na janela dela', await rows(`select modelo, peso::float as peso from analytics.ads_peso_modelo('mercadolivre', '2026-09-01', '2026-11-30') where item_id = 'MLB11'`),
  [{ modelo: 'ZZZ99', peso: 1 }]);

await perfil('gestor'); await canais('crm');
eq('RLS: usuario sem o canal nao ve metricas', await comoAuth(() => rows(MET, ['consolidado'])), []);
eq('RLS: usuario sem o canal nao ve pesos', await comoAuth(() => rows(PESO)), []);
await canais('shopee');
eq('RLS: so o canal liberado entra', await comoAuth(async () => (await rows(MET, ['consolidado'])).map((r) => r.modelo)), ['SHP01']);
await canais('mercadolivre,shopee');
eq('autenticado calcula metricas', (await comoAuth(() => rows(MET, ['consolidado']))).length, 8);
await perfil('admin');

// ads_parametros: a linha valida na data
await db.exec(`insert into core.parametros_ads (channel, vigente_desde, teto_fator) values ('mercadolivre', '2027-06-01', 4)`);
const PAR = (d) => rows(`select vigente_desde::text as d, teto_fator::float as t from analytics.ads_parametros('mercadolivre', '${d}')`);
eq('parametros: antes da primeira vigencia', await PAR('2026-10-31'), []);
eq('parametros: primeira vigencia', await PAR('2026-11-01'), [{ d: '2026-11-01', t: 2 }]);
eq('parametros: ainda a primeira', await PAR('2027-05-31'), [{ d: '2026-11-01', t: 2 }]);
eq('parametros: segunda vigencia no dia', await PAR('2027-06-01'), [{ d: '2027-06-01', t: 4 }]);
eq('parametros: depois da ultima', await PAR('2030-01-01'), [{ d: '2027-06-01', t: 4 }]);
eq('parametros: autenticado le', (await comoAuth(() => rows(`select 1 from analytics.ads_parametros('shopee', '2026-12-01')`))).length, 1);

// ---------------- Reexecucao ----------------
await db.exec(`update core.orcamento_ads set valor_mensal = 6000 where channel = 'shopee' and vigente_desde = '2026-11-01'`);
await db.exec(`update core.role_permissions set allowed = true where role = 'comercial' and permission = 'editar_ads'`);
await db.exec(mig('0018_ads_tabelas.sql'));
await db.exec(mig('0018_ads_tabelas.sql'));
await db.exec(mig('0019_ads_funcoes.sql'));
eq('reexecucao preserva orcamento alterado', await val(`select valor_mensal::float from core.orcamento_ads where channel = 'shopee' and vigente_desde = '2026-11-01'`), 6000);
eq('reexecucao preserva permissao alterada', await val(`select allowed from core.role_permissions where role = 'comercial' and permission = 'editar_ads'`), true);
eq('reexecucao nao duplica sementes', await rows(`select (select count(*)::int from core.parametros_ads where vigente_desde = '2026-11-01') as p,
  (select count(*)::int from core.role_permissions where permission in ('ads','editar_ads')) as r,
  (select count(*)::int from pg_policies where schemaname in ('core','mkt') and tablename in ('ads_anuncios','orcamento_ads','parametros_ads','ads_modo')) as pol`),
  [{ p: 2, r: 10, pol: 6 }]);

console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
process.exit(fails ? 1 : 0);
