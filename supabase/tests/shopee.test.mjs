import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Shopee (migrations 0020, 0030, 0031): pagamentos (escrow), view analytics.shopee_fatura, pendentes e idempotencia.
// Shopee (migration 0032): Ads da conta e por anuncio sem somar o dia 2x; "sem modelo" e tabela = cartao.
const repo = fileURLToPath(new URL('../..', import.meta.url));
let db = new PGlite(); // trocado por um banco novo na secao da 0032 (Ads), que precisa das funcoes do painel
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
const val = async (sql, p = []) => Object.values((await rows(sql, p))[0])[0];

await db.exec(readFileSync(`${repo}/supabase/tests/stubs.sql`, 'utf8'));
for (const f of ['0002_marketplaces.sql', '0003_regras_v1.sql', '0020_shopee_pagamentos.sql', '0030_shopee_escrow_campos.sql', '0031_shopee_categorias.sql']) await db.exec(mig(f));
await db.exec(mig('0020_shopee_pagamentos.sql')); // reexecutavel
await db.exec(mig('0030_shopee_escrow_campos.sql')); // reexecutavel (e de novo depois da 0020)
await db.exec(mig('0031_shopee_categorias.sql')); // reexecutavel
console.log('Migrations 0002, 0003, 0020 (2x), 0030 (2x) e 0031 (2x) aplicadas');

// Permissoes controladas pelo teste
await db.exec(`
  create or replace function core.can_see_costs() returns boolean language sql as $$ select coalesce(nullif(current_setting('teste.custos', true), ''), 'true')::boolean $$;
  create or replace function core.can_see_channel(ch text) returns boolean language sql as $$ select ch = any (string_to_array(coalesce(nullif(current_setting('teste.canais', true), ''), 'mercadolivre,shopee,crm'), ',')) $$;
  grant usage on schema core to authenticated;`);
const comoAuth = async (fn) => { await db.exec(`set role authenticated`); try { return await fn(); } finally { await db.exec(`reset role`); } };
const tenta = async (sql) => { try { await db.exec(sql); return 'ok'; } catch (e) { return /row-level security|permission denied/i.test(e.message) ? 'negado' : e.message; } };

// ---------------- Gravacao de pedidos (mesmo SQL do upsert do job) ----------------
const gravarPedido = async (id, status, raw, criado = '2026-11-10 10:00-03') => {
  await db.query(`
    insert into mkt.orders (channel, order_id, status, date_created, total_amount, tags, raw)
    values ('shopee', $1, $2, $3, 59.9, array['shopee:' || ($4::jsonb ->> 'order_status')], $4::jsonb)
    on conflict (channel, order_id) do update set status = excluded.status, date_created = excluded.date_created,
      total_amount = excluded.total_amount, tags = excluded.tags, raw = excluded.raw`, [id, status, criado, JSON.stringify(raw)]);
  await db.query(`delete from mkt.order_items where channel = 'shopee' and order_id = $1`, [id]);
  await db.query(`
    insert into mkt.order_items (channel, order_id, line_no, item_id, variation_id, sku, title, quantity, unit_price)
    values ('shopee', $1, 1, '111', '222', 'BLA68-AZU-K0010', 'Caneca', 2, 29.95)
    on conflict (channel, order_id, line_no) do update set quantity = excluded.quantity`, [id]);
};
const linhas = (id, extra = []) => JSON.stringify([
  { order_id: id, categoria: 'comissao', valor: 8.5, data_ref: '2026-11-10' },
  { order_id: id, categoria: 'frete', valor: 5, data_ref: '2026-11-10' },
  { order_id: id, categoria: 'liquido', valor: 40.12, data_ref: '2026-11-10' },
  ...extra,
]);
const gravarEscrow = (ids, l) => val(`select mkt.shopee_gravar_escrow($1::text[], $2::jsonb)`, [ids, l]);

await gravarPedido('P1', 'paid', { order_status: 'COMPLETED' });
await gravarPedido('P1', 'paid', { order_status: 'COMPLETED' });
eq('pedido gravado 2x: uma linha', await val(`select count(*)::int from mkt.orders where order_id = 'P1'`), 1);
eq('itens gravados 2x: uma linha', await val(`select count(*)::int from mkt.order_items where order_id = 'P1'`), 1);
eq('SKU da Shopee calcula modelo e unidades', await rows(`select modelo, units from mkt.order_items where order_id = 'P1'`), [{ modelo: 'BLA68', units: 20 }]);

