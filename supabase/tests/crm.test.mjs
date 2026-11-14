import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Banco do CRM (migration 0012): tabelas, permissoes, vinculo do vendedor e RLS.
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

await db.exec(readFileSync(`${repo}/supabase/tests/stubs.sql`, 'utf8'));
for (const f of ['0002_marketplaces.sql', '0003_regras_v1.sql', '0006_custo_por_cotacao.sql', '0007_de_para_modelo.sql',
  '0008_dashboard_admin.sql', '0011_rls_desempenho.sql', '0012_crm.sql', '0012_crm.sql'])
  await db.exec(mig(f));
console.log('Migrations 0002 + 0003 + 0006 + 0007 + 0008 + 0011 + 0012 (x2) aplicadas');

// Perfil e usuario controlados pelo teste
await db.exec(`
  create or replace function core.my_role() returns core.app_role language sql as $$ select current_setting('teste.perfil')::core.app_role $$;
  create or replace function auth.uid() returns uuid language sql as $$ select nullif(current_setting('teste.uid', true), '')::uuid $$;
  grant usage on schema core, auth to authenticated;
  grant select on auth.users to authenticated;`);
const perfil = (p) => db.exec(`set teste.perfil = '${p}'`);
const uid = (u) => db.exec(`set teste.uid = '${u}'`);
const val = async (sql) => Object.values((await db.query(sql)).rows[0])[0];

const U1 = '00000000-0000-0000-0000-000000000001';
const U2 = '00000000-0000-0000-0000-000000000002';

// Sementes
eq('origens do Brinde do Bem', await val(`select array_agg(source_id order by source_id) from crm.origens_brinde`),
  ['10|WHATSAPP', '14|FACEBOOK', '19', '23', '24', '38', '39', '42', '52|BITRIX_WHATCRM_NET_70680444', '53', '54']);
eq('origem com nome', await val(`select nome from crm.origens_brinde where source_id = '54'`), 'Landing page Brinde do bem');
eq('permissoes crm_*', (await db.query(`
  select role::text, array_agg(permission order by permission) as p from core.role_permissions
   where allowed and permission like 'crm\_%' group by role order by role::core.app_role`)).rows,
  [
    { role: 'admin', p: ['crm_funil', 'crm_origens', 'crm_vendedores'] },
    { role: 'gestor', p: ['crm_funil', 'crm_origens', 'crm_vendedores'] },
    { role: 'comercial', p: ['crm_funil', 'crm_origens', 'crm_vendedores'] },
    { role: 'vendedor', p: ['crm_funil', 'crm_origens', 'crm_vendedores'] },
  ]);

// Vinculo automatico por e-mail
await db.exec(`
  insert into auth.users (id, email) values ('${U1}', ' Ana@Brinde.org '), ('${U2}', 'outro@brinde.org');
  insert into crm.users (bitrix_id, nome, email, ativo) values (7, 'Ana', 'ana@brinde.org', true), (8, 'Beto', 'beto@brinde.org', true);
  insert into crm.deals (id, category_id, assigned_by_id) values (1, 10, 7), (2, 10, 8);`);
await uid(U1);
eq('vinculo automatico por e-mail', await val(`select core.my_bitrix_id()`), 7);
await uid(U2);
eq('sem vinculo = null', await val(`select core.my_bitrix_id()`), null);

// Vinculo manual vence o automatico; desvincular desliga
await uid(U1); await perfil('admin');
await db.exec(`select core.crm_vincular('${U1}', 9)`);
eq('vinculo manual vence', await val(`select core.my_bitrix_id()`), 9);
await db.exec(`select core.crm_desvincular_auto('${U1}')`);
eq('desvincular = null', await val(`select core.my_bitrix_id()`), null);
await db.exec(`delete from crm.vinculo_vendedor`);
eq('vinculos listados', (await db.query(`select bitrix_id::int as b, tipo from core.crm_vinculos() order by bitrix_id`)).rows,
  [{ b: 7, tipo: 'automatico' }, { b: 8, tipo: null }]);
await db.exec(`select core.crm_origem_ativa('99', true)`);
eq('origem ativa (upsert)', await val(`select ativo from crm.origens_brinde where source_id = '99'`), true);

// RLS
await db.exec(`reset role`);
const deals = async (p, u) => {
  await perfil(p); await uid(u);
  await db.exec(`set role authenticated`);
  try { return await val(`select array_agg(id order by id) from crm.deals`); } finally { await db.exec(`reset role`); }
};
eq('RLS vendedor ve so os seus', await deals('vendedor', U1), [1]);
eq('RLS comercial ve todos', await deals('comercial', U1), [1, 2]);
eq('RLS vendedor sem vinculo', await deals('vendedor', U2), null);
await perfil('vendedor'); await uid(U1); await db.exec(`set role authenticated`);
await erro('vinculo_vendedor sem leitura direta', `select * from crm.vinculo_vendedor`, /permission denied|row-level/);
await db.exec(`reset role`);

// Permissoes das funcoes admin
await perfil('comercial');
await erro('crm_vinculos exige admin', `select * from core.crm_vinculos()`, /permiss/);
await perfil('gestor');
await erro('crm_vincular exige admin', `select core.crm_vincular('${U1}', 1)`, /permiss/);
await erro('crm_desvincular_auto exige admin', `select core.crm_desvincular_auto('${U1}')`, /permiss/);
await erro('crm_origem_ativa exige admin', `select core.crm_origem_ativa('19', false)`, /permiss/);

if (fails) { console.log(`\n${fails} FALHA(S)`); process.exit(1); }
console.log('\nTodos os testes do CRM passaram');
