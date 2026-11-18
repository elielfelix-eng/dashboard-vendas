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
    d: '2025-01-01', pausar_gasto_min: 50, pausar_cliques_min: 100, min_dias_dados: 7, revisar_cliques_min: 100,
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
eq('parametros: antes da primeira vigencia', await PAR('2024-12-31'), []);
eq('parametros: primeira vigencia (semente desde 2025-01-01)', await PAR('2025-01-01'), [{ d: '2025-01-01', t: 2 }]);
eq('parametros: periodo historico (out/2026) tem limites', await PAR('2026-10-31'), [{ d: '2025-01-01', t: 2 }]);
eq('parametros: ainda a primeira', await PAR('2027-05-31'), [{ d: '2025-01-01', t: 2 }]);
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
eq('reexecucao nao duplica sementes', await rows(`select (select count(*)::int from core.parametros_ads where vigente_desde = '2025-01-01') as p,
  (select count(*)::int from core.role_permissions where permission in ('ads','editar_ads')) as r,
  (select count(*)::int from pg_policies where schemaname in ('core','mkt') and tablename in ('ads_anuncios','orcamento_ads','parametros_ads','ads_modo')) as pol`),
  [{ p: 2, r: 10, pol: 6 }]);
await db.exec(`update core.role_permissions set allowed = false where role = 'comercial' and permission = 'editar_ads'`);

// =====================================================================
// US1 (T009-T012): ads_resumo, ads_serie, ads_modelos, ads_campanhas
// Cenario novo (outubro/2026, ML). Primeiro dia da API de campanhas: 05/10.
//   Investimento (dash_ads_periodo) = fatura ligada a pedido (12 + 10) + fatura sem pedido antes da API (7) + API (180) = 209
//   Por anuncio (ads_metrics_daily): AAA11 90, BBB22 20, CCC33 25 (sem custo, pausado), sem modelo 5 -> nao atribuido = 209 - 135 = 74
// =====================================================================
await perfil('admin'); await canais('mercadolivre,shopee');
await db.exec(`
delete from mkt.order_items; delete from mkt.orders; delete from mkt.item_variations; delete from mkt.items;
delete from mkt.ads_metrics_daily; delete from mkt.ads_campaigns; delete from mkt.ads_anuncios; delete from mkt.ads_campaign_daily;
delete from mkt.billing_details; delete from map.modelo_de_para; delete from core.ads_modo; delete from erp.cost_tiers;
insert into erp.cost_tiers (product_id, qty_start, qty_end, price, created_at, source) values
 ('AAA11',1,49,10,'2026-01-01','erp'), ('BBB22',1,49,5,'2026-01-01','erp'), ('DDD44',1,49,1,'2026-01-01','erp');
insert into mkt.orders (channel, order_id, status, date_created, date_closed, total_amount, raw) values
 ('mercadolivre','P1','paid','2026-10-10 12:00+00','2026-10-10 12:00+00',200,'{}'),
 ('mercadolivre','P2','paid','2026-10-12 12:00+00','2026-10-12 12:00+00',100,'{}'),
 ('mercadolivre','P3','paid','2026-10-15 12:00+00','2026-10-15 12:00+00',50,'{}'),
 ('mercadolivre','P4','paid','2026-10-20 12:00+00','2026-10-20 12:00+00',30,'{}'),
 ('mercadolivre','P5','paid','2026-09-20 12:00+00','2026-09-20 12:00+00',70,'{}'),
 ('brindedobem','B1','paid','2026-10-10 12:00+00','2026-10-10 12:00+00',5000,'{}');
insert into mkt.order_items (channel, order_id, line_no, item_id, sku, title, quantity, unit_price) values
 ('mercadolivre','P1',1,'MLB1','AAA11-AZU','Produto A',2,100),
 ('mercadolivre','P2',1,'MLB1','AAA11-AZU','Produto A',1,60),
 ('mercadolivre','P2',2,'MLB2','BBB22-AZU','Produto B',1,40),
 ('mercadolivre','P3',1,'MLB3','CCC33-AZU','Produto C',1,50),
 ('mercadolivre','P4',1,'MLB4','DDD44-AZU','Produto D',1,30),
 ('mercadolivre','P5',1,'MLB5','EEE55-AZU','Produto E',1,70),
 ('brindedobem','B1',1,'BDB1','BDB01-AZU','Brinde',1,5000);
insert into mkt.items (channel, item_id, title, sku) values
 ('mercadolivre','MLB1','Anuncio A',null), ('mercadolivre','MLB2','Anuncio B',null), ('mercadolivre','MLB3','Anuncio C',null),
 ('mercadolivre','MLB9','Anuncio sem SKU',null), ('shopee','SH1','Anuncio Shopee','SHP01-X'), ('brindedobem','BDB1','Brinde','BDB01-AZU');
insert into mkt.billing_details (period_key, detail_id, created_at, detail_type, code, amount, order_id) values
 ('2026-10','f1','2026-10-11 10:00+00','CHARGE','CVVML',20,'P1'),
 ('2026-10','f2','2026-10-11 10:00+00','CHARGE','PADS',12,'P1'),
 ('2026-10','f3','2026-10-13 10:00+00','CHARGE','PADS',10,'P2'),
 ('2026-10','f4','2026-10-04 06:00+00','CHARGE','PADS',7,null),
 ('2026-10','f5','2026-10-22 06:00+00','CHARGE','PADS',99,null),
 ('2026-10','f6','2026-10-08 06:00+00','CHARGE','CDLIT',8,null),
 ('2026-09','f7','2026-09-16 06:00+00','CHARGE','PADS',15,null);
insert into mkt.ads_campaign_daily (channel, campaign_id, day, cost) values
 ('mercadolivre','c1','2026-10-05',100), ('mercadolivre','c1','2026-10-20',50), ('mercadolivre','c2','2026-10-10',30);
insert into mkt.ads_campaigns (channel, campaign_id, name, status, budget, roas_target, automatica) values
 ('mercadolivre','c1','Campanha 1','active',40,4,false),
 ('mercadolivre','c3','Campanha 3','active',10,null,true),
 ('mercadolivre','c8','Antiga','paused',10,null,false);
insert into mkt.ads_metrics_daily (channel, item_id, day, campaign_id, impressions, clicks, cost, direct_amount, indirect_amount, direct_units, indirect_units, organic_units) values
 ('mercadolivre','MLB1','2026-10-05','c1',1000,50,60,300,0,3,0,0),
 ('mercadolivre','MLB1','2026-10-20','c1',500,20,30,0,100,0,1,0),
 ('mercadolivre','MLB2','2026-10-06','c1',400,10,20,40,0,1,0,0),
 ('mercadolivre','MLB3','2026-10-10','c2',200,8,25,0,0,0,0,0),
 ('mercadolivre','MLB9','2026-10-10','c2',100,2,5,0,0,0,0,0),
 ('brindedobem','BDB1','2026-10-10',null,9,9,1000,900,0,9,0,0),
 ('shopee','SH1','2026-10-09',null,10,1,5,0,0,0,0,0);
insert into mkt.ads_anuncios (channel, item_id, campaign_id, status) values
 ('mercadolivre','MLB1','c1','active'), ('mercadolivre','MLB2','c1','active'), ('mercadolivre','MLB3','c2','paused');
insert into core.ads_modo (channel, tipo, chave, modo) values
 ('mercadolivre','modelo','AAA11','automatico'), ('mercadolivre','campanha','c1','automatico');
`);
const OUT = ['2026-10-01', '2026-10-31'];
const RES = `select investimento::float, vendas_ads::float, roas::float, acos::float, tacos::float, pct_vendas_ads::float,
  vendas_brutas_canal::float, nao_atribuido::float, tem_detalhe from analytics.ads_resumo($1, $2::date, $3::date)`;
const resumo = (c, de = OUT[0], ate = OUT[1]) => rows(RES, [c, de, ate]);
const adsPer = (c, de = OUT[0], ate = OUT[1]) => val(`select analytics.dash_ads_periodo('${c}', '${de}', '${ate}')::float`);

