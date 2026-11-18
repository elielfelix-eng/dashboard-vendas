-- =====================================================================
-- 0018 - Ads e Orcamento: tabelas, permissoes, orcamento e limites com vigencia
-- Pode ser reexecutada. Aplicar depois da 0013 (e da 0011, que define o desempenho da RLS).
-- O job de sincronizacao conecta por DATABASE_URL (dono do banco, ignora RLS), como nas
-- demais tabelas mkt.*; por isso nao ha grant de escrita para ele aqui.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Dados sincronizados (schema mkt)
-- ---------------------------------------------------------------------
create table if not exists mkt.ads_anuncios (
  channel      text not null,
  item_id      text not null,
  campaign_id  text,
  status       text,
  atualizado_em timestamptz not null default now(),
  primary key (channel, item_id)
);

alter table mkt.ads_anuncios enable row level security;
drop policy if exists "canal liberado" on mkt.ads_anuncios;
create policy "canal liberado" on mkt.ads_anuncios for select to authenticated
  using ((select core.can_see_channel(channel)));
grant select on mkt.ads_anuncios to authenticated;

alter table mkt.ads_campaigns add column if not exists roas_target   numeric;
alter table mkt.ads_campaigns add column if not exists automatica    boolean;
alter table mkt.ads_campaigns add column if not exists atualizado_em timestamptz;

-- ---------------------------------------------------------------------
-- 2. Permissoes (sementes: so na primeira vez, on conflict do nothing preserva o que o admin mudou)
--    ads: admin, gestor, comercial | editar_ads: admin, gestor
-- ---------------------------------------------------------------------
insert into core.role_permissions (role, permission, allowed)
select r.role::core.app_role, p.permission,
       case p.permission
         when 'ads' then r.role in ('admin', 'gestor', 'comercial')
         else r.role in ('admin', 'gestor')
       end
  from unnest(array['admin', 'gestor', 'comercial', 'visualizador', 'vendedor']) as r(role)
 cross join unnest(array['ads', 'editar_ads']) as p(permission)
on conflict (role, permission) do nothing;

-- ---------------------------------------------------------------------
-- 3. Orcamento mensal por canal e vigencia (leitura com 'ads'; editavel por quem tem editar_ads)
--    Vale a linha com o maior vigente_desde <= data consultada.
-- ---------------------------------------------------------------------
create table if not exists core.orcamento_ads (
  channel       text not null check (channel in ('mercadolivre', 'shopee')),
  vigente_desde date not null,
  valor_mensal  numeric(14, 2) not null check (valor_mensal > 0),
  primary key (channel, vigente_desde)
);
insert into core.orcamento_ads (channel, vigente_desde, valor_mensal) values
  ('mercadolivre', '2026-11-01', 5000),
  ('shopee', '2026-11-01', 5000)
on conflict (channel, vigente_desde) do nothing;

alter table core.orcamento_ads enable row level security;
drop policy if exists "orcamento ads: leitura" on core.orcamento_ads;
drop policy if exists "orcamento ads: edicao" on core.orcamento_ads;
-- leitura so com a permissao 'ads' (a tela Ads); o calculo do mes usa analytics.ads_orcamento (definer)
create policy "orcamento ads: leitura" on core.orcamento_ads for select to authenticated
  using ((select core.has_perm('ads')));
create policy "orcamento ads: edicao" on core.orcamento_ads for all to authenticated
  using ((select core.has_perm('editar_ads'))) with check ((select core.has_perm('editar_ads')));
grant select, insert, update, delete on core.orcamento_ads to authenticated;

-- ---------------------------------------------------------------------
-- 4. Limites das sugestoes por canal e vigencia (editaveis so pelo admin)
-- ---------------------------------------------------------------------
create table if not exists core.parametros_ads (
  channel                   text not null check (channel in ('mercadolivre', 'shopee')),
  vigente_desde             date not null,
  pausar_gasto_min          numeric not null default 50,
  pausar_cliques_min        integer not null default 100,
  min_dias_dados            integer not null default 7,
  revisar_cliques_min       integer not null default 100,
  revisar_conversao_max_pct numeric not null default 1,
  escalar_folga_pp          numeric not null default 10,
  escalar_unidades_min      integer not null default 3,
  testar_margem_min_pct     numeric not null default 20,
  testar_unidades_min       integer not null default 3,
  teste_reserva_pct         numeric not null default 10,
  teste_max_modelos         integer not null default 5,
  reduzir_fator             numeric not null default 0.7,
  teto_fator                numeric not null default 2,
  alerta_sobra_pct          numeric not null default 80,
  primary key (channel, vigente_desde)
);
-- Limites vigentes desde 2025-01-01: os periodos historicos (ate 12 meses) tambem tem limites.
insert into core.parametros_ads (channel, vigente_desde) values
  ('mercadolivre', '2025-01-01'),
  ('shopee', '2025-01-01')
on conflict (channel, vigente_desde) do nothing;

alter table core.parametros_ads enable row level security;
drop policy if exists "parametros ads: leitura" on core.parametros_ads;
drop policy if exists "parametros ads: admin altera" on core.parametros_ads;
create policy "parametros ads: leitura" on core.parametros_ads for select to authenticated using (true);
create policy "parametros ads: admin altera" on core.parametros_ads for all to authenticated
  using ((select core.my_role()) = 'admin') with check ((select core.my_role()) = 'admin');
grant select, insert, update, delete on core.parametros_ads to authenticated;

-- ---------------------------------------------------------------------
-- 5. Modo Manual/Automatico por modelo, campanha ou anuncio (sem linha = manual)
--    Leitura: quem tem 'ads'. Sem politica de escrita: so por funcao definer (tarefa futura).
-- ---------------------------------------------------------------------
create table if not exists core.ads_modo (
  channel      text not null,
  tipo         text not null check (tipo in ('modelo', 'campanha', 'anuncio')),
  chave        text not null,
  modo         text not null check (modo in ('manual', 'automatico')),
  alterado_por uuid,
  alterado_em  timestamptz not null default now(),
  primary key (channel, tipo, chave)
);

alter table core.ads_modo enable row level security;
drop policy if exists "ads modo: leitura" on core.ads_modo;
create policy "ads modo: leitura" on core.ads_modo for select to authenticated
  using ((select core.has_perm('ads')));
grant select on core.ads_modo to authenticated;