// ---------------- Escrow: idempotente ----------------
eq('escrow: grava 3 linhas', await gravarEscrow(['P1'], linhas('P1')), 3);
eq('escrow: 2a gravacao igual', await gravarEscrow(['P1'], linhas('P1')), 3);
eq('escrow gravado 2x nao duplica', await val(`select count(*)::int from mkt.shopee_escrow where order_id = 'P1'`), 3);
// Nova leitura do mesmo pedido substitui (tarifa que sumiu sai; valor alterado atualiza)
await gravarEscrow(['P1'], JSON.stringify([{ order_id: 'P1', categoria: 'comissao', valor: 9, data_ref: '2026-11-10' }]));
eq('escrow relido substitui as linhas do pedido', await rows(`select categoria, valor::float as v from mkt.shopee_escrow where order_id = 'P1' order by categoria`),
  [{ categoria: 'comissao', v: 9 }]);
await gravarEscrow(['P1'], linhas('P1'));
eq('valor zero nao vira linha', await gravarEscrow(['P1'], linhas('P1', [{ order_id: 'P1', categoria: 'campanha', valor: 0, data_ref: '2026-11-10' }])), 3);
await erro('categoria invalida recusada', `select mkt.shopee_gravar_escrow(array['P1'], '[{"order_id":"P1","categoria":"inventada","valor":1,"data_ref":"2026-11-10"}]'::jsonb)`, /check/i);
await erro('escrow de pedido inexistente recusado', `select mkt.shopee_gravar_escrow(array['NAO'], '[{"order_id":"NAO","categoria":"comissao","valor":1,"data_ref":"2026-11-10"}]'::jsonb)`, /foreign key/i);
eq('linha de outro pedido na lista e ignorada', await gravarEscrow(['P1'], linhas('P1', [{ order_id: 'OUTRO', categoria: 'comissao', valor: 1, data_ref: '2026-11-10' }])), 3);

// ---------------- View analytics.shopee_fatura ----------------
eq('view: mesmas colunas de ml_fatura (order_id, categoria, valor, data_ref)',
  (await rows(`select column_name from information_schema.columns where table_schema = 'analytics' and table_name = 'shopee_fatura' order by ordinal_position`)).map((r) => r.column_name),
  ['order_id', 'categoria', 'valor', 'data_ref']);
eq('view: so tarifas (liquido fica fora), custo positivo', await rows(`select categoria, valor::float as v, data_ref::text as d from analytics.shopee_fatura order by categoria`),
  [{ categoria: 'comissao', v: 8.5, d: '2026-11-10' }, { categoria: 'frete', v: 5, d: '2026-11-10' }]);

// ---------------- Pendentes: sem escrow volta a ser buscado (Review Focus 3) ----------------
await gravarPedido('P2', 'paid', { order_status: 'COMPLETED' });              // pago, sem escrow
await gravarPedido('P3', 'paid', { order_status: 'SHIPPED' });                // pago, com escrow ainda nao final
await gravarEscrow(['P3'], linhas('P3'));
await gravarPedido('P4', 'cancelled', { order_status: 'CANCELLED' });         // cancelado
await gravarPedido('P5', 'unpaid', { order_status: 'UNPAID' });               // nao pago
await gravarPedido('P6', 'paid', { order_status: 'COMPLETED' }, '2025-06-01 10:00-03'); // fora dos 12 meses
await db.exec(`insert into mkt.orders (channel, order_id, status, date_created) values ('mercadolivre', 'ML1', 'paid', now())`);
eq('pendentes: pagos sem escrow ou ainda nao concluidos (P1: concluido, mas sem os campos da 0030)', (await rows(`select * from mkt.shopee_pedidos_pendentes(500) as p order by 1`)).map((r) => Object.values(r)[0]),
  ['P1', 'P2', 'P3']);
eq('pedido sem escrow nao tem tarifa zero', await val(`select count(*)::int from mkt.shopee_escrow where order_id = 'P2'`), 0);
eq('pendentes: limite respeitado', (await rows(`select * from mkt.shopee_pedidos_pendentes(1)`)).length, 1);

