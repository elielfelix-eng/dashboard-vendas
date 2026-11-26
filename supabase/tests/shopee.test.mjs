import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Shopee (migrations 0020, 0030, 0031): pagamentos (escrow), view analytics.shopee_fatura, pendentes e idempotencia.
// Shopee (migration 0032): Ads da conta e por anuncio sem somar o dia 2x; "sem modelo" e tabela = cartao.
// Shopee (migration 0021): funcoes do painel com vendas, tarifas, margem e Ads da Shopee; ML identico antes/depois.
// Shopee (migration 0033): Ads por produto da Shopee (ranking e sugestoes, limites do ML); ML identico antes/depois.
// Crescimento (migration 0022): crescimento_canal por canal, margens nulas sem custos, parametros com vigencia e RLS.
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
// Contrato da Tarefa 5: o cartao de investimento da Shopee = soma de mkt.ads_campaign_daily ('conta'), lido pela 0021.
await db.exec(mig('0021_shopee_funcoes.sql'));
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

// =====================================================================
// 0021: funcoes do painel com a Shopee (Tarefa 5). Banco novo com Mercado Livre e Shopee em outubro/2026.
// O retrato do Mercado Livre e tirado ANTES da 0021 e conferido depois (nada do ML pode mudar).
// =====================================================================
db = new PGlite();
await db.exec(readFileSync(`${repo}/supabase/tests/stubs.sql`, 'utf8'));
for (const f of ['0002_marketplaces.sql', '0003_regras_v1.sql', '0006_custo_por_cotacao.sql', '0007_de_para_modelo.sql',
  '0008_dashboard_admin.sql', '0009_dashboard_funcoes.sql', '0010_dashboard_metas.sql', '0011_rls_desempenho.sql',
  '0012_crm.sql', '0013_crm_funcoes.sql', '0018_ads_tabelas.sql', '0019_ads_funcoes.sql',
  '0020_shopee_pagamentos.sql', '0030_shopee_escrow_campos.sql', '0031_shopee_categorias.sql', '0032_shopee_ads.sql'])
  await db.exec(mig(f));
console.log('Banco novo (0021): 0002..0019 + 0020, 0030, 0031 e 0032 aplicadas, ainda sem a 0021');
await db.exec(`
  create or replace function core.my_role() returns core.app_role language sql as $$ select coalesce(nullif(current_setting('teste.perfil', true), ''), 'admin')::core.app_role $$;
  create or replace function core.can_see_channel(ch text) returns boolean language sql as $$ select ch = any (string_to_array(coalesce(nullif(current_setting('teste.canais', true), ''), 'mercadolivre,shopee,crm'), ',')) $$;
  grant usage on schema core to authenticated;`);
const perfil = (p) => db.exec(`set teste.perfil = '${p}'`);
const canais = (c) => db.exec(`set teste.canais = '${c}'`);
await perfil('admin'); await canais('mercadolivre,shopee,crm');

// ---------------- Mercado Livre (mesmo cenario de ads.test.mjs + cancelado, devolvido e parametros) ----------------
await db.exec(`
insert into core.accounts (channel, external_id, active) values ('mercadolivre', 'ml1', true), ('shopee', 'sh1', true);
insert into core.orcamento_ads (channel, vigente_desde, valor_mensal) values ('mercadolivre', '2026-10-01', 3000), ('shopee', '2026-10-01', 1000);
insert into core.parametros_custo (channel, imposto_pct, embalagem_pedido, embalagem_peca, vigente_desde) values
 ('mercadolivre', 8, 2, 0.5, '2026-01-01'), ('shopee', 10, 1, 0, '2026-01-01');
insert into erp.cost_tiers (product_id, qty_start, qty_end, price, created_at, source) values
 ('AAA11',1,49,10,'2026-01-01','erp'), ('BBB22',1,49,5,'2026-01-01','erp'), ('DDD44',1,49,1,'2026-01-01','erp'), ('SHP01',1,49,7,'2026-01-01','erp');
insert into mkt.orders (channel, order_id, status, date_created, date_closed, total_amount, raw, shipment_id, shipping_cost_seller, shipment_status) values
 ('mercadolivre','P1','paid','2026-10-10 12:00+00','2026-10-10 12:00+00',200,'{}','s1',null,null),
 ('mercadolivre','P2','paid','2026-10-12 12:00+00','2026-10-12 12:00+00',100,'{}','s2',null,null),
 ('mercadolivre','P3','paid','2026-10-15 12:00+00','2026-10-15 12:00+00',50,'{}','s3',9,null),
 ('mercadolivre','P4','paid','2026-10-20 12:00+00','2026-10-20 12:00+00',30,'{}','s4',6,null),
 ('mercadolivre','P5','paid','2026-09-20 12:00+00','2026-09-20 12:00+00',70,'{}','s5',null,null),
 ('mercadolivre','P6','cancelled','2026-10-13 12:00+00','2026-10-13 12:00+00',30,'{}','s6',null,'cancelled'),
 ('mercadolivre','P7','cancelled','2026-10-14 12:00+00','2026-10-14 12:00+00',70,'{}','s7',null,'delivered');
insert into mkt.order_items (channel, order_id, line_no, item_id, sku, title, quantity, unit_price, sale_fee) values
 ('mercadolivre','P1',1,'MLB1','AAA11-AZU','Produto A',2,100,11),
 ('mercadolivre','P2',1,'MLB1','AAA11-AZU','Produto A',1,60,7),
 ('mercadolivre','P2',2,'MLB2','BBB22-AZU','Produto B',1,40,5),
 ('mercadolivre','P3',1,'MLB3','CCC33-AZU','Produto C',1,50,6),
 ('mercadolivre','P4',1,'MLB4','DDD44-AZU','Produto D',1,30,4),
 ('mercadolivre','P5',1,'MLB5','EEE55-AZU','Produto E',1,70,8),
 ('mercadolivre','P6',1,'MLB4','DDD44-AZU','Produto D',1,30,4),
 ('mercadolivre','P7',1,'MLB1','AAA11-AZU','Produto A',1,70,8);
insert into mkt.items (channel, item_id, title, sku) values
 ('mercadolivre','MLB1','Anuncio A',null), ('mercadolivre','MLB2','Anuncio B',null), ('mercadolivre','MLB3','Anuncio C',null),
 ('mercadolivre','MLB9','Anuncio sem SKU',null);
insert into mkt.billing_details (period_key, detail_id, created_at, detail_type, code, amount, order_id) values
 ('2026-10','f1','2026-10-11 10:00+00','CHARGE','CVVML',20,'P1'),
 ('2026-10','f2','2026-10-11 10:00+00','CHARGE','PADS',12,'P1'),
 ('2026-10','f3','2026-10-13 10:00+00','CHARGE','PADS',10,'P2'),
 ('2026-10','f3b','2026-10-13 10:00+00','CHARGE','CXDE',15,'P2'),
 ('2026-10','f4','2026-10-04 06:00+00','CHARGE','PADS',7,null),
 ('2026-10','f5','2026-10-22 06:00+00','CHARGE','PADS',99,null),
 ('2026-10','f6','2026-10-08 06:00+00','CHARGE','CDLIT',8,null),
 ('2026-10','f8','2026-10-15 10:00+00','CHARGE','CXDE',12,'P7'),
 ('2026-09','f7','2026-09-16 06:00+00','CHARGE','PADS',15,null);
insert into mkt.ads_campaign_daily (channel, campaign_id, day, cost) values
 ('mercadolivre','c1','2026-10-05',100), ('mercadolivre','c1','2026-10-20',50), ('mercadolivre','c2','2026-10-10',30),
 ('mercadolivre','c1','2026-10-15',5);
insert into mkt.ads_campaigns (channel, campaign_id, name, status, budget, roas_target, automatica) values
 ('mercadolivre','c1','Campanha 1','active',40,4,false), ('mercadolivre','c3','Campanha 3','active',10,null,true);
insert into mkt.ads_metrics_daily (channel, item_id, day, campaign_id, impressions, clicks, cost, direct_amount, indirect_amount, direct_units, indirect_units, organic_units) values
 ('mercadolivre','MLB1','2026-10-05','c1',1000,50,60,300,0,3,0,0),
 ('mercadolivre','MLB1','2026-10-20','c1',500,20,30,0,100,0,1,0),
 ('mercadolivre','MLB2','2026-10-06','c1',400,10,20,40,0,1,0,0),
 ('mercadolivre','MLB3','2026-10-10','c2',200,8,25,0,0,0,0,0),
 ('mercadolivre','MLB9','2026-10-10','c2',100,2,5,0,0,0,0,0);
insert into mkt.ads_anuncios (channel, item_id, campaign_id, status) values
 ('mercadolivre','MLB1','c1','active'), ('mercadolivre','MLB2','c1','active'), ('mercadolivre','MLB3','c2','paused');
`);

