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
  '0008_dashboard_admin.sql', '0011_rls_desempenho.sql', '0012_crm.sql', '0012_crm.sql', '0013_crm_funcoes.sql', '0013_crm_funcoes.sql'])
  await db.exec(mig(f));
console.log('Migrations 0002 + 0003 + 0006 + 0007 + 0008 + 0011 + 0012 (x2) + 0013 (x2) aplicadas');

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

// Origens para a tela de administracao (o schema crm nao e exposto na Data API)
await db.exec(`insert into crm.sources (status_id, nome) values ('19', 'Site BdB (Bitrix)'), ('UC_OUTRA', 'Outra origem')
               on conflict do nothing`);
const adm = (await db.query(`select source_id, nome, ativo from core.crm_origens_admin()`)).rows;
eq('crm_origens_admin: semeadas + ativada, todas ativas',
  adm.filter((r) => r.source_id !== 'UC_OUTRA').map((r) => [r.source_id, r.ativo]).sort(),
  ['10|WHATSAPP', '14|FACEBOOK', '19', '23', '24', '38', '39', '42', '52|BITRIX_WHATCRM_NET_70680444', '53', '54', '99']
    .map((x) => [x, true]).sort());
eq('crm_origens_admin: origem do Bitrix fora da lista vem inativa', adm.find((r) => r.source_id === 'UC_OUTRA'),
  { source_id: 'UC_OUTRA', nome: 'Outra origem', ativo: false });
eq('crm_origens_admin: nome do Bitrix quando existe', adm.find((r) => r.source_id === '19').nome, 'Site BdB (Bitrix)');
eq('crm_origens_admin: ordenada por nome', adm.map((r) => r.nome), [...adm.map((r) => r.nome)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));

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
await perfil('comercial');
await erro('crm_origens_admin exige admin', `select * from core.crm_origens_admin()`, /permiss/);

// Sem nenhuma permissao crm_* (visualizador): nada do CRM, mesmo vendo o canal
await perfil('visualizador'); await uid(U1); await db.exec(`set role authenticated`);
try {
  eq('RLS visualizador (sem crm_*): crm.deals vazio', await val(`select count(*)::int from crm.deals`), 0);
  eq('RLS visualizador (sem crm_*): crm.users vazio', await val(`select count(*)::int from crm.users`), 0);
} finally { await db.exec(`reset role`); }

// ---------------- 0013: funcoes de analise analytics.crm_* ----------------
// 4 leads da origem 19 em outubro (um em 01/11 02:30+03 = 31/10 20:30 em Brasilia) + 1 lead do Bazar (UC_BVPCTK).
// Negocios do funil 10: ganho R$ 1.000 (20/10), perdido em C10:LOSE e aberto em C10:UC_W608A6. Mais 1 ganho no funil 33.
await db.exec(`
  insert into crm.stages (entity, status_id, category_id, nome, ordem, semantica) values
    ('deal', 'C10:NEW', 10, 'Novo', 10, 'andamento'),
    ('deal', 'C10:UC_W608A6', 10, 'Proposta', 20, 'andamento'),
    ('deal', 'C10:WON', 10, 'Ganho', 30, 'ganho'),
    ('deal', 'C10:LOSE', 10, 'Perdido', 40, 'perdido'),
    ('deal', 'C10:UC_SEMRESP', 10, 'Cliente sem resposta', 50, 'perdido'),
    ('deal', 'C33:WON', 33, 'Ganho', 30, 'ganho');
  insert into crm.leads (id, source_id, assigned_by_id, date_create) values
    (101, '19', 7, '2026-10-05T12:00:00-03:00'),
    (102, '19', 7, '2026-10-10T12:00:00-03:00'),
    (103, '19', 8, '2026-10-15T12:00:00-03:00'),
    (104, '19', 8, '2026-11-01T02:30:00+03:00'),
    (105, 'UC_BVPCTK', 7, '2026-10-12T12:00:00-03:00');
  insert into crm.deals (id, category_id, stage_id, source_id, assigned_by_id, lead_id, opportunity, date_create, closedate, area) values
    (201, 10, 'C10:WON', '19', 7, 101, 1000, '2026-10-06T12:00:00-03:00', '2026-10-20T12:00:00-03:00', 'Brinde do Bem'),
    (202, 10, 'C10:LOSE', '19', 7, 102, 500, '2026-10-11T12:00:00-03:00', '2026-10-25T12:00:00-03:00', 'Brinde do Bem'),
    (203, 10, 'C10:UC_W608A6', '19', 8, 103, 300, '2026-10-16T12:00:00-03:00', null, 'Brinde do Bem'),
    (204, 33, 'C33:WON', '19', 8, 104, 999, '2026-10-17T12:00:00-03:00', '2026-10-21T12:00:00-03:00', 'Brinde do Bem');
  insert into crm.stage_history (id, deal_id, stage_id, entrou_em) values
    (1, 201, 'C10:NEW', '2026-10-06T12:00:00-03:00'), (2, 201, 'C10:UC_W608A6', '2026-10-10T12:00:00-03:00'),
    (3, 201, 'C10:WON', '2026-10-20T12:00:00-03:00'),
    (4, 202, 'C10:NEW', '2026-10-11T12:00:00-03:00'), (5, 202, 'C10:LOSE', '2026-10-25T12:00:00-03:00'),
    (6, 203, 'C10:NEW', '2026-10-16T12:00:00-03:00'), (7, 203, 'C10:UC_W608A6', '2026-10-18T12:00:00-03:00');
  insert into crm.first_activity (lead_id, primeira_em) values
    (101, '2026-10-05T14:00:00-03:00'), (102, '2026-10-10T16:00:00-03:00');`);