// ---------------- RLS: so quem ve custos ----------------
eq('RLS: com custos ve a fatura', await comoAuth(() => val(`select count(*)::int from analytics.shopee_fatura`)), 4);
await db.exec(`set teste.custos = 'false'`);
eq('RLS: sem custos nao ve a fatura', await comoAuth(() => val(`select count(*)::int from analytics.shopee_fatura`)), 0);
eq('RLS: sem custos nao ve a tabela', await comoAuth(() => val(`select count(*)::int from mkt.shopee_escrow`)), 0);
await db.exec(`set teste.custos = 'true'`);
await db.exec(`set teste.canais = 'mercadolivre'`);
eq('RLS: sem o canal Shopee nao ve a fatura', await comoAuth(() => val(`select count(*)::int from analytics.shopee_fatura`)), 0);
await db.exec(`set teste.canais = 'mercadolivre,shopee,crm'`);
eq('RLS: sem escrita para authenticated', await comoAuth(() => tenta(`insert into mkt.shopee_escrow (order_id, categoria, valor, data_ref) values ('P1', 'campanha', 1, '2026-11-10')`)), 'negado');
eq('RLS: authenticated nao executa a gravacao', await comoAuth(() => tenta(`select mkt.shopee_gravar_escrow(array['P1'], '[]'::jsonb)`)), 'negado');
eq('RLS: authenticated nao executa os pendentes', await comoAuth(() => tenta(`select mkt.shopee_pedidos_pendentes(1)`)), 'negado');
eq('RLS: politica usa (select ...)', await val(`select qual ~* 'SELECT core\\.' from pg_policies where schemaname = 'mkt' and tablename = 'shopee_escrow'`), true);

// ---------------- Conferencia por pedido (exemplo da revisao) ----------------
// Itens 59,90; cupom do vendedor 5; comissao 8,5; servico 3,2; transacao 1,5;
// frete 20 - subsidio 15 - pago pelo comprador 5 = 0 (sem linha); liquido 41,70.
await db.query(`insert into mkt.orders (channel, order_id, status, date_created, raw) values ('shopee', 'R1', 'paid', '2026-11-10 10:00-03', '{"order_status":"COMPLETED"}')`);
await db.query(`insert into mkt.order_items (channel, order_id, line_no, sku, quantity, unit_price) values ('shopee', 'R1', 1, 'BLA68-AZU', 1, 59.90)`);
await gravarEscrow(['R1'], JSON.stringify([
  { order_id: 'R1', categoria: 'cupom_vendedor', valor: 5, data_ref: '2026-11-10' },
  { order_id: 'R1', categoria: 'comissao', valor: 8.5, data_ref: '2026-11-10' },
  { order_id: 'R1', categoria: 'taxa_servico', valor: 3.2, data_ref: '2026-11-10' },
  { order_id: 'R1', categoria: 'taxa_transacao', valor: 1.5, data_ref: '2026-11-10' },
  { order_id: 'R1', categoria: 'frete', valor: 0, data_ref: '2026-11-10' },
  { order_id: 'R1', categoria: 'liquido', valor: 41.7, data_ref: '2026-11-10' },
]));
eq('conciliacao: colunas', (await rows(`select column_name from information_schema.columns where table_schema = 'analytics' and table_name = 'shopee_conciliacao' order by ordinal_position`)).map((r) => r.column_name),
  ['order_id', 'receita_itens', 'tarifas', 'liquido', 'diferenca']);
eq('conciliacao: exemplo da revisao fecha em 0,00', await rows(`select receita_itens::text as r, tarifas::text as t, liquido::text as l, diferenca::text as d from analytics.shopee_conciliacao where order_id = 'R1'`),
  [{ r: '59.90', t: '18.20', l: '41.70', d: '0.00' }]);
eq('conciliacao: pedido sem escrow fica fora', await val(`select count(*)::int from analytics.shopee_conciliacao where order_id = 'P2'`), 0);
eq('conciliacao: P1 (itens 59,90; tarifas 13,50; liquido 40,12) mostra a diferenca', await val(`select diferenca::text from analytics.shopee_conciliacao where order_id = 'P1'`), '6.28');
eq('RLS conciliacao: com custos ve', await comoAuth(() => val(`select count(*)::int from analytics.shopee_conciliacao`)), 3);
await db.exec(`set teste.custos = 'false'`);
eq('RLS conciliacao: sem custos nao ve', await comoAuth(() => val(`select count(*)::int from analytics.shopee_conciliacao`)), 0);
await db.exec(`set teste.custos = 'true'`);
await db.exec(`delete from mkt.orders where order_id = 'R1'`);