// ---------------- Shopee (gravada pelos mesmos caminhos do job) ----------------
// S1 pago com escrow; S2 TO_RETURN (pago, decisao 1) com reembolso; S3 pago ainda sem escrow (estimado);
// S4 cancelado depois de pago com escrow (custo do periodo, sem venda); S5 cancelado sem pagamento (decisao 2); S6 nao pago.
const pedidoShopee = async (id, status, bruto, criado, pago, sku, qtd, preco) => {
  await db.query(`insert into mkt.orders (channel, order_id, status, date_created, date_closed, total_amount, tags, raw)
    values ('shopee', $1, $2, $3, $4, $5, array['shopee:' || $6::text], jsonb_build_object('order_status', $6::text))`,
  [id, status, criado, pago, qtd * preco, bruto]);
  await db.query(`insert into mkt.order_items (channel, order_id, line_no, item_id, sku, title, quantity, unit_price)
    values ('shopee', $1, 1, $2, $3, 'Produto Shopee', $4, $5)`, [id, sku.startsWith('AAA11') ? 'SH1' : 'SH2', sku, qtd, preco]);
};
await pedidoShopee('S1', 'paid', 'COMPLETED', '2026-10-15 10:00-03', '2026-10-15 10:05-03', 'AAA11-AZU', 2, 50);
await pedidoShopee('S2', 'paid', 'TO_RETURN', '2026-10-16 10:00-03', '2026-10-16 10:05-03', 'SHP01-X', 1, 100);
await pedidoShopee('S3', 'paid', 'READY_TO_SHIP', '2026-10-20 10:00-03', '2026-10-20 10:05-03', 'SHP01-X', 1, 60);
await pedidoShopee('S4', 'cancelled', 'CANCELLED', '2026-10-17 10:00-03', '2026-10-17 10:05-03', 'SHP01-X', 1, 40);
await pedidoShopee('S5', 'cancelled', 'CANCELLED', '2026-10-18 10:00-03', null, 'SHP01-X', 1, 30);
await pedidoShopee('S6', 'unpaid', 'UNPAID', '2026-10-19 10:00-03', null, 'SHP01-X', 1, 25);
const esc = (id, l) => gravarEscrow([id], JSON.stringify(Object.entries(l).map(([categoria, valor]) => ({ order_id: id, categoria, valor, data_ref: '2026-10-15' }))));
await esc('S1', { comissao: 12, taxa_servico: 6, taxa_transacao: 2, frete: 4, cupom_vendedor: 5, liquido: 71 });
await esc('S2', { comissao: 12, taxa_servico: 6, taxa_transacao: 2, reembolso: 100, liquido: -20 });
await esc('S4', { comissao: 8, liquido: 32 });
await db.exec(`insert into mkt.items (channel, item_id, title, sku, status) values ('shopee','SH1','Caneca Shopee','AAA11-AZU','active'), ('shopee','SH2','Copo Shopee','SHP01-X','active')`);
const MS = (day, cost, direct, indirect) => ({ item_id: 'conta', day, campaign_id: 'conta', impressions: 100, clicks: 10, cost,
  direct_amount: direct, indirect_amount: indirect, direct_units: 1, indirect_units: 0, organic_units: 0 });
await gravarAds(['2026-10-15', '2026-10-16'], JSON.stringify([MS('2026-10-15', 30, 120, 30), MS('2026-10-16', 10, 20, 0)]),
  JSON.stringify([{ day: '2026-10-15', cost: 30, raw: {} }, { day: '2026-10-16', cost: 10, raw: {} }]));

// ---------------- Retrato do Mercado Livre (e do consolidado das sugestoes) ----------------
const OUT21 = `'2026-10-01'::date, '2026-10-31'::date`;
const RETRATO = {
  base: `select * from analytics.dash_pedidos_base('2026-01-01', '2026-12-31') where channel = 'mercadolivre' order by order_id`,
  resumo_out: `select * from analytics.dash_resumo('mercadolivre', ${OUT21})`,
  resumo_set: `select * from analytics.dash_resumo('mercadolivre', '2026-09-01', '2026-09-30')`,
  mensal: `select * from analytics.dash_resultado_mensal('mercadolivre', '2026-08-01', '2026-10-31')`,
  serie_dia: `select * from analytics.dash_serie('mercadolivre', ${OUT21}, 'dia')`,
  serie_semana: `select * from analytics.dash_serie('mercadolivre', ${OUT21}, 'semana')`,
  itens: `select * from analytics.dash_itens('mercadolivre', ${OUT21}) order by order_id, item_id, sku`,
  modelos: `select * from analytics.dash_modelos('mercadolivre', ${OUT21})`,
  skus: `select * from analytics.dash_skus('mercadolivre', ${OUT21}, null)`,
  pedidos: `select * from analytics.dash_pedidos('mercadolivre', ${OUT21}, null)`,
  alertas: `select * from analytics.dash_alertas('mercadolivre', ${OUT21})`,
  custos_periodo: `select * from analytics.dash_custos_periodo('mercadolivre', ${OUT21}) order by categoria`,
  ads_periodo: `select analytics.dash_ads_periodo('mercadolivre', ${OUT21}) as v, analytics.dash_ads_periodo('mercadolivre', '2026-09-01', '2026-09-30') as s`,
  metas: `select * from analytics.dash_metas('mercadolivre', 2026, '2026-10-20')`,
  ads_resumo: `select * from analytics.ads_resumo('mercadolivre', ${OUT21})`,
  ads_resumo_leve: `select * from analytics.ads_resumo('mercadolivre', ${OUT21}, false)`,
  ads_serie: `select * from analytics.ads_serie('mercadolivre', ${OUT21})`,
  ads_metricas: `select * from analytics.ads_metricas_modelo('mercadolivre', ${OUT21}) order by modelo`,
  ads_modelos: `select * from analytics.ads_modelos('mercadolivre', ${OUT21})`,
  ads_campanhas: `select * from analytics.ads_campanhas('mercadolivre', ${OUT21})`,
  ads_sugestoes: `select * from analytics.ads_sugestoes('mercadolivre', '2026-10-31')`,
  ads_sugestoes_cons: `select * from analytics.ads_sugestoes('consolidado', '2026-10-31')`,
  ads_orcamento: `select * from analytics.ads_orcamento('mercadolivre', '2026-10-20')`,
  ads_seguidores: `select * from analytics.ads_seguidores('mercadolivre', ${OUT21})`,
};
const retrato = async () => {
  const r = {};
  for (const [k, sql] of Object.entries(RETRATO)) r[k] = await rows(sql);
  return r;
};
const antesAdmin = await retrato();
await perfil('comercial');
const antesComercial = await comoAuth(retrato);
await perfil('admin');
eq('retrato do ML tem dados (pedidos, modelos, Ads)', [antesAdmin.base.length, antesAdmin.modelos.length > 1, antesAdmin.ads_modelos.length > 1], [7, true, true]);

await db.exec(mig('0021_shopee_funcoes.sql'));
await db.exec(mig('0021_shopee_funcoes.sql')); // reexecutavel
console.log('0021 aplicada (2x)');

// ---------------- Mercado Livre identico antes e depois da 0021 (decisao 6) ----------------
const depoisAdmin = await retrato();
for (const k of Object.keys(RETRATO)) eq(`ML igual antes/depois (admin): ${k}`, depoisAdmin[k], antesAdmin[k]);
await perfil('comercial');
const depoisComercial = await comoAuth(retrato);
await perfil('admin');
for (const k of Object.keys(RETRATO)) eq(`ML igual antes/depois (comercial, RLS): ${k}`, depoisComercial[k], antesComercial[k]);

// ---------------- Step 1: dash_resumo('shopee') devolve as vendas da Shopee ----------------
const RES21 = `select pedidos, vendas_brutas::float, unidades, ticket_medio::float, cancelados, devolvidos, pct_cancel_devol::float,
  receita::float, comissao::float, frete::float, parcelamento::float, product_ads::float, seguidores::float, estornos::float,
  difal::float, outras::float, custo_produto::float, imposto::float, embalagem::float, margem_bruta::float,
  margem_contribuicao::float, pedidos_sem_custo, canceladas_valor::float, devolvidas_valor::float, estimados
  from analytics.dash_resumo($1, '2026-10-01', '2026-10-31')`;
const res21 = async (c) => (await rows(RES21, [c]))[0];
const r2 = (x) => Math.round(x * 100) / 100;
const sh = await res21('shopee');
eq('resumo shopee: vendas (S1..S4; S5 cancelado sem pagamento e S6 nao pago ficam fora)',
  { p: sh.pedidos, vb: sh.vendas_brutas, u: sh.unidades, t: sh.ticket_medio, c: sh.cancelados, d: sh.devolvidos, pct: sh.pct_cancel_devol, r: sh.receita, cv: sh.canceladas_valor },
  { p: 4, vb: 300, u: 5, t: 75, c: 1, d: 0, pct: 25, r: 260, cv: 40 });
