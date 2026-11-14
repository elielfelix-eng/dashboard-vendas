-- =====================================================================
-- 0013 - CRM (Bitrix24): funcoes de analise analytics.crm_* (o banco calcula, a tela mostra)
-- Pode ser reexecutada. Ordem de aplicacao: ... -> 0011 -> 0012 -> 0013.
--
-- Parametros comuns: p_de, p_ate (dias de Brasilia), p_area (deals.area), p_vendedor (assigned_by_id)
-- e p_origem (leads.source_id nas contagens de lead; deals.source_id nas de negocio).
-- Regras (spec, secao 4 "Regras de contagem"):
--   * so o funil 10 (Brinde do Bem); so leads de origem ativa em crm.origens_brinde; deleted_at fica fora;
--   * leads novos = criados no periodo; coorte = leads criados no periodo, com o desfecho ate hoje
--     (negocios do funil 10 ligados por lead_id; a coorte segue a origem e o responsavel do LEAD);
--   * ganhos, perdidos e valor = closedate no periodo + semantica da etapa (crm.stages);
--   * ciclo = closedate - date_create dos ganhos no periodo; 1o contato = first_activity - criacao do lead.
-- Dia de referencia = (ts at time zone 'America/Sao_Paulo')::date between p_de and p_ate, escrito como
--   ts >= (p_de::timestamp at time zone 'America/Sao_Paulo') and ts < ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
-- (mesmo resultado, mas usa os indices de data).
-- Percentuais 0-100 com 1 casa; dinheiro com 2; dias/horas com 1. Divisao por zero -> null.
-- Todas security invoker (o RLS da 0012 vale: o vendedor so ve o que e dele), exceto crm_vendedores.
-- Sem a permissao da tela devolvem zero linhas (a tela mostra "sem dados"), sem erro:
--   resumo/funil/etapas/motivos_perda exigem crm_funil; origens exige crm_origens;
--   opcoes exige qualquer crm_*; vendedores (definer) da erro sem crm_vendedores.
-- =====================================================================

-- Indices de periodo e de responsavel (leads ~270k, negocios ~48k, historico ~250k)
create index if not exists leads_date_create_idx on crm.leads (date_create);
create index if not exists leads_assigned_by_id_idx on crm.leads (assigned_by_id);
create index if not exists deals_date_create_idx on crm.deals (date_create);
create index if not exists stage_history_entrou_em_idx on crm.stage_history (entrou_em);

-- ---------------------------------------------------------------------
-- Resumo (cartoes) - sempre 1 linha
-- ---------------------------------------------------------------------
create or replace function analytics.crm_resumo(p_de date, p_ate date, p_area text default null,
                                                p_vendedor bigint default null, p_origem text default null)
returns table (leads_novos int, leads_com_negocio int, negocios_coorte int, ganhos_coorte int,
               ganhos int, perdidos int, valor_ganho numeric, ciclo_medio_dias numeric)