// ---------------- 0030: todos os campos em dinheiro do pagamento ----------------
const gravarCampos = (ids, c) => val(`select mkt.shopee_gravar_escrow_campos($1::text[], $2::jsonb)`, [ids, c]);
// Antes de gravar os campos: P1 (concluido, com escrow) volta para a lista de pendentes (carga unica)
eq('pendentes: pago com escrow e sem campos volta (carga unica)', (await rows(`select * from mkt.shopee_pedidos_pendentes(500) as p order by 1`)).map((r) => Object.values(r)[0]),
  ['P1', 'P2', 'P3']);
const camposP1 = JSON.stringify({ P1: {
  escrow_amount: 40.12, commission_fee: 8.5, taxa_nova: 0.49, seller_return_refund: -12.3, buyer_paid_shipping_fee: 5,
  buyer_user_name: 'comprador-ficticio', buyer_total_amount: 64.9, order_sn: 'P1', codigo: '12.5', zero: 0, lista: [1], obj: { a: 1 }, seller_id: 9,
} });
eq('campos: grava um pedido', await gravarCampos(['P1'], camposP1), 1);
eq('campos: 2a gravacao igual', await gravarCampos(['P1'], camposP1), 1);
eq('campos: gravado 2x nao duplica', await val(`select count(*)::int from mkt.shopee_escrow_campos where order_id = 'P1'`), 1);
eq('campos: so numeros, sem texto, comprador, zero, listas ou ids', await val(`select campos from mkt.shopee_escrow_campos where order_id = 'P1'`),
  { taxa_nova: 0.49, escrow_amount: 40.12, commission_fee: 8.5, seller_return_refund: -12.3, buyer_paid_shipping_fee: 5 });
eq('campos: nenhum texto do comprador no banco', await val(`select count(*)::int from mkt.shopee_escrow_campos where campos::text ~ 'comprador|buyer_user_name|buyer_total'`), 0);
await gravarCampos(['P1'], JSON.stringify({ P1: { escrow_amount: 41 } }));
eq('campos: releitura substitui', await val(`select campos from mkt.shopee_escrow_campos where order_id = 'P1'`), { escrow_amount: 41 });
await gravarCampos(['P1'], camposP1);
eq('campos: pedido fora da lista e ignorado', await gravarCampos(['P1'], JSON.stringify({ P1: { a: 1 }, P3: { a: 2 } })), 1);
eq('campos: P3 nao gravado', await val(`select count(*)::int from mkt.shopee_escrow_campos where order_id = 'P3'`), 0);
await gravarCampos(['P1'], camposP1);
eq('campos: pedido sem nenhum numero nao vira linha', await gravarCampos(['P3'], JSON.stringify({ P3: { order_sn: 'P3' } })), 0);
await erro('campos: pedido inexistente recusado', `select mkt.shopee_gravar_escrow_campos(array['NAO'], '{"NAO":{"a":1}}'::jsonb)`, /foreign key/i);
eq('pendentes: P1 sai depois de ter os campos', (await rows(`select * from mkt.shopee_pedidos_pendentes(500) as p order by 1`)).map((r) => Object.values(r)[0]),
  ['P2', 'P3']);