eq('decisao 1: TO_RETURN conta como venda paga (receita inclui S2)', await rows(`select order_id, classe from analytics.dash_pedidos_base('2026-10-01', '2026-10-31') where channel = 'shopee' order by order_id`),
  [{ order_id: 'S1', classe: 'pago' }, { order_id: 'S2', classe: 'pago' }, { order_id: 'S3', classe: 'pago' },
   { order_id: 'S4', classe: 'cancelado' }, { order_id: 'S5', classe: 'outro' }, { order_id: 'S6', classe: 'outro' }]);
eq('decisao 2: cancelado sem pagamento nao infla a taxa de cancelamento (1 de 4, nao 2 de 5)', [sh.cancelados, sh.pct_cancel_devol], [1, 25]);
eq('serie shopee: dia 15 (S1), 17 (S4 cancelado) e 18 (S5 fora)',
  (await rows(`select periodo::text as d, vendas_brutas::float as v, pedidos as p, receita::float as r from analytics.dash_serie('shopee', '2026-10-15', '2026-10-18', 'dia')`)),
  [{ d: '2026-10-15', v: 100, p: 1, r: 100 }, { d: '2026-10-16', v: 100, p: 1, r: 100 }, { d: '2026-10-17', v: 40, p: 1, r: 0 }, { d: '2026-10-18', v: 0, p: 0, r: 0 }]);
eq('resultado mensal shopee: outubro = resumo', (await rows(`select vendas_brutas::float as v, margem_contribuicao::float as m from analytics.dash_resultado_mensal('shopee', '2026-10-01', '2026-10-31')`)),
  [{ v: 300, m: sh.margem_contribuicao }]);
eq('metas: realizado da Shopee em outubro = receita', (await rows(`select realizado::float as r from analytics.dash_metas('shopee', 2026, '2026-10-20') where mes = '2026-10-01'`)), [{ r: 260 }]);

// ---------------- Step 2: margem desconta comissao, taxas e frete do escrow; sem escrow = estimada e marcada ----------------
eq('resumo shopee: tarifas do escrow (S1, S2, S4 cancelado) + estimativa de S3 (taxas 20%, frete 2%, outras 2,5% da venda)',
  { com: sh.comissao, fr: sh.frete, out: sh.outras, parc: sh.parcelamento, est: sh.estimados },
  { com: 60, fr: 5.2, out: 106.5, parc: 0, est: 1 });
eq('resumo shopee: Ads da conta, custo, imposto e embalagem da Shopee',
  { ads: sh.product_ads, cp: sh.custo_produto, imp: sh.imposto, emb: sh.embalagem, sc: sh.pedidos_sem_custo }, { ads: 40, cp: 34, imp: 26, emb: 3, sc: 0 });
eq('resumo shopee: margens (contribuicao = 260 - 211,70 - 26 - 3 - 34)', [sh.margem_bruta, sh.margem_contribuicao], [226, -14.7]);
const B21 = `select order_id, comissao::float as c, frete::float as f, outras::float as o, frete_estimado as e
  from analytics.dash_pedidos_base('2026-10-01', '2026-10-31') where channel = 'shopee' order by order_id`;
eq('base shopee: tarifas por pedido (S4 cancelado depois de pago: custo do escrow conta; S3 estimado e marcado)', await rows(B21), [
  { order_id: 'S1', c: 20, f: 4, o: 5, e: false }, { order_id: 'S2', c: 20, f: 0, o: 100, e: false }, { order_id: 'S3', c: 12, f: 1.2, o: 1.5, e: true },
  { order_id: 'S4', c: 8, f: 0, o: 0, e: false }, { order_id: 'S5', c: 0, f: 0, o: 0, e: false }, { order_id: 'S6', c: 0, f: 0, o: 0, e: false }]);
const semEstimar = (await rows(B21)).find((x) => x.order_id === 'S3');
eq('sem escrow a margem nao sai inflada (tarifa estimada > 0)', semEstimar.c + semEstimar.f + semEstimar.o > 0, true);
// Escrow chega: a estimativa sai e entram os valores reais
await esc('S3', { comissao: 7, taxa_servico: 3.6, taxa_transacao: 1.2, liquido: 48.2 });
eq('escrow chegou: S3 com o valor real, sem marca', (await rows(B21)).find((x) => x.order_id === 'S3'), { order_id: 'S3', c: 11.8, f: 0, o: 0, e: false });
await db.exec(`delete from mkt.shopee_escrow where order_id = 'S3'`);
// Sem nenhum historico de escrow: estimativa zero, mas o pedido continua marcado como estimado
await db.exec(`update mkt.orders set status = 'unpaid' where order_id in ('S1', 'S2')`);
eq('sem historico de escrow: marcado como estimado', (await rows(B21)).find((x) => x.order_id === 'S3').e, true);
await db.exec(`update mkt.orders set status = 'paid' where order_id in ('S1', 'S2')`);
// Janela de 90 dias: so S1 nela (S2 vendido em junho) -> taxa de S1 (20%, 4%, 5%); janela vazia -> todo o historico
const mover = (ids, d) => db.exec(`update mkt.orders set date_created = '${d} 10:00-03', date_closed = '${d} 10:05-03' where order_id in (${ids.map((x) => `'${x}'`).join(', ')})`);
await mover(['S2'], '2026-06-01');
eq('estimativa: janela de 90 dias com S1 usa so S1 (ignora S2 de junho)', (await rows(B21)).find((x) => x.order_id === 'S3'), { order_id: 'S3', c: 12, f: 2.4, o: 3, e: true });
await mover(['S1'], '2026-06-01');
eq('estimativa: janela de 90 dias vazia -> todos os pedidos com escrow (S1 + S2 de junho)', (await rows(B21)).find((x) => x.order_id === 'S3'), { order_id: 'S3', c: 12, f: 1.2, o: 1.5, e: true });
await mover(['S1'], '2026-10-15'); await mover(['S2'], '2026-10-16');
// Cancelado depois de pago (decisao do dono, rodada 1): custo do escrow e perda do periodo, sem venda
const antesCanc = await res21('shopee');
await db.exec(`delete from mkt.shopee_escrow where order_id = 'S4'`);
const semCanc = await res21('shopee');
await esc('S4', { comissao: 8, liquido: 32 });
eq('cancelado depois de pago com escrow: margem cai exatamente o custo (8), sem venda a mais',
  { m: r2(semCanc.margem_contribuicao - antesCanc.margem_contribuicao), r: antesCanc.receita - semCanc.receita, vb: antesCanc.vendas_brutas - semCanc.vendas_brutas,
    p: antesCanc.pedidos - semCanc.pedidos, c: r2(antesCanc.comissao - semCanc.comissao) },
  { m: 8, r: 0, vb: 0, p: 0, c: 8 });
eq('modelos shopee: contribuicao soma a margem do resumo',
  Math.round((await rows(`select contribuicao::float as c from analytics.dash_modelos('shopee', ${OUT21})`)).reduce((s, m) => s + m.c, 0) * 100) / 100, -14.7);
eq('modelos shopee: AAA11 e SHP01', (await rows(`select modelo, vendas_brutas::float as v, receita::float as r, custo_produto::float as c from analytics.dash_modelos('shopee', ${OUT21}) order by modelo`)),
  [{ modelo: 'AAA11', v: 100, r: 100, c: 20 }, { modelo: 'SHP01', v: 200, r: 160, c: 14 }]);

// ---------------- Step 3: consolidado = soma dos canais, sem duplicar pedido nem tarifa ----------------
const ml = await res21('mercadolivre');
const co = await res21('consolidado');
const SOMA = ['pedidos', 'vendas_brutas', 'unidades', 'cancelados', 'devolvidos', 'receita', 'comissao', 'frete', 'parcelamento', 'product_ads',
  'seguidores', 'estornos', 'difal', 'outras', 'custo_produto', 'imposto', 'embalagem', 'margem_bruta', 'margem_contribuicao',
  'pedidos_sem_custo', 'canceladas_valor', 'devolvidas_valor', 'estimados'];
eq('consolidado = ML + Shopee (campo a campo)', SOMA.map((k) => r2(co[k])), SOMA.map((k) => r2(ml[k] + sh[k])));
eq('consolidado: cada pedido uma vez', await rows(`select count(*)::int as n, count(distinct (channel, order_id))::int as d from analytics.dash_pedidos_base('2026-10-01', '2026-10-31')`),
  [{ n: 12, d: 12 }]);
eq('consolidado: tarifa da Shopee uma vez (escrow de pedido pago e cancelado + estimativa)', r2(co.comissao - ml.comissao), 60);
eq('consolidado: modelos somam os dois canais (AAA11 = ML + Shopee)',
  (await rows(`select modelo, vendas_brutas::float as v from analytics.dash_modelos('consolidado', ${OUT21}) where modelo = 'AAA11'`))[0].v,
  (await rows(`select vendas_brutas::float as v from analytics.dash_modelos('mercadolivre', ${OUT21}) where modelo = 'AAA11'`))[0].v + 100);
