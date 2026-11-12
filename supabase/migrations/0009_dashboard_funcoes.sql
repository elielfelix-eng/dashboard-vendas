-- =====================================================================
-- 0009 - Dashboard: funcoes de resumo para as telas (o banco calcula, a tela mostra)
-- Pode ser reexecutada. Ordem de aplicacao: 0003 -> 0006 -> 0007 -> 0008 -> 0009 -> 0010.
--
-- Regras (iguais as de analytics.ml_meses):
--   vendas brutas / pedidos / unidades = pago + cancelado + devolvido (sem dividido);
--   receita = so pago; tarifas = parte do pedido + parte do periodo (fatura sem pedido e Ads da API).
-- Sem a permissao 'custos': custo do produto, imposto, embalagem, margens e curva ABC voltam nulos.
-- p_canal: 'consolidado' (todos os canais com dados) ou o canal ('mercadolivre', 'shopee', ...).
-- =====================================================================

drop function if exists analytics.dash_resumo(text, date, date);
drop function if exists analytics.dash_serie(text, date, date, text);
drop function if exists analytics.dash_custos_periodo(text, date, date);
drop view if exists analytics.dash_pedidos_base;

-- ---------------------------------------------------------------------
-- Pedidos com canal, imposto e embalagem (vigencia por data da venda)
-- ---------------------------------------------------------------------
create view analytics.dash_pedidos_base with (security_invoker = true) as
select p.*,
       'mercadolivre'::text as channel,
       case when p.classe = 'pago' then p.receita * coalesce(pc.imposto_pct, 0) / 100 else 0 end as imposto,
       case when p.classe = 'pago' then coalesce(pc.embalagem_pedido, 0) + coalesce(pc.embalagem_peca, 0) * p.unidades
            else 0 end as embalagem
  from analytics.ml_pedidos p
  left join lateral (
    select c.imposto_pct, c.embalagem_pedido, c.embalagem_peca
      from core.parametros_custo c
     where c.channel = 'mercadolivre' and c.vigente_desde <= p.data_venda
     order by c.vigente_desde desc
     limit 1
  ) pc on true
 where core.can_see_channel('mercadolivre');

-- ---------------------------------------------------------------------
-- Custos do periodo sem pedido (fatura) + Product Ads da API
-- ---------------------------------------------------------------------
create function analytics.dash_custos_periodo(p_canal text, p_de date, p_ate date)
returns table (categoria text, valor numeric)
language sql stable security invoker set search_path = '' as $$
  with api as (
    select min(a.day) as d from mkt.ads_campaign_daily a where a.channel = 'mercadolivre'
  )
  select x.categoria, sum(x.valor)
    from (
      select f.categoria, f.valor
        from analytics.ml_fatura f
       where f.order_id is null
         and f.data_ref between p_de and p_ate
         and (f.categoria <> 'product_ads' or f.data_ref < coalesce((select d from api), 'infinity'::date))
      union all
      select 'product_ads', a.cost
        from mkt.ads_campaign_daily a
       where a.channel = 'mercadolivre' and a.day between p_de and p_ate
    ) x
   where p_canal in ('consolidado', 'mercadolivre')
     and core.can_see_channel('mercadolivre')
   group by x.categoria
$$;

