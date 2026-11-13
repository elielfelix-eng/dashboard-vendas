import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Funcoes do dashboard (migration 0009): base de pedidos, custos do periodo, resumo, serie, modelos, SKUs, pedidos.
const repo = fileURLToPath(new URL('../..', import.meta.url));
const db = new PGlite();
let fails = 0;
const eq = (label, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  if (!ok) fails++;
  console.log(`${ok ? 'OK  ' : 'FALHA'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (esperado ${JSON.stringify(exp)})`}`);
};
const mig = (f) => readFileSync(`${repo}/supabase/migrations/${f}`, 'utf8');
await db.exec(readFileSync(`${repo}/supabase/tests/stubs.sql`, 'utf8'));
for (const f of ['0002_marketplaces.sql', '0003_regras_v1.sql', '0006_custo_por_cotacao.sql', '0007_de_para_modelo.sql',
  '0008_dashboard_admin.sql', '0009_dashboard_funcoes.sql', '0009_dashboard_funcoes.sql', '0010_dashboard_metas.sql',
  '0011_rls_desempenho.sql', '0011_rls_desempenho.sql'])
  await db.exec(mig(f));
console.log('Migrations 0002..0011 aplicadas (0009 e 0011 x2)');

await db.exec(`create or replace function core.my_role() returns core.app_role language sql as $$ select coalesce(nullif(current_setting('teste.perfil', true), ''), 'admin')::core.app_role $$`);
const perfil = (p) => db.exec(`set teste.perfil = '${p}'`);
const rows = async (sql, p = []) => (await db.query(sql, p)).rows;

// Mesmo cenario de regras-v1.test.mjs (pedidos 1-8, fatura, Ads)
await db.exec(`
insert into erp.cost_tiers (product_id, qty_start, qty_end, price, created_at, source) values ('BLA68', 1, 49, 4.00, '2026-01-01', 'erp');
insert into mkt.orders (channel, order_id, status, date_created, date_closed, total_amount, shipment_id, shipping_cost_seller, raw, shipment_status, shipment_substatus) values
 ('mercadolivre','1','paid','2026-10-01 02:00+00','2026-10-01 02:30+00', 100, 's1', 12.5, '{}', null, null),
 ('mercadolivre','2','paid','2026-10-10 12:00+00','2026-10-10 12:00+00', 60,  's2', 10, '{}', null, null),
 ('mercadolivre','3','cancelled','2026-10-11 12:00+00','2026-10-11 12:00+00', 50, 's3', null, '{"cancel_detail":{"code":"pack_splitted"}}', null, null),
 ('mercadolivre','4','cancelled','2026-10-12 12:00+00','2026-10-12 12:00+00', 70, 's4', null, '{}', 'delivered', null),
 ('mercadolivre','5','cancelled','2026-10-13 12:00+00','2026-10-13 12:00+00', 30, 's5', null, '{}', 'cancelled', null),
 ('mercadolivre','6','cancelled','2026-10-14 12:00+00','2026-10-14 12:00+00', 20, 's6', null, '{}', 'not_delivered', 'returned');
insert into mkt.order_items (channel, order_id, line_no, item_id, sku, title, quantity, unit_price, sale_fee) values
 ('mercadolivre','1',1,'MLB1','BLA68-AMA-K0010-V1','x',2,50, 6),
 ('mercadolivre','2',1,'MLB2','GFT10-AZU','y',3,20, 0),
 ('mercadolivre','3',1,'MLB2','GFT10-AZU','y',1,50, 0),
 ('mercadolivre','4',1,'MLB2','GFT10-AZU','y',1,70, 0),
 ('mercadolivre','5',1,'MLB2','GFT10-AZU','y',1,30, 0),
 ('mercadolivre','6',1,'MLB2','GFT10-AZU','y',1,20, 0);
insert into mkt.billing_details (period_key, detail_id, created_at, detail_type, code, amount, order_id) values
 ('2026-10','a','2026-10-11 10:00+00','CHARGE','CVVML', 7.20, '2'),
 ('2026-10','b','2026-10-11 10:00+00','CHARGE','CXDE', 15.00, '2'),
 ('2026-10','c','2026-10-11 10:00+00','BONUS','BXDE', 5.00, '2'),
 ('2026-10','d','2026-10-02 06:00+00','CHARGE','PADS', 40.00, null),
 ('2026-10','e','2026-10-21 06:00+00','CHARGE','PADS', 99.00, null),
 ('2026-10','f','2026-10-05 06:00+00','CHARGE','CDLIT', 8.00, null),
 ('2026-10','g','2026-10-06 06:00+00','BONUS','BPAD', 3.00, null),
 ('2026-10','h','2026-10-07 06:00+00','CHARGE','CDIFAL', 2.00, null),
 ('2026-10','i','2026-10-07 06:00+00','CHARGE','CESM', 1.00, null);
insert into mkt.ads_campaign_daily (campaign_id, day, cost) values ('c1','2026-10-20', 30), ('c1','2026-10-21', 25), ('c2','2026-10-21', 5);
insert into mkt.orders (channel, order_id, status, date_created, date_closed, total_amount, shipment_id, shipping_cost_seller, raw) values
 ('mercadolivre','7','paid','2026-08-10 12:00+00','2026-08-10 12:00+00', 10, 's7', 50, '{}'),
 ('mercadolivre','8','paid','2026-08-10 12:00+00','2026-08-10 12:00+00', 10, 's7', 50, '{}');
insert into mkt.order_items (channel, order_id, line_no, item_id, sku, title, quantity, unit_price, sale_fee) values
 ('mercadolivre','7',1,'MLB2','GFT10-AZU','y',1,10,0), ('mercadolivre','8',1,'MLB2','GFT10-AZU','y',1,10,0);
insert into mkt.billing_details (period_key, detail_id, created_at, detail_type, code, amount, order_id) values
 ('2026-08','s7f','2026-08-11 10:00+00','CHARGE','CXDE', 100.00, '8');
`);

const RESUMO = `select pedidos, vendas_brutas::float, unidades, ticket_medio::float, cancelados, devolvidos, pct_cancel_devol::float,
  receita::float, comissao::float, frete::float, parcelamento::float, product_ads::float, seguidores::float, estornos::float,
  difal::float, outras::float, custo_produto::float, imposto::float, embalagem::float, margem_bruta::float,
  margem_contribuicao::float, pedidos_sem_custo from analytics.dash_resumo($1, $2::date, $3::date)`;
const resumo = async (c, de, ate) => (await rows(RESUMO, [c, de, ate]));

// ---------------- Task 2: resumo e serie ----------------
const out = (await resumo('mercadolivre', '2026-10-01', '2026-10-31'))[0];
eq('resumo de outubro = ml_meses', {
  pedidos: out.pedidos, vendas_brutas: out.vendas_brutas, unidades: out.unidades, cancelados: out.cancelados, devolvidos: out.devolvidos,
  receita: out.receita, product_ads: out.product_ads, seguidores: out.seguidores, estornos: out.estornos, difal: out.difal,
  outras: out.outras, comissao: out.comissao, frete: out.frete, custo_produto: out.custo_produto, margem_contribuicao: out.margem_contribuicao,
}, {
  pedidos: 4, vendas_brutas: 180, unidades: 6, cancelados: 1, devolvidos: 2, receita: 60, product_ads: 100, seguidores: 8,
  estornos: -3, difal: 2, outras: 1, comissao: 7.2, frete: 10, custo_produto: 0, margem_contribuicao: -65.2,
});
eq('ticket, % cancel/devol, margem bruta, sem custo', { t: out.ticket_medio, p: out.pct_cancel_devol, mb: out.margem_bruta, sc: out.pedidos_sem_custo },
  { t: 45, p: 75, mb: 60, sc: 1 });
const meses = (await rows(`select margem_liquida::float as m from analytics.ml_meses where mes = '2026-10-01'`))[0].m;
eq('margem de contribuicao = margem_liquida do ml_meses (sem imposto/embalagem)', out.margem_contribuicao, meses);

await db.exec(`insert into core.parametros_custo (channel, imposto_pct, embalagem_pedido, embalagem_peca, vigente_desde) values ('mercadolivre', 10, 2, 0.5, '2026-10-12')`);
let r = (await resumo('mercadolivre', '2026-10-01', '2026-10-31'))[0];
eq('vigencia posterior a venda nao vale', { i: r.imposto, e: r.embalagem }, { i: 0, e: 0 });
await db.exec(`update core.parametros_custo set vigente_desde = '2026-10-01' where imposto_pct = 10`);
r = (await resumo('mercadolivre', '2026-10-01', '2026-10-31'))[0];
eq('imposto e embalagem na vigencia', { i: r.imposto, e: r.embalagem, m: r.margem_contribuicao }, { i: 6, e: 3.5, m: -74.7 });
await db.exec(`delete from core.parametros_custo where imposto_pct = 10`);

eq('periodo vazio', (await resumo('mercadolivre', '2020-01-01', '2020-01-31')).map((x) => ({ p: x.pedidos, v: x.vendas_brutas, t: x.ticket_medio, c: x.pct_cancel_devol })),
  [{ p: 0, v: 0, t: 0, c: 0 }]);
eq('shopee sem dados', (await resumo('shopee', '2026-10-01', '2026-10-31'))[0].pedidos, 0);
eq('shopee sem custos do periodo', (await resumo('shopee', '2026-10-01', '2026-10-31'))[0].product_ads, 0);
eq('consolidado = mercado livre', (await resumo('consolidado', '2026-10-01', '2026-10-31'))[0], out);

await perfil('comercial');
const com = (await resumo('mercadolivre', '2026-10-01', '2026-10-31'))[0];
eq('comercial: custos nulos', [com.custo_produto, com.margem_bruta, com.margem_contribuicao, com.imposto, com.embalagem, com.pedidos_sem_custo],
  [null, null, null, null, null, null]);
eq('comercial: vendas e Ads visiveis', [com.vendas_brutas, com.product_ads], [180, 100]);
await perfil('admin');

await db.exec(`create or replace function core.can_see_channel(ch text) returns boolean language sql as 'select false'`);
eq('canal bloqueado', (await resumo('mercadolivre', '2026-10-01', '2026-10-31'))[0].pedidos, 0);
eq('canal bloqueado: sem custos do periodo', (await resumo('mercadolivre', '2026-10-01', '2026-10-31'))[0].product_ads, 0);
await db.exec(`create or replace function core.can_see_channel(ch text) returns boolean language sql as 'select true'`);

const serie = async (de, ate, g) => rows(`select periodo::text, vendas_brutas::float, pedidos, receita::float from analytics.dash_serie('mercadolivre', $1::date, $2::date, $3)`, [de, ate, g]);
const dia = await serie('2026-10-10', '2026-10-14', 'dia');
eq('serie diaria: 5 dias', dia.length, 5);
eq('serie diaria: dia 10 e dia 11 (dividido nao conta)', dia.slice(0, 2),
  [{ periodo: '2026-10-10', vendas_brutas: 60, pedidos: 1, receita: 60 }, { periodo: '2026-10-11', vendas_brutas: 0, pedidos: 0, receita: 0 }]);
eq('serie mensal', (await serie('2026-09-01', '2026-10-31', 'mes')).map((x) => [x.periodo, x.vendas_brutas]), [['2026-09-01', 100], ['2026-10-01', 180]]);
eq('serie semanal comeca na segunda', (await serie('2026-10-10', '2026-10-14', 'semana')).map((x) => x.periodo), ['2026-10-05', '2026-10-12']);

// ---------------- Task 3: modelos, ABC, SKUs, pedidos ----------------
const MODELOS = `select modelo, pedidos, unidades, vendas_brutas::float, ticket_medio::float, pct_cancel_devol::float, receita::float,
  custo_produto::float, tarifas_frete::float, custos_rateados::float, imposto_embalagem::float, contribuicao::float,
  contribuicao_pct::float, abc, sem_custo from analytics.dash_modelos($1, $2::date, $3::date) order by modelo`;
const modelos = (c, de, ate) => rows(MODELOS, [c, de, ate]);

let mo = await modelos('mercadolivre', '2026-10-01', '2026-10-31');
eq('outubro: so GFT10', mo.map((m) => [m.modelo, m.vendas_brutas, m.receita, m.pedidos]), [['GFT10', 180, 60, 4]]);
const totalPeriodo = (await rows(`select coalesce(sum(valor), 0)::float as v from analytics.dash_custos_periodo('mercadolivre', '2026-10-01', '2026-10-31')`))[0].v;
eq('rateio de um modelo = todo o custo do periodo', mo[0].custos_rateados, totalPeriodo);
eq('contribuicao do modelo = margem do resumo', mo[0].contribuicao, -65.2);

// Pedido com 2 modelos: tarifas do pedido repartidas pelo valor de cada item
await db.exec(`
insert into mkt.orders (channel, order_id, status, date_created, date_closed, total_amount, raw) values
 ('mercadolivre','M1','paid','2026-10-20 13:00+00','2026-10-20 13:00+00', 100, '{}');
insert into mkt.order_items (channel, order_id, line_no, item_id, sku, title, quantity, unit_price, sale_fee) values
 ('mercadolivre','M1',1,'MLB1','BLA68-AMA','x',1,70,0), ('mercadolivre','M1',2,'MLB2','GFT10-AZU','y',1,30,0);
insert into mkt.billing_details (period_key, detail_id, created_at, detail_type, code, amount, order_id) values
 ('2026-10','m1c','2026-10-21 10:00+00','CHARGE','CVVML', 10.00, 'M1');
`);
mo = await modelos('mercadolivre', '2026-10-01', '2026-10-31');
eq('pedido com 2 modelos: vendas por item', mo.map((m) => [m.modelo, m.vendas_brutas, m.pedidos]), [['BLA68', 70, 1], ['GFT10', 210, 5]]);
eq('pedido com 2 modelos: tarifas repartidas (GFT10 inclui as do pedido 2)', mo.map((m) => m.tarifas_frete), [7, 20.2]);
eq('custo do BLA68 (1 peca x R$ 4)', mo[0].custo_produto, 4);
const somaRateio = mo.reduce((s, m) => s + m.custos_rateados, 0);
eq('soma do rateio = custo do periodo', Math.round(somaRateio * 100) / 100, totalPeriodo);
eq('rateio pela receita (70 de 160)', Math.round(mo[0].custos_rateados * 100) / 100, Math.round(totalPeriodo * 70 / 160 * 100) / 100);
const vbTotal = (await resumo('mercadolivre', '2026-10-01', '2026-10-31'))[0];
eq('soma das vendas brutas dos modelos = resumo', mo.reduce((s, m) => s + m.vendas_brutas, 0), vbTotal.vendas_brutas);
eq('soma das contribuicoes = margem do resumo', Math.round(mo.reduce((s, m) => s + m.contribuicao, 0) * 100) / 100, vbTotal.margem_contribuicao);

// Curva ABC (cenario em 2025, sem custos de periodo)
await db.exec(`
insert into erp.cost_tiers (product_id, qty_start, qty_end, price, created_at, source) values
 ('Z1', 1, 10, 20, '2025-01-01', 'erp'), ('Z2', 1, 10, 5, '2025-01-01', 'erp'),
 ('Z3', 1, 10, 5, '2025-01-01', 'erp'), ('Z4', 1, 10, 20, '2025-01-01', 'erp');
insert into mkt.orders (channel, order_id, status, date_created, date_closed, total_amount, raw) values
 ('mercadolivre','Z1','paid','2025-03-10 13:00+00','2025-03-10 13:00+00', 100, '{}'),
 ('mercadolivre','Z2','paid','2025-03-10 13:00+00','2025-03-10 13:00+00', 20, '{}'),
 ('mercadolivre','Z3','paid','2025-03-10 13:00+00','2025-03-10 13:00+00', 10, '{}'),
 ('mercadolivre','Z4','paid','2025-03-10 13:00+00','2025-03-10 13:00+00', 10, '{}');
insert into mkt.order_items (channel, order_id, line_no, item_id, sku, title, quantity, unit_price, sale_fee) values
 ('mercadolivre','Z1',1,'Z','Z1-AZU','z',1,100,0), ('mercadolivre','Z2',1,'Z','Z2-AZU','z',1,20,0),
 ('mercadolivre','Z3',1,'Z','Z3-AZU','z',1,10,0), ('mercadolivre','Z4',1,'Z','Z4-AZU','z',1,10,0);
`);
eq('curva ABC por lucro', (await modelos('mercadolivre', '2025-03-01', '2025-03-31')).map((m) => [m.modelo, m.contribuicao, m.abc]),
  [['Z1', 80, 'A'], ['Z2', 15, 'B'], ['Z3', 5, 'C'], ['Z4', -10, 'prejuizo']]);
eq('modelo so com cancelados: sem curva', (await modelos('mercadolivre', '2026-10-13', '2026-10-13')).map((m) => [m.modelo, m.receita, m.abc]),
  [['GFT10', 0, null]]);

eq('SKUs do GFT10', (await rows(`select sku, kit, pedidos, unidades, vendas_brutas::float, receita::float from analytics.dash_skus('mercadolivre','2026-10-01','2026-10-31','GFT10')`)),
  [{ sku: 'GFT10-AZU', kit: null, pedidos: 5, unidades: 7, vendas_brutas: 210, receita: 90 }]);
const ped = await rows(`select order_id, classe from analytics.dash_pedidos('mercadolivre','2026-10-01','2026-10-31','GFT10')`);
eq('pedidos do GFT10 (inclui dividido e o pedido com 2 modelos)', ped.map((p) => `${p.order_id}:${p.classe}`).sort(),
  ['2:pago', '3:dividido', '4:devolvido', '5:cancelado', '6:devolvido', 'M1:pago']);
eq('pedidos sem filtro de modelo', (await rows(`select count(*)::int as n from analytics.dash_pedidos('mercadolivre','2026-10-01','2026-10-31', null)`))[0].n, 6);

await perfil('comercial');
mo = await modelos('mercadolivre', '2026-10-01', '2026-10-31');
eq('comercial: modelos sem custo/ABC', mo.map((m) => [m.custo_produto, m.contribuicao, m.abc, m.sem_custo]), [[null, null, null, null], [null, null, null, null]]);
eq('comercial: vendas visiveis', mo.map((m) => m.vendas_brutas), [70, 210]);
eq('comercial: pedidos sem custo', (await rows(`select distinct custo_produto from analytics.dash_pedidos('mercadolivre','2026-10-01','2026-10-31', null)`)).map((x) => x.custo_produto), [null]);
await perfil('admin');

// ---------------- Revisao final: RLS de verdade (papel authenticated, nao superusuario) ----------------
await db.exec(`grant usage on schema core to authenticated`);
await perfil('comercial');
await db.exec(`set role authenticated`);
const comRls = (await resumo('mercadolivre', '2026-10-01', '2026-10-31'))[0];
eq('I2: comercial ve o mesmo Product Ads do admin (fatura + API)', comRls.product_ads, 100);
eq('I5: imposto/embalagem por item mascarados para comercial',
  (await rows(`select distinct impemb from analytics.dash_itens('mercadolivre','2026-10-01','2026-10-31')`)).map((x) => x.impemb), [null]);
eq('I5: parametros de custo nao legiveis por comercial', (await rows(`select count(*)::int as n from core.parametros_custo`))[0].n, 0);
await db.exec(`reset role`);
await perfil('admin');

// 0011: permissao calculada uma vez por consulta, com o mesmo efeito
eq('0011: politicas usam my_channels/can_see_costs em (select ...)',
  (await rows(`select tablename, qual from pg_policies where schemaname in ('mkt','erp') and policyname in ('canal liberado','fatura: quem ve custos','custos: quem ve custos') order by tablename`))
    .every((p) => /SELECT (core\.my_channels|core\.can_see_costs)/i.test(p.qual)), true);
await db.exec(`create or replace function core.can_see_channel(ch text) returns boolean language sql as 'select ch <> ''mercadolivre'''`);
await db.exec(`set role authenticated`);
eq('0011: canal nao liberado continua bloqueado (RLS)', (await rows(`select count(*)::int as n from mkt.orders`))[0].n, 0);
await db.exec(`reset role`);
await db.exec(`create or replace function core.can_see_channel(ch text) returns boolean language sql as 'select true'`);
await db.exec(`set role authenticated`);
eq('0011: canal liberado ve os pedidos (RLS)', (await rows(`select count(*)::int as n from mkt.orders`))[0].n > 0, true);
await db.exec(`reset role`);

// ---------------- Revisao final: reaplicar a 0007 nao derruba o dashboard ----------------
await db.exec(mig('0007_de_para_modelo.sql'));
let depois07 = null;
try { depois07 = (await resumo('mercadolivre', '2026-10-01', '2026-10-31'))[0].vendas_brutas; } catch (e) { depois07 = e.message; }
eq('I1: dash_resumo funciona depois de reaplicar a 0007', depois07, 280); // outubro com o pedido M1 (70 + 210)

// ---------------- Desempenho: a base calcula so o periodo pedido, com os mesmos valores do ml_pedidos ----------------
const COLS = `order_id, classe, data_venda::text, sku, sku_anuncio, qtd, unidades, valor_venda::float, receita::float,
  comissao::float, frete::float, parcelamento::float, product_ads::float, seguidores::float, estornos::float,
  difal::float, outras::float, custo_produto::float, alerta_custo`;
const base = await rows(`select ${COLS} from analytics.dash_pedidos_base('1900-01-01', '2100-12-31') order by order_id`);
const viewP = await rows(`select ${COLS} from analytics.ml_pedidos order by order_id`);
eq('base no periodo inteiro = ml_pedidos (todas as colunas, todos os pedidos)', base, viewP);
eq('base filtra pela data da venda em Brasilia (pedido 1 = 30/09)',
  (await rows(`select order_id from analytics.dash_pedidos_base('2026-09-30', '2026-09-30')`)).map((x) => x.order_id), ['1']);
eq('base de outubro nao traz pedidos de agosto/setembro',
  (await rows(`select order_id from analytics.dash_pedidos_base('2026-10-01', '2026-10-31') order by order_id`)).map((x) => x.order_id),
  ['2', '3', '4', '5', '6', 'M1']);
eq('base traz frete_estimado igual ao ml_pedidos',
  (await rows(`select order_id, frete_estimado from analytics.dash_pedidos_base('1900-01-01','2100-12-31') order by order_id`)),
  (await rows(`select order_id, frete_estimado from analytics.ml_pedidos order by order_id`)));

// ---------------- Itens da V1: canceladas/devolvidas em R$, estimados, resultado mensal, SKUs, alertas ----------------
const out2 = (await rows(`select canceladas_valor::float, devolvidas_valor::float, estimados from analytics.dash_resumo('mercadolivre','2026-10-01','2026-10-31')`))[0];
eq('resumo: valor de canceladas e devolvidas, estimados (outubro)', out2, { canceladas_valor: 30, devolvidas_valor: 90, estimados: 0 });
eq('resumo: pedido 1 de setembro sem fatura = estimado',
  (await rows(`select estimados from analytics.dash_resumo('mercadolivre','2026-09-01','2026-09-30')`))[0].estimados, 1);

const mens = await rows(`select mes::text, vendas_brutas::float, receita::float, margem_contribuicao::float, canceladas_valor::float
  from analytics.dash_resultado_mensal('mercadolivre', '2026-08-01', '2026-10-31')`);
eq('resultado mensal: um mes por linha', mens.map((m) => m.mes), ['2026-08-01', '2026-09-01', '2026-10-01']);
eq('resultado mensal: setembro', [mens[1].vendas_brutas, mens[1].receita], [100, 100]);
eq('resultado mensal: outubro = resumo de outubro', mens[2].margem_contribuicao,
  (await rows(`select margem_contribuicao::float as m from analytics.dash_resumo('mercadolivre','2026-10-01','2026-10-31')`))[0].m);
eq('resultado mensal: periodo parcial respeita o corte',
  (await rows(`select mes::text, vendas_brutas::float from analytics.dash_resultado_mensal('mercadolivre','2026-10-12','2026-10-14')`)),
  [{ mes: '2026-10-01', vendas_brutas: 120 }]);

eq('modelos: nome do produto e ABC por receita',
  (await rows(`select modelo, produto, abc_receita from analytics.dash_modelos('mercadolivre','2026-10-01','2026-10-31') order by modelo`)),
  [{ modelo: 'BLA68', produto: 'x', abc_receita: 'A' }, { modelo: 'GFT10', produto: 'y', abc_receita: 'A' }]); // 90 e 70 de 160: o 2o comeca em 56%
eq('SKUs de todos os modelos (sem filtro)',
  (await rows(`select sku, modelo, produto, receita::float, tarifas_frete::float from analytics.dash_skus('mercadolivre','2026-10-01','2026-10-31', null) order by sku`)),
  [{ sku: 'BLA68-AMA', modelo: 'BLA68', produto: 'x', receita: 70, tarifas_frete: 7 }, { sku: 'GFT10-AZU', modelo: 'GFT10', produto: 'y', receita: 90, tarifas_frete: 20.2 }]);
eq('alertas do periodo (pedidos pagos sem custo)',
  (await rows(`select codigo, tipo, pedidos from analytics.dash_alertas('mercadolivre','2026-10-01','2026-10-31')`)),
  [{ codigo: 'GFT10', tipo: 'sem_custo', pedidos: 2 }]);
// ---------------- Fotos do anuncio ----------------
await db.exec(`
insert into mkt.items (channel, item_id, title, thumbnail, permalink, raw) values
 ('mercadolivre','MLB2','y','http://http2.mlstatic.com/thumb-y.jpg','https://produto.mercadolivre.com.br/MLB2',
  '{"pictures":[{"id":"P1","secure_url":"https://img/p1.jpg"},{"id":"P2","secure_url":"https://img/p2.jpg"}],
    "variations":[{"id":111,"picture_ids":["P2"]}]}'),
 ('mercadolivre','MLB1','x','http://http2.mlstatic.com/thumb-x.jpg','https://produto.mercadolivre.com.br/MLB1', '{}');
update mkt.order_items set variation_id = '111' where order_id = '2';
`);
eq('foto: variacao do SKU', (await rows(`select analytics.foto_anuncio('MLB2', '111') as f`))[0].f, 'https://img/p2.jpg');
eq('foto: sem variacao = principal', (await rows(`select analytics.foto_anuncio('MLB2', null) as f`))[0].f, 'https://img/p1.jpg');
eq('foto: sem fotos no raw = miniatura em https', (await rows(`select analytics.foto_anuncio('MLB1', null) as f`))[0].f, 'https://http2.mlstatic.com/thumb-x.jpg');
eq('foto: anuncio desconhecido = nulo', (await rows(`select analytics.foto_anuncio('MLB999', null) as f`))[0].f, null);
eq('modelos: foto principal e link do anuncio',
  (await rows(`select modelo, foto, link from analytics.dash_modelos('mercadolivre','2026-10-01','2026-10-31') order by modelo`)),
  [{ modelo: 'BLA68', foto: 'https://http2.mlstatic.com/thumb-x.jpg', link: 'https://produto.mercadolivre.com.br/MLB1' },
   { modelo: 'GFT10', foto: 'https://img/p1.jpg', link: 'https://produto.mercadolivre.com.br/MLB2' }]);
eq('SKU completo: foto da variacao vendida', // GFT10-AZU vendido no pedido 2 com a variacao 111
  (await rows(`select sku, foto from analytics.dash_skus('mercadolivre','2026-10-10','2026-10-10', null)`)),
  [{ sku: 'GFT10-AZU', foto: 'https://img/p2.jpg' }]);

await perfil('comercial');
eq('comercial: sem alertas de custo', (await rows(`select count(*)::int as n from analytics.dash_alertas('mercadolivre','2026-10-01','2026-10-31')`))[0].n, 0);
eq('comercial: resultado mensal sem margem', (await rows(`select distinct margem_contribuicao from analytics.dash_resultado_mensal('mercadolivre','2026-10-01','2026-10-31')`)).map((x) => x.margem_contribuicao), [null]);
await perfil('admin');

console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
process.exit(fails ? 1 : 0);
