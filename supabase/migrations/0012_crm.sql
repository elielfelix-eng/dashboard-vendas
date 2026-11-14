-- =====================================================================
-- 0012 - CRM (Bitrix24): tabelas, permissoes, vinculo do vendedor e RLS
-- Pode ser reexecutada. Ordem de aplicacao: 0003 -> 0006 -> 0007 -> 0008 -> 0009 -> 0010 -> 0011 -> 0012 -> 0013.
-- A sincronizacao grava como service role (ignora RLS); o painel so le.
-- =====================================================================

create schema if not exists crm;

-- ---------------------------------------------------------------------
-- 1. Tabelas
-- ---------------------------------------------------------------------
create table if not exists crm.users (
  bitrix_id bigint primary key,
  nome      text,
  email     text,
  ativo     boolean,
  synced_at timestamptz not null default now()
);

create table if not exists crm.pipelines (
  category_id int primary key,
  nome        text,
  synced_at   timestamptz not null default now()
);

create table if not exists crm.stages (
  entity      text not null check (entity in ('lead', 'deal')),
  status_id   text not null,
  category_id int,
  nome        text,
  ordem       int,
  semantica   text check (semantica in ('andamento', 'ganho', 'perdido')),
  synced_at   timestamptz not null default now(),
  primary key (entity, status_id)
);

create table if not exists crm.sources (
  status_id text primary key,
  nome      text,
  synced_at timestamptz not null default now()
);

create table if not exists crm.origens_brinde (
  source_id text primary key,
  nome      text,
  ativo     boolean not null default true,
  synced_at timestamptz not null default now()
);

insert into crm.origens_brinde (source_id, nome) values
  ('19', 'Site - Brinde do Bem'),
  ('38', 'Site - Brindes Vocação'),
  ('10|WHATSAPP', 'WhatsApp - Brindedobem'),
  ('52|BITRIX_WHATCRM_NET_70680444', 'WhatsApp - Brinde do Bem - Alternativo'),
  ('39', 'WhatsApp - Brindes Vocação'),
  ('23', 'E-Mail - Brinde do Bem'),
  ('53', 'Email - Brindes Vocação'),
  ('42', 'E-Mail - Relacionamento Brinde do Bem'),
  ('24', 'Telefone - Brinde do Bem'),
  ('14|FACEBOOK', 'Facebook - Brinde do Bem'),
  ('54', 'Landing page Brinde do bem')
on conflict (source_id) do nothing;

create table if not exists crm.leads (
  id             bigint primary key,
  status_id      text,
  source_id      text,
  assigned_by_id bigint,
  date_create    timestamptz,
  date_modify    timestamptz,
  date_closed    timestamptz,
  contact_id     bigint,
  company_id     bigint,
  opportunity    numeric(14, 2),
  deleted_at     timestamptz,
  synced_at      timestamptz not null default now()
);

create table if not exists crm.deals (
  id                bigint primary key,
  category_id       int,
  stage_id          text,
  stage_semantic_id text,
  source_id         text,
  assigned_by_id    bigint,
  lead_id           bigint,
  contact_id        bigint,
  company_id        bigint,
  opportunity       numeric(14, 2),
  currency_id       text,
  date_create       timestamptz,
  date_modify       timestamptz,
  closedate         timestamptz,
  closed            boolean,
  area              text,
  deleted_at        timestamptz,
  synced_at         timestamptz not null default now()
);
create index if not exists deals_lead_id_idx on crm.deals (lead_id);
create index if not exists deals_assigned_by_id_idx on crm.deals (assigned_by_id);
create index if not exists deals_closedate_idx on crm.deals (closedate);

create table if not exists crm.stage_history (
  id        bigint primary key,
  deal_id   bigint,
  stage_id  text,
  entrou_em timestamptz,
  synced_at timestamptz not null default now()
);
create index if not exists stage_history_deal_idx on crm.stage_history (deal_id, entrou_em);

create table if not exists crm.first_activity (
  lead_id     bigint primary key,
  primeira_em timestamptz,
  synced_at   timestamptz not null default now()
);

-- Excecoes da ligacao usuario do painel <-> usuario do Bitrix (mantida pelo admin).
-- Linha com bitrix_id nulo = ligacao automatica (por e-mail) desligada.
create table if not exists crm.vinculo_vendedor (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  bitrix_id bigint
);

-- ---------------------------------------------------------------------
-- 2. Permissoes por perfil (sementes: nao desfazem o que o admin mudou)
-- ---------------------------------------------------------------------
insert into core.role_permissions (role, permission, allowed)
select r.role::core.app_role, p.permission, r.role <> 'visualizador'
  from unnest(array['admin', 'gestor', 'comercial', 'visualizador', 'vendedor']) as r(role)
 cross join unnest(array['crm_funil', 'crm_vendedores', 'crm_origens']) as p(permission)
