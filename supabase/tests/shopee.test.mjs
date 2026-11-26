import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Shopee (migration 0020): pagamentos (escrow), view analytics.shopee_fatura, pendentes e idempotencia.
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
const val = async (sql, p = []) => Object.values((await rows(sql, p))[0])[0];

await db.exec(readFileSync(`${repo}/supabase/tests/stubs.sql`, 'utf8'));
for (const f of ['0002_marketplaces.sql', '0003_regras_v1.sql', '0020_shopee_pagamentos.sql']) await db.exec(mig(f));
await db.exec(mig('0020_shopee_pagamentos.sql')); // reexecutavel
console.log('Migrations 0002, 0003 e 0020 (2x) aplicadas');

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
eq('pendentes: pagos sem escrow ou ainda nao concluidos', (await rows(`select * from mkt.shopee_pedidos_pendentes(500) as p order by 1`)).map((r) => Object.values(r)[0]),
  ['P2', 'P3']);
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

// ---------------- Reexecucao preserva dados ----------------
await db.exec(mig('0020_shopee_pagamentos.sql'));
eq('0020 reexecutada preserva o escrow', await val(`select count(*)::int from mkt.shopee_escrow`), 6);

console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
process.exit(fails ? 1 : 0);
