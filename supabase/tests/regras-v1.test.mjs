import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Testa as regras de negócio da V1 (migrations 0002 + 0003) num Postgres em memória.
const repo = fileURLToPath(new URL('../..', import.meta.url));
const db = new PGlite();
let fails = 0;
const eq = (label, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  if (!ok) fails++;
  console.log(`${ok ? 'OK  ' : 'FALHA'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (esperado ${JSON.stringify(exp)})`}`);
};
const one = async (q, p = []) => (await db.query(q, p)).rows[0];

// Stubs do ambiente Supabase (auth, papéis, funções de perfil)
await db.exec(readFileSync(`${repo}/supabase/tests/stubs.sql`, 'utf8'));
await db.exec(readFileSync(`${repo}/supabase/migrations/0002_marketplaces.sql`, 'utf8'));
await db.exec(readFileSync(`${repo}/supabase/migrations/0003_regras_v1.sql`, 'utf8'));
console.log('Migrations 0002 + 0003 aplicadas');

// ---------------- Custos por faixa ----------------
await db.exec(`
insert into erp.cost_tiers (product_id, qty_start, qty_end, price, created_at, expired_at) values
 ('BLA68', 1, 9, 5.00, '2026-01-01', '2026-06-01'),
 ('BLA68', 10, 49, 4.00, '2026-01-01', null),
 ('BLA68', 50, 99, 3.00, '2026-01-01', null),
 ('BLA68', 1, 9, 5.50, '2026-06-01', null),
 ('GAP1', 1, 9, 2.00, '2026-01-01', null),
 ('GAP1', 20, 29, 1.00, '2026-01-01', null),
 ('LOW1', 10, 20, 7.00, '2026-01-01', null),
 ('NEW1', 1, 100, 9.00, '2026-05-01', null),
 ('TIE1', 1, 100, 1.00, '2026-01-01', null),
 ('TIE1', 1, 100, 1.50, '2026-02-01', null),
 ('TIE1', 1, 100, 1.20, '2026-02-01', null);
`);
const cost = (m, d, u) => one(`select price::float as price, flag from analytics.resolve_unit_cost($1, $2::timestamptz, $3)`, [m, d, u]);
eq('faixa que contém (10 un, mar)', await cost('BLA68', '2026-03-01', 10), { price: 4, flag: null });
eq('acima da última (120 un)', await cost('BLA68', '2026-03-01', 120), { price: 3, flag: null });
eq('faixa vencida substituída (5 un, jul)', await cost('BLA68', '2026-07-01', 5), { price: 5.5, flag: null });
eq('faixa antiga ainda vale (5 un, mar)', await cost('BLA68', '2026-03-01', 5), { price: 5, flag: null });
eq('buraco entre faixas -> abaixo (15 un)', await cost('GAP1', '2026-03-01', 15), { price: 2, flag: null });
eq('abaixo da primeira (3 un)', await cost('LOW1', '2026-03-01', 3), { price: 7, flag: null });
eq('sem faixa na data -> faixa_atual', await cost('NEW1', '2026-01-15', 5), { price: 9, flag: 'faixa_atual' });
eq('modelo sem faixa -> sem_custo', await cost('XXX', '2026-03-01', 5), { price: 0, flag: 'sem_custo' });
eq('empate: mais recente, depois maior preço', await cost('TIE1', '2026-03-01', 5), { price: 1.5, flag: null });

// ---------------- Pedidos ----------------
await db.exec(`
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
`);
eq('SKU com kit', await one(`select modelo, cor, kit_units, versao, units from mkt.order_items where order_id='1'`),
  { modelo: 'BLA68', cor: 'AMA', kit_units: 10, versao: 'V1', units: 20 });
eq('SKU sem kit', await one(`select modelo, cor, kit_units, versao, units from mkt.order_items where order_id='2'`),
  { modelo: 'GFT10', cor: 'AZU', kit_units: null, versao: null, units: 3 });

const classes = (await db.query(`select order_id, classe from analytics.ml_pedidos order by order_id`)).rows.map((r) => `${r.order_id}:${r.classe}`);
eq('classificação', classes, ['1:pago', '2:pago', '3:dividido', '4:devolvido', '5:cancelado', '6:devolvido']);
eq('data da venda em Brasília (02:30Z = 30/09 23:30)', await one(`select data_venda::text, mes::text from analytics.ml_pedidos where order_id='1'`),
  { data_venda: '2026-09-30', mes: '2026-09-01' });

// ---------------- Fatura e Ads ----------------
await db.exec(`
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
`);
eq('PADS volta 1 dia', await one(`select data_ref::text from analytics.ml_fatura where detail_id='d'`), { data_ref: '2026-10-01' });
eq('pedido faturado usa fatura', await one(`select comissao::float, frete::float, frete_estimado from analytics.ml_pedidos where order_id='2'`),
  { comissao: 7.2, frete: 10, frete_estimado: false });
eq('pedido não faturado usa estimativa', await one(`select comissao::float, frete::float, frete_estimado from analytics.ml_pedidos where order_id='1'`),
  { comissao: 12, frete: 12.5, frete_estimado: true });
// Carrinho: pedidos 7 e 8 no mesmo envio s7; a fatura cobrou o frete só no 8
await db.exec(`
insert into mkt.orders (channel, order_id, status, date_created, date_closed, total_amount, shipment_id, shipping_cost_seller, raw) values
 ('mercadolivre','7','paid','2026-08-10 12:00+00','2026-08-10 12:00+00', 10, 's7', 50, '{}'),
 ('mercadolivre','8','paid','2026-08-10 12:00+00','2026-08-10 12:00+00', 10, 's7', 50, '{}');
insert into mkt.order_items (channel, order_id, line_no, item_id, sku, title, quantity, unit_price, sale_fee) values
 ('mercadolivre','7',1,'MLB2','GFT10-AZU','y',1,10,0), ('mercadolivre','8',1,'MLB2','GFT10-AZU','y',1,10,0);
insert into mkt.billing_details (period_key, detail_id, created_at, detail_type, code, amount, order_id) values
 ('2026-08','s7f','2026-08-11 10:00+00','CHARGE','CXDE', 100.00, '8');
`);
eq('carrinho: frete já cobrado em outro pedido do envio -> 0', await one(`select frete::float, frete_estimado from analytics.ml_pedidos where order_id='7'`),
  { frete: 0, frete_estimado: false });
eq('carrinho: pedido faturado mantém o frete da fatura', await one(`select frete::float from analytics.ml_pedidos where order_id='8'`), { frete: 100 });

eq('custo do produto (2 kits de 10 = 20 un x R$4)', await one(`select custo_produto::float, custo_unitario::float from analytics.ml_pedidos where order_id='1'`),
  { custo_produto: 80, custo_unitario: 4 });

const out = await one(`select vendas_qtd, vendas_brutas::float, unidades_vendidas, cancelados, canceladas_valor::float,
  devolvidas, devolvidas_valor::float, divididos, receita::float, product_ads::float, seguidores::float, estornos::float,
  difal::float, outras::float, comissao::float, frete::float, custo_produto::float, margem_liquida::float
  from analytics.ml_meses where mes = '2026-10-01'`);
// Outubro: pedidos 2..6 (pedido 1 caiu em setembro pelo fuso). Vendas brutas = 60 + 70 + 30 + 20 (sem o dividido)
// Ads: PADS de 01/10 (antes da API) = 40 + API (30+25+5) = 100; PADS de 20/10 é ignorado (coberto pela API)
// Custo GFT10 sem faixa = 0. Margem = 60 - (7.2 + 10 + 100 + 8 - 3 + 2 + 1) - 0 = -65.2
eq('resumo de outubro', out, {
  vendas_qtd: 4, vendas_brutas: 180, unidades_vendidas: 6, cancelados: 1, canceladas_valor: 30,
  devolvidas: 2, devolvidas_valor: 90, divididos: 1, receita: 60, product_ads: 100, seguidores: 8, estornos: -3,
  difal: 2, outras: 1, comissao: 7.2, frete: 10, custo_produto: 0, margem_liquida: -65.2,
});
eq('alerta sem_custo', (await db.query(`select tipo, codigo, qtd_pedidos from analytics.ml_alertas`)).rows,
  [{ tipo: 'sem_custo', codigo: 'GFT10', qtd_pedidos: 3 }]); // pedidos 2, 7 e 8

console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
process.exit(fails ? 1 : 0);

