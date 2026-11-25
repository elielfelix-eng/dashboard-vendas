-- =====================================================================
-- 0023 - Alertas de atraso e reputacao: tabelas, permissoes, parametros e feriados
-- Pode ser reexecutada. Aplicar depois da 0013 (e da 0011, que define o desempenho da RLS).
-- O job de sincronizacao conecta por DATABASE_URL (dono do banco, ignora RLS), como nas
-- demais tabelas mkt.*; por isso nao ha grant de escrita para ele aqui.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Dados sincronizados (schema mkt)
-- ---------------------------------------------------------------------
create table if not exists mkt.envios_prazos (
  channel        text not null,
  shipment_id    text not null,
  account_id     uuid,
  status         text,
  substatus      text,
  prazo_despacho date,
  prazo_entrega  date,
  despachado_em  timestamptz,
  entregue_em    timestamptz,
  atualizado_em  timestamptz not null default now(),
  primary key (channel, shipment_id)
);

alter table mkt.envios_prazos enable row level security;
drop policy if exists "envios prazos: leitura" on mkt.envios_prazos;
create policy "envios prazos: leitura" on mkt.envios_prazos for select to authenticated
  using ((select core.can_see_channel(channel)) and (select core.has_perm('operacao')));
grant select on mkt.envios_prazos to authenticated;

-- Fotos periodicas da reputacao do vendedor. Taxas em percentual (0-100).
create table if not exists mkt.reputacao_fotos (
  account_id          uuid not null,
  capturado_em        timestamptz not null default now(),
  level_id            text,
  power_seller_status text,
  reclamacoes_taxa    numeric,
  cancelamentos_taxa  numeric,
  atrasos_taxa        numeric,
  vendas_periodo      integer,
  periodo             text,
  primary key (account_id, capturado_em)
);

alter table mkt.reputacao_fotos enable row level security;
drop policy if exists "reputacao fotos: leitura" on mkt.reputacao_fotos;
create policy "reputacao fotos: leitura" on mkt.reputacao_fotos for select to authenticated
  using ((select core.has_perm('operacao')));
grant select on mkt.reputacao_fotos to authenticated;

-- ---------------------------------------------------------------------
-- 2. Permissoes (sementes: so na primeira vez, on conflict do nothing preserva o que o admin mudou)
--    operacao: admin, gestor, comercial | editar_grupos: admin, gestor
-- ---------------------------------------------------------------------
insert into core.role_permissions (role, permission, allowed)
select r.role::core.app_role, p.permission,
       case p.permission
         when 'operacao' then r.role in ('admin', 'gestor', 'comercial')
         else r.role in ('admin', 'gestor')
       end
  from unnest(array['admin', 'gestor', 'comercial', 'visualizador', 'vendedor']) as r(role)
 cross join unnest(array['operacao', 'editar_grupos']) as p(permission)
on conflict (role, permission) do nothing;

-- ---------------------------------------------------------------------
-- 3. Grupos de anuncios (antecedencia propria) e seus itens; um anuncio fica em um unico grupo
-- ---------------------------------------------------------------------
create table if not exists core.grupos_anuncio (
  id               bigint generated always as identity primary key,
  account_id       uuid references core.accounts (id) on delete cascade,
  nome             text not null,
  antecedencia_dias integer not null check (antecedencia_dias between 0 and 30),
  unique (account_id, nome)
);

create table if not exists core.grupo_anuncio_itens (
  channel  text not null,
  item_id  text not null,
  grupo_id bigint not null references core.grupos_anuncio (id) on delete cascade,
  primary key (channel, item_id)
);

alter table core.grupos_anuncio enable row level security;
drop policy if exists "grupos anuncio: leitura" on core.grupos_anuncio;
drop policy if exists "grupos anuncio: edicao" on core.grupos_anuncio;
create policy "grupos anuncio: leitura" on core.grupos_anuncio for select to authenticated
  using ((select core.has_perm('operacao')) or (select core.has_perm('editar_grupos')));
create policy "grupos anuncio: edicao" on core.grupos_anuncio for all to authenticated
  using ((select core.has_perm('editar_grupos'))) with check ((select core.has_perm('editar_grupos')));
grant select, insert, update, delete on core.grupos_anuncio to authenticated;

alter table core.grupo_anuncio_itens enable row level security;
drop policy if exists "grupo itens: leitura" on core.grupo_anuncio_itens;
drop policy if exists "grupo itens: edicao" on core.grupo_anuncio_itens;
create policy "grupo itens: leitura" on core.grupo_anuncio_itens for select to authenticated
  using ((select core.has_perm('operacao')) or (select core.has_perm('editar_grupos')));
