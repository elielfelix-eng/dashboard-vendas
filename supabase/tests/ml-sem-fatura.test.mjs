import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Migration 0036: pedido pago do ML sem fatura so fica "estimado" no mes corrente (Brasilia); mes fechado = definitivo.
// Valores (comissao, frete, totais do dash_resumo) nao mudam. Datas relativas a now() para nao depender do relogio.
const repo = fileURLToPath(new URL('../..', import.meta.url));
const db = new PGlite();
let fails = 0;
const eq = (label, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  if (!ok) fails++;
  console.log(`${ok ? 'OK  ' : 'FALHA'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (esperado ${JSON.stringify(exp)})`}`);
};
const mig = (f) => readFileSync(`${repo}/supabase/migrations/${f}`, 'utf8');
const rows = async (sql, p = []) => (await db.query(sql, p)).rows;
await db.exec(readFileSync(`${repo}/supabase/tests/stubs.sql`, 'utf8'));
for (const f of ['0002_marketplaces.sql', '0003_regras_v1.sql', '0006_custo_por_cotacao.sql', '0007_de_para_modelo.sql', '0008_dashboard_admin.sql',
  '0009_dashboard_funcoes.sql', '0010_dashboard_metas.sql', '0011_rls_desempenho.sql', '0020_shopee_pagamentos.sql', '0030_shopee_escrow_campos.sql',
  '0031_shopee_categorias.sql', '0021_shopee_funcoes.sql']) await db.exec(mig(f));
await db.exec(`create or replace function core.my_role() returns core.app_role language sql as $$ select 'admin'::core.app_role $$`);

// Meio-dia (Brasilia) do dia 1 do mes corrente, e 40 dias antes (sempre mes fechado)
const [{ atual, fechado }] = await rows(`select
  ((date_trunc('month', now() at time zone 'America/Sao_Paulo') + interval '12 hours') at time zone 'America/Sao_Paulo')::text as atual,
  ((date_trunc('month', now() at time zone 'America/Sao_Paulo') - interval '40 days' + interval '12 hours') at time zone 'America/Sao_Paulo')::text as fechado`);
await db.exec(`
insert into erp.cost_tiers (product_id, qty_start, qty_end, price, created_at, source) values ('BLA68', 1, 49, 4.00, '2020-01-01', 'erp');
insert into mkt.orders (channel, order_id, status, date_created, date_closed, total_amount, shipment_id, shipping_cost_seller, raw) values
 ('mercadolivre','F1','paid','${fechado}','${fechado}', 100, 'sf1', 12.5, '{}'),
 ('mercadolivre','A1','paid','${atual}','${atual}', 100, 'sa1', 12.5, '{}'),
 ('mercadolivre','F2','paid','${fechado}','${fechado}', 100, 'sf2', 12.5, '{}');
insert into mkt.order_items (channel, order_id, line_no, item_id, sku, title, quantity, unit_price, sale_fee) values
 ('mercadolivre','F1',1,'MLB1','BLA68-AMA-K0010-V1','x',2,50, 6),
 ('mercadolivre','A1',1,'MLB1','BLA68-AMA-K0010-V1','x',2,50, 6),
 ('mercadolivre','F2',1,'MLB1','BLA68-AMA-K0010-V1','x',2,50, 6);
-- F2 tem fatura (frete e comissao faturados)
insert into mkt.billing_details (period_key, detail_id, created_at, detail_type, code, amount, order_id) values
 ('x','b1','${fechado}','CHARGE','CVVML', 7, 'F2'), ('x','b2','${fechado}','CHARGE','CXDE', 9, 'F2');`);

const De = '2020-01-01', Ate = '2099-12-31';
const BASE = `select order_id, comissao::float as comissao, frete::float as frete, receita::float as receita, custo_produto::float as custo,
  imposto::float as imposto, embalagem::float as embalagem, frete_estimado from analytics.dash_pedidos_base_ml('${De}', '${Ate}') order by order_id`;
const RESUMO = `select pedidos, vendas_brutas::float, receita::float, comissao::float, frete::float, parcelamento::float, product_ads::float,
  custo_produto::float, imposto::float, embalagem::float, margem_bruta::float, margem_contribuicao::float, estimados
  from analytics.dash_resumo('mercadolivre', '${De}', '${Ate}')`;
const antesBase = await rows(BASE);
const antesResumo = (await rows(RESUMO))[0];
eq('0021: pedidos sem fatura (F1 fechado, A1 atual) estimados', antesBase.map((r) => [r.order_id, r.frete_estimado]), [['A1', true], ['F1', true], ['F2', false]]);

await db.exec(mig('0036_ml_sem_fatura_definitivo.sql'));
await db.exec(mig('0036_ml_sem_fatura_definitivo.sql')); // reexecutavel
const base = await rows(BASE);
const resumo = (await rows(RESUMO))[0];
eq('0036: mes fechado sem fatura = definitivo; mes corrente = estimado; com fatura = nao estimado',
  base.map((r) => [r.order_id, r.frete_estimado]), [['A1', true], ['F1', false], ['F2', false]]);
eq('0036: frete e comissao do pedido fechado sem fatura iguais (12,5 / 12)', base.filter((r) => r.order_id === 'F1').map((r) => [r.frete, r.comissao]), [[12.5, 12]]);
eq('0036: todos os valores por pedido iguais (so o marcador muda)',
  base.map(({ frete_estimado, ...r }) => r), antesBase.map(({ frete_estimado, ...r }) => r));
const { estimados: e0, ...m0 } = antesResumo; const { estimados: e1, ...m1 } = resumo;
eq('0036: totais em dinheiro do dash_resumo iguais', m1, m0);
eq('dash_resumo.estimados: de 2 para 1 (so o mes corrente)', [e0, e1], [2, 1]);
eq('search_path vazio mantido', (await rows(`select proconfig from pg_proc where proname = 'dash_pedidos_base_ml'`))[0].proconfig, ['search_path=""']);

if (fails) { console.log(`\n${fails} FALHA(S)`); process.exit(1); }
console.log('\nTodos os testes passaram');