language sql stable security invoker set search_path = '' as $$
  with lds as materialized (
    select l.id
      from crm.leads l
     where l.deleted_at is null
       and l.date_create >= (p_de::timestamp at time zone 'America/Sao_Paulo')
       and l.date_create < ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
       and l.source_id in (select o.source_id from crm.origens_brinde o where o.ativo)
       and (p_vendedor is null or l.assigned_by_id = p_vendedor)
       and (p_origem is null or l.source_id = p_origem)
  ),
  cd as materialized (
    select d.id, d.lead_id, s.semantica
      from crm.deals d
      join lds on lds.id = d.lead_id
      left join crm.stages s on s.entity = 'deal' and s.status_id = d.stage_id
     where d.category_id = 10 and d.deleted_at is null
       and (p_area is null or d.area = p_area)
  ),
  fech as materialized (
    select s.semantica, d.opportunity, d.date_create, d.closedate
      from crm.deals d
      join crm.stages s on s.entity = 'deal' and s.status_id = d.stage_id and s.semantica in ('ganho', 'perdido')
     where d.category_id = 10 and d.deleted_at is null
       and d.closedate >= (p_de::timestamp at time zone 'America/Sao_Paulo')
       and d.closedate < ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
       and (p_area is null or d.area = p_area)
       and (p_vendedor is null or d.assigned_by_id = p_vendedor)
       and (p_origem is null or d.source_id = p_origem)
  )
  select (select count(*) from lds)::int,
         (select count(distinct cd.lead_id) from cd)::int,
         (select count(*) from cd)::int,
         (select count(*) from cd where cd.semantica = 'ganho')::int,
         (select count(*) from fech f where f.semantica = 'ganho')::int,
         (select count(*) from fech f where f.semantica = 'perdido')::int,
         round(coalesce((select sum(f.opportunity) from fech f where f.semantica = 'ganho'), 0), 2),
         round((select avg(extract(epoch from f.closedate - f.date_create) / 86400)
                  from fech f where f.semantica = 'ganho' and f.date_create is not null), 1)
   where (select core.has_perm('crm_funil'))
$$;

-- ---------------------------------------------------------------------
-- Funil: Leads -> Negocios (da coorte) -> cada etapa em andamento (negocios da coorte que
-- entraram nela, pelo stage_history) -> Ganhos (da coorte)
-- ---------------------------------------------------------------------
create or replace function analytics.crm_funil(p_de date, p_ate date, p_area text default null,
                                               p_vendedor bigint default null, p_origem text default null)
returns table (ordem int, etapa text, quantidade int)
language sql stable security invoker set search_path = '' as $$
  with lds as materialized (
    select l.id
      from crm.leads l
     where l.deleted_at is null
       and l.date_create >= (p_de::timestamp at time zone 'America/Sao_Paulo')
       and l.date_create < ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
       and l.source_id in (select o.source_id from crm.origens_brinde o where o.ativo)
       and (p_vendedor is null or l.assigned_by_id = p_vendedor)
       and (p_origem is null or l.source_id = p_origem)
  ),
  cd as materialized (
    select d.id, s.semantica
      from crm.deals d
      join lds on lds.id = d.lead_id
      left join crm.stages s on s.entity = 'deal' and s.status_id = d.stage_id
     where d.category_id = 10 and d.deleted_at is null
       and (p_area is null or d.area = p_area)
  ),
  st as (
    select s.status_id, s.nome,
           row_number() over (order by s.ordem nulls last, s.status_id)::int as n
      from crm.stages s
     where s.entity = 'deal' and s.category_id = 10 and s.semantica = 'andamento'
  ),
  passou as (
    select h.stage_id, count(distinct h.deal_id)::int as qtd
      from crm.stage_history h
      join cd on cd.id = h.deal_id
     group by h.stage_id
  )
  select r.ordem, r.etapa, r.quantidade
    from (
      select 1 as ordem, 'Leads'::text as etapa, (select count(*) from lds)::int as quantidade
      union all
      select 2, 'Negócios'::text, (select count(*) from cd)::int
      union all
      select 2 + st.n, coalesce(st.nome, st.status_id), coalesce(p.qtd, 0)
        from st left join passou p on p.stage_id = st.status_id
      union all
      select 3 + (select count(*) from st)::int, 'Ganhos'::text, (select count(*) from cd where cd.semantica = 'ganho')::int
    ) r
   where (select core.has_perm('crm_funil'))
   order by r.ordem
$$;

-- ---------------------------------------------------------------------
-- Por etapa em andamento do funil 10: em aberto e valor em aberto (foto de AGORA, sem periodo),
-- tempo medio na etapa (entradas no periodo; saida = proxima entrada do mesmo negocio, ou agora
-- se ele continua na etapa) e o maior gargalo (maior tempo medio).
-- ---------------------------------------------------------------------
create or replace function analytics.crm_etapas(p_de date, p_ate date, p_area text default null,
                                                p_vendedor bigint default null, p_origem text default null)