eq('view longa: um campo por linha', await rows(`select campo, valor::float as v from analytics.shopee_escrow_campos_longo where order_id = 'P1' order by campo`), [
  { campo: 'buyer_paid_shipping_fee', v: 5 }, { campo: 'commission_fee', v: 8.5 }, { campo: 'escrow_amount', v: 40.12 },
  { campo: 'seller_return_refund', v: -12.3 }, { campo: 'taxa_nova', v: 0.49 },
]);
eq('RLS campos: com custos ve', await comoAuth(() => val(`select count(*)::int from analytics.shopee_escrow_campos_longo`)), 5);
await db.exec(`set teste.custos = 'false'`);
eq('RLS campos: sem custos nao ve a view', await comoAuth(() => val(`select count(*)::int from analytics.shopee_escrow_campos_longo`)), 0);
eq('RLS campos: sem custos nao ve a tabela', await comoAuth(() => val(`select count(*)::int from mkt.shopee_escrow_campos`)), 0);
await db.exec(`set teste.custos = 'true'`);
await db.exec(`set teste.canais = 'mercadolivre'`);
eq('RLS campos: sem o canal Shopee nao ve', await comoAuth(() => val(`select count(*)::int from analytics.shopee_escrow_campos_longo`)), 0);
await db.exec(`set teste.canais = 'mercadolivre,shopee,crm'`);
eq('RLS campos: sem escrita para authenticated', await comoAuth(() => tenta(`insert into mkt.shopee_escrow_campos (order_id, campos) values ('P3', '{}')`)), 'negado');
eq('RLS campos: authenticated nao executa a gravacao', await comoAuth(() => tenta(`select mkt.shopee_gravar_escrow_campos(array['P1'], '{}'::jsonb)`)), 'negado');
await db.exec(mig('0030_shopee_escrow_campos.sql'));
eq('0030 reexecutada preserva os campos', await val(`select count(*)::int from mkt.shopee_escrow_campos`), 1);
await db.exec(mig('0020_shopee_pagamentos.sql'));
await db.exec(mig('0030_shopee_escrow_campos.sql'));
eq('0020 + 0030 reaplicadas: pendentes com a regra da 0030', (await rows(`select * from mkt.shopee_pedidos_pendentes(500) as p order by 1`)).map((r) => Object.values(r)[0]),
  ['P2', 'P3']);

// ---------------- Reexecucao preserva dados ----------------
await db.exec(mig('0020_shopee_pagamentos.sql'));
eq('0020 reexecutada preserva o escrow', await val(`select count(*)::int from mkt.shopee_escrow`), 6);

// ---------------- 0031: protecao do frete, reembolso e pedidos reais ----------------
// A secao anterior reaplicou a 0020 (que redefine os pendentes): reaplica a 0030 e a 0031, na ordem documentada
await db.exec(mig('0030_shopee_escrow_campos.sql'));
await db.exec(mig('0031_shopee_categorias.sql'));
// Mesmas fixtures do teste do conector (as linhas esperadas la conferem com tarifasDoEscrow)
const reais = JSON.parse(readFileSync(`${repo}/packages/connectors/src/shopee/fixtures/escrow-reais.json`, 'utf8')).pedidos;
for (const f of reais) {
  await db.query(`insert into mkt.orders (channel, order_id, status, date_created, raw) values ('shopee', $1, 'paid', '2026-11-10 10:00-03', '{"order_status":"COMPLETED"}')`, [f.order_sn]);
  await db.query(`insert into mkt.order_items (channel, order_id, line_no, quantity, unit_price) values ('shopee', $1, 1, 1, $2)`, [f.order_sn, f.itens]);
  await gravarEscrow([f.order_sn], JSON.stringify(f.linhas.map((l) => ({ ...l, order_id: f.order_sn, data_ref: '2026-11-10' }))));
  eq(`conciliacao real ${f.order_sn}: diferenca 0,00`, await val(`select diferenca::text from analytics.shopee_conciliacao where order_id = $1`, [f.order_sn]), '0.00');
}
eq('categorias novas gravam (protecao_frete, reembolso)', await rows(`select categoria, valor::text as v from mkt.shopee_escrow where order_id = '260918B8KJMYJP' order by categoria`),
  [{ categoria: 'liquido', v: '-0.49' }, { categoria: 'protecao_frete', v: '0.49' }, { categoria: 'reembolso', v: '157.89' }]);
await erro('categoria invalida continua recusada', `select mkt.shopee_gravar_escrow(array['P1'], '[{"order_id":"P1","categoria":"inventada","valor":1,"data_ref":"2026-11-10"}]'::jsonb)`, /check/i);
// 0031 apaga os campos: todo pedido concluido volta a ser pendente e e regravado com o mapeamento novo
await gravarCampos(['P1'], camposP1);
eq('antes da 0031: P1 com campos', await val(`select count(*)::int from mkt.shopee_escrow_campos`), 1);
await db.exec(mig('0031_shopee_categorias.sql'));
eq('0031 reexecutada: campos apagados', await val(`select count(*)::int from mkt.shopee_escrow_campos`), 0);
eq('0031 reexecutada: escrow preservado', await val(`select count(*)::int from mkt.shopee_escrow where order_id = '260918B8KJMYJP'`), 3);
eq('0031: P1 e os pedidos reais voltam a ser pendentes', (await rows(`select * from mkt.shopee_pedidos_pendentes(500) as p`)).length, 3 + reais.length);