eq('consolidado: contribuicao dos modelos = margem do resumo',
  r2((await rows(`select contribuicao::float as c from analytics.dash_modelos('consolidado', ${OUT21})`)).reduce((s, m) => s + m.c, 0)), r2(co.margem_contribuicao));
eq('metas consolidado: realizado = ML + Shopee', (await rows(`select realizado::float as r from analytics.dash_metas('consolidado', 2026, '2026-10-20') where mes = '2026-10-01'`))[0].r,
  (await rows(`select realizado::float as r from analytics.dash_metas('mercadolivre', 2026, '2026-10-20') where mes = '2026-10-01'`))[0].r + 260);

// ---------------- Step 4: sem 'custos' nao le tarifas nem margem da Shopee ----------------
await perfil('comercial');
const shc = await comoAuth(() => res21('shopee'));
eq('comercial: tarifas e margem da Shopee nulas', [shc.comissao, shc.frete, shc.parcelamento, shc.seguidores, shc.estornos, shc.difal, shc.outras,
  shc.custo_produto, shc.imposto, shc.embalagem, shc.margem_bruta, shc.margem_contribuicao], Array(12).fill(null));
eq('comercial: vendas e Ads da Shopee visiveis, sem estimados', [shc.vendas_brutas, shc.receita, shc.product_ads, shc.estimados], [300, 260, 40, 0]);
eq('comercial: base sem tarifa da Shopee', await comoAuth(() => rows(`select distinct comissao, frete, outras, custo_produto from analytics.dash_pedidos_base('2026-10-01', '2026-10-31') where channel = 'shopee'`)),
  [{ comissao: null, frete: null, outras: null, custo_produto: null }]);
eq('comercial: itens e modelos da Shopee sem tarifas', await comoAuth(async () => [
  (await rows(`select distinct tarifas from analytics.dash_itens('shopee', ${OUT21})`)).map((x) => x.tarifas),
  (await rows(`select distinct tarifas_frete, contribuicao from analytics.dash_modelos('shopee', ${OUT21})`))]),
  [[null], [{ tarifas_frete: null, contribuicao: null }]]);
eq('comercial: consolidado sem tarifa da Shopee (so as do ML)', (await comoAuth(() => res21('consolidado'))).comissao, Number(depoisComercial.resumo_out[0].comissao));
await perfil('admin');
await canais('mercadolivre');
eq('sem o canal Shopee: resumo da Shopee vazio e consolidado = ML', [(await comoAuth(() => res21('shopee'))).pedidos, (await comoAuth(() => res21('consolidado'))).vendas_brutas],
  [0, ml.vendas_brutas]);
eq('sem o canal Shopee: Ads da Shopee 0', await comoAuth(() => val(`select analytics.dash_ads_periodo('shopee', ${OUT21})::float`)), 0);
await canais('mercadolivre,shopee,crm');

// ---------------- Step 5: Ads da Shopee (conta) no consolidado e so a Shopee em 'shopee' ----------------
const adsP = (c) => val(`select analytics.dash_ads_periodo('${c}', ${OUT21})::float`);
const adsMl = await adsP('mercadolivre');
eq('dash_ads_periodo: shopee = conta (30 + 10)', await adsP('shopee'), 40);
eq('dash_ads_periodo: consolidado = ML + Shopee', await adsP('consolidado'), adsMl + 40);
const serie = (c) => rows(`select dia::text as d, investimento::float as i, vendas_ads::float as v from analytics.ads_serie('${c}', ${OUT21})`);
const sSh = await serie('shopee'); const sMl = await serie('mercadolivre'); const sCo = await serie('consolidado');
eq('ads_serie shopee: so os dias da Shopee', sSh.filter((x) => x.i || x.v), [{ d: '2026-10-15', i: 30, v: 150 }, { d: '2026-10-16', i: 10, v: 20 }]);
eq('ads_serie: soma = dash_ads_periodo (gemea), nos tres canais', [sSh, sMl, sCo].map((s) => r2(s.reduce((a, x) => a + x.i, 0))), [40, adsMl, adsMl + 40]);
eq('ads_serie consolidado: cada dia = ML + Shopee', sCo.every((x, i) => r2(x.i) === r2(sMl[i].i + sSh[i].i) && r2(x.v) === r2(sMl[i].v + sSh[i].v)), true);
const orc = await rows(`select canal, gasto_product_ads::float as g, gasto_mes::float as m from analytics.ads_orcamento('consolidado', '2026-10-20')`);
eq('ads_orcamento: Shopee = Ads da conta no mes; consolidado = soma', orc.map((x) => [x.canal, x.g]),
  [['mercadolivre', orc[0].g], ['shopee', 40], ['consolidado', r2(orc[0].g + 40)]]);
eq('ads_orcamento shopee: so a Shopee', (await rows(`select canal, gasto_product_ads::float as g from analytics.ads_orcamento('shopee', '2026-10-20')`)), [{ canal: 'shopee', g: 40 }]);
const RS = `select investimento::float as i, vendas_ads::float as v, roas::float, acos::float, tacos::float, vendas_brutas_canal::float as vb,
  nao_atribuido::float as na, tem_detalhe as t from analytics.ads_resumo($1, '2026-10-01', '2026-10-31')`;
const rsSh = (await rows(RS, ['shopee']))[0]; const rsMl = (await rows(RS, ['mercadolivre']))[0]; const rsCo = (await rows(RS, ['consolidado']))[0];
eq('ads_resumo shopee: conta inteira (ROAS 170/40, ACOS, TACOS sobre 300), tudo nao atribuido',
  rsSh, { i: 40, v: 170, roas: 4.25, acos: 23.53, tacos: 13.33, vb: 300, na: 40, t: true });
eq('ads_resumo: vendas brutas = dash_resumo (shopee e consolidado)', [rsSh.vb, rsCo.vb], [sh.vendas_brutas, co.vendas_brutas]);
eq('ads_resumo consolidado: investimento e vendas somam (ROAS nao inflado)', [rsCo.i, rsCo.v, rsCo.roas],
  [r2(rsMl.i + 40), r2(rsMl.v + 170), r2((rsMl.v + 170) / (rsMl.i + 40))]);
eq('ads_resumo consolidado: nao atribuido = ML + Shopee (nunca negativo)', [rsCo.na, rsCo.na >= 0], [r2(rsMl.na + 40), true]);
const camp = (c) => rows(`select campanha_id, nome, investimento::float as i, vendas_ads::float as v, roas::float from analytics.ads_campanhas('${c}', ${OUT21})`);
eq('ads_campanhas shopee: so a conta, soma = cartao', await camp('shopee'), [{ campanha_id: 'conta', nome: 'Shopee Ads (conta inteira)', i: 40, v: 170, roas: 4.25 }]);
const cCo = await camp('consolidado'); const cMl = await camp('mercadolivre');
eq('ads_campanhas consolidado: soma = cartao; linha "nao atribuido" = a do ML',
  [r2(cCo.reduce((s, x) => s + x.i, 0)), cCo.find((x) => x.campanha_id === null)?.i ?? null], [r2(adsMl + 40), cMl.find((x) => x.campanha_id === null)?.i ?? null]);
const AM = `select modelo, investimento::float as i, lucro_pos_ads::float as l, sugestao from analytics.ads_modelos($1, '2026-10-01', '2026-10-31')`;
const amSh = await rows(AM, ['shopee']);
eq('ads_modelos shopee: modelos vendidos sem Ads por produto; linha nula = conta inteira', amSh.map((x) => [x.modelo, x.i, x.sugestao]),
  [['AAA11', 0, null], ['SHP01', 0, null], [null, 40, null]]);
const dmSh = await rows(`select modelo, (contribuicao + custos_rateados)::float as antes from analytics.dash_modelos('shopee', ${OUT21}) order by modelo`);
eq('ads_modelos shopee: lucro apos Ads = contribuicao antes do Ads (sem Ads atribuido)', amSh.filter((x) => x.modelo).map((x) => r2(x.l)), dmSh.map((x) => r2(x.antes)));
const amCo = await rows(AM, ['consolidado']); const amMl = await rows(AM, ['mercadolivre']);
eq('ads_modelos consolidado: soma = cartao; linha nula = ML + 40', [r2(amCo.reduce((s, x) => s + x.i, 0)), amCo.find((x) => x.modelo === null).i],
  [r2(adsMl + 40), r2(amMl.find((x) => x.modelo === null).i + 40)]);
eq('ads_sugestoes: Shopee sem sugestao por produto (decisao 3)', (await rows(`select * from analytics.ads_sugestoes('shopee', '2026-10-31')`)).length, 0);
eq('ads_sugestoes consolidado: so sugestoes do ML', (await rows(`select distinct canal from analytics.ads_sugestoes('consolidado', '2026-10-31')`)).map((x) => x.canal), ['mercadolivre']);
await perfil('comercial');
eq('comercial (sem custos, com ads): Ads da Shopee visivel', await comoAuth(async () => (await rows(RS, ['shopee']))[0].i), 40);
await perfil('admin');