returns table (status_id text, nome text, ordem int, em_aberto int, valor_aberto numeric,
               tempo_medio_dias numeric, gargalo boolean)
language sql stable security invoker set search_path = '' as $$
  with st as (
    select s.status_id, s.nome, s.ordem
      from crm.stages s
     where s.entity = 'deal' and s.category_id = 10 and s.semantica = 'andamento'
  ),
  dl as materialized (
    select d.id, d.stage_id, d.opportunity
      from crm.deals d
     where d.category_id = 10 and d.deleted_at is null
       and (p_area is null or d.area = p_area)
       and (p_vendedor is null or d.assigned_by_id = p_vendedor)
       and (p_origem is null or d.source_id = p_origem)
  ),
  ab as (
    select dl.stage_id, count(*)::int as qtd, sum(coalesce(dl.opportunity, 0)) as valor
      from dl
     group by dl.stage_id
  ),
  ent as materialized (
    select h.deal_id, h.stage_id, h.entrou_em, dl.stage_id as atual
      from crm.stage_history h
      join dl on dl.id = h.deal_id
     where h.entrou_em >= (p_de::timestamp at time zone 'America/Sao_Paulo')
       and h.entrou_em < ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
       and h.stage_id in (select st.status_id from st)
  ),
  dur as (
    select e.stage_id,
           extract(epoch from coalesce(nx.entrou_em, case when e.atual = e.stage_id then now() end) - e.entrou_em) / 86400 as dias
      from ent e
      left join lateral (
        select h2.entrou_em
          from crm.stage_history h2
         where h2.deal_id = e.deal_id and h2.entrou_em > e.entrou_em
         order by h2.entrou_em
         limit 1
      ) nx on true
  ),
  tm as (
    select dur.stage_id, round(avg(dur.dias), 1) as dias
      from dur
     where dur.dias is not null
     group by dur.stage_id
  ),
  r as (
    select st.status_id, coalesce(st.nome, st.status_id) as nome, st.ordem,
           coalesce(ab.qtd, 0) as em_aberto, round(coalesce(ab.valor, 0), 2) as valor_aberto, tm.dias
      from st
      left join ab on ab.stage_id = st.status_id
      left join tm on tm.stage_id = st.status_id
  )
  select r.status_id, r.nome, r.ordem, r.em_aberto, r.valor_aberto, r.dias,
         coalesce(r.status_id = (select r2.status_id from r r2 where r2.dias is not null
                                  order by r2.dias desc, r2.ordem nulls last, r2.status_id limit 1), false)
    from r
   where (select core.has_perm('crm_funil'))
   order by r.ordem nulls last, r.status_id
$$;

-- ---------------------------------------------------------------------
-- Motivos de perda = etapa de perda dos negocios perdidos no periodo (closedate)
-- ---------------------------------------------------------------------
create or replace function analytics.crm_motivos_perda(p_de date, p_ate date, p_area text default null,
                                                       p_vendedor bigint default null, p_origem text default null)
returns table (status_id text, motivo text, perdidos int, pct numeric)
language sql stable security invoker set search_path = '' as $$
  with pd as materialized (
    select d.stage_id, s.nome
      from crm.deals d
      join crm.stages s on s.entity = 'deal' and s.status_id = d.stage_id and s.semantica = 'perdido'
     where d.category_id = 10 and d.deleted_at is null
       and d.closedate >= (p_de::timestamp at time zone 'America/Sao_Paulo')
       and d.closedate < ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
       and (p_area is null or d.area = p_area)
       and (p_vendedor is null or d.assigned_by_id = p_vendedor)
       and (p_origem is null or d.source_id = p_origem)
  ),
  g as (
    select pd.stage_id, min(pd.nome) as nome, count(*)::int as qtd from pd group by pd.stage_id
  )
  select g.stage_id,
         case when g.stage_id = 'C10:LOSE' then 'Cancelado (sem motivo)' else coalesce(g.nome, g.stage_id) end,
         g.qtd,
         round(g.qtd * 100.0 / nullif(sum(g.qtd) over (), 0), 1)
    from g
   where (select core.has_perm('crm_funil'))
   order by g.qtd desc, g.stage_id
