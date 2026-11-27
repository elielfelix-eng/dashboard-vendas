import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Cadastro proprio do vendedor (migration 0038): elegibilidade pelo Bitrix e perfil criado no cadastro.
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
// auth.users do Supabase tem raw_user_meta_data; o stub so tinha id e email
await db.exec(`alter table auth.users add column if not exists raw_user_meta_data jsonb not null default '{}'::jsonb`);
// Tabela de perfis igual a de 0001_core.sql (a 0001 inteira depende do Vault, que o PGlite nao tem)
await db.exec(`
  create table core.user_profiles (
    user_id        uuid primary key references auth.users (id) on delete cascade,
    full_name      text,
    role           core.app_role not null default 'visualizador',
    channels       text[] not null default array['mercadolivre', 'shopee', 'crm'],
    bitrix_user_id bigint,
    created_at     timestamptz not null default now()
  );`);
for (const f of ['0002_marketplaces.sql', '0003_regras_v1.sql', '0006_custo_por_cotacao.sql', '0007_de_para_modelo.sql',
  '0008_dashboard_admin.sql', '0011_rls_desempenho.sql', '0012_crm.sql', '0013_crm_funcoes.sql', '0038_cadastro_vendedor.sql'])
  await db.exec(mig(f));
console.log('Migrations 0002 a 0013 e 0038 aplicadas');

const ALLISON = '00000000-0000-0000-0000-0000000000a1';
const INATIVO = '00000000-0000-0000-0000-0000000000a2';
const FORA = '00000000-0000-0000-0000-0000000000a3';
const SEM_ORIGEM = '00000000-0000-0000-0000-0000000000a4';
const CAIXA = '00000000-0000-0000-0000-0000000000a5';

await db.exec(`
  insert into crm.users (bitrix_id, nome, email, ativo) values
    (34741, 'Allison Santos', 'Allison.Santos@BrindeDoBem.com.br', true),
    (99001, 'Inativa', 'inativa@brindedobem.com.br', false),
    (99002, 'Externa', 'externa@gmail.com', true),
    (99003, 'Sem origem', 'sem.origem@brindedobem.com.br', true),
    (99004, 'Caixa', 'caixa@brindedobem.com.br', true);`);

const perfilDe = async (id) => (await db.query(
  `select role::text as role, channels from core.user_profiles where user_id = $1`, [id])).rows[0];
const criar = (id, email, origem) => db.query(
  `insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`,
  [id, email, origem ? JSON.stringify({ origem }) : '{}']);

// Elegivel: vira vendedor com canal crm (e-mail com maiusculas e espacos)
await criar(ALLISON, '  Allison.Santos@brindedobem.com.br ', 'cadastro_proprio');
eq('elegivel vira vendedor', await perfilDe(ALLISON), { role: 'vendedor', channels: ['crm'] });

// Inativo no Bitrix: continua visualizador
await criar(INATIVO, 'inativa@brindedobem.com.br', 'cadastro_proprio');
eq('inativo no Bitrix nao vira vendedor', await perfilDe(INATIVO), { role: 'visualizador', channels: ['mercadolivre', 'shopee', 'crm'] });

// Dominio de fora: continua visualizador, mesmo existindo no Bitrix
await criar(FORA, 'externa@gmail.com', 'cadastro_proprio');
eq('outro dominio nao vira vendedor', (await perfilDe(FORA)).role, 'visualizador');

// Sem a marca de origem: comportamento atual (visualizador), mesmo elegivel
await criar(SEM_ORIGEM, 'sem.origem@brindedobem.com.br', null);
eq('sem marca de origem mantem visualizador', (await perfilDe(SEM_ORIGEM)).role, 'visualizador');

// Caixa diferente no cadastro ainda e elegivel
await criar(CAIXA, 'CAIXA@BRINDEDOBEM.COM.BR', 'cadastro_proprio');
eq('caixa diferente e elegivel', (await perfilDe(CAIXA)).role, 'vendedor');

// Funcao de elegibilidade: so o servico (service_role) pode executar
eq('pode_cadastrar: elegivel', await val(`select core.pode_cadastrar_vendedor('allison.santos@brindedobem.com.br')`), true);
eq('pode_cadastrar: inativo', await val(`select core.pode_cadastrar_vendedor('inativa@brindedobem.com.br')`), false);
eq('pode_cadastrar: outro dominio', await val(`select core.pode_cadastrar_vendedor('externa@gmail.com')`), false);
eq('pode_cadastrar: nao cadastrado', await val(`select core.pode_cadastrar_vendedor('ninguem@brindedobem.com.br')`), false);
eq('pode_cadastrar: dominio parecido nao vale', await val(`select core.pode_cadastrar_vendedor('x@brindedobem.com.br.evil.com')`), false);

async function val(sql) {
  return Object.values((await db.query(sql)).rows[0])[0];
}

eq('wrapper public: elegivel', await val(`select public.pode_cadastrar_vendedor('allison.santos@brindedobem.com.br')`), true);
eq('wrapper public: outro dominio', await val(`select public.pode_cadastrar_vendedor('externa@gmail.com')`), false);
await db.exec(`grant usage on schema core, public to authenticated`);
await erro('authenticated nao executa o wrapper public', `set role authenticated; select public.pode_cadastrar_vendedor('allison.santos@brindedobem.com.br')`, /permission denied for function/);
await db.exec(`reset role`);
await db.exec(`grant usage on schema core to authenticated`);
await db.exec(`set role authenticated`);
await erro('authenticated nao executa a elegibilidade', `select core.pode_cadastrar_vendedor('allison.santos@brindedobem.com.br')`, /permission denied for function/);
await db.exec(`reset role`);

console.log(fails ? `\n${fails} teste(s) falharam` : '\nTodos os testes do cadastro de vendedor passaram');
process.exit(fails ? 1 : 0);