// ---------------- Consolidado: ACOS de equilibrio da tabela = o da sugestao (base so ML), rodada 1 ----------------
const J30 = ['2026-10-02', '2026-10-31']; // periodo = janela de 30 dias da sugestao
const eqTab = async (c) => (await rows(`select acos_equilibrio::float as e from analytics.ads_modelos($1, $2, $3) where modelo = 'AAA11'`, [c, ...J30]))[0].e;
const eqSug = (await rows(`select acos_equilibrio_30d::float as e, motivo from analytics.ads_sugestoes('consolidado', '2026-10-31') where modelo = 'AAA11'`))[0];
const recAAA = async (c) => (await rows(`select receita::float as r from analytics.dash_modelos($1, $2, $3) where modelo = 'AAA11'`, [c, ...J30]))[0].r;
eq('AAA11 vendido nos dois canais (receita consolidada > a do ML)', (await recAAA('consolidado')) > (await recAAA('mercadolivre')), true);
eq('consolidado: ACOS de equilibrio da tabela = o da sugestao = o do ML (nao nulo)',
  [await eqTab('consolidado'), eqSug.e, await eqTab('mercadolivre'), eqSug.e !== null], [eqSug.e, eqSug.e, eqSug.e, true]);

// ---------------- Reaplicar 0009/0019 desfaz; reaplicar a 0021 depois refaz ----------------
await db.exec(mig('0009_dashboard_funcoes.sql'));
await db.exec(mig('0019_ads_funcoes.sql'));
await db.exec(mig('0021_shopee_funcoes.sql'));
eq('0009 + 0019 + 0021 reaplicadas: Shopee de volta', [(await res21('shopee')).vendas_brutas, await adsP('shopee')], [300, 40]);

// =====================================================================
// 0033: Ads por produto da Shopee (Tarefa 5b): ranking e sugestoes com os mesmos limites do ML.
// Mesmo banco da 0021. O retrato do ML e tirado com o Ads por produto da Shopee ja gravado, ANTES da 0033.
// =====================================================================
// Limites: a linha padrao da Shopee (0018) continua la e o ML e editado; a 0033 copia o ML para a Shopee.
await db.exec(`update core.parametros_ads set pausar_gasto_min = 60, escalar_folga_pp = 12 where channel = 'mercadolivre';
  insert into mkt.items (channel, item_id, title, sku, status) values ('shopee','SH3','Garrafa Shopee','GGG77-PRT','active');`);
// Ads por produto da Shopee (como combinarAdsShopee grava: 'conta' = so a sobra do dia; sem sobra, sem linha 'conta')
//   15/10: conta 30 = SH1 12 (AAA11) + SH2 10 (SHP01) + sobra 8;  16/10: conta 10 = SH2 10;
//   20 a 26/10: conta 10 por dia = SH3 10 (GGG77, sem venda): 7 dias, R$ 70, nenhuma unidade.
const MP = (item, day, cost, clicks, direct, units) => ({ item_id: item, day, campaign_id: item === 'conta' ? 'conta' : 'k1', impressions: 100,
  clicks, cost, direct_amount: direct, indirect_amount: 0, direct_units: units, indirect_units: 0, organic_units: 0 });
const DIAS33 = ['2026-10-15', '2026-10-16', ...[20, 21, 22, 23, 24, 25, 26].map((d) => `2026-10-${d}`)];
await gravarAds(DIAS33, JSON.stringify([
  MP('SH1', '2026-10-15', 12, 20, 60, 1), MP('SH2', '2026-10-15', 10, 10, 20, 1), MP('conta', '2026-10-15', 8, 5, 40, 0),
  MP('SH2', '2026-10-16', 10, 10, 20, 1),
  ...DIAS33.slice(2).map((d) => MP('SH3', d, 10, 3, 0, 0))]),
JSON.stringify([{ day: '2026-10-15', cost: 30, raw: {} }, { day: '2026-10-16', cost: 10, raw: {} }, ...DIAS33.slice(2).map((d) => ({ day: d, cost: 10, raw: {} }))]));
eq('0033: cartao da Shopee = conta (30 + 10 + 70)', await adsP('shopee'), 110);

const RETRATO33 = Object.keys(RETRATO).filter((k) => k !== 'ads_sugestoes_cons'); // o consolidado passa a ter a Shopee (intencional)
const retrato33 = async () => { const r = {}; for (const k of RETRATO33) r[k] = await rows(RETRATO[k]); return r; };
const antes33 = await retrato33();
await perfil('comercial');
const antes33c = await comoAuth(retrato33);
await perfil('admin');
eq('0033: retrato do ML com sugestoes e tabela', [antes33.ads_sugestoes.length > 1, antes33.ads_modelos.length > 1], [true, true]);
eq('limites antes da 0033: Shopee com a linha padrao da 0018 (diferente do ML editado)',
  await rows(`select vigente_desde::text as v, pausar_gasto_min::float as p, escalar_folga_pp::float as f from core.parametros_ads where channel = 'shopee'`),
  [{ v: '2025-01-01', p: 50, f: 10 }]);

await db.exec(mig('0033_shopee_ads_produto.sql'));
await db.exec(mig('0033_shopee_ads_produto.sql')); // reexecutavel
console.log('0033 aplicada (2x)');

// ---------------- Mercado Livre identico antes e depois da 0033 ----------------
const depois33 = await retrato33();
for (const k of RETRATO33) eq(`0033: ML igual antes/depois (admin): ${k}`, depois33[k], antes33[k]);
await perfil('comercial');
const depois33c = await comoAuth(retrato33);
await perfil('admin');
for (const k of RETRATO33) eq(`0033: ML igual antes/depois (comercial, RLS): ${k}`, depois33c[k], antes33c[k]);

// ---------------- Limites da Shopee = os do ML (linha criada pela 0033) ----------------
const LIM = `select vigente_desde::text as v, pausar_gasto_min::float, pausar_cliques_min, min_dias_dados, revisar_cliques_min,
  revisar_conversao_max_pct::float, escalar_folga_pp::float, escalar_unidades_min, testar_margem_min_pct::float, testar_unidades_min,
  teste_reserva_pct::float, teste_max_modelos, reduzir_fator::float, teto_fator::float, alerta_sobra_pct::float
  from core.parametros_ads where channel = $1 order by vigente_desde`;
const limMl = await rows(LIM, ['mercadolivre']);
eq('limites: Shopee = ML (pausar 60, folga 12), mesmo com a linha padrao da Shopee antes', await rows(LIM, ['shopee']), limMl);
eq('limites: ML editado de fato (nao sao os padroes)', [limMl[0].pausar_gasto_min, limMl[0].escalar_folga_pp], [60, 12]);

// ---------------- ads_sugestoes('shopee'): so dados da Shopee, regras e textos do ML ----------------
const SG = `select modelo, canal, sugestao, motivo, investimento_30d::float as i, vendas_ads_30d::float as v, unidades_ads_30d::float as u,
  acos_30d::float as acos, acos_equilibrio_30d::float as eqb, dias_com_dados as d from analytics.ads_sugestoes($1, '2026-10-31')`;
const sgSh = await rows(SG, ['shopee']);
eq('sugestoes shopee: AAA11 (ACOS 20% < equilibrio 40% - folga 12, so 1 unidade) = manter', sgSh.find((x) => x.modelo === 'AAA11'),
  { modelo: 'AAA11', canal: 'shopee', sugestao: 'manter', motivo: 'ACOS 20,00% bem abaixo do equilíbrio 40,00%, mas só 1 unidade vendida por Ads; mínimo 3',
    i: 12, v: 60, u: 1, acos: 20, eqb: 40, d: 1 });
eq('sugestoes shopee: SHP01 (ACOS 50% > equilibrio -9,19%; margem com escrow, estimativa e cancelado pago) = reduzir', sgSh.find((x) => x.modelo === 'SHP01'),
  { modelo: 'SHP01', canal: 'shopee', sugestao: 'reduzir', motivo: 'ACOS 50,00% acima do equilíbrio -9,19%', i: 20, v: 40, u: 2, acos: 50, eqb: -9.19, d: 2 });
eq('sugestoes shopee: GGG77 (R$ 70 em 7 dias sem venda, limite 60 copiado do ML) = pausar', sgSh.find((x) => x.modelo === 'GGG77'),
  { modelo: 'GGG77', canal: 'shopee', sugestao: 'pausar', motivo: 'gastou R$ 70,00 em 30 dias sem venda', i: 70, v: 0, u: 0, acos: null, eqb: null, d: 7 });