// ---------------- T009: ads_resumo ----------------
eq('pre: dash_ads_periodo de outubro', await adsPer('mercadolivre'), 209);
eq('resumo ML outubro', await resumo('mercadolivre'), [{
  investimento: 209, vendas_ads: 440, roas: 2.11, acos: 47.5, tacos: 55, pct_vendas_ads: 115.79,
  vendas_brutas_canal: 380, nao_atribuido: 74, tem_detalhe: true,
}]);
eq('resumo: investimento = dash_ads_periodo', (await resumo('mercadolivre'))[0].investimento, await adsPer('mercadolivre'));
eq('resumo: vendas brutas = dash_resumo', (await resumo('mercadolivre'))[0].vendas_brutas_canal,
  await val(`select vendas_brutas::float from analytics.dash_resumo('mercadolivre', '2026-10-01', '2026-10-31')`));
eq('resumo: periodo antes da API (so fatura) = dash_ads_periodo, sem detalhe', await resumo('mercadolivre', '2026-09-01', '2026-09-30'), [{
  investimento: 15, vendas_ads: 0, roas: 0, acos: null, tacos: 21.43, pct_vendas_ads: 0,
  vendas_brutas_canal: 70, nao_atribuido: 15, tem_detalhe: false,
}]);
eq('resumo: periodo vazio', await resumo('mercadolivre', '2020-01-01', '2020-01-31'), [{
  investimento: 0, vendas_ads: 0, roas: null, acos: null, tacos: null, pct_vendas_ads: null,
  vendas_brutas_canal: 0, nao_atribuido: 0, tem_detalhe: false,
}]);
eq('resumo consolidado: sem o canal brindedobem (FR-010)', await resumo('consolidado'), [{
  investimento: 209, vendas_ads: 440, roas: 2.11, acos: 47.5, tacos: 55, pct_vendas_ads: 115.79,
  vendas_brutas_canal: 380, nao_atribuido: 69, tem_detalhe: true,
}]);
eq('resumo shopee: so o shopee (sem fonte conferida ainda)', (await resumo('shopee')).map((r) => [r.investimento, r.vendas_ads, r.vendas_brutas_canal, r.tem_detalhe]),
  [[0, 0, 0, true]]);
await perfil('comercial');
eq('resumo comercial (sem custos, como authenticated): mesmo investimento', await comoAuth(() => resumo('mercadolivre')), [{
  investimento: 209, vendas_ads: 440, roas: 2.11, acos: 47.5, tacos: 55, pct_vendas_ads: 115.79,
  vendas_brutas_canal: 380, nao_atribuido: 74, tem_detalhe: true,
}]);
await perfil('visualizador');
eq('resumo sem a permissao ads: uma linha zerada', await comoAuth(() => resumo('mercadolivre')), [{
  investimento: 0, vendas_ads: 0, roas: null, acos: null, tacos: null, pct_vendas_ads: null,
  vendas_brutas_canal: 0, nao_atribuido: 0, tem_detalhe: false,
}]);
await perfil('gestor'); await canais('crm');
eq('resumo sem o canal: zerado', (await comoAuth(() => resumo('mercadolivre'))).map((r) => [r.investimento, r.vendas_ads, r.vendas_brutas_canal, r.tem_detalhe]),
  [[0, 0, 0, false]]);
await perfil('admin'); await canais('mercadolivre,shopee');

// ---------------- T010: ads_serie ----------------
const SER = `select dia::text, investimento::float, vendas_ads::float from analytics.ads_serie($1, $2::date, $3::date) order by dia`;
const serie = await rows(SER, ['mercadolivre', ...OUT]);
eq('serie: um dia por linha', serie.length, 31);
eq('serie: soma diaria = investimento do resumo', serie.reduce((s, d) => s + d.investimento, 0), 209);
eq('serie: dias com investimento (fatura sem pedido 03/10, API, fatura ligada a pedido pela data da venda)',
  serie.filter((d) => d.investimento).map((d) => [d.dia, d.investimento]),
  [['2026-10-03', 7], ['2026-10-05', 100], ['2026-10-10', 42], ['2026-10-12', 10], ['2026-10-20', 50]]);
eq('serie: vendas por Ads por dia', serie.filter((d) => d.vendas_ads).map((d) => [d.dia, d.vendas_ads]),
  [['2026-10-05', 300], ['2026-10-06', 40], ['2026-10-20', 100]]);
const sub = await rows(SER, ['mercadolivre', '2026-10-08', '2026-10-15']);
eq('serie: soma de um trecho = dash_ads_periodo do trecho', sub.reduce((s, d) => s + d.investimento, 0), await adsPer('mercadolivre', '2026-10-08', '2026-10-15'));
eq('serie consolidada: sem brindedobem', (await rows(SER, ['consolidado', ...OUT])).reduce((s, d) => s + d.vendas_ads, 0), 440);
await perfil('comercial');
eq('serie comercial (sem custos): mesma soma', (await comoAuth(() => rows(SER, ['mercadolivre', ...OUT]))).reduce((s, d) => s + d.investimento, 0), 209);
await perfil('visualizador');
eq('serie sem ads: nada', await comoAuth(() => rows(SER, ['mercadolivre', ...OUT])), []);
await perfil('gestor'); await canais('shopee');
eq('serie: canal ML nao liberado nao mostra investimento nem vendas', (await comoAuth(() => rows(SER, ['consolidado', ...OUT])))
  .reduce((s, d) => s + d.investimento + d.vendas_ads, 0), 0);
await perfil('admin'); await canais('mercadolivre,shopee');
eq('serie e definer so com agregados (excecao documentada)', await val(`select prosecdef from pg_proc where proname = 'ads_serie'`), true);

// ---------------- T011: ads_modelos ----------------
const MOD = `select modelo, produto, investimento::float as inv, impressoes::float as imp, cliques::float as cli, ctr::float, cpc::float,
  conversao::float as conv, vendas_ads::float as vend, unidades_ads::float as un, acos::float, acos_equilibrio::float as eqb,
  lucro_pos_ads::float as lucro, contribuicao_pct::float as cpct, sugestao, motivo, pausado, campanha_id, modo
  from analytics.ads_modelos($1, $2::date, $3::date)`;
const modelos = (c, de = OUT[0], ate = OUT[1]) => rows(MOD, [c, de, ate]);
const mo = await modelos('mercadolivre');
eq('modelos: universo (Ads no periodo ou venda paga em 30 dias), ordem por investimento, nao atribuido por ultimo',
  mo.map((m) => m.modelo), ['AAA11', 'CCC33', 'BBB22', 'DDD44', null]);
const A = mo.find((m) => m.modelo === 'AAA11');
eq('AAA11: metricas, CTR, CPC, conversao, ACOS', { inv: A.inv, imp: A.imp, cli: A.cli, ctr: A.ctr, cpc: A.cpc, conv: A.conv, vend: A.vend, un: A.un, acos: A.acos },
  { inv: 90, imp: 1500, cli: 70, ctr: 4.67, cpc: 1.29, conv: 5.71, vend: 400, un: 4, acos: 22.5 });
// Contribuicao antes do Ads sem nenhum Ads: 260 - 30 (custo) - 20 (comissao) - 8 x 260/380 (Seguidores rateado) = 204,53
eq('AAA11: ACOS de equilibrio e lucro (contribuicao antes do Ads)', { eqb: A.eqb, lucro: A.lucro, cpct: A.cpct }, { eqb: 78.66, lucro: 114.53, cpct: 22.53 });
const dm = await rows(`select modelo, receita::float, contribuicao::float from analytics.dash_modelos('mercadolivre', '2026-10-01', '2026-10-31')`);
const adsCp = await val(`select sum(valor)::float from analytics.dash_custos_periodo('mercadolivre', '2026-10-01', '2026-10-31') where categoria = 'product_ads'`);
const recTot = dm.reduce((s, m) => s + m.receita, 0);
const r2 = (mod, fat) => { const d = dm.find((m) => m.modelo === mod); return Math.round((d.contribuicao + adsCp * d.receita / recTot + fat) / d.receita * 10000) / 100; };
eq('R2 sem dupla contagem: = (contribuicao de dash_modelos + Ads rateado + Ads de fatura ligada a pedido) / receita',
  [A.eqb, mo.find((m) => m.modelo === 'BBB22').eqb], [r2('AAA11', 12 + 6), r2('BBB22', 4)]);
