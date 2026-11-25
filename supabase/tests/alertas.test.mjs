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
  '0012_crm.sql', '0013_crm_funcoes.sql', '0018_ads_tabelas.sql', '0019_ads_funcoes.sql', '0023_alertas_tabelas.sql',
  '0024_alertas_funcoes.sql'])
  await db.exec(mig(f));
console.log('Migrations 0002..0013 + 0018 + 0019 + 0023 + 0024 aplicadas');

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

// ---------------- Dias uteis (0024) ----------------
// 2026-11-20 (sexta) e feriado; 2026-11-23 e segunda; 2026-11-30 e segunda.
eq('subtrai_dias_uteis(2026-11-30, 4)', await val(`select core.subtrai_dias_uteis('2026-11-30', 4)::text`), '2026-11-24');
eq('subtrai_dias_uteis(2026-11-23, 1) pula feriado e fim de semana', await val(`select core.subtrai_dias_uteis('2026-11-23', 1)::text`), '2026-11-19');
eq('subtrai_dias_uteis(x, 0) = x', await val(`select core.subtrai_dias_uteis('2026-11-22', 0)::text`), '2026-11-22');
eq('dias_uteis_ate(2026-11-24, 2026-11-30)', await val(`select core.dias_uteis_ate('2026-11-24', '2026-11-30')`), 4);
eq('dias_uteis_ate(2026-11-30, 2026-11-30)', await val(`select core.dias_uteis_ate('2026-11-30', '2026-11-30')`), 0);
eq('dias_uteis_ate(2026-12-01, 2026-11-30)', await val(`select core.dias_uteis_ate('2026-12-01', '2026-11-30')`), -1);
eq('dias_uteis_ate(2026-11-19, 2026-11-23) pula feriado', await val(`select core.dias_uteis_ate('2026-11-19', '2026-11-23')`), 1);

// ---------------- Listas de alerta (0024) ----------------
// A: sem grupo (padrao 4), despacho 2026-11-30, entrega 2026-12-20 (fora da janela em 26/11)
// B: pacote com dois pedidos/itens nos grupos G2 (2 dias) e G6 (6 dias), despacho e entrega 2026-12-04
// C: prazos nulos; D: pedido cancelado; E: ja despachado (shipped), entrega 2026-11-30
await db.exec(`
  insert into core.grupos_anuncio (nome, antecedencia_dias) values ('G2', 2), ('G6', 6);
  insert into core.grupo_anuncio_itens (channel, item_id, grupo_id)
    select 'mercadolivre', 'MLB-B2', id from core.grupos_anuncio where nome = 'G2'
    union all select 'mercadolivre', 'MLB-B6', id from core.grupos_anuncio where nome = 'G6';
  insert into mkt.orders (channel, order_id, pack_id, status, shipment_id) values
    ('mercadolivre', 'OA', null, 'paid', 'SA'),
    ('mercadolivre', 'OB1', 'PB', 'paid', 'SB'),
    ('mercadolivre', 'OB2', 'PB', 'paid', 'SB'),
    ('mercadolivre', 'OC', null, 'paid', 'SC'),
    ('mercadolivre', 'OD', null, 'cancelled', 'SD'),
    ('mercadolivre', 'OE', null, 'paid', 'SE');
  insert into mkt.order_items (channel, order_id, line_no, item_id, title, quantity, unit_price) values
    ('mercadolivre', 'OA', 1, 'MLB-A', 'Caneca A', 1, 10),
    ('mercadolivre', 'OB1', 1, 'MLB-B2', 'Caneca B2', 1, 10),
    ('mercadolivre', 'OB2', 1, 'MLB-B6', 'Caneca B6', 1, 10),
    ('mercadolivre', 'OC', 1, 'MLB-C', 'Caneca C', 1, 10),
    ('mercadolivre', 'OD', 1, 'MLB-D', 'Caneca D', 1, 10),
    ('mercadolivre', 'OE', 1, 'MLB-E', 'Caneca E', 1, 10);
  insert into mkt.envios_prazos (channel, shipment_id, status, prazo_despacho, prazo_entrega, despachado_em) values
    ('mercadolivre', 'SA', 'ready_to_ship', '2026-11-30', '2026-12-20', null),
    ('mercadolivre', 'SB', 'ready_to_ship', '2026-12-04', '2026-12-04', null),
    ('mercadolivre', 'SC', 'handling', null, null, null),
    ('mercadolivre', 'SD', 'ready_to_ship', '2026-11-24', '2026-11-26', null),
    ('mercadolivre', 'SE', 'shipped', '2026-11-20', '2026-11-30', '2026-11-19 15:00-03');`);