eq('sugestoes shopee: so modelos da Shopee (sobra da conta nunca vira modelo)', sgSh.map((x) => x.modelo), ['AAA11', 'GGG77', 'SHP01']);
const dmSh33 = await rows(`select modelo, round((contribuicao + custos_rateados) / receita * 100, 2)::float as e from analytics.dash_modelos('shopee', '2026-10-02', '2026-10-31') order by modelo`);
eq('sugestoes shopee: equilibrio = margem antes do Ads de dash_modelos(shopee) (sem fatura por pedido)',
  sgSh.filter((x) => x.eqb !== null).map((x) => [x.modelo, x.eqb]), dmSh33.map((x) => [x.modelo, x.e]));

// ---------------- ads_modelos('shopee'): por modelo; nao atribuido = sobra da conta ----------------
const AM33 = `select modelo, investimento::float as i, acos::float as acos, acos_equilibrio::float as eqb, lucro_pos_ads::float as l, sugestao
  from analytics.ads_modelos($1, '2026-10-01', '2026-10-31')`;
const am33 = await rows(AM33, ['shopee']);
eq('ads_modelos shopee: investimento, ACOS, equilibrio e sugestao por modelo; linha nula = sobra da conta (8)', am33, [
  { modelo: 'GGG77', i: 70, acos: null, eqb: null, l: -70, sugestao: 'pausar' },
  { modelo: 'SHP01', i: 20, acos: 50, eqb: -9.19, l: -34.7, sugestao: 'reduzir' },
  { modelo: 'AAA11', i: 12, acos: 20, eqb: 40, l: 28, sugestao: 'manter' },
  { modelo: null, i: 8, acos: null, eqb: null, l: null, sugestao: null }]);
const naoSh = am33.find((x) => x.modelo === null).i;
eq('ads_modelos shopee: soma das linhas + nao atribuido = dash_ads_periodo(shopee); nao atribuido >= 0',
  [r2(am33.reduce((s, x) => s + x.i, 0)), naoSh >= 0], [await adsP('shopee'), true]);
eq('ads_resumo shopee: nao atribuido = o da tabela', (await rows(RS, ['shopee']))[0].na, naoSh);
// Por anuncio cobrindo a conta inteira: nao atribuido ~0
await gravarAds(['2026-10-15'], JSON.stringify([MP('SH1', '2026-10-15', 12, 20, 60, 1), MP('SH2', '2026-10-15', 18, 10, 20, 1)]),
  JSON.stringify([{ day: '2026-10-15', cost: 30, raw: {} }]));
eq('ads_modelos shopee: por anuncio cobre a conta -> sem linha "nao atribuido"', (await rows(AM33, ['shopee'])).filter((x) => x.modelo === null), []);
await gravarAds(['2026-10-15'], JSON.stringify([MP('SH1', '2026-10-15', 12, 20, 60, 1), MP('SH2', '2026-10-15', 10, 10, 20, 1), MP('conta', '2026-10-15', 8, 5, 40, 0)]),
  JSON.stringify([{ day: '2026-10-15', cost: 30, raw: {} }]));
// Item 'conta' nunca e modelo, nem se um anuncio cadastrado tivesse esse id com SKU
await db.exec(`insert into mkt.items (channel, item_id, title, sku, status) values ('shopee','conta','x','AAA11-AZU','active')`);
eq('ads_modelos shopee: item "conta" segue em "nao atribuido" mesmo com SKU', (await rows(AM33, ['shopee'])).map((x) => [x.modelo, x.i]),
  [['GGG77', 70], ['SHP01', 20], ['AAA11', 12], [null, 8]]);
await db.exec(`delete from mkt.items where channel = 'shopee' and item_id = 'conta'`);

// ---------------- Consolidado: metricas e margem somadas; tabela = sugestao ----------------
const sgMl = await rows(SG, ['mercadolivre']);
const sgCo = await rows(SG, ['consolidado']);
const aMl = sgMl.find((x) => x.modelo === 'AAA11'); const aSh = sgSh.find((x) => x.modelo === 'AAA11'); const aCo = sgCo.find((x) => x.modelo === 'AAA11');
eq('consolidado AAA11: Ads somados (ML + Shopee), canal = o de maior investimento',
  [aCo.i, aCo.v, aCo.u, aCo.canal], [r2(aMl.i + aSh.i), r2(aMl.v + aSh.v), r2(aMl.u + aSh.u), aMl.i > aSh.i ? 'mercadolivre' : 'shopee']);
const dmCo = (await rows(`select contribuicao::float as c, receita::float as r from analytics.dash_modelos('consolidado', $1, $2) where modelo = 'AAA11'`, J30))[0];
eq('consolidado AAA11: equilibrio com a margem dos dois canais (nao e o do ML nem o da Shopee)',
  [aCo.eqb !== aMl.eqb, aCo.eqb !== aSh.eqb, aCo.eqb !== null], [true, true, true]);
// Valor esperado, montado a parte: contribuicao consolidada + parte do Product Ads do periodo (ML API + conta Shopee,
// rateada pela receita) + Product Ads da fatura do ML ligado aos pedidos do AAA11 (P1 12 + P2 10 x 60/100 = 18).
const adsCpCo = await val(`select coalesce(sum(valor), 0)::float from analytics.dash_custos_periodo('consolidado', $1, $2) where categoria = 'product_ads'`, J30);
const recCo = await val(`select sum(receita)::float from analytics.dash_modelos('consolidado', $1, $2)`, J30);
eq('consolidado AAA11: equilibrio = (contribuicao + rateio do Ads do periodo + fatura do ML) / receita = 55,25',
  [aCo.eqb, r2((dmCo.c + adsCpCo * dmCo.r / recCo + 18) / dmCo.r * 100)], [55.25, 55.25]);
eq('consolidado: ACOS de equilibrio da tabela = o da sugestao (AAA11, periodo = janela)', await eqTab('consolidado'), aCo.eqb);
eq('consolidado: o numero da tabela aparece no motivo', aCo.motivo.includes(`${String(aCo.eqb.toFixed(2)).replace('.', ',')}%`), true);
eq('consolidado: receita do equilibrio = ML + Shopee (AAA11)', dmCo.r, (await recAAA('mercadolivre')) + 100);
eq('consolidado: GGG77 (so Shopee) e SHP01 com sugestao do canal Shopee', sgCo.filter((x) => ['GGG77', 'SHP01'].includes(x.modelo)).map((x) => [x.modelo, x.canal, x.sugestao]),
  [['GGG77', 'shopee', 'pausar'], ['SHP01', 'shopee', 'reduzir']]);
const amCo33 = await rows(AM33, ['consolidado']);
eq('ads_modelos consolidado: soma = cartao; nao atribuido = ML + sobra da Shopee',
  [r2(amCo33.reduce((s, x) => s + x.i, 0)), amCo33.find((x) => x.modelo === null).i],
  [r2(adsMl + 110), r2((await rows(AM33, ['mercadolivre'])).find((x) => x.modelo === null).i + 8)]);

// ---------------- Sem 'custos': sem margem nem equilibrio (como o ML) ----------------
await perfil('comercial');
const sgShC = await comoAuth(() => rows(SG, ['shopee']));
eq('comercial: Shopee sem equilibrio; pausar continua; sem reduzir', sgShC.map((x) => [x.modelo, x.sugestao, x.eqb]),
  [['AAA11', null, null], ['GGG77', 'pausar', null], ['SHP01', null, null]]);
eq('comercial: ads_modelos shopee sem equilibrio nem lucro', (await comoAuth(() => rows(AM33, ['shopee']))).map((x) => [x.modelo, x.eqb, x.l]),
  [['GGG77', null, null], ['SHP01', null, null], ['AAA11', null, null], [null, null, null]]);
await perfil('admin');

// ---------------- Limites: a Shopee editada (Parametros) muda a sugestao; a 0033 e uma copia unica e reexecutavel ----------------
await db.exec(`update core.parametros_ads set pausar_gasto_min = 75 where channel = 'shopee'`);
eq('limites: Shopee editada para 75, GGG77 (R$ 70) deixa de ser pausar', (await rows(SG, ['shopee'])).find((x) => x.modelo === 'GGG77').sugestao, 'manter');
await db.exec(mig('0033_shopee_ads_produto.sql'));
const limSh1 = await rows(LIM, ['shopee']);
await db.exec(mig('0033_shopee_ads_produto.sql'));
eq('limites: reexecutar a 0033 copia o ML de novo (copia unica decidida pelo dono) e duas execucoes dao o mesmo',
  [limSh1, await rows(LIM, ['shopee'])], [limMl, limMl]);
// ML com uma vigencia mais nova: a Shopee recebe essa vigencia com os mesmos valores (a mais antiga fica)
await db.exec(`insert into core.parametros_ads (channel, vigente_desde, pausar_gasto_min, teste_max_modelos) values ('mercadolivre', '2026-11-01', 45, 7)`);
await db.exec(mig('0033_shopee_ads_produto.sql'));
eq('limites: ultima linha do ML copiada com a vigencia dela', (await rows(LIM, ['shopee'])).map((x) => [x.v, x.pausar_gasto_min, x.teste_max_modelos]),
  [['2025-01-01', 60, 5], ['2026-11-01', 45, 7]]);