eq('BBB22: pedido com 2 modelos (Ads da fatura repartido pelo valor do item)', (({ inv, ctr, cpc, conv, acos, eqb, lucro, cpct, pausado, campanha_id, modo }) =>
  ({ inv, ctr, cpc, conv, acos, eqb, lucro, cpct, pausado, campanha_id, modo }))(mo.find((m) => m.modelo === 'BBB22')),
  { inv: 20, ctr: 2.5, cpc: 2, conv: 10, acos: 50, eqb: 85.39, lucro: 14.16, cpct: 26.18, pausado: false, campanha_id: 'c1', modo: 'manual' });
eq('CCC33: modelo sem custo -> equilibrio/lucro/margem nulos; pausado; ACOS sem venda nulo', (({ inv, cpc, conv, vend, acos, eqb, lucro, cpct, pausado, campanha_id }) =>
  ({ inv, cpc, conv, vend, acos, eqb, lucro, cpct, pausado, campanha_id }))(mo.find((m) => m.modelo === 'CCC33')),
  { inv: 25, cpc: 3.13, conv: 0, vend: 0, acos: null, eqb: null, lucro: null, cpct: null, pausado: true, campanha_id: 'c2' });
eq('DDD44: vendido sem Ads aparece zerado', (({ inv, imp, cli, ctr, cpc, conv, vend, un, acos, eqb, lucro, pausado, campanha_id }) =>
  ({ inv, imp, cli, ctr, cpc, conv, vend, un, acos, eqb, lucro, pausado, campanha_id }))(mo.find((m) => m.modelo === 'DDD44')),
  { inv: 0, imp: 0, cli: 0, ctr: null, cpc: null, conv: null, vend: 0, un: 0, acos: null, eqb: 94.56, lucro: 28.37, pausado: false, campanha_id: null });
eq('AAA11: modo automatico, campanha c1, produto', [A.modo, A.campanha_id, A.produto, A.pausado], ['automatico', 'c1', 'Produto A', false]);
// Outubro/2026: limites da semente (vigentes desde 2025-01-01)
eq('sugestao em outubro com os limites da semente; pausado e nao atribuido sem sugestao',
  mo.map((m) => [m.modelo, m.sugestao]), [['AAA11', 'escalar'], ['CCC33', null], ['BBB22', 'manter'], ['DDD44', 'manter'], [null, null]]);
eq('linha nao atribuido sem motivo', mo.find((m) => m.modelo === null).motivo, null);
const nulo = mo.find((m) => m.modelo === null);
eq('linha nao atribuido = investimento do resumo - modelos (inclui o anuncio sem modelo)', nulo.inv, 74);
eq('reconciliacao: soma da tabela = cartao', mo.reduce((s, m) => s + m.inv, 0), (await resumo('mercadolivre'))[0].investimento);
eq('linha nao atribuido = nao_atribuido do resumo', nulo.inv, (await resumo('mercadolivre'))[0].nao_atribuido);
eq('linha nao atribuido sem equilibrio/lucro', [nulo.eqb, nulo.lucro, nulo.cpct, nulo.pausado], [null, null, null, false]);
eq('metricas = ads_metricas_modelo', mo.filter((m) => m.modelo && m.inv).map((m) => [m.modelo, m.inv, m.imp, m.vend]),
  (await rows(`select modelo, investimento::float as i, impressoes::float as p, vendas_ads::float as v from analytics.ads_metricas_modelo('mercadolivre', '2026-10-01', '2026-10-31')
     where modelo is not null order by investimento desc, modelo`)).map((m) => [m.modelo, m.i, m.p, m.v]));
const cons = await modelos('consolidado');
eq('consolidado: shopee entra, brindedobem nao (FR-010)', cons.map((m) => [m.modelo, m.inv]),
  [['AAA11', 90], ['CCC33', 25], ['BBB22', 20], ['SHP01', 5], ['DDD44', 0], [null, 69]]);
eq('consolidado: reconciliacao', cons.reduce((s, m) => s + m.inv, 0), (await resumo('consolidado'))[0].investimento);
eq('universo: venda so fora da janela de 30 dias nao entra', (await modelos('mercadolivre', '2026-10-01', '2026-10-31')).some((m) => m.modelo === 'EEE55'), false);
eq('universo: venda paga na janela de 30 dias ate p_ate entra', (await modelos('mercadolivre', '2026-10-01', '2026-10-10')).map((m) => m.modelo).includes('EEE55'), true);
eq('universo: so venda na janela (sem venda nem Ads no periodo) -> lucro/equilibrio nulos',
  (await modelos('mercadolivre', '2026-10-01', '2026-10-10')).filter((m) => m.modelo === 'EEE55').map((m) => [m.inv, m.eqb, m.lucro, m.cpct]),
  [[0, null, null, null]]);
eq('modelos shopee: sem venda por modelo (curto-circuito), so o anuncio da Shopee',
  (await modelos('shopee')).map((m) => [m.modelo, m.inv, m.lucro]), [['SHP01', 5, -5], [null, -5, null]]);
await db.exec(`update mkt.ads_campaigns set status = 'paused' where campaign_id = 'c1'`);
eq('pausado: campanha pausada pausa os modelos dela', (await modelos('mercadolivre')).filter((m) => m.pausado).map((m) => m.modelo), ['AAA11', 'CCC33', 'BBB22']);
await db.exec(`update mkt.ads_campaigns set status = 'active' where campaign_id = 'c1'`);

await perfil('gestor');
const pega = (lst) => lst.filter((m) => ['AAA11', 'BBB22', 'DDD44'].includes(m.modelo)).map((m) => [m.modelo, m.eqb, m.lucro, m.cpct]);
eq('gestor com custos (authenticated, RLS valendo): mesmo equilibrio/lucro do calculo',
  pega(await comoAuth(() => modelos('mercadolivre'))),
  [['AAA11', 78.66, 114.53, 22.53], ['BBB22', 85.39, 14.16, 26.18], ['DDD44', 94.56, 28.37, 45.35]]);
await perfil('comercial');
const moCom = await comoAuth(() => modelos('mercadolivre'));
eq('FR-009: comercial (authenticated) sem equilibrio/lucro/margem', moCom.map((m) => [m.modelo, m.eqb, m.lucro, m.cpct]),
  [['AAA11', null, null, null], ['CCC33', null, null, null], ['BBB22', null, null, null], ['DDD44', null, null, null], [null, null, null, null]]);
eq('FR-009: comercial ve investimento e metricas iguais', moCom.map((m) => [m.modelo, m.inv, m.acos]), mo.map((m) => [m.modelo, m.inv, m.acos]));
await perfil('visualizador');
eq('modelos sem ads: nada', await comoAuth(() => modelos('mercadolivre')), []);
await perfil('gestor'); await canais('crm');
eq('modelos: canal nao liberado -> nada', await comoAuth(() => modelos('mercadolivre')), []);
eq('modelos: consolidado sem canais -> nada', await comoAuth(() => modelos('consolidado')), []);
await canais('shopee');
eq('modelos: ML nao liberado -> nada no ML', (await comoAuth(() => modelos('mercadolivre'))), []);
eq('modelos: consolidado so com o canal liberado (shopee; cartao 0 -> linha nula negativa reconcilia)',
  (await comoAuth(() => modelos('consolidado'))).map((m) => [m.modelo, m.inv]), [['SHP01', 5], [null, -5]]);
await perfil('admin'); await canais('mercadolivre,shopee');

// ---------------- T012: ads_campanhas ----------------
const CAMP = `select campanha_id, nome, status, automatica, orcamento_diario::float as orc, roas_target::float as roas_obj,
  acos_equivalente::float as acos_eq, investimento::float as inv, vendas_ads::float as vend, acos::float, roas::float, modelos, modo
  from analytics.ads_campanhas($1, $2::date, $3::date)`;