// =====================================================================
// 0032: anuncios e Shopee Ads (Tarefa 4). Banco novo com as funcoes do painel (0002..0019) + 0020..0032.
// =====================================================================
db = new PGlite();
await db.exec(readFileSync(`${repo}/supabase/tests/stubs.sql`, 'utf8'));
for (const f of ['0002_marketplaces.sql', '0003_regras_v1.sql', '0006_custo_por_cotacao.sql', '0007_de_para_modelo.sql',
  '0008_dashboard_admin.sql', '0009_dashboard_funcoes.sql', '0010_dashboard_metas.sql', '0011_rls_desempenho.sql',
  '0012_crm.sql', '0013_crm_funcoes.sql', '0018_ads_tabelas.sql', '0019_ads_funcoes.sql',
  '0020_shopee_pagamentos.sql', '0030_shopee_escrow_campos.sql', '0031_shopee_categorias.sql', '0032_shopee_ads.sql', '0032_shopee_ads.sql'])
  await db.exec(mig(f));
console.log('Banco novo: 0002..0019 + 0020, 0030, 0031 e 0032 (2x) aplicadas');
await db.exec(`
  create or replace function core.my_role() returns core.app_role language sql as $$ select 'admin'::core.app_role $$;
  create or replace function core.can_see_channel(ch text) returns boolean language sql as $$ select ch = any (string_to_array(coalesce(nullif(current_setting('teste.canais', true), ''), 'mercadolivre,shopee,crm'), ',')) $$;
  grant usage on schema core to authenticated;`);

// Anuncios da Shopee (mesmo formato do job): SH1 com SKU (modelo AAA11), SH2 sem SKU no anuncio nem na variacao
await db.exec(`
insert into mkt.items (channel, item_id, title, sku, status) values
 ('shopee','SH1','Caneca Shopee','AAA11-AZU','active'), ('shopee','SH2','Sem SKU',null,'active');
insert into mkt.item_variations (channel, item_id, variation_id, sku) values ('shopee','SH2','21','');
insert into mkt.ads_campaign_daily (channel, campaign_id, day, cost) values ('mercadolivre','c1','2026-11-05',100);`);

const D5 = '2026-11-05';
const M = (item, cost, extra = {}) => ({ item_id: item, day: D5, campaign_id: item === 'conta' ? 'conta' : 'c1', impressions: 10, clicks: 2, cost,
  direct_amount: 5, indirect_amount: 1, direct_units: 1, indirect_units: 0, organic_units: 0, ...extra });
const conta = JSON.stringify([{ day: D5, cost: 60, raw: { expense: 60 } }]);
const porAnuncio = JSON.stringify([M('SH1', 30), M('SH2', 20), M('conta', 10)]);
const gravarAds = (dias, m, c) => val(`select mkt.shopee_gravar_ads($1::date[], $2::jsonb, $3::jsonb)`, [dias, m, c]);
const adsShopee = () => rows(`select item_id, campaign_id, cost::float as c from mkt.ads_metrics_daily where channel = 'shopee' order by item_id collate "C"`);

eq('ads: grava as linhas por anuncio', await gravarAds([D5], porAnuncio, conta), 3);
eq('ads: 2a gravacao do mesmo dia', await gravarAds([D5], porAnuncio, conta), 3);
eq('ads: mesmo dia gravado 2x nao soma (Step 1)', await adsShopee(),
  [{ item_id: 'SH1', campaign_id: 'c1', c: 30 }, { item_id: 'SH2', campaign_id: 'c1', c: 20 }, { item_id: 'conta', campaign_id: 'conta', c: 10 }]);
eq('ads: conta na pseudo-campanha "conta" (investimento do dia), sem somar 2x', await rows(`select campaign_id, day::text as d, cost::float as c, raw from mkt.ads_campaign_daily where channel = 'shopee'`),
  [{ campaign_id: 'conta', d: D5, c: 60, raw: { expense: 60 } }]);
eq('ads: linha repetida no mesmo envio fica uma so', await gravarAds([D5], JSON.stringify([M('SH1', 30), M('SH1', 30)]), conta), 1);
eq('ads: nova busca do dia substitui (anuncio que sumiu sai)', await adsShopee(), [{ item_id: 'SH1', campaign_id: 'c1', c: 30 }]);
// Por anuncio indisponivel na nova busca: so a conta; nada do por-anuncio antigo fica somado junto
await gravarAds([D5], JSON.stringify([M('conta', 60)]), conta);
eq('ads: por anuncio indisponivel -> uma linha "conta" com o total do dia', await adsShopee(), [{ item_id: 'conta', campaign_id: 'conta', c: 60 }]);
eq('ads: Mercado Livre intocado', await rows(`select channel, campaign_id, cost::float as c from mkt.ads_campaign_daily where channel = 'mercadolivre'`),
  [{ channel: 'mercadolivre', campaign_id: 'c1', c: 100 }]);