const lista = (tipo, hoje) => rows(`select situacao, shipment_id, order_id, pack_id, item_id, titulo, grupo, antecedencia,
  prazo::text as prazo, faltam, status_envio, despachado from analytics.alertas_envio('${tipo}', '${hoje}')`);
const de = (ls, s) => ls.filter((r) => r.shipment_id === s);

eq('A em 23/11: nao aparece', de(await lista('despacho', '2026-11-23'), 'SA').length, 0);
eq('A em 24/11: em_risco, faltam 4', de(await lista('despacho', '2026-11-24'), 'SA').map((r) => [r.situacao, r.faltam, r.antecedencia, r.grupo]),
  [['em_risco', 4, 4, null]]);
eq('A em 01/12: atrasada', de(await lista('despacho', '2026-12-01'), 'SA').map((r) => [r.situacao, r.faltam]), [['atrasada', -1]]);
const d26 = await lista('despacho', '2026-11-26');
eq('B em 26/11: uma linha, antecedencia 6, em_risco, item do G6', de(d26, 'SB').map((r) => [r.situacao, r.antecedencia, r.grupo, r.item_id, r.order_id, r.pack_id, r.titulo]),
  [['em_risco', 6, 'G6', 'MLB-B6', 'OB2', 'PB', 'Caneca B6']]);
eq('C: prazo_desconhecido na ultima linha', [d26.at(-1).shipment_id, d26.at(-1).situacao, d26.at(-1).prazo, d26.at(-1).faltam], ['SC', 'prazo_desconhecido', null, null]);
eq('despacho em 26/11: ordem A, B, C (sem D cancelado, sem E despachado)', d26.map((r) => r.shipment_id), ['SA', 'SB', 'SC']);
const e26 = await lista('entrega', '2026-11-26');
eq('entrega em 26/11: nao despachados primeiro, E depois, C por ultimo', e26.map((r) => [r.shipment_id, r.situacao, r.despachado]),
  [['SB', 'em_risco', false], ['SE', 'em_risco', true], ['SC', 'prazo_desconhecido', false]]);
eq('entrega: E faltam 2 (27/11 e 30/11)', de(e26, 'SE').map((r) => [r.faltam, r.status_envio]), [[2, 'shipped']]);
eq('alertas_contagem em 26/11: A, B (uma vez), C, E', await val(`select analytics.alertas_contagem('2026-11-26')`), 4);
eq('tipo invalido: zero linhas', (await lista('outro', '2026-11-26')).length, 0);

await perfil('comercial');
eq('comercial (operacao) ve a lista', await comoAuth(async () => (await lista('despacho', '2026-11-26')).length), 3);
await db.exec(`set teste.canais = 'shopee'`);
eq('canal nao liberado: lista vazia', await comoAuth(async () => (await lista('despacho', '2026-11-26')).length), 0);
await db.exec(`set teste.canais = 'mercadolivre,shopee,crm'`);
await perfil('visualizador');
eq('visualizador: alertas_envio(despacho) = 0', await comoAuth(async () => (await lista('despacho', '2026-11-26')).length), 0);
eq('visualizador: alertas_contagem = 0', await comoAuth(() => val(`select analytics.alertas_contagem('2026-11-26')`)), 0);
eq('visualizador: reputacao_atual = 0', await comoAuth(async () => (await rows(`select * from analytics.reputacao_atual()`)).length), 0);
eq('visualizador: reputacao_serie = 0', await comoAuth(async () => (await rows(`select * from analytics.reputacao_serie()`)).length), 0);
await perfil('admin');

