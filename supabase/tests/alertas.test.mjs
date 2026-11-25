import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Alertas de atraso e reputacao (migration 0023): tabelas, permissoes, sementes e RLS.
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
  '0012_crm.sql', '0013_crm_funcoes.sql', '0018_ads_tabelas.sql', '0019_ads_funcoes.sql', '0023_alertas_tabelas.sql'])
  await db.exec(mig(f));
console.log('Migrations 0002..0013 + 0018 + 0019 + 0023 aplicadas');

// Perfil, usuario e canais controlados pelo teste
await db.exec(`
  create or replace function core.my_role() returns core.app_role language sql as $$ select coalesce(nullif(current_setting('teste.perfil', true), ''), 'admin')::core.app_role $$;
  create or replace function auth.uid() returns uuid language sql as $$ select nullif(current_setting('teste.uid', true), '')::uuid $$;
  create or replace function core.can_see_channel(ch text) returns boolean language sql as $$ select ch = any (string_to_array(coalesce(nullif(current_setting('teste.canais', true), ''), 'mercadolivre,shopee,crm'), ',')) $$;
  grant usage on schema core to authenticated;`);
const perfil = (p) => db.exec(`set teste.perfil = '${p}'`);
const comoAuth = async (fn) => { await db.exec(`set role authenticated`); try { return await fn(); } finally { await db.exec(`reset role`); } };
const tenta = async (sql) => { try { await db.exec(sql); return 'ok'; } catch (e) { return /row-level security|permission denied/i.test(e.message) ? 'negado' : e.message; } };

// ---------------- Permissoes ----------------
eq('permissao operacao', (await rows(`select role::text as r from core.role_permissions where permission = 'operacao' and allowed order by role::core.app_role`)).map((x) => x.r),
  ['admin', 'gestor', 'comercial']);
eq('permissao operacao: todos os perfis tem linha', await val(`select count(*)::int from core.role_permissions where permission = 'operacao'`), 5);
eq('permissao editar_grupos', (await rows(`select role::text as r from core.role_permissions where permission = 'editar_grupos' and allowed order by role::core.app_role`)).map((x) => x.r),
  ['admin', 'gestor']);
eq('permissao editar_grupos: todos os perfis tem linha', await val(`select count(*)::int from core.role_permissions where permission = 'editar_grupos'`), 5);

// ---------------- Sementes ----------------
eq('parametros_alertas', await rows(`select antecedencia_padrao, perto_limite_pct::float as perto_limite_pct from core.parametros_alertas`),
  [{ antecedencia_padrao: 4, perto_limite_pct: 80 }]);
const fer = async (ano) => (await rows(`select data::text as d from core.feriados where extract(year from data) = ${ano}`)).map((x) => x.d);
const f26 = await fer(2026);
eq('feriados 2026 incluem Sexta-feira Santa, Consciencia Negra e Natal', ['2026-04-03', '2026-11-20', '2026-12-25'].every((d) => f26.includes(d)), true);
eq('feriados 2027 incluem Sexta-feira Santa', (await fer(2027)).includes('2027-03-26'), true);
eq('feriados: 10 por ano', [f26.length, (await fer(2027)).length], [10, 10]);

// ---------------- Restricoes ----------------
await erro('antecedencia_dias = 31 recusado', `insert into core.grupos_anuncio (nome, antecedencia_dias) values ('G31', 31)`, /check/i);
await erro('antecedencia_dias negativa recusada', `insert into core.grupos_anuncio (nome, antecedencia_dias) values ('Gneg', -1)`, /check/i);
await db.exec(`insert into core.grupos_anuncio (nome, antecedencia_dias) values ('G0', 0), ('G30', 30)`);
eq('antecedencia 0 e 30 gravam', await val(`select count(*)::int from core.grupos_anuncio`), 2);
await erro('perto_limite_pct 0 recusado', `update core.parametros_alertas set perto_limite_pct = 0`, /check/i);
await erro('perto_limite_pct 101 recusado', `update core.parametros_alertas set perto_limite_pct = 101`, /check/i);
await erro('parametros_alertas: segunda linha recusada', `insert into core.parametros_alertas (id) values (false)`, /check|duplicate|unique/i);
await db.exec(`insert into core.grupo_anuncio_itens (channel, item_id, grupo_id) select 'mercadolivre', 'MLB1', id from core.grupos_anuncio where nome = 'G0'`);
await erro('mesmo anuncio em dois grupos recusado', `insert into core.grupo_anuncio_itens (channel, item_id, grupo_id) select 'mercadolivre', 'MLB1', id from core.grupos_anuncio where nome = 'G30'`, /duplicate|unique/i);
await erro('limite: indicador invalido recusado', `insert into core.reputacao_limites (level_id, indicador, limite_pct) values ('verde', 'outro', 1)`, /check/i);
eq('reputacao_limites: sem sementes (limites aguardam o levantamento)', await val(`select count(*)::int from core.reputacao_limites`), 0);

// ---------------- RLS ----------------
await db.exec(`
  insert into mkt.envios_prazos (channel, shipment_id, status, prazo_despacho) values ('mercadolivre', 'S1', 'ready_to_ship', '2026-12-01');
  insert into mkt.reputacao_fotos (account_id, level_id) values ('00000000-0000-0000-0000-000000000001', 'verde');
  insert into core.reputacao_limites (level_id, indicador, limite_pct) values ('verde', 'atrasos', 6);`);
