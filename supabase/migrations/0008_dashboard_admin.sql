-- =====================================================================
-- 0008 - Dashboard: permissoes por perfil, parametros de custo, metas e premissas
-- Pode ser reexecutada. Ordem de aplicacao: 0003 -> 0006 -> 0007 -> 0008 -> 0009 -> 0010.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Permissoes por perfil (editaveis na tela Administracao > Permissoes)
-- ---------------------------------------------------------------------
create table if not exists core.role_permissions (
  role       core.app_role not null,
  permission text not null,
  allowed    boolean not null default false,
  primary key (role, permission)
);

-- Sementes (so na primeira vez: on conflict do nothing preserva o que o admin mudou)
insert into core.role_permissions (role, permission, allowed)
select r.role::core.app_role, p.permission,
       case r.role
         when 'admin' then true
         when 'gestor' then p.permission <> 'configuracoes'
         when 'comercial' then p.permission in ('visao_geral', 'vendas', 'metas')
         when 'visualizador' then p.permission = 'visao_geral'
         else false
       end
  from unnest(array['admin', 'gestor', 'comercial', 'visualizador', 'vendedor']) as r(role)
 cross join unnest(array['visao_geral', 'vendas', 'rentabilidade', 'metas', 'custos', 'editar_metas', 'configuracoes']) as p(permission)
on conflict (role, permission) do nothing;

create or replace function core.has_perm(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select rp.allowed from core.role_permissions rp
                    where rp.role = core.my_role() and rp.permission = p), false)
$$;

-- Quem ve custos passa a ser decidido pela permissao 'custos'
create or replace function core.can_see_costs() returns boolean
language sql stable security definer set search_path = '' as $$
  select core.has_perm('custos')
$$;

-- Trava: o admin nunca perde o acesso a administracao
create or replace function core.trava_admin_configuracoes() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'DELETE' and old.role = 'admin' and old.permission = 'configuracoes')
     or (tg_op = 'UPDATE' and new.role = 'admin' and new.permission = 'configuracoes' and not new.allowed) then
    raise exception 'o perfil admin precisa manter a permissao configuracoes';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists trava_admin_configuracoes on core.role_permissions;
create trigger trava_admin_configuracoes before update or delete on core.role_permissions
  for each row execute function core.trava_admin_configuracoes();

alter table core.role_permissions enable row level security;
drop policy if exists "permissoes: leitura" on core.role_permissions;
drop policy if exists "permissoes: admin altera" on core.role_permissions;
create policy "permissoes: leitura" on core.role_permissions for select to authenticated using (true);
create policy "permissoes: admin altera" on core.role_permissions for update to authenticated
  using (core.my_role() = 'admin') with check (core.my_role() = 'admin');
grant select, update on core.role_permissions to authenticated;

-- ---------------------------------------------------------------------
-- 2. Parametros de custo por canal e vigencia (imposto e embalagem)
-- ---------------------------------------------------------------------
create table if not exists core.parametros_custo (
  id               bigserial primary key,
  channel          text not null,
  imposto_pct      numeric(6, 3) not null default 0 check (imposto_pct >= 0),
  embalagem_pedido numeric(12, 2) not null default 0 check (embalagem_pedido >= 0),
  embalagem_peca   numeric(12, 4) not null default 0 check (embalagem_peca >= 0),
  vigente_desde    date not null,
  unique (channel, vigente_desde)
);
insert into core.parametros_custo (channel, imposto_pct, embalagem_pedido, embalagem_peca, vigente_desde)
values ('mercadolivre', 0, 0, 0, '2019-01-01')
on conflict (channel, vigente_desde) do nothing;

alter table core.parametros_custo enable row level security;
drop policy if exists "parametros: leitura" on core.parametros_custo;
drop policy if exists "parametros: admin altera" on core.parametros_custo;
create policy "parametros: leitura" on core.parametros_custo for select to authenticated using (true);
create policy "parametros: admin altera" on core.parametros_custo for all to authenticated
  using (core.my_role() = 'admin') with check (core.my_role() = 'admin');
grant select, insert, update, delete on core.parametros_custo to authenticated;
grant usage on sequence core.parametros_custo_id_seq to authenticated;

-- ---------------------------------------------------------------------
-- 3. Metas mensais por canal (upload do Excel)
-- ---------------------------------------------------------------------
create table if not exists core.metas (
  channel      text not null check (channel in ('mercadolivre', 'shopee', 'brindedobem')),
  ano          integer not null,
  mes          integer not null check (mes between 1 and 12),
  valor        numeric(14, 2) not null check (valor >= 0),
  carregado_em timestamptz not null default now(),
  primary key (channel, ano, mes)
);

alter table core.metas enable row level security;
drop policy if exists "metas: leitura" on core.metas;
drop policy if exists "metas: edicao" on core.metas;
create policy "metas: leitura" on core.metas for select to authenticated using (core.has_perm('metas') or core.has_perm('editar_metas'));
create policy "metas: edicao" on core.metas for all to authenticated
  using (core.has_perm('editar_metas')) with check (core.has_perm('editar_metas'));
grant select, insert, update, delete on core.metas to authenticated;

-- Substitui as metas dos anos presentes no arquivo (tudo numa transacao)
create or replace function core.substituir_metas(p_linhas jsonb) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  v_n integer;
begin
  delete from core.metas m
   where m.ano in (select distinct (l->>'ano')::integer from jsonb_array_elements(p_linhas) l);
  insert into core.metas (channel, ano, mes, valor)
  select l->>'channel', (l->>'ano')::integer, (l->>'mes')::integer, (l->>'valor')::numeric
    from jsonb_array_elements(p_linhas) l;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
grant execute on function core.substituir_metas(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 4. Premissas da projecao (crescimento % ao mes; mes vazio = padrao do canal no ano)
-- ---------------------------------------------------------------------
create table if not exists core.premissas_projecao (
  id              bigserial primary key,
  channel         text not null check (channel in ('mercadolivre', 'shopee', 'brindedobem')),
  ano             integer not null,
  mes             integer check (mes between 1 and 12),
  crescimento_pct numeric(7, 3) not null,
  alterado_em     timestamptz not null default now()
);
create unique index if not exists premissas_projecao_chave
  on core.premissas_projecao (channel, ano, (coalesce(mes, 0)));

alter table core.premissas_projecao enable row level security;
drop policy if exists "premissas: leitura" on core.premissas_projecao;
drop policy if exists "premissas: edicao" on core.premissas_projecao;
create policy "premissas: leitura" on core.premissas_projecao for select to authenticated using (core.has_perm('metas'));
create policy "premissas: edicao" on core.premissas_projecao for all to authenticated
  using (core.has_perm('editar_metas')) with check (core.has_perm('editar_metas'));
grant select, insert, update, delete on core.premissas_projecao to authenticated;
grant usage on sequence core.premissas_projecao_id_seq to authenticated;

grant execute on function core.has_perm(text), core.can_see_costs() to authenticated;