$$;

-- ---------------------------------------------------------------------
-- Vendedores (ranking). SECURITY DEFINER: o vendedor ve a propria linha e a "Media da equipe",
-- calculada com todos os vendedores (por isso nao pode depender do RLS).
-- leads = criados no periodo (do responsavel do lead); negocios = do funil 10 criados no periodo;
-- ganhos/perdidos/valor pela closedate; conversao = ganhos / (ganhos + perdidos); ticket = valor / ganhos.
-- Media da equipe = media por vendedor (sem a linha "Sem responsavel") dos que tiveram atividade.
-- ---------------------------------------------------------------------
create or replace function analytics.crm_vendedores(p_de date, p_ate date, p_area text default null,
                                                    p_vendedor bigint default null, p_origem text default null)
returns table (bitrix_id bigint, vendedor text, leads int, primeiro_contato_horas numeric, sem_contato int,
               negocios int, ganhos int, perdidos int, conversao numeric, valor_ganho numeric, ticket_medio numeric)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_vendedor boolean;
  v_filtro bigint := p_vendedor;
begin
  if not coalesce(core.has_perm('crm_vendedores'), false) then
    raise exception 'sem permissao para ver os vendedores do CRM';
  end if;
  if not coalesce(core.can_see_channel('crm'), false) then
    return;
  end if;
  v_vendedor := coalesce(core.my_role() = 'vendedor', false);
  if v_vendedor then
    v_filtro := core.my_bitrix_id();
    if v_filtro is null then
      return;
    end if;
  end if;

  return query
  with l as materialized (
    select l.assigned_by_id as bid,
           extract(epoch from fa.primeira_em - l.date_create) / 3600 as horas
      from crm.leads l
      left join crm.first_activity fa on fa.lead_id = l.id
     where l.deleted_at is null
       and l.date_create >= (p_de::timestamp at time zone 'America/Sao_Paulo')
       and l.date_create < ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
       and l.source_id in (select o.source_id from crm.origens_brinde o where o.ativo)
       and (p_origem is null or l.source_id = p_origem)
  ),
  neg as materialized (
    select d.assigned_by_id as bid
      from crm.deals d
     where d.category_id = 10 and d.deleted_at is null
       and d.date_create >= (p_de::timestamp at time zone 'America/Sao_Paulo')
       and d.date_create < ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
       and (p_area is null or d.area = p_area)
       and (p_origem is null or d.source_id = p_origem)
  ),
  fech as materialized (
    select d.assigned_by_id as bid, s.semantica, d.opportunity
      from crm.deals d
      join crm.stages s on s.entity = 'deal' and s.status_id = d.stage_id and s.semantica in ('ganho', 'perdido')
     where d.category_id = 10 and d.deleted_at is null
       and d.closedate >= (p_de::timestamp at time zone 'America/Sao_Paulo')
       and d.closedate < ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
       and (p_area is null or d.area = p_area)
       and (p_origem is null or d.source_id = p_origem)
  ),
  k as (
    select l.bid, 1 as lead, l.horas, case when l.horas is null then 1 else 0 end as sem, 0 as neg,
           0 as gan, 0 as per, 0::numeric as valor
      from l
    union all
    select neg.bid, 0, null, 0, 1, 0, 0, 0 from neg
    union all
    select fech.bid, 0, null, 0, 0,
           case when fech.semantica = 'ganho' then 1 else 0 end,
           case when fech.semantica = 'perdido' then 1 else 0 end,
           case when fech.semantica = 'ganho' then coalesce(fech.opportunity, 0) else 0 end
      from fech
  ),
  por as (
    select k.bid,
           sum(k.lead)::int as leads, avg(k.horas) as horas, sum(k.sem)::int as sem,
           sum(k.neg)::int as neg, sum(k.gan)::int as gan, sum(k.per)::int as per, sum(k.valor) as valor
      from k
     group by k.bid
  ),
  linhas as (
    select por.bid,
           case when por.bid is null then 'Sem responsável'
                else coalesce(u.nome, 'Usuário ' || por.bid) end as nome,
           por.leads, round(por.horas, 1) as horas, por.sem, por.neg, por.gan, por.per,
           round(por.gan * 100.0 / nullif(por.gan + por.per, 0), 1) as conv,
           round(por.valor, 2) as valor,
           round(por.valor / nullif(por.gan, 0), 2) as ticket
      from por
      left join crm.users u on u.bitrix_id = por.bid
  ),
  media as (
    select null::bigint as bid, 'Média da equipe'::text as nome,
           round(avg(x.leads))::int as leads, round(avg(x.horas), 1) as horas, round(avg(x.sem))::int as sem,
           round(avg(x.neg))::int as neg, round(avg(x.gan))::int as gan, round(avg(x.per))::int as per,
           round(avg(x.conv), 1) as conv, round(avg(x.valor), 2) as valor, round(avg(x.ticket), 2) as ticket
      from linhas x
     where x.bid is not null
    having count(*) > 0
  )
  select y.bid, y.nome, y.leads, y.horas, y.sem, y.neg, y.gan, y.per, y.conv, y.valor, y.ticket
    from (
      select linhas.*, case when linhas.bid is null then 1 else 0 end as grupo
        from linhas
       where (v_filtro is null or linhas.bid = v_filtro)
         and not (v_vendedor and linhas.bid is null)
      union all
      select media.*, 2 from media
    ) y
   order by y.grupo, y.valor desc, y.gan desc, y.neg desc, y.leads desc, y.nome;