await db.exec(`reset role`); await perfil('comercial'); await uid(U2);
const rows = async (sql) => (await db.query(sql)).rows;
const ARGS = (de, ate, extra = '') => `'${de}'::date, '${ate}'::date${extra}`;
const OUT = ARGS('2026-10-01', '2026-10-31');
const NOV = ARGS('2026-11-01', '2026-11-30');
const RESUMO = (a) => `select * from analytics.crm_resumo(${a})`;

eq('crm_resumo outubro', (await rows(RESUMO(OUT)))[0], {
  leads_novos: 4, leads_com_negocio: 3, negocios_coorte: 3, ganhos_coorte: 1,
  ganhos: 1, perdidos: 1, valor_ganho: '1000.00', ciclo_medio_dias: '14.0' });
eq('lead de 01/11 02:30+03 conta em outubro (nao em novembro)', (await rows(RESUMO(NOV)))[0].leads_novos, 0);
eq('crm_resumo novembro: zeros, sem erro', (await rows(RESUMO(NOV)))[0], {
  leads_novos: 0, leads_com_negocio: 0, negocios_coorte: 0, ganhos_coorte: 0,
  ganhos: 0, perdidos: 0, valor_ganho: '0.00', ciclo_medio_dias: null });
// CLOSEDATE gravada como o dia em Brasilia (mapDeal): ganho de 01/11 conta em novembro
await db.exec(`insert into crm.deals (id, category_id, stage_id, source_id, assigned_by_id, opportunity, date_create, closedate, area)
               values (205, 10, 'C10:WON', '19', 7, 700, '2026-10-25T12:00:00-03:00', '2026-11-01T00:00:00-03:00', 'Brinde do Bem')`);
eq('ganho com closedate 01/11 conta em novembro', (await rows(`select ganhos, valor_ganho from analytics.crm_resumo(${NOV})`))[0],
  { ganhos: 1, valor_ganho: '700.00' });
eq('ganho com closedate 01/11 nao conta em outubro', (await rows(`select ganhos, valor_ganho from analytics.crm_resumo(${OUT})`))[0],
  { ganhos: 1, valor_ganho: '1000.00' });
await db.exec(`delete from crm.deals where id = 205`);
eq('filtro p_area = Pedido Online zera os negocios', (await rows(RESUMO(ARGS('2026-10-01', '2026-10-31', `, 'Pedido Online'`))))[0], {
  leads_novos: 4, leads_com_negocio: 0, negocios_coorte: 0, ganhos_coorte: 0,
  ganhos: 0, perdidos: 0, valor_ganho: '0.00', ciclo_medio_dias: null });
eq('filtro p_vendedor = 8', (await rows(`select leads_novos, negocios_coorte, ganhos from analytics.crm_resumo(${OUT}, null, 8)`))[0],
  { leads_novos: 2, negocios_coorte: 1, ganhos: 0 });
eq('filtro p_origem = 38 (sem dados)', (await rows(`select leads_novos, ganhos from analytics.crm_resumo(${OUT}, null, null, '38')`))[0],
  { leads_novos: 0, ganhos: 0 });

eq('crm_funil outubro', await rows(`select ordem, etapa, quantidade from analytics.crm_funil(${OUT}) order by ordem`), [
  { ordem: 1, etapa: 'Leads', quantidade: 4 }, { ordem: 2, etapa: 'Negócios', quantidade: 3 },
  { ordem: 3, etapa: 'Novo', quantidade: 3 }, { ordem: 4, etapa: 'Proposta', quantidade: 2 },
  { ordem: 5, etapa: 'Ganhos', quantidade: 1 }]);