-- ---------------------------------------------------------------------
-- Resumo do periodo (cartoes) - sempre 1 linha
-- ---------------------------------------------------------------------
create function analytics.dash_resumo(p_canal text, p_de date, p_ate date)
returns table (
  pedidos integer, vendas_brutas numeric, unidades integer, ticket_medio numeric,
  cancelados integer, devolvidos integer, pct_cancel_devol numeric, receita numeric,
  comissao numeric, frete numeric, parcelamento numeric, product_ads numeric, seguidores numeric,
  estornos numeric, difal numeric, outras numeric, custo_produto numeric, imposto numeric,
  embalagem numeric, margem_bruta numeric, margem_contribuicao numeric, pedidos_sem_custo integer
)
language sql stable security invoker set search_path = '' as $$
  with b as (
    select * from analytics.dash_pedidos_base
     where (p_canal = 'consolidado' or channel = p_canal) and data_venda between p_de and p_ate
  ),
  v as (
    select count(*) filter (where classe in ('pago', 'cancelado', 'devolvido'))::integer as pedidos,
           coalesce(sum(valor_venda) filter (where classe in ('pago', 'cancelado', 'devolvido')), 0) as vendas_brutas,
           coalesce(sum(qtd) filter (where classe in ('pago', 'cancelado', 'devolvido')), 0)::integer as unidades,
           count(*) filter (where classe = 'cancelado')::integer as cancelados,
           count(*) filter (where classe = 'devolvido')::integer as devolvidos,
           coalesce(sum(receita), 0) as receita,
           coalesce(sum(comissao), 0) as comissao, coalesce(sum(frete), 0) as frete,
           coalesce(sum(parcelamento), 0) as parcelamento, coalesce(sum(product_ads), 0) as product_ads,
           coalesce(sum(seguidores), 0) as seguidores, coalesce(sum(estornos), 0) as estornos,
           coalesce(sum(difal), 0) as difal, coalesce(sum(outras), 0) as outras,
           coalesce(sum(custo_produto), 0) as custo_produto,
           coalesce(sum(imposto), 0) as imposto, coalesce(sum(embalagem), 0) as embalagem,
           count(*) filter (where classe = 'pago' and alerta_custo like '%sem_custo%')::integer as sem_custo
      from b
  ),
  c as (
    select coalesce(sum(valor) filter (where categoria = 'comissao'), 0) as comissao,
           coalesce(sum(valor) filter (where categoria = 'frete'), 0) as frete,
           coalesce(sum(valor) filter (where categoria = 'parcelamento'), 0) as parcelamento,
           coalesce(sum(valor) filter (where categoria = 'product_ads'), 0) as product_ads,
           coalesce(sum(valor) filter (where categoria = 'seguidores'), 0) as seguidores,
           coalesce(sum(valor) filter (where categoria = 'estornos_publicidade'), 0) as estornos,
           coalesce(sum(valor) filter (where categoria = 'difal'), 0) as difal,
           coalesce(sum(valor) filter (where categoria = 'outras'), 0) as outras
      from analytics.dash_custos_periodo(p_canal, p_de, p_ate)
  ),
  t as (
    select v.*,
           v.comissao + c.comissao as t_comissao, v.frete + c.frete as t_frete,
           v.parcelamento + c.parcelamento as t_parcelamento, v.product_ads + c.product_ads as t_product_ads,
           v.seguidores + c.seguidores as t_seguidores, v.estornos + c.estornos as t_estornos,
           v.difal + c.difal as t_difal, v.outras + c.outras as t_outras,
           core.has_perm('custos') as ve_custos
      from v, c
  )
  select t.pedidos, t.vendas_brutas, t.unidades,
         case when t.pedidos > 0 then round(t.vendas_brutas / t.pedidos, 2) else 0 end,
         t.cancelados, t.devolvidos,
         case when t.pedidos > 0 then round((t.cancelados + t.devolvidos) * 100.0 / t.pedidos, 2) else 0 end,
         t.receita, t.t_comissao, t.t_frete, t.t_parcelamento, t.t_product_ads, t.t_seguidores,
         t.t_estornos, t.t_difal, t.t_outras,
         case when t.ve_custos then t.custo_produto end,
         case when t.ve_custos then t.imposto end,
         case when t.ve_custos then t.embalagem end,
         case when t.ve_custos then t.receita - t.custo_produto end,
         case when t.ve_custos then t.receita
              - (t.t_comissao + t.t_frete + t.t_parcelamento + t.t_product_ads + t.t_seguidores
                 + t.t_estornos + t.t_difal + t.t_outras)
              - t.imposto - t.embalagem - t.custo_produto end,
         case when t.ve_custos then t.sem_custo end
    from t
$$;

-- ---------------------------------------------------------------------
-- Serie por dia, semana (segunda-feira) ou mes, com periodos vazios = 0
-- ---------------------------------------------------------------------
create function analytics.dash_serie(p_canal text, p_de date, p_ate date, p_grao text)
returns table (periodo date, vendas_brutas numeric, pedidos integer, receita numeric)
language sql stable security invoker set search_path = '' as $$
  with g as (
    select case p_grao when 'semana' then 'week' when 'mes' then 'month' else 'day' end as unidade
  ),
  eixo as (
    select s::date as periodo
      from g, generate_series(date_trunc((select unidade from g), p_de::timestamp),
                              p_ate::timestamp,
                              ('1 ' || (select unidade from g))::interval) s
  ),
  agg as (
    select date_trunc((select unidade from g), b.data_venda::timestamp)::date as periodo,
           sum(b.valor_venda) filter (where b.classe in ('pago', 'cancelado', 'devolvido')) as vendas_brutas,
           count(*) filter (where b.classe in ('pago', 'cancelado', 'devolvido'))::integer as pedidos,
           sum(b.receita) as receita
      from analytics.dash_pedidos_base b
     where (p_canal = 'consolidado' or b.channel = p_canal) and b.data_venda between p_de and p_ate
     group by 1
  )
  select e.periodo, coalesce(a.vendas_brutas, 0), coalesce(a.pedidos, 0), coalesce(a.receita, 0)
    from eixo e
    left join agg a on a.periodo = e.periodo
   order by e.periodo
$$;

grant select on analytics.dash_pedidos_base to authenticated;
grant execute on function analytics.dash_custos_periodo(text, date, date),
                          analytics.dash_resumo(text, date, date),
                          analytics.dash_serie(text, date, date, text) to authenticated;