eq('ads: dia fora da lista nao e apagado nem gravado', await gravarAds(['2026-11-06'], porAnuncio, '[]'), 0);
eq('ads: dia 05 preservado', (await adsShopee()).length, 1);
eq('ads: pseudo-campanha "conta" cadastrada', await rows(`select name from mkt.ads_campaigns where channel = 'shopee' and campaign_id = 'conta'`),
  [{ name: 'Shopee Ads (conta inteira)' }]);
eq('ads: Mercado Livre nao recebe o Ads da Shopee (dash_ads_periodo ML)', await val(`select analytics.dash_ads_periodo('mercadolivre', '2026-11-01', '2026-11-30')::float`), 100);

// ---------------- Step 2: anuncio sem SKU equivalente cai em "sem modelo"; tabela = cartao (Review Focus 4) ----------------
await gravarAds([D5], porAnuncio, conta);
eq('sem modelo: SH1 -> AAA11; SH2 (sem SKU) e o resto da conta -> modelo nulo',
  await rows(`select modelo, investimento::float as inv, vendas_ads::float as v from analytics.ads_metricas_modelo('shopee', '2026-11-01', '2026-11-30') order by modelo nulls last`),
  [{ modelo: 'AAA11', inv: 30, v: 6 }, { modelo: null, inv: 30, v: 12 }]);
// Contrato para a Tarefa 5 (0021): o cartao de investimento da Shopee = soma de mkt.ads_campaign_daily ('conta').
// Ate a 0021, dash_ads_periodo devolve 0 para a Shopee; aqui ele e simulado com esse contrato.
await db.exec(`
create or replace function analytics.dash_ads_periodo(p_canal text, p_de date, p_ate date) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select sum(a.cost) from mkt.ads_campaign_daily a
                    where a.channel = 'shopee' and p_canal in ('consolidado', 'shopee') and a.day between p_de and p_ate), 0)
$$;`);
const cartao = await val(`select investimento::float from analytics.ads_resumo('shopee', '2026-11-01', '2026-11-30')`);
eq('cartao: investimento da Shopee = conta do dia', cartao, 60);
const tabela = await rows(`select modelo, investimento::float as inv from analytics.ads_modelos('shopee', '2026-11-01', '2026-11-30') order by modelo nulls last`);
eq('tabela: AAA11 e a linha "sem modelo / nao atribuido"', tabela, [{ modelo: 'AAA11', inv: 30 }, { modelo: null, inv: 30 }]);
eq('tabela: soma = cartao', tabela.reduce((s, r) => s + r.inv, 0), cartao);
eq('resumo: vendas por Ads = vendas da conta (direta + indireta)', await val(`select vendas_ads::float from analytics.ads_resumo('shopee', '2026-11-01', '2026-11-30')`), 18);
eq('campanhas: soma = cartao', (await rows(`select investimento::float as inv from analytics.ads_campanhas('shopee', '2026-11-01', '2026-11-30')`)).reduce((s, r) => s + r.inv, 0), cartao);
// So a conta (por anuncio indisponivel): tudo "sem modelo", e a soma continua batendo
await gravarAds([D5], JSON.stringify([M('conta', 60)]), conta);
const tabela2 = await rows(`select modelo, investimento::float as inv from analytics.ads_modelos('shopee', '2026-11-01', '2026-11-30')`);
eq('so a conta: uma linha "sem modelo" = cartao', tabela2, [{ modelo: null, inv: 60 }]);

// ---------------- Seguranca e reexecucao ----------------
eq('ads: authenticated nao executa a gravacao', await comoAuth(() => tenta(`select mkt.shopee_gravar_ads(array['2026-11-05']::date[], '[]'::jsonb, '[]'::jsonb)`)), 'negado');
await db.exec(mig('0032_shopee_ads.sql'));
eq('0032 reexecutada preserva o Ads', (await adsShopee()).length, 1);

console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
process.exit(fails ? 1 : 0);