// ---------------- Reputacao (0024) ----------------
// Foto mais recente: verde, reclamacoes 0,9 (limite 1), cancelamentos 0,5 (sem limite), atrasos 7 (limite 6).
// Duas fotos no mesmo dia (3 dias atras, Brasilia): a serie fica com a ultima.
await db.exec(`
  insert into core.reputacao_limites (level_id, indicador, limite_pct) values ('verde', 'reclamacoes', 1);
  insert into mkt.reputacao_fotos (account_id, capturado_em, level_id, power_seller_status, reclamacoes_taxa, cancelamentos_taxa, atrasos_taxa) values
    ('00000000-0000-0000-0000-000000000001', now() + interval '1 hour', 'verde', 'platinum', 0.9, 0.5, 7),
    ('00000000-0000-0000-0000-000000000001', (((now() at time zone 'America/Sao_Paulo')::date - 3)::timestamp + time '10:00') at time zone 'America/Sao_Paulo', 'amarelo', null, 2, 2, 2),
    ('00000000-0000-0000-0000-000000000001', (((now() at time zone 'America/Sao_Paulo')::date - 3)::timestamp + time '15:00') at time zone 'America/Sao_Paulo', 'verde', null, 1, 1, 1);`);
eq('reputacao_atual: 3 linhas da foto mais recente', await rows(`select level_id, power_seller_status, indicador, valor_pct::float as valor,
    limite_pct::float as limite, perto, acima from analytics.reputacao_atual()`),
  [{ level_id: 'verde', power_seller_status: 'platinum', indicador: 'reclamacoes', valor: 0.9, limite: 1, perto: true, acima: false },
   { level_id: 'verde', power_seller_status: 'platinum', indicador: 'cancelamentos', valor: 0.5, limite: null, perto: null, acima: null },
   { level_id: 'verde', power_seller_status: 'platinum', indicador: 'atrasos', valor: 7, limite: 6, perto: true, acima: true }]);
const serie = await rows(`select dia::text as dia, level_id, reclamacoes::float as r from analytics.reputacao_serie(180)
  where dia = (now() at time zone 'America/Sao_Paulo')::date - 3`);
eq('reputacao_serie: ultima foto do dia', serie.map((x) => [x.level_id, x.r]), [['verde', 1]]);
eq('reputacao_serie(1): so os ultimos dias', await val(`select count(*)::int from analytics.reputacao_serie(1)
  where dia < (now() at time zone 'America/Sao_Paulo')::date - 1`), 0);
await perfil('comercial');
eq('comercial le reputacao_atual', await comoAuth(async () => (await rows(`select * from analytics.reputacao_atual()`)).length), 3);
await perfil('admin');

// ---------------- Reexecucao ----------------
await db.exec(`update core.role_permissions set allowed = true where role = 'comercial' and permission = 'editar_grupos'`);
await db.exec(`update core.parametros_alertas set antecedencia_padrao = 6`);
await db.exec(mig('0023_alertas_tabelas.sql'));
await db.exec(mig('0023_alertas_tabelas.sql'));
await db.exec(mig('0024_alertas_funcoes.sql'));
await db.exec(mig('0024_alertas_funcoes.sql'));
eq('reexecucao da 0024: contagem igual', await val(`select analytics.alertas_contagem('2026-11-26')`), 4);
eq('reexecucao preserva permissao alterada', await val(`select allowed from core.role_permissions where role = 'comercial' and permission = 'editar_grupos'`), true);
eq('reexecucao preserva parametros alterados', await val(`select antecedencia_padrao from core.parametros_alertas`), 6);
eq('reexecucao nao duplica sementes', await rows(`select (select count(*)::int from core.feriados) as f,
  (select count(*)::int from core.parametros_alertas) as p,
  (select count(*)::int from core.role_permissions where permission in ('operacao','editar_grupos')) as r`),
  [{ f: 20, p: 1, r: 10 }]);

console.log(fails ? `\n${fails} FALHA(S)` : '\nTudo OK');
process.exit(fails ? 1 : 0);
