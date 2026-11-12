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
  '0008_dashboard_admin.sql', '0009_dashboard_funcoes.sql', '0009_dashboard_funcoes.sql'])
  await db.exec(mig(f));
console.log('Migrations 0002..0009 aplicadas (0009 x2)');

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

console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
process.exit(fails ? 1 : 0);