eq('campanhas: agregacao, atributos, ACOS equivalente, nome = id quando sem cadastro, numero de modelos', await rows(CAMP, ['mercadolivre', ...OUT]), [
  { campanha_id: 'c1', nome: 'Campanha 1', status: 'active', automatica: false, orc: 40, roas_obj: 4, acos_eq: 25, inv: 150, vend: 440, acos: 34.09, roas: 2.93, modelos: 2, modo: 'automatico' },
  { campanha_id: 'c2', nome: 'c2', status: null, automatica: null, orc: null, roas_obj: null, acos_eq: null, inv: 30, vend: 0, acos: null, roas: 0, modelos: 1, modo: 'manual' },
  { campanha_id: 'c3', nome: 'Campanha 3', status: 'active', automatica: true, orc: 10, roas_obj: null, acos_eq: null, inv: 0, vend: 0, acos: null, roas: null, modelos: 0, modo: 'manual' },
]);
eq('campanhas consolidado: sem brindedobem', (await rows(CAMP, ['consolidado', ...OUT])).map((c) => c.campanha_id), ['c1', 'c2', 'c3']);
await perfil('comercial');
eq('campanhas: comercial ve', (await comoAuth(() => rows(CAMP, ['mercadolivre', ...OUT]))).map((c) => [c.campanha_id, c.inv]), [['c1', 150], ['c2', 30], ['c3', 0]]);
await perfil('visualizador');
eq('campanhas sem ads: nada', await comoAuth(() => rows(CAMP, ['mercadolivre', ...OUT])), []);
await perfil('gestor'); await canais('crm');
eq('campanhas: canal nao liberado -> nada', await comoAuth(() => rows(CAMP, ['mercadolivre', ...OUT])), []);
await perfil('admin'); await canais('mercadolivre,shopee');

// Vendas brutas do resumo: todas as classes e o escopo de dash_resumo (dezembro, cenario a parte)
await db.exec(`
insert into mkt.orders (channel, order_id, status, date_created, date_closed, total_amount, raw, shipment_status, shipment_substatus) values
 ('mercadolivre','X1','paid','2026-12-05 12:00+00','2026-12-05 12:00+00',100,'{}',null,null),
 ('mercadolivre','X2','cancelled','2026-12-06 12:00+00','2026-12-06 12:00+00',50,'{}','cancelled',null),
 ('mercadolivre','X3','cancelled','2026-12-07 12:00+00','2026-12-07 12:00+00',70,'{"cancel_detail":{"code":"pack_splitted"}}',null,null),
 ('mercadolivre','X4','cancelled','2026-12-08 12:00+00','2026-12-08 12:00+00',30,'{}','delivered',null),
 ('mercadolivre','X5','cancelled','2026-12-09 12:00+00','2026-12-09 12:00+00',20,'{}','not_delivered','returned'),
 ('mercadolivre','X6','cancelled','2026-12-10 12:00+00','2026-12-10 12:00+00',40,'{}',null,'pack_splitted'),
 ('shopee','XS1','paid','2026-12-05 12:00+00','2026-12-05 12:00+00',999,'{}',null,null);
insert into mkt.order_items (channel, order_id, line_no, item_id, sku, title, quantity, unit_price) values
 ('mercadolivre','X1',1,'MLB1','AAA11-AZU','a',1,100), ('mercadolivre','X2',1,'MLB1','AAA11-AZU','a',1,50),
 ('mercadolivre','X3',1,'MLB1','AAA11-AZU','a',1,70), ('mercadolivre','X4',1,'MLB1','AAA11-AZU','a',1,30),
 ('mercadolivre','X5',1,'MLB1','AAA11-AZU','a',1,20), ('mercadolivre','X6',1,'MLB1','AAA11-AZU','a',1,40),
 ('shopee','XS1',1,'SH1','SHP01-X','s',1,999);
`);
const DEZ = ['2026-12-01', '2026-12-31'];
const vbResumo = (c) => val(`select vendas_brutas::float from analytics.dash_resumo('${c}', '${DEZ[0]}', '${DEZ[1]}')`);
eq('classes: pago + cancelado + devolvido (2 formas); sem os dois carrinhos divididos; sem a Shopee',
  (await resumo('mercadolivre', ...DEZ))[0].vendas_brutas_canal, 200);
eq('classes: ML = dash_resumo', (await resumo('mercadolivre', ...DEZ))[0].vendas_brutas_canal, await vbResumo('mercadolivre'));
eq('classes: consolidado = dash_resumo (pedido da Shopee fora)', (await resumo('consolidado', ...DEZ))[0].vendas_brutas_canal, await vbResumo('consolidado'));
eq('classes: shopee = dash_resumo (0 por enquanto)', [(await resumo('shopee', ...DEZ))[0].vendas_brutas_canal, await vbResumo('shopee')], [0, 0]);
await perfil('comercial');
eq('classes: authenticated (RLS) = dash_resumo', await comoAuth(async () => [(await resumo('mercadolivre', ...DEZ))[0].vendas_brutas_canal, await vbResumo('mercadolivre')]), [200, 200]);
await perfil('admin');

eq('funcoes da tela: invoker (exceto ads_serie)', await rows(`select proname, prosecdef from pg_proc where proname in ('ads_resumo','ads_modelos','ads_campanhas') order by proname`),
  [{ proname: 'ads_campanhas', prosecdef: false }, { proname: 'ads_modelos', prosecdef: false }, { proname: 'ads_resumo', prosecdef: false }]);
await db.exec(mig('0019_ads_funcoes.sql'));
eq('0019 reexecutavel com as funcoes da tela', (await resumo('mercadolivre'))[0].investimento, 209);