await perfil('comercial');
eq('comercial le envios_prazos', await comoAuth(() => val(`select count(*)::int from mkt.envios_prazos`)), 1);
eq('comercial le reputacao_fotos', await comoAuth(() => val(`select count(*)::int from mkt.reputacao_fotos`)), 1);
eq('comercial nao grava grupos', await comoAuth(() => tenta(`insert into core.grupos_anuncio (nome, antecedencia_dias) values ('X', 3)`)), 'negado');
eq('comercial le grupos (operacao)', await comoAuth(() => val(`select count(*)::int from core.grupos_anuncio`)), 2);
eq('comercial le itens dos grupos', await comoAuth(() => val(`select count(*)::int from core.grupo_anuncio_itens`)), 1);
eq('comercial le parametros_alertas', await comoAuth(() => val(`select count(*)::int from core.parametros_alertas`)), 1);
eq('comercial le limites', await comoAuth(() => val(`select count(*)::int from core.reputacao_limites`)), 1);
eq('comercial nao altera parametros_alertas', await comoAuth(async () => { await db.exec(`update core.parametros_alertas set antecedencia_padrao = 9`); return val(`select antecedencia_padrao from core.parametros_alertas`); }), 4);
eq('comercial nao grava feriado', await comoAuth(() => tenta(`insert into core.feriados (data, nome) values ('2026-06-01', 'X')`)), 'negado');
eq('comercial nao grava limite', await comoAuth(() => tenta(`insert into core.reputacao_limites (level_id, indicador, limite_pct) values ('verde', 'cancelamentos', 2)`)), 'negado');
eq('comercial nao grava envios_prazos', await comoAuth(() => tenta(`insert into mkt.envios_prazos (channel, shipment_id) values ('mercadolivre', 'S2')`)), 'negado');
await db.exec(`set teste.canais = 'shopee'`);
eq('envios_prazos: canal nao liberado some', await comoAuth(() => val(`select count(*)::int from mkt.envios_prazos`)), 0);
await db.exec(`set teste.canais = 'mercadolivre,shopee,crm'`);

await perfil('visualizador');
eq('visualizador: envios_prazos = 0', await comoAuth(() => val(`select count(*)::int from mkt.envios_prazos`)), 0);
eq('visualizador: reputacao_fotos = 0', await comoAuth(() => val(`select count(*)::int from mkt.reputacao_fotos`)), 0);
eq('visualizador: grupos = 0', await comoAuth(() => val(`select count(*)::int from core.grupos_anuncio`)), 0);
eq('visualizador: parametros_alertas = 0', await comoAuth(() => val(`select count(*)::int from core.parametros_alertas`)), 0);
eq('visualizador: limites = 0', await comoAuth(() => val(`select count(*)::int from core.reputacao_limites`)), 0);
eq('visualizador le feriados (authenticated)', await comoAuth(() => val(`select count(*)::int from core.feriados`)), 20);

await perfil('gestor');
eq('gestor grava grupo', await comoAuth(() => tenta(`insert into core.grupos_anuncio (nome, antecedencia_dias) values ('Gestor', 5)`)), 'ok');
eq('gestor grava item de grupo', await comoAuth(() => tenta(`insert into core.grupo_anuncio_itens (channel, item_id, grupo_id) select 'mercadolivre', 'MLB2', id from core.grupos_anuncio where nome = 'Gestor'`)), 'ok');
eq('gestor nao grava feriado (so configuracoes)', await comoAuth(() => tenta(`insert into core.feriados (data, nome) values ('2026-06-01', 'X')`)), await comoAuth(async () => (await val(`select core.has_perm('configuracoes')`)) ? 'ok' : 'negado'));
await perfil('admin');
eq('admin grava feriado', await comoAuth(() => tenta(`insert into core.feriados (data, nome) values ('2026-06-04', 'Corpus Christi')`)), 'ok');
eq('admin altera parametros_alertas', await comoAuth(async () => { await db.exec(`update core.parametros_alertas set antecedencia_padrao = 5`); return val(`select antecedencia_padrao from core.parametros_alertas`); }), 5);
await db.exec(`update core.parametros_alertas set antecedencia_padrao = 4`);
await db.exec(`delete from core.feriados where data = '2026-06-04'`);

// ---------------- Reexecucao ----------------
await db.exec(`update core.role_permissions set allowed = true where role = 'comercial' and permission = 'editar_grupos'`);
await db.exec(`update core.parametros_alertas set antecedencia_padrao = 6`);
await db.exec(mig('0023_alertas_tabelas.sql'));
await db.exec(mig('0023_alertas_tabelas.sql'));
eq('reexecucao preserva permissao alterada', await val(`select allowed from core.role_permissions where role = 'comercial' and permission = 'editar_grupos'`), true);
eq('reexecucao preserva parametros alterados', await val(`select antecedencia_padrao from core.parametros_alertas`), 6);
eq('reexecucao nao duplica sementes', await rows(`select (select count(*)::int from core.feriados) as f,
  (select count(*)::int from core.parametros_alertas) as p,
  (select count(*)::int from core.role_permissions where permission in ('operacao','editar_grupos')) as r`),
  [{ f: 20, p: 1, r: 10 }]);

console.log(fails ? `\n${fails} FALHA(S)` : '\nTudo OK');
process.exit(fails ? 1 : 0);
