-- Cadastro proprio do vendedor (spec docs/superpowers/specs/2026-11-27-cadastro-vendedor-design.md).
-- 1) Elegibilidade: e-mail do dominio da empresa e usuario ativo no Bitrix (crm.users, sincronizado).
-- 2) Perfil: cadastro com a marca origem = 'cadastro_proprio' e elegivel vira vendedor com canal crm.
-- Reexecutavel: create or replace, drop trigger if exists.

-- ---------------------------------------------------------------------
-- 1. Elegibilidade (so o servico com service_role pode executar)
-- ---------------------------------------------------------------------
create or replace function core.pode_cadastrar_vendedor(p_email text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from crm.users u
     where lower(u.email) = lower(trim(p_email))
       and u.ativo = true
       and split_part(lower(trim(p_email)), '@', 2) = 'brindedobem.com.br'
  )
$$;

revoke all on function core.pode_cadastrar_vendedor(text) from public, anon, authenticated;
grant execute on function core.pode_cadastrar_vendedor(text) to service_role;

-- A API do Supabase so expoe o schema public: o servico chama este wrapper, que so delega.
create or replace function public.pode_cadastrar_vendedor(p_email text) returns boolean
language sql stable security invoker set search_path = '' as $$
  select core.pode_cadastrar_vendedor(p_email)
$$;

revoke all on function public.pode_cadastrar_vendedor(text) from public, anon, authenticated;
grant execute on function public.pode_cadastrar_vendedor(text) to service_role;

-- ---------------------------------------------------------------------
-- 2. Perfil criado no cadastro (o padrao continua visualizador)
-- ---------------------------------------------------------------------
create or replace function core.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into core.user_profiles (user_id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email))
  on conflict (user_id) do nothing;

  if coalesce(new.raw_user_meta_data ->> 'origem', '') = 'cadastro_proprio'
     and core.pode_cadastrar_vendedor(new.email) then
    update core.user_profiles
       set role = 'vendedor', channels = array['crm']
     where user_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function core.handle_new_user();
