-- =====================================================================
-- 0001 — Núcleo: schemas, perfis de usuário, contas conectadas,
--        cofre de tokens (Supabase Vault) e log de sincronização.
-- =====================================================================

create extension if not exists supabase_vault;

create schema if not exists core;      -- usuários, contas, tokens, logs
create schema if not exists mkt;       -- marketplaces (ML, Shopee)
create schema if not exists erp;       -- dados vindos do SQL Server (gateway)
create schema if not exists crm;       -- Bitrix24
create schema if not exists map;       -- de-para (SKU, negócio x ERP)
create schema if not exists config;    -- impostos, embalagem etc.
create schema if not exists analytics; -- views de KPI

-- ---------------------------------------------------------------------
-- Perfis de acesso
-- ---------------------------------------------------------------------
create type core.app_role as enum ('admin', 'gestor', 'comercial', 'visualizador', 'vendedor');

create table core.user_profiles (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  full_name      text,
  role           core.app_role not null default 'visualizador',
  -- canais que o usuário pode ver: mercadolivre, shopee, crm
  channels       text[] not null default array['mercadolivre', 'shopee', 'crm'],
  bitrix_user_id bigint,          -- usado pelo perfil "vendedor"
  created_at     timestamptz not null default now()
);

-- Funções auxiliares usadas pelas políticas RLS
create or replace function core.my_role() returns core.app_role
language sql stable security definer set search_path = '' as $$
  select role from core.user_profiles where user_id = auth.uid()
$$;

create or replace function core.can_see_channel(ch text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select ch = any (channels) from core.user_profiles where user_id = auth.uid()), false)
$$;

create or replace function core.can_see_costs() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(core.my_role() in ('admin', 'gestor'), false)
$$;

-- Cria o perfil automaticamente quando um usuário é cadastrado
create or replace function core.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into core.user_profiles (user_id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email))
  on conflict (user_id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function core.handle_new_user();

alter table core.user_profiles enable row level security;

create policy "usuario ve o proprio perfil; admin ve todos"
  on core.user_profiles for select to authenticated
  using (user_id = auth.uid() or core.my_role() = 'admin');

create policy "somente admin altera perfis"
  on core.user_profiles for all to authenticated
  using (core.my_role() = 'admin')
  with check (core.my_role() = 'admin');

-- ---------------------------------------------------------------------
-- Contas conectadas (ML, Shopee, Bitrix24)
-- ---------------------------------------------------------------------
create table core.accounts (
  id          uuid primary key default gen_random_uuid(),
  channel     text not null check (channel in ('mercadolivre', 'shopee', 'bitrix24')),
  external_id text not null,          -- ex.: user_id do vendedor no ML
  nickname    text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (channel, external_id)
);

alter table core.accounts enable row level security;
create policy "logados veem contas" on core.accounts for select to authenticated using (true);

-- ---------------------------------------------------------------------
-- Tokens OAuth — o conteúdo fica CRIPTOGRAFADO no Vault.
-- Esta tabela guarda apenas os IDs dos segredos e a validade.
-- Sem políticas RLS => nenhum usuário do site consegue ler.
-- ---------------------------------------------------------------------
create table core.oauth_tokens (
  account_id        uuid primary key references core.accounts (id) on delete cascade,
  access_secret_id  uuid not null,
  refresh_secret_id uuid not null,
  expires_at        timestamptz not null,
  scope             text,
  updated_at        timestamptz not null default now()
);
alter table core.oauth_tokens enable row level security;
revoke all on core.oauth_tokens from anon, authenticated;

create or replace function core.save_oauth_tokens(
  p_account uuid, p_access text, p_refresh text, p_expires_at timestamptz, p_scope text
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  r core.oauth_tokens;
begin
  select * into r from core.oauth_tokens where account_id = p_account for update;
  if not found then
    insert into core.oauth_tokens (account_id, access_secret_id, refresh_secret_id, expires_at, scope)
    values (
      p_account,
      vault.create_secret(p_access,  'oauth_access_'  || p_account),
      vault.create_secret(p_refresh, 'oauth_refresh_' || p_account),
      p_expires_at, p_scope
    );
  else
    perform vault.update_secret(r.access_secret_id, p_access);
    perform vault.update_secret(r.refresh_secret_id, p_refresh);
    update core.oauth_tokens
       set expires_at = p_expires_at, scope = p_scope, updated_at = now()
     where account_id = p_account;
  end if;
end $$;

create or replace function core.read_oauth_tokens(p_account uuid)
returns table (access_token text, refresh_token text, expires_at timestamptz)
language sql security definer set search_path = '' as $$
  select a.decrypted_secret, r.decrypted_secret, t.expires_at
    from core.oauth_tokens t
    join vault.decrypted_secrets a on a.id = t.access_secret_id
    join vault.decrypted_secrets r on r.id = t.refresh_secret_id
   where t.account_id = p_account
$$;

-- Somente o servidor (conexão direta / service_role) pode usar estas funções
revoke execute on function core.save_oauth_tokens(uuid, text, text, timestamptz, text) from public, anon, authenticated;
revoke execute on function core.read_oauth_tokens(uuid) from public, anon, authenticated;
grant execute on function core.save_oauth_tokens(uuid, text, text, timestamptz, text) to service_role;
grant execute on function core.read_oauth_tokens(uuid) to service_role;

-- ---------------------------------------------------------------------
-- Log das sincronizações (alimenta o selo "Atualizado às HH:MM")
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- Permissões de leitura via API (o RLS acima filtra as linhas)
-- ---------------------------------------------------------------------
grant usage on schema core to authenticated;
grant select on core.user_profiles, core.accounts, core.sync_runs to authenticated;
grant insert, update, delete on core.user_profiles to authenticated; -- RLS: só admin
grant execute on function core.my_role(), core.can_see_channel(text), core.can_see_costs() to authenticated;