create policy "grupo itens: edicao" on core.grupo_anuncio_itens for all to authenticated
  using ((select core.has_perm('editar_grupos'))) with check ((select core.has_perm('editar_grupos')));
grant select, insert, update, delete on core.grupo_anuncio_itens to authenticated;

-- ---------------------------------------------------------------------
-- 4. Parametros (linha unica): antecedencia padrao e "perto do limite"
-- ---------------------------------------------------------------------
create table if not exists core.parametros_alertas (
  id                boolean primary key default true check (id),
  antecedencia_padrao integer not null default 4 check (antecedencia_padrao between 0 and 30),
  perto_limite_pct  numeric not null default 80 check (perto_limite_pct between 1 and 100)
);
insert into core.parametros_alertas (id) values (true) on conflict (id) do nothing;

alter table core.parametros_alertas enable row level security;
drop policy if exists "parametros alertas: leitura" on core.parametros_alertas;
drop policy if exists "parametros alertas: edicao" on core.parametros_alertas;
create policy "parametros alertas: leitura" on core.parametros_alertas for select to authenticated
  using ((select core.has_perm('operacao')));
create policy "parametros alertas: edicao" on core.parametros_alertas for all to authenticated
  using ((select core.has_perm('configuracoes'))) with check ((select core.has_perm('configuracoes')));
grant select, insert, update, delete on core.parametros_alertas to authenticated;

-- ---------------------------------------------------------------------
-- 5. Feriados nacionais (2026 e 2027). Carnaval e Corpus Christi ficam de fora (ponto facultativo);
--    o admin acrescenta se quiser.
-- ---------------------------------------------------------------------
create table if not exists core.feriados (
  data date primary key,
  nome text not null
);
insert into core.feriados (data, nome) values
  ('2026-01-01', 'Confraternização Universal'), ('2026-04-03', 'Sexta-feira Santa'), ('2026-04-21', 'Tiradentes'),
  ('2026-05-01', 'Dia do Trabalho'), ('2026-09-07', 'Independência do Brasil'), ('2026-10-12', 'Nossa Senhora Aparecida'),
  ('2026-11-02', 'Finados'), ('2026-11-15', 'Proclamação da República'), ('2026-11-20', 'Consciência Negra'),
  ('2026-12-25', 'Natal'),
  ('2027-01-01', 'Confraternização Universal'), ('2027-03-26', 'Sexta-feira Santa'), ('2027-04-21', 'Tiradentes'),
  ('2027-05-01', 'Dia do Trabalho'), ('2027-09-07', 'Independência do Brasil'), ('2027-10-12', 'Nossa Senhora Aparecida'),
  ('2027-11-02', 'Finados'), ('2027-11-15', 'Proclamação da República'), ('2027-11-20', 'Consciência Negra'),
  ('2027-12-25', 'Natal')
on conflict (data) do nothing;

alter table core.feriados enable row level security;
drop policy if exists "feriados: leitura" on core.feriados;
drop policy if exists "feriados: edicao" on core.feriados;
create policy "feriados: leitura" on core.feriados for select to authenticated using (true);
create policy "feriados: edicao" on core.feriados for all to authenticated
  using ((select core.has_perm('configuracoes'))) with check ((select core.has_perm('configuracoes')));
grant select, insert, update, delete on core.feriados to authenticated;

-- ---------------------------------------------------------------------
-- 6. Limites de reputacao por nivel e indicador.
--    Sem sementes: so entram valores confirmados pelo levantamento (sem linha = "limite nao cadastrado").
-- ---------------------------------------------------------------------
create table if not exists core.reputacao_limites (
  level_id   text not null,
  indicador  text not null check (indicador in ('reclamacoes', 'cancelamentos', 'atrasos')),
  limite_pct numeric not null,
  primary key (level_id, indicador)
);

alter table core.reputacao_limites enable row level security;
drop policy if exists "reputacao limites: leitura" on core.reputacao_limites;
drop policy if exists "reputacao limites: edicao" on core.reputacao_limites;
create policy "reputacao limites: leitura" on core.reputacao_limites for select to authenticated
  using ((select core.has_perm('operacao')));
create policy "reputacao limites: edicao" on core.reputacao_limites for all to authenticated
  using ((select core.has_perm('configuracoes'))) with check ((select core.has_perm('configuracoes')));
grant select, insert, update, delete on core.reputacao_limites to authenticated;