// =====================================================================
// US2 (T019): sugestoes em ads_modelos (janela de 30 dias ate p_ate, research R4)
// Cenario novo (fevereiro/2027, ML; limites da semente, vigentes desde 2025-01-01: 50 / 100 / 7 / 100 / 1% / 10 pp / 3 / 20% / 3).
//   Equilibrio (contribuicao antes do Ads / receita): RED02 30%, REV03 50%, ESC04 30%, MAN08 30%, TES05 25%; SCU09 sem custo.
//   Product Ads da API (c9, 100) e rateado em dash_modelos e devolvido no equilibrio (R2): nao muda os numeros acima.
// =====================================================================
await perfil('admin'); await canais('mercadolivre,shopee');
const dias = (ini, n) => Array.from({ length: n }, (_, k) => { const d = new Date(`${ini}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); });
const met = (ch, item, dia, cli, custo, valor = 0, un = 0, camp = null, ind = [0, 0]) =>
  `('${ch}','${item}','${dia}',${camp ? `'${camp}'` : 'null'},${cli * 10},${cli},${custo},${valor},${ind[0]},${un},${ind[1]},0)`;
const metUS2 = [
  ...dias('2027-02-10', 10).map((d) => met('mercadolivre', 'MLP1', d, 3, 6)),                 // PAU01: R$ 60, 10 dias, sem venda
  met('mercadolivre', 'MLR2', '2027-02-10', 20, 35, 100, 1),                                    // RED02: ACOS 35
  met('mercadolivre', 'MLV3', '2027-02-11', 200, 10, 50, 1),                                    // REV03: 200 cliques, conversao 0,5%
  met('mercadolivre', 'MLE4', '2027-02-12', 50, 90, 300, 3, null, [200, 2]),                   // ESC04: ACOS 18, 3 diretas + 2 indiretas
  ...dias('2027-02-01', 8).map((d, k) => met('mercadolivre', 'MLP6', d, k < 6 ? 15 : 30, 2.5)), // PRI06: 150 cliques, R$ 20, 8 dias
  ...dias('2027-02-10', 10).map((d) => met('mercadolivre', 'MLP7', d, 3, 6)),                 // PSD07: como PAU01, mas pausado
  met('mercadolivre', 'MLM8', '2027-02-13', 20, 50, 200, 2),                                    // MAN08: ACOS 25
  met('mercadolivre', 'MLS9', '2027-02-14', 20, 40, 100, 1),                                    // SCU09: sem custo, ACOS 40
  ...dias('2027-02-20', 3).map((d) => met('mercadolivre', 'MLO10', d, 1, 20)),                // POU10: R$ 60 em so 3 dias
  ...dias('2027-01-05', 10).map((d) => met('mercadolivre', 'MLW11', d, 3, 10)),               // WIN11: so fora da janela
  ...dias('2027-02-01', 8).map((d) => met('shopee', 'SHX', d, 2, 3.75)),                      // SHP12 (Shopee): R$ 30, 8 dias
];
await db.exec(`
delete from mkt.order_items; delete from mkt.orders; delete from mkt.item_variations; delete from mkt.items;
delete from mkt.ads_metrics_daily; delete from mkt.ads_campaigns; delete from mkt.ads_anuncios; delete from mkt.ads_campaign_daily;
delete from mkt.billing_details; delete from map.modelo_de_para; delete from core.ads_modo; delete from erp.cost_tiers;
insert into erp.cost_tiers (product_id, qty_start, qty_end, price, created_at, source) values
 ('RED02',1,49,70,'2026-01-01','erp'), ('REV03',1,49,25,'2026-01-01','erp'), ('ESC04',1,49,70,'2026-01-01','erp'),
 ('MAN08',1,49,70,'2026-01-01','erp'), ('TES05',1,49,75,'2026-01-01','erp'), ('PAU01',1,49,10,'2026-01-01','erp'),
 ('PRI06',1,49,10,'2026-01-01','erp'), ('PSD07',1,49,10,'2026-01-01','erp'), ('POU10',1,49,10,'2026-01-01','erp'),
 ('WIN11',1,49,10,'2026-01-01','erp');
insert into mkt.orders (channel, order_id, status, date_created, date_closed, total_amount, raw) values
 ('mercadolivre','R1','paid','2027-02-10 12:00+00','2027-02-10 12:00+00',100,'{}'),
 ('mercadolivre','V1','paid','2027-02-11 12:00+00','2027-02-11 12:00+00',50,'{}'),
 ('mercadolivre','E1','paid','2027-02-12 12:00+00','2027-02-12 12:00+00',500,'{}'),
 ('mercadolivre','M1','paid','2027-02-13 12:00+00','2027-02-13 12:00+00',200,'{}'),
 ('mercadolivre','S1','paid','2027-02-14 12:00+00','2027-02-14 12:00+00',100,'{}'),
 ('mercadolivre','T1','paid','2027-02-15 12:00+00','2027-02-15 12:00+00',400,'{}');
insert into mkt.order_items (channel, order_id, line_no, item_id, sku, title, quantity, unit_price) values
 ('mercadolivre','R1',1,'MLR2','RED02-AZU','Red',1,100), ('mercadolivre','V1',1,'MLV3','REV03-AZU','Rev',1,50),
 ('mercadolivre','E1',1,'MLE4','ESC04-AZU','Esc',5,100), ('mercadolivre','M1',1,'MLM8','MAN08-AZU','Man',2,100),
 ('mercadolivre','S1',1,'MLS9','SCU09-AZU','Scu',1,100), ('mercadolivre','T1',1,'MLT5','TES05-AZU','Tes',4,100);
insert into mkt.items (channel, item_id, title, sku) values
 ('mercadolivre','MLP1','Pau','PAU01-AZU'), ('mercadolivre','MLP6','Pri','PRI06-AZU'), ('mercadolivre','MLP7','Psd','PSD07-AZU'),
 ('mercadolivre','MLO10','Pou','POU10-AZU'), ('mercadolivre','MLW11','Win','WIN11-AZU'), ('shopee','SHX','Shp','SHP12-X');
insert into mkt.ads_anuncios (channel, item_id, campaign_id, status) values
 ('mercadolivre','MLP7',null,'paused'), ('mercadolivre','MLM8','c9','active');
insert into mkt.ads_campaigns (channel, campaign_id, name, status) values ('mercadolivre','c9','Campanha 9','active');
insert into mkt.ads_campaign_daily (channel, campaign_id, day, cost) values ('mercadolivre','c9','2027-02-10',100);
insert into mkt.ads_metrics_daily (channel, item_id, day, campaign_id, impressions, clicks, cost, direct_amount, indirect_amount, direct_units, indirect_units, organic_units) values
 ${metUS2.join(',\n ')};
`);
const FEV = ['2027-02-01', '2027-02-28'];
const ord = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => a[0].localeCompare(b[0])));
const porModelo = (lst) => ord(Object.fromEntries(lst.filter((m) => m.modelo).map((m) => [m.modelo, m.sugestao])));
const sug = async (c, de = FEV[0], ate = FEV[1]) => porModelo(await modelos(c, de, ate));
const mf = await modelos('mercadolivre', ...FEV);
const motivo = (mod) => mf.find((m) => m.modelo === mod)?.motivo;
eq('US2: universo de fevereiro (WIN11 so tem Ads fora do periodo)', mf.map((m) => m.modelo).filter(Boolean).sort(),
  ['ESC04', 'MAN08', 'PAU01', 'POU10', 'PRI06', 'PSD07', 'RED02', 'REV03', 'SCU09', 'TES05']);
eq('US2: uma sugestao por modelo', porModelo(mf), ord({
  PAU01: 'pausar', RED02: 'reduzir', REV03: 'revisar', ESC04: 'escalar', TES05: 'testar', PRI06: 'pausar',
  PSD07: null, MAN08: 'manter', SCU09: 'manter', POU10: 'manter',
}));
eq('cenario 1: Pausar com o motivo', [mf.find((m) => m.modelo === 'PAU01').sugestao, motivo('PAU01')], ['pausar', 'gastou R$ 60,00 em 30 dias sem venda']);
eq('cenario 2: Reduzir (ACOS acima do equilibrio)', [mf.find((m) => m.modelo === 'RED02').sugestao, motivo('RED02')], ['reduzir', 'ACOS 35,00% acima do equilíbrio 30,00%']);
eq('cenario 3: Revisar anuncio (cliques e conversao baixa)', [mf.find((m) => m.modelo === 'REV03').sugestao, motivo('REV03')],
  ['revisar', '200 cliques e conversão 0,50% (abaixo de 1,00%)']);
eq('cenario 4: Escalar (12 pontos abaixo, 5 unidades por Ads: diretas + indiretas)', [mf.find((m) => m.modelo === 'ESC04').sugestao, motivo('ESC04')],
  ['escalar', 'ACOS 18,00% bem abaixo do equilíbrio 30,00% com 5 unidades vendidas por Ads']);
eq('cenario 5: Testar Ads (sem Ads, margem 25%, 4 unidades pagas) aparece na tabela zerado',
  (({ modelo, inv, cli, un, sugestao, motivo: mt }) => ({ modelo, inv, cli, un, sugestao, mt }))(mf.find((m) => m.modelo === 'TES05')),
  { modelo: 'TES05', inv: 0, cli: 0, un: 0, sugestao: 'testar', mt: 'margem 25,00% e 4 unidades vendidas sem Ads' });
eq('cenario 6: Pausar prevalece sobre Revisar (150 cliques, 0 venda, 8 dias)', [mf.find((m) => m.modelo === 'PRI06').sugestao, motivo('PRI06')],
  ['pausar', '150 cliques em 30 dias sem venda (gastou R$ 20,00)']);
eq('cenario 7: anuncio pausado -> pausado e sem sugestao nem motivo', (({ pausado, sugestao, motivo: mt }) => ({ pausado, sugestao, mt }))(mf.find((m) => m.modelo === 'PSD07')),
  { pausado: true, sugestao: null, mt: null });
await db.exec(`update mkt.ads_campaigns set status = 'paused' where campaign_id = 'c9'`);
eq('cenario 7: campanha pausada -> pausado e sem sugestao', (await modelos('mercadolivre', ...FEV)).filter((m) => m.modelo === 'MAN08').map((m) => [m.pausado, m.sugestao, m.motivo]),
  [[true, null, null]]);
await db.exec(`update mkt.ads_campaigns set status = 'active' where campaign_id = 'c9'`);
eq('poucos dias com dados: nao pausa (R$ 60 em 3 dias) -> Manter', [mf.find((m) => m.modelo === 'POU10').sugestao, motivo('POU10')],
  ['manter', 'gastou R$ 60,00 em 30 dias sem venda, mas só 3 dias com dados; mínimo 7']);
eq('Manter: motivo diz por que (sem folga para escalar)', motivo('MAN08'), 'ACOS 25,00% dentro do equilíbrio 30,00%, sem folga de 10,00 pontos para escalar');
eq('Manter sem custo: motivo', motivo('SCU09'), 'sem custo cadastrado, sem ACOS de equilíbrio: investiu R$ 40,00 em 30 dias e vendeu 1 unidades por Ads');
eq('modelo sem custo: so Pausar/Revisar/Manter (ACOS 40 nao vira Reduzir)', [mf.find((m) => m.modelo === 'SCU09').sugestao, /sem custo/.test(motivo('SCU09'))], ['manter', true]);
eq('linha nao atribuido sem sugestao', mf.filter((m) => m.modelo === null).map((m) => [m.sugestao, m.motivo]), [[null, null]]);

// Entradas da sugestao (ads_sugestoes)
const SUG = `select modelo, canal, sugestao, investimento_30d::float as inv, cliques_30d::float as cli, unidades_ads_30d::float as un,
  conversao_30d::float as conv, acos_30d::float as acos, acos_equilibrio_30d::float as eqb, contribuicao_pct_30d::float as cpct,
  unidades_pagas_30d::float as pagas, dias_com_dados as dias, pausado
  from analytics.ads_sugestoes($1, $2::date) order by modelo`;
const sf = await rows(SUG, ['mercadolivre', FEV[1]]);
eq('ads_sugestoes: entradas de ESC04', sf.find((s) => s.modelo === 'ESC04'),
  { modelo: 'ESC04', canal: 'mercadolivre', sugestao: 'escalar', inv: 90, cli: 50, un: 5, conv: 10, acos: 18, eqb: 30, cpct: 30, pagas: 5, dias: 1, pausado: false });
eq('ads_sugestoes: entradas de TES05 (sem Ads)', sf.find((s) => s.modelo === 'TES05'),
  { modelo: 'TES05', canal: 'mercadolivre', sugestao: 'testar', inv: 0, cli: 0, un: 0, conv: null, acos: null, eqb: 25, cpct: 25, pagas: 4, dias: 0, pausado: false });
eq('ads_sugestoes: dias com dados e pausado', sf.filter((s) => ['PAU01', 'PRI06', 'PSD07', 'POU10'].includes(s.modelo)).map((s) => [s.modelo, s.dias, s.pausado, s.sugestao]),
  [['PAU01', 10, false, 'pausar'], ['POU10', 3, false, 'manter'], ['PRI06', 8, false, 'pausar'], ['PSD07', 10, true, null]]);
eq('ads_sugestoes: equilibrio de 30 dias = ads_modelos quando o periodo e a janela',
  sf.filter((s) => s.eqb !== null).map((s) => [s.modelo, s.eqb]),
  (await modelos('mercadolivre', '2027-01-30', FEV[1])).filter((m) => m.modelo && m.eqb !== null).map((m) => [m.modelo, m.eqb]).sort((a, b) => a[0].localeCompare(b[0])));

// Janela de 30 dias ate p_ate (R4), nao o periodo
const curto = await modelos('mercadolivre', '2027-02-20', FEV[1]);
eq('janela: periodo curto ainda usa os 30 dias (RED02 so vendeu na janela -> Reduzir; POU10 -> Manter)',
  curto.filter((m) => m.modelo).map((m) => [m.modelo, m.sugestao]).sort((a, b) => a[0].localeCompare(b[0])),
  [['ESC04', 'escalar'], ['MAN08', 'manter'], ['POU10', 'manter'], ['RED02', 'reduzir'], ['REV03', 'revisar'], ['SCU09', 'manter'], ['TES05', 'testar']]);
eq('janela: modelo com Ads so fora dos 30 dias fica sem sugestao', (await modelos('mercadolivre', '2027-01-01', FEV[1])).filter((m) => m.modelo === 'WIN11').map((m) => [m.inv, m.sugestao, m.motivo]),
  [[100, null, null]]);
eq('janela: p_ate mais tarde (so 1 dia de PAU01 na janela) -> Manter', (await rows(SUG, ['mercadolivre', '2027-03-20'])).filter((s) => s.modelo === 'PAU01').map((s) => [s.inv, s.dias, s.sugestao]),
  [[6, 1, 'manter']]);

// Limites lidos da vigencia em p_ate
await db.exec(`insert into core.parametros_ads (channel, vigente_desde, pausar_gasto_min, escalar_unidades_min) values ('mercadolivre', '2027-02-20', 70, 6)`);
eq('limites: nova vigencia muda o resultado (gasto minimo 70, unidades para escalar 6)', await sug('mercadolivre'), ord({
  PAU01: 'manter', RED02: 'reduzir', REV03: 'revisar', ESC04: 'manter', TES05: 'testar', PRI06: 'pausar',
  PSD07: null, MAN08: 'manter', SCU09: 'manter', POU10: 'manter',
}));
eq('Manter: Escalar barrado pelas unidades diz o minimo', (await modelos('mercadolivre', ...FEV)).filter((m) => m.modelo === 'ESC04').map((m) => [m.sugestao, m.motivo]),
  [['manter', 'ACOS 18,00% bem abaixo do equilíbrio 30,00%, mas só 5 unidades vendidas por Ads; mínimo 6']]);
eq('limites: p_ate antes da nova vigencia usa a anterior', (await rows(SUG, ['mercadolivre', '2027-02-19'])).filter((s) => ['PAU01', 'ESC04'].includes(s.modelo)).map((s) => [s.modelo, s.sugestao]),
  [['ESC04', 'escalar'], ['PAU01', 'pausar']]);
await db.exec(`delete from core.parametros_ads where channel = 'mercadolivre' and vigente_desde = '2027-02-20'`);
await db.exec(`insert into core.parametros_ads (channel, vigente_desde, revisar_conversao_max_pct, testar_unidades_min) values ('mercadolivre', '2027-02-20', 0.4, 5)`);
eq('limites: conversao maxima 0,4% e 5 unidades para testar', [(await sug('mercadolivre')).REV03, (await sug('mercadolivre')).TES05], ['manter', 'manter']);
eq('Manter: Testar barrado pelas unidades diz o minimo', (await modelos('mercadolivre', ...FEV)).filter((m) => m.modelo === 'TES05').map((m) => m.motivo),
  ['sem Ads em 30 dias: margem 25,00%, mas só 4 unidades vendidas; mínimo 5 para testar']);
await db.exec(`delete from core.parametros_ads where channel = 'mercadolivre' and vigente_desde = '2027-02-20'`);

// Consolidado: limites do canal de cada linha
eq('consolidado sem vigencia propria da Shopee: SHP12 (R$ 30) mantem', (await sug('consolidado')).SHP12, 'manter');
await db.exec(`insert into core.parametros_ads (channel, vigente_desde, pausar_gasto_min) values ('shopee', '2027-02-01', 20)`);
const cf = await modelos('consolidado', ...FEV);
eq('consolidado: SHP12 usa o limite da Shopee (20) -> Pausar', cf.filter((m) => m.modelo === 'SHP12').map((m) => [m.sugestao, m.motivo]),
  [['pausar', 'gastou R$ 30,00 em 30 dias sem venda']]);
eq('consolidado: modelos do ML com o limite do ML (iguais ao canal ML)', porModelo(cf.filter((m) => m.modelo !== 'SHP12')), porModelo(mf));
eq('shopee: limite da Shopee', (await sug('shopee')).SHP12, 'pausar');
await db.exec(`delete from core.parametros_ads where channel = 'shopee' and vigente_desde = '2027-02-01'`);

// Sem custos (FR-009): so Pausar/Revisar ou nulo, como authenticated
await perfil('comercial');
const semCustos = await comoAuth(() => modelos('mercadolivre', ...FEV));
eq('FR-009: comercial (authenticated) so ve Pausar/Revisar; o resto nulo', porModelo(semCustos), ord({
  PAU01: 'pausar', RED02: null, REV03: 'revisar', ESC04: null, TES05: null, PRI06: 'pausar',
  PSD07: null, MAN08: null, SCU09: null, POU10: null,
}));
eq('FR-009: sem sugestao, sem motivo', semCustos.filter((m) => m.sugestao === null).every((m) => m.motivo === null), true);
eq('FR-009: motivo de Pausar com os numeros tambem para o comercial', semCustos.find((m) => m.modelo === 'PAU01').motivo, 'gastou R$ 60,00 em 30 dias sem venda');
eq('FR-009: ads_sugestoes sem equilibrio nem margem', (await comoAuth(() => rows(SUG, ['mercadolivre', FEV[1]]))).every((s) => s.eqb === null && s.cpct === null), true);
await perfil('gestor');
eq('gestor (authenticated, com custos): mesmas sugestoes do admin', await comoAuth(() => sug('mercadolivre')), porModelo(mf));
await perfil('visualizador');
eq('ads_sugestoes sem a permissao ads: nada', await comoAuth(() => rows(SUG, ['mercadolivre', FEV[1]])), []);
await perfil('admin');
// Sem linha de limites vigente em p_ate (uma so regra de resolucao: ads_parametros): sugestao nula
await db.exec(`update core.parametros_ads set vigente_desde = '2027-03-15' where channel = 'mercadolivre' and vigente_desde = '2025-01-01'`);
eq('sem limites vigentes em p_ate: sugestao e motivo nulos', (await modelos('mercadolivre', ...FEV)).every((m) => m.sugestao === null && m.motivo === null), true);
await db.exec(`update core.parametros_ads set vigente_desde = '2025-01-01' where channel = 'mercadolivre' and vigente_desde = '2027-03-15'`);
eq('limites restaurados', (await sug('mercadolivre')).PAU01, 'pausar');

// Limites exatos e sobreposicao de regras (abril/2027, janela 01-30/04; limites da semente)
const metABR = [
  ...dias('2027-04-01', 7).map((d, k) => met('mercadolivre', 'MLN1', d, 1, k < 6 ? 7 : 8)),     // BND01: gasto 50 em 7 dias
  ...dias('2027-04-01', 7).map((d, k) => met('mercadolivre', 'MLN2', d, k < 6 ? 14 : 16, 1)),   // BND02: 100 cliques em 7 dias
  met('mercadolivre', 'MLN3', '2027-04-10', 100, 10, 50, 1),                                    // BND03: conversao 1,00
  met('mercadolivre', 'MLN4', '2027-04-10', 20, 30, 100, 1),                                    // BND04: ACOS 30 = equilibrio 30
  met('mercadolivre', 'MLN5', '2027-04-10', 30, 60, 300, 3),                                    // BND05: ACOS 20 = equilibrio 30 - 10, 3 unidades
  ...dias('2027-04-01', 6).map((d, k) => met('mercadolivre', 'MLN8', d, 1, k < 5 ? 8 : 10)),    // BND08: gasto 50 em 6 dias
  met('mercadolivre', 'MLN9', '2027-04-10', 200, 40, 100, 1),                                   // BND09: Reduzir e Revisar
  met('mercadolivre', 'MLN10', '2027-04-10', 400, 45, 300, 3),                                  // BND10: Revisar e Escalar
];
await db.exec(`
insert into erp.cost_tiers (product_id, qty_start, qty_end, price, created_at, source) values
 ('BND03',1,49,25,'2026-01-01','erp'), ('BND04',1,49,70,'2026-01-01','erp'), ('BND05',1,49,70,'2026-01-01','erp'),
 ('BND06',1,49,80,'2026-01-01','erp'), ('BND07',1,49,80,'2026-01-01','erp'), ('BND09',1,49,70,'2026-01-01','erp'),
 ('BND10',1,49,70,'2026-01-01','erp');
insert into mkt.orders (channel, order_id, status, date_created, date_closed, total_amount, raw) values
 ('mercadolivre','N3','paid','2027-04-10 12:00+00','2027-04-10 12:00+00',50,'{}'),
 ('mercadolivre','N4','paid','2027-04-10 12:00+00','2027-04-10 12:00+00',100,'{}'),
 ('mercadolivre','N5','paid','2027-04-10 12:00+00','2027-04-10 12:00+00',300,'{}'),
 ('mercadolivre','N6','paid','2027-04-10 12:00+00','2027-04-10 12:00+00',300,'{}'),
 ('mercadolivre','N7','paid','2027-04-10 12:00+00','2027-04-10 12:00+00',200,'{}'),
 ('mercadolivre','N9','paid','2027-04-10 12:00+00','2027-04-10 12:00+00',100,'{}'),
 ('mercadolivre','N10','paid','2027-04-10 12:00+00','2027-04-10 12:00+00',300,'{}');
insert into mkt.order_items (channel, order_id, line_no, item_id, sku, title, quantity, unit_price) values
 ('mercadolivre','N3',1,'MLN3','BND03-AZU','b3',1,50), ('mercadolivre','N4',1,'MLN4','BND04-AZU','b4',1,100),
 ('mercadolivre','N5',1,'MLN5','BND05-AZU','b5',3,100), ('mercadolivre','N6',1,'MLN6','BND06-AZU','b6',3,100),
 ('mercadolivre','N7',1,'MLN7','BND07-AZU','b7',2,100), ('mercadolivre','N9',1,'MLN9','BND09-AZU','b9',1,100),
 ('mercadolivre','N10',1,'MLN10','BND10-AZU','b10',3,100);
insert into mkt.items (channel, item_id, title, sku) values
 ('mercadolivre','MLN1','b1','BND01-AZU'), ('mercadolivre','MLN2','b2','BND02-AZU'), ('mercadolivre','MLN8','b8','BND08-AZU');
insert into mkt.ads_metrics_daily (channel, item_id, day, campaign_id, impressions, clicks, cost, direct_amount, indirect_amount, direct_units, indirect_units, organic_units) values
 ${metABR.join(',\n ')};
`);
const ABR = ['2027-04-01', '2027-04-30'];
const ab = await modelos('mercadolivre', ...ABR);
const abm = (mod) => ab.filter((m) => m.modelo === mod).map((m) => [m.sugestao, m.motivo])[0];
eq('limite: gasto = 50 e dias = 7 -> Pausar', abm('BND01'), ['pausar', 'gastou R$ 50,00 em 30 dias sem venda']);
eq('limite: cliques = 100 (7 dias) -> Pausar', abm('BND02'), ['pausar', '100 cliques em 30 dias sem venda (gastou R$ 7,00)']);
eq('limite: conversao = 1,00% nao e Revisar', abm('BND03')[0], 'manter');
eq('limite: ACOS = equilibrio nao e Reduzir', abm('BND04'), ['manter', 'ACOS 30,00% dentro do equilíbrio 30,00%, sem folga de 10,00 pontos para escalar']);
eq('limite: ACOS = equilibrio - 10 com 3 unidades -> Escalar', abm('BND05'), ['escalar', 'ACOS 20,00% bem abaixo do equilíbrio 30,00% com 3 unidades vendidas por Ads']);
eq('limite: margem = 20% e 3 unidades pagas sem Ads -> Testar', abm('BND06'), ['testar', 'margem 20,00% e 3 unidades vendidas sem Ads']);
eq('limite: margem 20% e 2 unidades pagas -> Manter', abm('BND07'), ['manter', 'sem Ads em 30 dias: margem 20,00%, mas só 2 unidades vendidas; mínimo 3 para testar']);
eq('limite: gasto 50 em 6 dias -> Manter (minimo 7 dias)', abm('BND08'), ['manter', 'gastou R$ 50,00 em 30 dias sem venda, mas só 6 dias com dados; mínimo 7']);
eq('prioridade: Reduzir > Revisar', abm('BND09'), ['reduzir', 'ACOS 40,00% acima do equilíbrio 30,00%']);
eq('prioridade: Revisar > Escalar', abm('BND10'), ['revisar', '400 cliques e conversão 0,75% (abaixo de 1,00%)']);
await perfil('comercial');
const abCom = await comoAuth(() => modelos('mercadolivre', ...ABR));
eq('FR-009 sem custos: Reduzir que tambem cumpre Revisar aparece como Revisar (o CASE segue)',
  abCom.filter((m) => ['BND09', 'BND10', 'BND05'].includes(m.modelo)).map((m) => [m.modelo, m.sugestao]).sort((a, b) => a[0].localeCompare(b[0])),
  [['BND05', null], ['BND09', 'revisar'], ['BND10', 'revisar']]);
await perfil('admin');

eq('ads_fmt: stable', await val(`select provolatile from pg_proc where proname = 'ads_fmt'`), 's');
eq('ads_sugestoes: invoker', await val(`select prosecdef from pg_proc where proname = 'ads_sugestoes'`), false);
await db.exec(mig('0019_ads_funcoes.sql'));
eq('0019 reexecutavel com as sugestoes', (await sug('mercadolivre')).ESC04, 'escalar');

// =====================================================================
// US3 (T025): ads_orcamento - orcamento do mes corrente (novembro/2026, 30 dias; dezembro, 31 dias)
//   ML conectado; Shopee com conta inativa (nao conectada). Orcamento ML: nov 5.000 (semente), dez 6.000.
//   Product Ads (API, mesmo criterio de dash_ads_periodo): 01/11 1.000, 10/11 1.500, 30/11 200, 01/12 7.000.
//   Seguidores (fatura CDLIT, data_ref = cobranca - 1 dia): 500 em 15/11 (cobrado 16/11), 50 em 30/11 (cobrado 01/12).
// =====================================================================
await perfil('admin'); await canais('mercadolivre,shopee');
await db.exec(`
insert into core.accounts (channel, external_id, active) values ('mercadolivre', 'ml1', true), ('shopee', 'sh1', false);
insert into core.orcamento_ads (channel, vigente_desde, valor_mensal) values ('mercadolivre', '2026-12-01', 6000);
insert into mkt.ads_campaign_daily (channel, campaign_id, day, cost) values
 ('mercadolivre','c1','2026-11-01',1000), ('mercadolivre','c1','2026-11-10',1500), ('mercadolivre','c1','2026-11-30',200),
 ('mercadolivre','c1','2026-12-01',7000);
insert into mkt.billing_details (period_key, detail_id, created_at, detail_type, code, amount, order_id) values
 ('2026-11','s1','2026-11-16 06:00+00','CHARGE','CDLIT',500,null),
 ('2026-12','s2','2026-12-01 06:00+00','CHARGE','CDLIT',50,null);
`);
const ORC = `select canal, orcamento::float as orc, gasto_mes::float as gasto, gasto_product_ads::float as pa, gasto_seguidores::float as seg,
  gasto_ate_ontem::float as ontem, dias_mes, dias_completos, dias_restantes, pct_gasto::float as pg, pct_mes::float as pm,
  projecao::float as proj, saldo::float, valor_diario::float as vd, alerta from analytics.ads_orcamento($1, $2::date)`;
const orc = (c, d) => rows(ORC, [c, d]);
const ML18 = {
  canal: 'mercadolivre', orc: 5000, gasto: 3000, pa: 2500, seg: 500, ontem: 3000, dias_mes: 30, dias_completos: 17, dias_restantes: 13,
  pg: 60, pm: 56.67, proj: 5294.12, saldo: 2000, vd: 153.85, alerta: 'estouro',
};
eq('teste independente: dia 18/30, 3.000 ate o dia 17, orcamento 5.000 -> projecao 5.294,12, estouro, diario 153,85',
  await orc('mercadolivre', '2026-11-18'), [ML18]);
eq('sobra (< 80%) e gasto de hoje fora da projecao (dia 10)', await orc('mercadolivre', '2026-11-10'), [{
  canal: 'mercadolivre', orc: 5000, gasto: 2500, pa: 2500, seg: 0, ontem: 1000, dias_mes: 30, dias_completos: 9, dias_restantes: 21,
  pg: 50, pm: 30, proj: 3333.33, saldo: 2500, vd: 119.05, alerta: 'sobra',
}]);
eq('dentro da faixa (80% a 100%): sem alerta', (await orc('mercadolivre', '2026-11-20')).map((r) => [r.proj, r.alerta]), [[4736.84, null]]);
eq('1o dia: sem projecao nem alerta', await orc('mercadolivre', '2026-11-01'), [{
  canal: 'mercadolivre', orc: 5000, gasto: 1000, pa: 1000, seg: 0, ontem: 0, dias_mes: 30, dias_completos: 0, dias_restantes: 30,
  pg: 20, pm: 0, proj: null, saldo: 4000, vd: 133.33, alerta: null,
}]);
eq('ultimo dia: 1 dia restante; Seguidores cobrado em 01/12 conta em 30/11', await orc('mercadolivre', '2026-11-30'), [{
  canal: 'mercadolivre', orc: 5000, gasto: 3250, pa: 2700, seg: 550, ontem: 3000, dias_mes: 30, dias_completos: 29, dias_restantes: 1,
  pg: 65, pm: 96.67, proj: 3103.45, saldo: 1750, vd: 1750, alerta: 'sobra',
}]);
eq('orcamento esgotado (dezembro, vigencia 6.000): saldo e diario zero, estouro', await orc('mercadolivre', '2026-12-05'), [{
  canal: 'mercadolivre', orc: 6000, gasto: 7000, pa: 7000, seg: 0, ontem: 7000, dias_mes: 31, dias_completos: 4, dias_restantes: 27,
  pg: 116.67, pm: 12.9, proj: 54250, saldo: 0, vd: 0, alerta: 'estouro',
}]);
eq('vigencia: novembro 5.000, dezembro 6.000', [(await orc('mercadolivre', '2026-11-30'))[0].orc, (await orc('mercadolivre', '2026-12-01'))[0].orc], [5000, 6000]);
eq('sem orcamento vigente: orcamento, %, saldo, diario e alerta nulos', (await orc('mercadolivre', '2026-05-15')).map((r) =>
  [r.orc, r.gasto, r.pg, r.saldo, r.vd, r.alerta, r.proj]), [[null, 0, null, null, null, null, 0]]);
// Limite de sobra vem de core.parametros_ads (vigente em p_hoje)
await db.exec(`insert into core.parametros_ads (channel, vigente_desde, alerta_sobra_pct) values ('mercadolivre', '2026-11-20', 95)`);
eq('alerta_sobra_pct vigente (95%): 4.736,84 < 4.750 -> sobra', (await orc('mercadolivre', '2026-11-20')).map((r) => r.alerta), ['sobra']);
eq('alerta_sobra_pct anterior (80%) ainda vale antes da vigencia', (await orc('mercadolivre', '2026-11-10')).map((r) => r.alerta), ['sobra']);
await db.exec(`delete from core.parametros_ads where channel = 'mercadolivre' and vigente_desde = '2026-11-20'`);

// Consolidado: so contas conectadas (core.accounts ativa)
eq('consolidado: so o ML conectado (Shopee inativa fica fora)', await orc('consolidado', '2026-11-18'), [ML18, { ...ML18, canal: 'consolidado' }]);
eq('canal Shopee nao conectado: nada', await orc('shopee', '2026-11-18'), []);
await db.exec(`update core.accounts set active = true where channel = 'shopee'`);
eq('consolidado com a Shopee conectada: soma os dois orcamentos', (await orc('consolidado', '2026-11-18')).map((r) => [r.canal, r.orc, r.gasto, r.seg, r.proj, r.saldo, r.vd, r.alerta]), [
  ['mercadolivre', 5000, 3000, 500, 5294.12, 2000, 153.85, 'estouro'],
  ['shopee', 6000, 0, 0, 0, 6000, 461.54, 'sobra'],
  ['consolidado', 11000, 3000, 500, 5294.12, 8000, 615.38, 'sobra'],
]);
await db.exec(`update core.accounts set active = false where channel = 'shopee'`);
eq('canal invalido: nada', await orc('brindedobem', '2026-11-18'), []);

// Permissoes (como authenticated): comercial (ads sem custos) ve; sem ads nada; canal nao liberado nada
await perfil('comercial');
eq('comercial (sem custos, authenticated): mesmos numeros, com Seguidores da fatura', await comoAuth(() => orc('consolidado', '2026-11-18')),
  [ML18, { ...ML18, canal: 'consolidado' }]);
await perfil('visualizador');
eq('sem a permissao ads: nada', await comoAuth(() => orc('consolidado', '2026-11-18')), []);
await perfil('gestor'); await canais('shopee');
eq('ML nao liberado: nada (Shopee nao conectada)', await comoAuth(() => orc('consolidado', '2026-11-18')), []);
await canais('crm');
eq('nenhum canal liberado: nada', await comoAuth(() => orc('mercadolivre', '2026-11-18')), []);
await perfil('admin'); await canais('mercadolivre,shopee');
eq('p_hoje nulo = hoje em Brasilia', await rows(`select dias_completos = extract(day from (now() at time zone 'America/Sao_Paulo'))::int - 1 as ok,
  dias_mes = extract(day from date_trunc('month', (now() at time zone 'America/Sao_Paulo')) + interval '1 month - 1 day')::int as ok2
  from analytics.ads_orcamento('mercadolivre')`), [{ ok: true, ok2: true }]);
eq('ads_orcamento: security definer, execucao so para authenticated', await rows(`select prosecdef,
  has_function_privilege('anon', 'analytics.ads_orcamento(text, date)', 'execute') as anon,
  has_function_privilege('authenticated', 'analytics.ads_orcamento(text, date)', 'execute') as auth
  from pg_proc where proname = 'ads_orcamento'`), [{ prosecdef: true, anon: false, auth: true }]);
await db.exec(mig('0019_ads_funcoes.sql'));
eq('0019 reexecutavel com o orcamento', await orc('mercadolivre', '2026-11-18'), [ML18]);

console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
process.exit(fails ? 1 : 0);