eq('limites: ultima linha da Shopee = ultima do ML', (await rows(LIM, ['shopee']))[1], (await rows(LIM, ['mercadolivre']))[1]);
await db.exec(`delete from core.parametros_ads where vigente_desde = '2026-11-01'`);
// Reaplicar 0019 e 0021 exige reaplicar a 0033 (documentado no cabecalho)
await db.exec(mig('0019_ads_funcoes.sql'));
await db.exec(mig('0021_shopee_funcoes.sql'));
await db.exec(mig('0033_shopee_ads_produto.sql'));
eq('0019 + 0021 + 0033 reaplicadas: sugestoes da Shopee de volta', (await rows(SG, ['shopee'])).map((x) => x.modelo), ['AAA11', 'GGG77', 'SHP01']);

// ---------------- ads_campanhas (fix da 5b): campanha real da Shopee com o proprio investimento; 'conta' = sobra ----------------
// SH1 e SH3 na campanha k1 (12 + 70 = 82, vendas 60), SH2 na k2 (20, vendas 40), sobra da conta 8 (vendas 40). Cartao 110.
const K = (m, k) => ({ ...m, campaign_id: k });
const adsCampanhas = (sh2dia15, sobra) => gravarAds(DIAS33, JSON.stringify([
  K(MP('SH1', '2026-10-15', 12, 20, 60, 1), 'k1'), K(MP('SH2', '2026-10-15', sh2dia15, 10, 20, 1), 'k2'),
  ...(sobra ? [MP('conta', '2026-10-15', sobra, 5, 40, 0)] : []),
  K(MP('SH2', '2026-10-16', 10, 10, 20, 1), 'k2'),
  ...DIAS33.slice(2).map((d) => K(MP('SH3', d, 10, 3, 0, 0), 'k1'))]),
JSON.stringify([{ day: '2026-10-15', cost: 30, raw: {} }, { day: '2026-10-16', cost: 10, raw: {} }, ...DIAS33.slice(2).map((d) => ({ day: d, cost: 10, raw: {} }))]));
await adsCampanhas(10, 8);
await db.exec(`insert into mkt.ads_campaigns (channel, campaign_id, name, status) values ('shopee','k1','Shopee 1','active'), ('shopee','k2','Shopee 2','active')`);
const CA = `select campanha_id, nome, investimento::float as i, vendas_ads::float as v, roas::float, acos::float from analytics.ads_campanhas($1, ${OUT21})`;
const caSh = await rows(CA, ['shopee']);
eq('ads_campanhas shopee: investimento por campanha (metricas por anuncio), ROAS e ACOS; conta = sobra', caSh, [
  { campanha_id: 'k1', nome: 'Shopee 1', i: 82, v: 60, roas: 0.73, acos: 136.67 },
  { campanha_id: 'k2', nome: 'Shopee 2', i: 20, v: 40, roas: 2, acos: 50 },
  { campanha_id: 'conta', nome: 'Shopee Ads (conta inteira)', i: 8, v: 40, roas: 5, acos: 20 }]);
eq('ads_campanhas shopee: soma = cartao (dash_ads_periodo)', r2(caSh.reduce((s, x) => s + x.i, 0)), await adsP('shopee'));
// Sem sobra (por anuncio cobre a conta): a linha 'conta' some
await adsCampanhas(18, 0);
eq('ads_campanhas shopee: sem sobra, sem linha "conta"; soma = cartao', (await rows(CA, ['shopee'])).map((x) => [x.campanha_id, x.i]), [['k1', 82], ['k2', 28]]);
await adsCampanhas(10, 8);
// Consolidado: ML como antes + Shopee, sem contar duas vezes
const caMl = await rows(CA, ['mercadolivre']);
const caCo = await rows(CA, ['consolidado']);
eq('ads_campanhas consolidado: soma = cartao (ML + Shopee)', r2(caCo.reduce((s, x) => s + x.i, 0)), r2(adsMl + 110));
const chave = (x) => JSON.stringify(x);
eq('ads_campanhas consolidado: linhas = as do ML + as da Shopee (cada uma uma vez)',
  caCo.map(chave).sort(), [...caMl, ...caSh].map(chave).sort());

// ---------------- Ruido de centavos da Shopee escondido (decisao do dono, rodada final) ----------------
// Por anuncio 0,01 acima da conta no dia 15 (SH2 18,01, sem linha 'conta'): sobra da Shopee = -0,01.
await adsCampanhas(18.01, 0);
const nulaAm = async (c) => (await rows(AM33, [c])).filter((x) => x.modelo === null);
const amSh01 = await rows(AM33, ['shopee']);
eq('ruido: ads_modelos shopee sem linha "nao atribuido" (-0,01) e sem investimento negativo',
  [amSh01.filter((x) => x.modelo === null).length, amSh01.every((x) => x.i >= 0)], [0, true]);
eq('ruido: ads_campanhas shopee sem linha "conta" nem "nao atribuido"', (await rows(CA, ['shopee'])).map((x) => [x.campanha_id, x.i]), [['k1', 82], ['k2', 28.01]]);
eq('ruido: consolidado com a linha "nao atribuido" so do ML (tabela por modelo)', await nulaAm('consolidado'), await nulaAm('mercadolivre'));
eq('ruido: consolidado com as linhas de campanha do ML + as reais da Shopee',
  (await rows(CA, ['consolidado'])).map(chave).sort(), [...caMl, ...(await rows(CA, ['shopee']))].map(chave).sort());
await adsCampanhas(10, 8);
eq('ruido: sobra de 8 continua aparecendo (tabela por modelo e campanhas)',
  [(await nulaAm('shopee')).map((x) => x.i), (await rows(CA, ['shopee'])).filter((x) => x.campanha_id === 'conta').map((x) => x.i)], [[8], [8]]);
eq('ruido: consolidado com a sobra de 8 = ML + 8', (await nulaAm('consolidado'))[0].i, r2((await nulaAm('mercadolivre'))[0].i + 8));

// ---------------- Anuncio da Shopee que vendeu dois modelos (2:1): Ads repartido 2:1 ----------------
await db.exec(`
insert into mkt.items (channel, item_id, title, sku, status) values ('shopee','SH4','Kit Shopee','HHH88-AZU','active');
insert into mkt.orders (channel, order_id, status, date_created, date_closed, total_amount, tags, raw) values
 ('shopee','S7','paid','2026-10-21 10:00-03','2026-10-21 10:05-03',20,array['shopee:COMPLETED'],'{"order_status":"COMPLETED"}'),
 ('shopee','S8','paid','2026-10-22 10:00-03','2026-10-22 10:05-03',10,array['shopee:COMPLETED'],'{"order_status":"COMPLETED"}');
insert into mkt.order_items (channel, order_id, line_no, item_id, sku, title, quantity, unit_price) values
 ('shopee','S7',1,'SH4','HHH88-AZU','Kit Shopee',2,10), ('shopee','S8',1,'SH4','III99-AZU','Kit Shopee',1,10);`);
await gravarAds(['2026-10-27'], JSON.stringify([K(MP('SH4', '2026-10-27', 9, 30, 30, 3), 'k2')]), JSON.stringify([{ day: '2026-10-27', cost: 9, raw: {} }]));
const am21 = await rows(AM33, ['shopee']);
eq('2:1: SH4 (2 HHH88 e 1 III99 vendidos) reparte R$ 9 em 6 e 3', am21.filter((x) => ['HHH88', 'III99'].includes(x.modelo)).map((x) => [x.modelo, x.i]),
  [['HHH88', 6], ['III99', 3]]);
eq('2:1: nenhum investimento negativo; soma da tabela = cartao (119)', [am21.every((x) => x.i >= 0), r2(am21.reduce((s, x) => s + x.i, 0)), await adsP('shopee')],
  [true, 119, 119]);
eq('2:1: sugestoes com o mesmo rateio (vendas e unidades por Ads 2:1)',
  (await rows(SG, ['shopee'])).filter((x) => ['HHH88', 'III99'].includes(x.modelo)).map((x) => [x.modelo, x.i, x.v, x.u]),
  [['HHH88', 6, 20, 2], ['III99', 3, 10, 1]]);

// =====================================================================
// 0022: crescimento por canal e parametros editaveis (Tarefa 6). Mesmo banco (ML e Shopee em outubro/2026).
// =====================================================================
await perfil('admin'); await canais('mercadolivre,shopee,crm');
// Uma venda do ML em outubro/2025 (ano passado); a Shopee nao tem venda no ano passado (comeca em 06/2026).
await db.exec(`
insert into mkt.orders (channel, order_id, status, date_created, date_closed, total_amount, raw, shipment_id) values
 ('mercadolivre','PA1','paid','2025-10-10 12:00+00','2025-10-10 12:00+00',150,'{}','sa1');
insert into mkt.order_items (channel, order_id, line_no, item_id, sku, title, quantity, unit_price, sale_fee) values
 ('mercadolivre','PA1',1,'MLB1','AAA11-AZU','Produto A',1,150,10);`);
