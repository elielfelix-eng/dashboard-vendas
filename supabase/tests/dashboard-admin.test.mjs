import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Tabelas de administracao do dashboard (migration 0008): permissoes, parametros, metas, premissas.
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
for (const f of ['0002_marketplaces.sql', '0003_regras_v1.sql', '0006_custo_por_cotacao.sql', '0007_de_para_modelo.sql', '0008_dashboard_admin.sql', '0008_dashboard_admin.sql'])
  await db.exec(mig(f));
console.log('Migrations 0002 + 0003 + 0006 + 0007 + 0008 (x2) aplicadas');

// Perfil controlado pelo teste
await db.exec(`create or replace function core.my_role() returns core.app_role language sql as $$ select current_setting('teste.perfil')::core.app_role $$`);
const perfil = (p) => db.exec(`set teste.perfil = '${p}'`);
const val = async (sql) => Object.values((await db.query(sql)).rows[0])[0];

eq('sementes de permissoes', (await db.query(`
  select role::text, array_agg(permission order by permission) as p from core.role_permissions where allowed group by role order by role::core.app_role`)).rows,
  [
    { role: 'admin', p: ['configuracoes', 'custos', 'editar_metas', 'metas', 'rentabilidade', 'vendas', 'visao_geral'] },
    { role: 'gestor', p: ['custos', 'editar_metas', 'metas', 'rentabilidade', 'vendas', 'visao_geral'] },
    { role: 'comercial', p: ['metas', 'vendas', 'visao_geral'] },
    { role: 'visualizador', p: ['visao_geral'] },
  ]);

await perfil('admin'); eq('admin ve custos', await val(`select core.has_perm('custos')`), true);
await perfil('gestor'); eq('gestor ve custos', await val(`select core.has_perm('custos')`), true);
await perfil('comercial');
eq('comercial nao ve custos', await val(`select core.has_perm('custos')`), false);
eq('can_see_costs acompanha', await val(`select core.can_see_costs()`), false);
eq('permissao inexistente = false', await val(`select core.has_perm('xyz')`), false);
await perfil('vendedor'); eq('vendedor sem nada', await val(`select core.has_perm('visao_geral')`), false);

await perfil('admin');
await erro('trava: admin nao perde configuracoes',
  `update core.role_permissions set allowed = false where role = 'admin' and permission = 'configuracoes'`,
  /o perfil admin precisa manter a permissao configuracoes/);
await erro('trava: nao apaga admin/configuracoes',
  `delete from core.role_permissions where role = 'admin' and permission = 'configuracoes'`,
  /o perfil admin precisa manter a permissao configuracoes/);

// Reexecutar a 0008 nao desfaz alteracoes nem duplica
await db.exec(`update core.role_permissions set allowed = true where role = 'comercial' and permission = 'custos'`);
await db.exec(mig('0008_dashboard_admin.sql'));
eq('reexecucao preserva alteracao', await val(`select allowed from core.role_permissions where role='comercial' and permission='custos'`), true);
eq('sem duplicar permissoes', await val(`select count(*)::int from core.role_permissions`), 35);
eq('parametro inicial', (await db.query(`select channel, imposto_pct::float, embalagem_pedido::float, embalagem_peca::float, vigente_desde::text from core.parametros_custo`)).rows,
  [{ channel: 'mercadolivre', imposto_pct: 0, embalagem_pedido: 0, embalagem_peca: 0, vigente_desde: '2019-01-01' }]);

// Metas
await db.exec(`insert into core.metas (channel, ano, mes, valor) values ('mercadolivre', 2026, 12, 500)`);
eq('substituir_metas grava', await val(`select core.substituir_metas('[{"channel":"shopee","ano":2027,"mes":1,"valor":29000},{"channel":"mercadolivre","ano":2027,"mes":1,"valor":26711}]'::jsonb)`), 2);
eq('substituir_metas troca o ano', await val(`select core.substituir_metas('[{"channel":"shopee","ano":2027,"mes":2,"valor":32000}]'::jsonb)`), 1);
eq('metas apos troca', (await db.query(`select channel, ano, mes, valor::float from core.metas order by ano, channel, mes`)).rows,
  [{ channel: 'mercadolivre', ano: 2026, mes: 12, valor: 500 }, { channel: 'shopee', ano: 2027, mes: 2, valor: 32000 }]);
await erro('meta negativa recusada', `insert into core.metas (channel, ano, mes, valor) values ('shopee', 2028, 1, -1)`, /check/i);
await erro('canal desconhecido recusado', `insert into core.metas (channel, ano, mes, valor) values ('amazon', 2028, 1, 1)`, /check/i);

// Premissas: um padrao por canal/ano e um valor por mes
await db.exec(`insert into core.premissas_projecao (channel, ano, mes, crescimento_pct) values ('mercadolivre', 2027, null, 3), ('mercadolivre', 2027, 1, 5)`);
await erro('premissa padrao duplicada recusada', `insert into core.premissas_projecao (channel, ano, mes, crescimento_pct) values ('mercadolivre', 2027, null, 4)`, /duplicate|unique/i);

console.log(fails ? `\n${fails} FALHA(S)` : '\nTodos os testes passaram');
process.exit(fails ? 1 : 0);