const etapas = await rows(`select status_id, nome, ordem, em_aberto, valor_aberto, tempo_medio_dias, gargalo from analytics.crm_etapas(${OUT}) order by ordem`);
eq('crm_etapas: Novo (foto de agora + tempo medio)', etapas[0],
  { status_id: 'C10:NEW', nome: 'Novo', ordem: 10, em_aberto: 0, valor_aberto: '0.00', tempo_medio_dias: '6.7', gargalo: false });
eq('crm_etapas: Proposta e o gargalo (aberto ate agora)', [etapas[1].em_aberto, etapas[1].valor_aberto, etapas[1].gargalo, Number(etapas[1].tempo_medio_dias) > 10],
  [1, '300.00', true, true]);
eq('crm_etapas: so etapas em andamento', etapas.length, 2);

eq('crm_motivos_perda outubro', await rows(`select status_id, motivo, perdidos, pct from analytics.crm_motivos_perda(${OUT})`),
  [{ status_id: 'C10:LOSE', motivo: 'Cancelado (sem motivo)', perdidos: 1, pct: '100.0' }]);
eq('crm_motivos_perda novembro vazio', await rows(`select * from analytics.crm_motivos_perda(${NOV})`), []);

const VEND = `select bitrix_id::int as id, vendedor, leads, primeiro_contato_horas as h, sem_contato, negocios, ganhos, perdidos,
  conversao, valor_ganho, ticket_medio from analytics.crm_vendedores`;
eq('crm_vendedores (comercial)', await rows(`${VEND}(${OUT})`), [
  { id: 7, vendedor: 'Ana', leads: 2, h: '3.0', sem_contato: 0, negocios: 2, ganhos: 1, perdidos: 1,
    conversao: '50.0', valor_ganho: '1000.00', ticket_medio: '1000.00' },
  { id: 8, vendedor: 'Beto', leads: 2, h: null, sem_contato: 2, negocios: 1, ganhos: 0, perdidos: 0,
    conversao: null, valor_ganho: '0.00', ticket_medio: null },
  { id: null, vendedor: 'Média da equipe', leads: 2, h: '3.0', sem_contato: 1, negocios: 2, ganhos: 1, perdidos: 1,
    conversao: '50.0', valor_ganho: '500.00', ticket_medio: '1000.00' }]);
await db.exec(`insert into crm.leads (id, source_id, assigned_by_id, date_create) values
  (106, '19', null, '2026-10-20T12:00:00-03:00'), (107, '19', 77, '2026-10-21T12:00:00-03:00'),
  (108, '19', 7, '2026-10-22T12:00:00-03:00')`);
await db.exec(`update crm.leads set deleted_at = now() where id = 108`);
eq('crm_vendedores: sem responsavel, usuario desconhecido e excluidos', (await rows(`${VEND}(${OUT})`)).map((r) => [r.id, r.vendedor, r.leads]),
  [[7, 'Ana', 2], [8, 'Beto', 2], [77, 'Usuário 77', 1], [null, 'Sem responsável', 1], [null, 'Média da equipe', 2]]);
await db.exec(`delete from crm.leads where id in (106, 107, 108)`);
await perfil('visualizador');
await erro('crm_vendedores exige permissao', `select * from analytics.crm_vendedores(${OUT})`, /permiss/);
await perfil('comercial');
await db.exec(`create or replace function core.can_see_channel(ch text) returns boolean language sql as 'select ch <> ''crm'''`);
eq('crm_vendedores sem o canal crm: nada', await rows(`${VEND}(${OUT})`), []);
await db.exec(`create or replace function core.can_see_channel(ch text) returns boolean language sql as 'select true'`);

const ORIG = `select source_id, origem, leads, pct_negocio, pct_ganho, valor_ganho, ticket_medio from analytics.crm_origens`;
eq('crm_origens outubro (origem 19)', (await rows(`${ORIG}(${OUT})`)).find((r) => r.source_id === '19'),
  { source_id: '19', origem: 'Site - Brinde do Bem', leads: 4, pct_negocio: '75.0', pct_ganho: '25.0', valor_ganho: '1000.00', ticket_medio: '1000.00' });
const origNov = await rows(`${ORIG}(${NOV})`);
eq('crm_origens novembro: sem divisao por zero (percentuais nulos)',
  [origNov.length > 0, origNov.every((r) => r.leads === 0 && r.pct_negocio === null && r.pct_ganho === null && r.ticket_medio === null)], [true, true]);
