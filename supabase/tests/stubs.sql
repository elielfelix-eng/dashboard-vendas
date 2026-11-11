-- Stubs do ambiente Supabase para os testes em PGlite (auth, papeis, funcoes de perfil, core.sync_runs)
create role authenticated; create role anon; create role service_role;
create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';
create schema core; create schema mkt; create schema erp; create schema analytics; create schema config; create schema map; create schema crm;
create table core.accounts (id uuid primary key default gen_random_uuid());
create type core.app_role as enum ('admin','gestor','comercial','visualizador','vendedor');
create function core.can_see_channel(ch text) returns boolean language sql as 'select true';
create function core.can_see_costs() returns boolean language sql as 'select true';
create function core.my_role() returns core.app_role language sql as $$ select 'admin'::core.app_role $$;

-- identica a de 0001_core.sql
create table core.sync_runs (
  id          bigserial primary key,
  source      text not null check (source in ('mercadolivre', 'shopee', 'bitrix24', 'erp')),
  account_id  uuid references core.accounts (id) on delete set null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text not null default 'running' check (status in ('running', 'success', 'error')),
  stats       jsonb not null default '{}'::jsonb,
  error       text
);
create index on core.sync_runs (source, status, started_at desc);

alter table core.sync_runs enable row level security;
create policy "logados veem log de sincronizacao" on core.sync_runs for select to authenticated using (true);