end $$;

-- ---------------------------------------------------------------------
-- Origens: leads da coorte pela origem do lead (% -> negocio = leads com negocio / leads;
-- % -> ganho = leads com negocio ganho (etapa ganho hoje) / leads); valor ganho e ticket pelos ganhos no
-- periodo, pela origem do NEGOCIO. Lista as origens ativas mesmo sem dados; nula = "Sem origem".
-- ---------------------------------------------------------------------
create or replace function analytics.crm_origens(p_de date, p_ate date, p_area text default null,
                                                 p_vendedor bigint default null, p_origem text default null)
returns table (source_id text, origem text, leads int, pct_negocio numeric, pct_ganho numeric,
               valor_ganho numeric, ticket_medio numeric)
language sql stable security invoker set search_path = '' as $$
  with lds as materialized (
    select l.id, l.source_id
      from crm.leads l
     where l.deleted_at is null
       and l.date_create >= (p_de::timestamp at time zone 'America/Sao_Paulo')
       and l.date_create < ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
       and l.source_id in (select o.source_id from crm.origens_brinde o where o.ativo)
       and (p_vendedor is null or l.assigned_by_id = p_vendedor)
       and (p_origem is null or l.source_id = p_origem)
  ),
  cd as materialized (
    select d.lead_id, lds.source_id, s.semantica
      from crm.deals d
      join lds on lds.id = d.lead_id
      left join crm.stages s on s.entity = 'deal' and s.status_id = d.stage_id
     where d.category_id = 10 and d.deleted_at is null
       and (p_area is null or d.area = p_area)
  ),
  gan as materialized (
    select d.source_id, count(*)::int as qtd, sum(coalesce(d.opportunity, 0)) as valor
      from crm.deals d
      join crm.stages s on s.entity = 'deal' and s.status_id = d.stage_id and s.semantica = 'ganho'
     where d.category_id = 10 and d.deleted_at is null
       and d.closedate >= (p_de::timestamp at time zone 'America/Sao_Paulo')
       and d.closedate < ((p_ate + 1)::timestamp at time zone 'America/Sao_Paulo')
       and (p_area is null or d.area = p_area)
       and (p_vendedor is null or d.assigned_by_id = p_vendedor)
       and (p_origem is null or d.source_id = p_origem)
     group by d.source_id
  ),
  -- Desfecho por lead (agregado uma vez; junta por hash, sem subconsulta por lead)
  pd as (
    select cd.lead_id, bool_or(cd.semantica = 'ganho') as tem_ganho
      from cd
     group by cd.lead_id
  ),
  pl as (
    select lds.source_id, count(*)::int as leads,
           count(pd.lead_id)::int as com_neg,
           count(*) filter (where pd.tem_ganho)::int as com_ganho
      from lds
      left join pd on pd.lead_id = lds.id
     group by lds.source_id
  ),
  todas as (
    select o.source_id from crm.origens_brinde o where o.ativo and (p_origem is null or o.source_id = p_origem)
    union
    select pl.source_id from pl
    union
    select gan.source_id from gan
  )
  select t.source_id,
         case when t.source_id is null then 'Sem origem'
              else coalesce(ob.nome, s.nome, t.source_id) end,
         coalesce(pl.leads, 0),
         round(pl.com_neg * 100.0 / nullif(pl.leads, 0), 1),
         round(pl.com_ganho * 100.0 / nullif(pl.leads, 0), 1),
         round(coalesce(gan.valor, 0), 2),
         round(gan.valor / nullif(gan.qtd, 0), 2)
    from todas t
    left join crm.origens_brinde ob on ob.source_id = t.source_id
    left join crm.sources s on s.status_id = t.source_id
    left join pl on pl.source_id is not distinct from t.source_id
    left join gan on gan.source_id is not distinct from t.source_id
   where (select core.has_perm('crm_origens'))
   order by coalesce(pl.leads, 0) desc, coalesce(gan.valor, 0) desc, 2