on conflict (role, permission) do nothing;

-- ---------------------------------------------------------------------
-- 3. Vendedor do painel -> usuario do Bitrix
-- ---------------------------------------------------------------------
create or replace function core.my_bitrix_id() returns bigint
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from crm.vinculo_vendedor v where v.user_id = auth.uid())
      then (select v.bitrix_id from crm.vinculo_vendedor v where v.user_id = auth.uid())
    else (select u.bitrix_id
            from crm.users u
            join auth.users a on lower(trim(a.email)) = lower(trim(u.email))
           where a.id = auth.uid()
           order by u.ativo desc nulls last, u.bitrix_id
           limit 1)
  end
$$;
grant execute on function core.my_bitrix_id() to authenticated;

create or replace function core.crm_vinculos()
returns table (bitrix_id bigint, nome text, email text, ativo boolean, user_id uuid, usuario text, tipo text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not core.has_perm('configuracoes') then
    raise exception 'sem permissao para ver os vinculos do CRM';
  end if;
  return query
  select u.bitrix_id, u.nome, u.email, u.ativo,
         coalesce(m.user_id, a.id) as user_id,
         coalesce(ma.email, a.email) as usuario,
         case when m.user_id is not null then 'manual'
              when a.id is not null
                   and not exists (select 1 from crm.vinculo_vendedor x where x.user_id = a.id) then 'automatico'
         end as tipo
    from crm.users u
    left join crm.vinculo_vendedor m on m.bitrix_id = u.bitrix_id
    left join auth.users ma on ma.id = m.user_id
    left join auth.users a on lower(trim(a.email)) = lower(trim(u.email)) and m.user_id is null
   order by u.nome, u.bitrix_id;
end $$;
revoke all on function core.crm_vinculos() from public;
grant execute on function core.crm_vinculos() to authenticated;

create or replace function core.crm_vincular(p_user uuid, p_bitrix bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not core.has_perm('configuracoes') then
    raise exception 'sem permissao para alterar os vinculos do CRM';
  end if;
  insert into crm.vinculo_vendedor (user_id, bitrix_id) values (p_user, p_bitrix)
  on conflict (user_id) do update set bitrix_id = excluded.bitrix_id;
end $$;
revoke all on function core.crm_vincular(uuid, bigint) from public;
grant execute on function core.crm_vincular(uuid, bigint) to authenticated;

create or replace function core.crm_desvincular_auto(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not core.has_perm('configuracoes') then
    raise exception 'sem permissao para alterar os vinculos do CRM';
  end if;
  insert into crm.vinculo_vendedor (user_id, bitrix_id) values (p_user, null)
  on conflict (user_id) do update set bitrix_id = null;
end $$;
revoke all on function core.crm_desvincular_auto(uuid) from public;
grant execute on function core.crm_desvincular_auto(uuid) to authenticated;

create or replace function core.crm_origem_ativa(p_source text, p_ativo boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not core.has_perm('configuracoes') then
    raise exception 'sem permissao para alterar as origens do CRM';
  end if;
  insert into crm.origens_brinde (source_id, nome, ativo)
  values (p_source, coalesce((select s.nome from crm.sources s where s.status_id = p_source), p_source), p_ativo)
  on conflict (source_id) do update set ativo = excluded.ativo;
end $$;
revoke all on function core.crm_origem_ativa(text, boolean) from public;
grant execute on function core.crm_origem_ativa(text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 4. RLS: leitura para quem ve o canal 'crm' (vendedor so ve o que e dele)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['users', 'pipelines', 'stages', 'sources', 'origens_brinde',
                           'stage_history', 'first_activity', 'leads', 'deals', 'vinculo_vendedor']
  loop
    execute format('alter table crm.%I enable row level security', t);
    execute format('drop policy if exists "crm: leitura" on crm.%I', t);
  end loop;

  foreach t in array array['users', 'pipelines', 'stages', 'sources', 'origens_brinde',
                           'stage_history', 'first_activity']
  loop
    execute format('create policy "crm: leitura" on crm.%I for select to authenticated
                      using ((select core.can_see_channel(''crm'')))', t);
  end loop;

  foreach t in array array['leads', 'deals']
  loop
    execute format('create policy "crm: leitura" on crm.%I for select to authenticated
                      using ((select core.can_see_channel(''crm''))
                             and ((select core.my_role()) <> ''vendedor'' or assigned_by_id = (select core.my_bitrix_id())))', t);
  end loop;
end $$;

grant usage on schema crm to authenticated;
grant select on crm.users, crm.pipelines, crm.stages, crm.sources, crm.origens_brinde,
                crm.leads, crm.deals, crm.stage_history, crm.first_activity to authenticated;