await db.exec(`update crm.deals set source_id = null where id = 201`);
eq('crm_origens: negocio sem origem', (await rows(`${ORIG}(${OUT})`)).find((r) => r.source_id === null),
  { source_id: null, origem: 'Sem origem', leads: 0, pct_negocio: null, pct_ganho: null, valor_ganho: '1000.00', ticket_medio: '1000.00' });
await db.exec(`update crm.deals set source_id = '19' where id = 201`);

eq('crm_opcoes', await rows(`select tipo, valor, rotulo from analytics.crm_opcoes() where tipo <> 'origem'`), [
  { tipo: 'area', valor: 'Brinde do Bem', rotulo: 'Brinde do Bem' },
  { tipo: 'vendedor', valor: '7', rotulo: 'Ana' }, { tipo: 'vendedor', valor: '8', rotulo: 'Beto' }]);
eq('crm_opcoes: origens ativas', (await rows(`select valor from analytics.crm_opcoes() where tipo = 'origem'`)).length, 12);

// Sem permissao crm_*: as funcoes devolvem nada (a tela mostra "sem dados"), sem erro
await perfil('visualizador');
eq('visualizador: crm_resumo sem linhas', await rows(RESUMO(OUT)), []);
eq('visualizador: crm_funil sem linhas', await rows(`select * from analytics.crm_funil(${OUT})`), []);
eq('visualizador: crm_etapas sem linhas', await rows(`select * from analytics.crm_etapas(${OUT})`), []);
eq('visualizador: crm_motivos_perda sem linhas', await rows(`select * from analytics.crm_motivos_perda(${OUT})`), []);
eq('visualizador: crm_origens sem linhas', await rows(`select * from analytics.crm_origens(${OUT})`), []);
eq('visualizador: crm_opcoes sem linhas', await rows(`select * from analytics.crm_opcoes()`), []);
await db.exec(`set role authenticated`);
try {
  eq('visualizador (RLS): crm_resumo sem linhas', await rows(RESUMO(OUT)), []);
} finally { await db.exec(`reset role`); }
// So crm_origens: ve as origens e as opcoes, mas nao o funil
await db.exec(`update core.role_permissions set allowed = (permission = 'crm_origens')
                where role = 'visualizador' and permission like 'crm\_%'`);
eq('so crm_origens: crm_origens tem linhas', (await rows(`select * from analytics.crm_origens(${OUT})`)).length > 0, true);
eq('so crm_origens: crm_opcoes tem linhas', (await rows(`select * from analytics.crm_opcoes()`)).length > 0, true);
eq('so crm_origens: crm_resumo sem linhas', await rows(RESUMO(OUT)), []);
await db.exec(`update core.role_permissions set allowed = false where role = 'visualizador' and permission like 'crm\_%'`);
await perfil('comercial');
await db.exec(`set role authenticated`);
try {
  eq('comercial (RLS): crm_resumo com dados', (await rows(RESUMO(OUT)))[0].leads_novos, 4);
} finally { await db.exec(`reset role`); }

// Como vendedor 7 (U1 ligado por e-mail), com o RLS valendo
await perfil('vendedor'); await uid(U1); await db.exec(`set role authenticated`);
try {
  eq('vendedor 7: crm_vendedores = a dele + Media da equipe', (await rows(`${VEND}(${OUT})`)).map((r) => [r.id, r.vendedor, r.leads]),
    [[7, 'Ana', 2], [null, 'Média da equipe', 2]]);
  eq('vendedor 7: p_vendedor de outro e ignorado', (await rows(`${VEND}(${OUT}, null, 8)`)).map((r) => r.vendedor),
    ['Ana', 'Média da equipe']);
  eq('vendedor 7: crm_resumo so dele', (await rows(RESUMO(OUT)))[0], {
    leads_novos: 2, leads_com_negocio: 2, negocios_coorte: 2, ganhos_coorte: 1,
    ganhos: 1, perdidos: 1, valor_ganho: '1000.00', ciclo_medio_dias: '14.0' });
  eq('vendedor 7: my_bitrix_id pela API', await val(`select core.my_bitrix_id()`), 7);
  eq('vendedor 7: crm_opcoes so ele', await rows(`select valor from analytics.crm_opcoes() where tipo = 'vendedor'`), [{ valor: '7' }]);
} finally { await db.exec(`reset role`); }
await uid(U2); await db.exec(`set role authenticated`);
try {
  eq('vendedor sem vinculo: crm_vendedores vazio', await rows(`${VEND}(${OUT})`), []);
} finally { await db.exec(`reset role`); }

if (fails) { console.log(`\n${fails} FALHA(S)`); process.exit(1); }
console.log('\nTodos os testes do CRM passaram');