await db.exec(mig('0022_crescimento_canal.sql'));
await db.exec(mig('0022_crescimento_canal.sql')); // reexecutavel
console.log('0022 aplicada (2x)');

const CC = `select canal, vendas_atual::float as va, vendas_anterior::float as vp, vendas_ano_passado::float as vy,
  margem_pos_ads_atual::float as ma, margem_pos_ads_anterior::float as mp, pct_crescimento::float as pc, pct_queda::float as pq
  from analytics.crescimento_canal($1, $2, $3, $4, $5) order by canal`;
const cc = (c, de = '2026-10-01', ate = '2026-10-31', ade = '2026-09-01', aate = '2026-09-30') => rows(CC, [c, de, ate, ade, aate]);
const resumo = async (c, de, ate) => (await rows(`select vendas_brutas::float as vb, receita::float as r, margem_contribuicao::float as m
  from analytics.dash_resumo($1, $2, $3)`, [c, de, ate]))[0];
const pctM = (x) => (x.r > 0 ? Math.round((x.m / x.r) * 100 * 10000) / 10000 : null);
const r4 = (x) => (x == null ? null : Math.round(x * 10000) / 10000);

eq('parametros: 10 e 10 nos dois canais, vigentes desde 2025-01-01',
  await rows(`select channel, vigente_desde::text as v, pct_crescimento::float as c, pct_queda::float as q from core.parametros_crescimento order by channel`),
  [{ channel: 'mercadolivre', v: '2025-01-01', c: 10, q: 10 }, { channel: 'shopee', v: '2025-01-01', c: 10, q: 10 }]);

const esperado = async (c) => {
  const [a, p, y] = [await resumo(c, '2026-10-01', '2026-10-31'), await resumo(c, '2026-09-01', '2026-09-30'), await resumo(c, '2025-10-01', '2025-10-31')];
  return { canal: c, va: a.vb, vp: p.vb, vy: y.vb, ma: pctM(a), mp: pctM(p), pc: 10, pq: 10 };
};
const ccCons = (await cc('consolidado')).map((x) => ({ ...x, ma: r4(x.ma), mp: r4(x.mp) }));
const espMl = await esperado('mercadolivre'); const espSh = await esperado('shopee');
eq('crescimento consolidado: uma linha por canal, com vendas brutas e margem depois do Ads (% da receita) de dash_resumo',
  ccCons, [espMl, espSh]);
eq('crescimento: ML com venda no ano passado (150) e no periodo anterior; Shopee sem ano passado',
  [espMl.vy, espMl.vp > 0, espSh.vy, espSh.va > 0], [150, true, 0, true]);
eq('margem depois do Ads = margem de contribuicao (dash_resumo ja desconta o Ads): Shopee de outubro',
  await (async () => { const x = (await rows(`select margem_contribuicao::float as m, receita::float as r, product_ads::float as a,
    (receita - comissao - frete - parcelamento - seguidores - estornos - difal - outras - custo_produto - imposto - embalagem)::float as antes
    from analytics.dash_resumo('shopee', '2026-10-01', '2026-10-31')`))[0];
    return [r4(ccCons[1].ma), x.a > 0, r2(x.antes - x.a) === r2(x.m)]; })(),
  [r4(espSh.ma), true, true]);
eq('crescimento por canal: so a linha do canal pedido', (await cc('shopee')).map((x) => x.canal), ['shopee']);
eq('crescimento: canal invalido nao devolve linha', (await cc('brindedobem')).length, 0);

// Step 4: a mudanca de parametro vale a partir da vigencia; quem nao e admin nao grava
const tentaLinhas = async (sql) => { try { return (await db.query(sql)).affectedRows ?? 0; } catch (e) { return /row-level security|permission denied/i.test(e.message) ? 'negado' : e.message; } };
eq('admin grava nova vigencia da Shopee (RLS)', await comoAuth(() => tentaLinhas(
  `insert into core.parametros_crescimento (channel, vigente_desde, pct_crescimento, pct_queda) values ('shopee', '2026-10-15', 20, 5)`)), 1);
eq('vigencia: periodo que termina antes de 15/10 usa os parametros antigos',
  (await cc('shopee', '2026-10-01', '2026-10-14', '2026-09-17', '2026-09-30')).map((x) => [x.pc, x.pq]), [[10, 10]]);
eq('vigencia: periodo que termina depois de 15/10 usa os novos; o ML nao muda',
  (await cc('consolidado')).map((x) => [x.canal, x.pc, x.pq]), [['mercadolivre', 10, 10], ['shopee', 20, 5]]);
await perfil('gestor'); // tem 'vendas' e 'custos', nao e admin
eq('gestor nao grava (insert)', await comoAuth(() => tentaLinhas(
  `insert into core.parametros_crescimento (channel, vigente_desde, pct_crescimento, pct_queda) values ('shopee', '2026-11-01', 50, 50)`)), 'negado');
eq('gestor nao altera (update sem efeito)', await comoAuth(() => tentaLinhas(`update core.parametros_crescimento set pct_crescimento = 99`)), 0);
eq('gestor nao apaga (delete sem efeito)', await comoAuth(() => tentaLinhas(`delete from core.parametros_crescimento`)), 0);
eq('gestor le os parametros (tem vendas)', await comoAuth(() => val(`select count(*)::int from core.parametros_crescimento`)), 3);
await perfil('admin');
eq('parametros intactos depois das tentativas do gestor',
  await rows(`select channel, vigente_desde::text as v, pct_crescimento::float as c from core.parametros_crescimento order by channel, vigente_desde`),
  [{ channel: 'mercadolivre', v: '2025-01-01', c: 10 }, { channel: 'shopee', v: '2025-01-01', c: 10 }, { channel: 'shopee', v: '2026-10-15', c: 20 }]);
await erro('queda acima de 100% recusada', `insert into core.parametros_crescimento (channel, vigente_desde, pct_crescimento, pct_queda) values ('shopee', '2026-12-01', 10, 101)`, /check/i);
await erro('crescimento zero recusado', `insert into core.parametros_crescimento (channel, vigente_desde, pct_crescimento, pct_queda) values ('shopee', '2026-12-01', 0, 10)`, /check/i);
await erro('canal desconhecido recusado', `insert into core.parametros_crescimento (channel, vigente_desde, pct_crescimento, pct_queda) values ('outro', '2026-12-01', 10, 10)`, /check/i);
await db.exec(`update core.parametros_crescimento set pct_crescimento = 12 where channel = 'mercadolivre'`);
await db.exec(mig('0022_crescimento_canal.sql'));
eq('reexecutar a 0022 preserva o que o admin mudou', await val(`select pct_crescimento::float from core.parametros_crescimento where channel = 'mercadolivre'`), 12);
await db.exec(`update core.parametros_crescimento set pct_crescimento = 10 where channel = 'mercadolivre'`);

// Step 4b: sem 'custos', as margens vem nulas (as vendas continuam visiveis)
await perfil('comercial'); // vendas, sem custos
const ccCom = await comoAuth(() => cc('consolidado'));
eq('comercial: margens nulas, vendas iguais as do admin', ccCom.map((x) => [x.canal, x.va, x.vp, x.vy, x.ma, x.mp]),
  [['mercadolivre', espMl.va, espMl.vp, espMl.vy, null, null], ['shopee', espSh.va, espSh.vp, espSh.vy, null, null]]);
eq('comercial le os parametros (tem vendas)', await comoAuth(() => val(`select count(*)::int from core.parametros_crescimento`)), 3);
await perfil('visualizador'); // sem vendas
eq('visualizador (sem vendas): sem linhas e sem parametros', await comoAuth(async () => [(await cc('consolidado')).length,
  await val(`select count(*)::int from core.parametros_crescimento`)]), [0, 0]);
await perfil('admin');
await canais('mercadolivre');
eq('sem o canal Shopee: consolidado so com o ML; shopee vazio', await comoAuth(async () => [(await cc('consolidado')).map((x) => x.canal), (await cc('shopee')).length]),
  [['mercadolivre'], 0]);
await canais('mercadolivre,shopee,crm');
eq('RLS: politicas usam (select ...)', await val(`select bool_and(coalesce(qual, '') ~* 'SELECT core\\.' or coalesce(with_check, '') ~* 'SELECT core\\.') from pg_policies where schemaname = 'core' and tablename = 'parametros_crescimento'`), true);
eq('crescimento_canal: search_path vazio e sem execucao para anon', await rows(`select array_to_string(p.proconfig, ',') as c, has_function_privilege('anon', p.oid, 'execute') as anon
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'analytics' and p.proname = 'crescimento_canal'`),
  [{ c: 'search_path=""', anon: false }]);

console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
process.exit(fails ? 1 : 0);