$$;

-- ---------------------------------------------------------------------
-- Opcoes dos filtros: area (do funil 10), vendedor (com RLS: o vendedor so ve a si mesmo) e origem
-- ---------------------------------------------------------------------
create or replace function analytics.crm_opcoes()
returns table (tipo text, valor text, rotulo text)
language sql stable security invoker set search_path = '' as $$
  select x.tipo, x.valor, x.rotulo
    from (
      select 'area'::text as tipo, a.area as valor, a.area as rotulo
        from (select distinct d.area from crm.deals d
               where d.category_id = 10 and d.deleted_at is null and d.area is not null) a
      union all
      select 'vendedor', u.bitrix_id::text, coalesce(u.nome, 'Usuário ' || u.bitrix_id)
        from crm.users u
       where exists (select 1 from crm.deals d
                      where d.assigned_by_id = u.bitrix_id and d.category_id = 10 and d.deleted_at is null)
          or exists (select 1 from crm.leads l
                      where l.assigned_by_id = u.bitrix_id and l.deleted_at is null
                        and l.source_id in (select o.source_id from crm.origens_brinde o where o.ativo))
      union all
      select 'origem', o.source_id, coalesce(o.nome, o.source_id)
        from crm.origens_brinde o
       where o.ativo
    ) x
   where (select core.has_perm('crm_funil') or core.has_perm('crm_vendedores') or core.has_perm('crm_origens'))
   order by x.tipo, x.rotulo, x.valor
$$;

revoke all on function analytics.crm_vendedores(date, date, text, bigint, text) from public;
grant execute on function analytics.crm_resumo(date, date, text, bigint, text),
                          analytics.crm_funil(date, date, text, bigint, text),
                          analytics.crm_etapas(date, date, text, bigint, text),
                          analytics.crm_motivos_perda(date, date, text, bigint, text),
                          analytics.crm_vendedores(date, date, text, bigint, text),
                          analytics.crm_origens(date, date, text, bigint, text),
                          analytics.crm_opcoes() to authenticated;
