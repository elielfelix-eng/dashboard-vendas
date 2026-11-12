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

drop function if exists analytics.dash_pedidos(text, date, date, text);
drop function if exists analytics.dash_skus(text, date, date, text);
drop function if exists analytics.dash_modelos(text, date, date);
drop function if exists analytics.dash_itens(text, date, date);
drop function if exists analytics.dash_resumo(text, date, date);
drop function if exists analytics.dash_serie(text, date, date, text);
drop function if exists analytics.dash_custos_periodo(text, date, date);
drop function if exists analytics.dash_ads_periodo(text, date, date);
drop view if exists analytics.dash_pedidos_base;
drop function if exists analytics.dash_pedidos_base();

-- ---------------------------------------------------------------------
-- Pedidos com canal, imposto e embalagem (vigencia por data da venda).
-- E uma FUNCAO (nao view) de proposito: reaplicar a 0003/0007 recria ml_pedidos com
-- "drop ... cascade", o que apagaria uma view dependente e derrubaria o dashboard.
-- Sem a permissao 'custos': custo do produto, alerta, imposto e embalagem voltam nulos.
-- ---------------------------------------------------------------------
create function analytics.dash_pedidos_base()
returns table (
  order_id text, classe text, sale_ts timestamptz, data_venda date, sku text, sku_anuncio text,
  qtd integer, unidades integer, valor_venda numeric, receita numeric,
  comissao numeric, frete numeric, parcelamento numeric, product_ads numeric, seguidores numeric,
  estornos numeric, difal numeric, outras numeric, custo_produto numeric, alerta_custo text,
  channel text, imposto numeric, embalagem numeric
)
language sql stable security invoker set search_path = '' as $$
  select p.order_id::text, p.classe::text, p.sale_ts::timestamptz, p.data_venda::date, p.sku::text, p.sku_anuncio::text,
         p.qtd::integer, p.unidades::integer, p.valor_venda::numeric, p.receita::numeric,
         p.comissao::numeric, p.frete::numeric, p.parcelamento::numeric, p.product_ads::numeric, p.seguidores::numeric,
         p.estornos::numeric, p.difal::numeric, p.outras::numeric,
         case when v.ve then p.custo_produto::numeric end,
         case when v.ve then p.alerta_custo::text end,
         'mercadolivre'::text,
         case when not v.ve then null
              when p.classe = 'pago' then p.receita * coalesce(pc.imposto_pct, 0) / 100 else 0 end,
         case when not v.ve then null
              when p.classe = 'pago' then coalesce(pc.embalagem_pedido, 0) + coalesce(pc.embalagem_peca, 0) * p.unidades
              else 0 end
    from analytics.ml_pedidos p
   cross join (select core.has_perm('custos') as ve) v
    left join lateral (
      select c.imposto_pct, c.embalagem_pedido, c.embalagem_peca
        from core.parametros_custo c
       where c.channel = 'mercadolivre' and c.vigente_desde <= p.data_venda
       order by c.vigente_desde desc
       limit 1
    ) pc on true
   where core.can_see_channel('mercadolivre')
$$;

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
-- Product Ads do periodo para QUALQUER perfil que veja o canal.
-- A fatura do ML so e legivel por quem ve custos (RLS da 0003); o investimento em Ads,
-- porem, aparece para todos na Visao Geral (cartao Ads/TACOS). Esta funcao roda com os
-- direitos do dono e devolve so o total agregado: fatura ligada a pedidos do periodo
-- (pela data da venda) + fatura sem pedido antes da API + Ads da API.
-- ---------------------------------------------------------------------
create function analytics.dash_ads_periodo(p_canal text, p_de date, p_ate date)
returns numeric
language sql stable security definer set search_path = '' as $$
  select case
    when p_canal in ('consolidado', 'mercadolivre') and core.can_see_channel('mercadolivre') then
      coalesce((select sum(f.valor)
                  from analytics.ml_fatura f
                  join mkt.orders o on o.channel = 'mercadolivre' and o.order_id = f.order_id
                 where f.categoria = 'product_ads'
                   and (coalesce(o.date_closed, o.date_created) at time zone 'America/Sao_Paulo')::date between p_de and p_ate), 0)
      + coalesce((select sum(c.valor) from analytics.dash_custos_periodo(p_canal, p_de, p_ate) c
                   where c.categoria = 'product_ads'), 0)
    else 0
  end
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
    select * from analytics.dash_pedidos_base()
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
           v.parcelamento + c.parcelamento as t_parcelamento,
           analytics.dash_ads_periodo(p_canal, p_de, p_ate) as t_product_ads,
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
      from analytics.dash_pedidos_base() b
     where (p_canal = 'consolidado' or b.channel = p_canal) and b.data_venda between p_de and p_ate
     group by 1
  )
  select e.periodo, coalesce(a.vendas_brutas, 0), coalesce(a.pedidos, 0), coalesce(a.receita, 0)
    from eixo e
    left join agg a on a.periodo = e.periodo
   order by e.periodo
$$;

-- ---------------------------------------------------------------------
-- Itens vendidos com a referencia do ERP e a parte de cada item nos custos do pedido.
-- Tarifas, imposto e embalagem do pedido sao repartidos pelo valor de cada item.
-- ---------------------------------------------------------------------
create function analytics.dash_itens(p_canal text, p_de date, p_ate date)
returns table (order_id text, classe text, modelo text, sku text, kit integer, qtd integer,
               valor_item numeric, receita numeric, custo numeric, tarifas numeric, impemb numeric, sem_custo boolean)
language sql stable security invoker set search_path = '' as $$
  select b.order_id, b.classe, r.modelo, r.sku, oi.kit_units, oi.quantity,
         oi.unit_price * oi.quantity,
         case when b.classe = 'pago' then oi.unit_price * oi.quantity else 0 end,
         case when not v.ve then null when b.classe = 'pago' then coalesce(c.price, 0) * oi.units else 0 end,
         w.peso * (b.comissao + b.frete + b.parcelamento + b.product_ads + b.seguidores + b.estornos + b.difal + b.outras),
         w.peso * (b.imposto + b.embalagem),
         case when v.ve then (b.classe = 'pago' and c.flag = 'sem_custo') end
    from analytics.dash_pedidos_base() b
    join mkt.order_items oi on oi.channel = b.channel and oi.order_id = b.order_id
    cross join lateral analytics.ref_erp(oi.sku, oi.modelo, oi.cor, b.sale_ts) r
    left join lateral analytics.resolve_unit_cost(r.modelo, b.sale_ts, oi.units) c on true
    cross join lateral (
      select case when b.valor_venda > 0 then oi.unit_price * oi.quantity / b.valor_venda
                  else 1.0 / (select count(*) from mkt.order_items x where x.channel = b.channel and x.order_id = b.order_id)
             end as peso
    ) w
   cross join (select core.has_perm('custos') as ve) v
   where (p_canal = 'consolidado' or b.channel = p_canal) and b.data_venda between p_de and p_ate
$$;

-- ---------------------------------------------------------------------
-- Vendas e rentabilidade por modelo, com rateio dos custos do periodo e curva ABC por lucro
-- ABC: entre os modelos com contribuicao positiva, em ordem decrescente, o lucro acumulado
-- ANTES do modelo < 80% -> A, < 95% -> B, senao C. Contribuicao <= 0 -> 'prejuizo'.
-- ---------------------------------------------------------------------
create function analytics.dash_modelos(p_canal text, p_de date, p_ate date)
returns table (
  modelo text, pedidos integer, unidades integer, vendas_brutas numeric, ticket_medio numeric,
  pct_cancel_devol numeric, receita numeric, custo_produto numeric, tarifas_frete numeric,
  custos_rateados numeric, imposto_embalagem numeric, contribuicao numeric, contribuicao_pct numeric,
  abc text, sem_custo integer
)
language sql stable security invoker set search_path = '' as $$
  with i as (
    select * from analytics.dash_itens(p_canal, p_de, p_ate)
  ),
  cp as (
    select coalesce(sum(valor), 0) as total from analytics.dash_custos_periodo(p_canal, p_de, p_ate)
  ),
  m as (
    select i.modelo,
           count(distinct i.order_id) filter (where i.classe in ('pago', 'cancelado', 'devolvido'))::integer as pedidos,
           coalesce(sum(i.qtd) filter (where i.classe in ('pago', 'cancelado', 'devolvido')), 0)::integer as unidades,
           coalesce(sum(i.valor_item) filter (where i.classe in ('pago', 'cancelado', 'devolvido')), 0) as vendas_brutas,
           count(distinct i.order_id) filter (where i.classe in ('cancelado', 'devolvido'))::integer as cancel_devol,
           sum(i.receita) as receita, sum(i.custo) as custo, sum(i.tarifas) as tarifas, sum(i.impemb) as impemb,
           count(distinct i.order_id) filter (where i.sem_custo)::integer as sem_custo
      from i
     group by i.modelo
  ),
  c as (
    select m.*,
           case when t.r > 0 then cp.total * m.receita / t.r else 0 end as rateio
      from m
     cross join cp
     cross join (select sum(receita) as r from m) t
  ),
  c2 as (
    select c.*, c.receita - c.custo - c.tarifas - c.rateio - c.impemb as contrib from c
  ),
  acum as (
    select c2.modelo,
           coalesce(sum(c2.contrib) over (order by c2.contrib desc, c2.modelo
                                          rows between unbounded preceding and 1 preceding), 0) as antes,
           sum(c2.contrib) over () as total
      from c2
     where c2.contrib > 0 and c2.receita > 0
  )
  select c2.modelo, c2.pedidos, c2.unidades, c2.vendas_brutas,
         case when c2.pedidos > 0 then round(c2.vendas_brutas / c2.pedidos, 2) else 0 end,
         case when c2.pedidos > 0 then round(c2.cancel_devol * 100.0 / c2.pedidos, 2) else 0 end,
         c2.receita,
         case when v.ve then c2.custo end,
         c2.tarifas, c2.rateio,
         case when v.ve then c2.impemb end,
         case when v.ve then c2.contrib end,
         case when v.ve and c2.receita > 0 then round(c2.contrib * 100 / c2.receita, 2) end,
         case when not v.ve or c2.receita <= 0 then null
              when c2.contrib <= 0 then 'prejuizo'
              when a.antes / a.total < 0.80 then 'A'
              when a.antes / a.total < 0.95 then 'B'
              else 'C' end,
         case when v.ve then c2.sem_custo end
    from c2
    left join acum a on a.modelo = c2.modelo
   cross join (select core.has_perm('custos') as ve) v
   order by c2.vendas_brutas desc, c2.modelo
$$;

-- ---------------------------------------------------------------------
-- Detalhe de um modelo por SKU (mesmo calculo, rateio pela receita do SKU no periodo)
-- ---------------------------------------------------------------------
create function analytics.dash_skus(p_canal text, p_de date, p_ate date, p_modelo text)
returns table (sku text, kit integer, pedidos integer, unidades integer, vendas_brutas numeric,
               receita numeric, custo_produto numeric, contribuicao numeric)
language sql stable security invoker set search_path = '' as $$
  with i as (
    select * from analytics.dash_itens(p_canal, p_de, p_ate)
  ),
  cp as (
    select coalesce(sum(valor), 0) as total from analytics.dash_custos_periodo(p_canal, p_de, p_ate)
  ),
  t as (
    select sum(receita) as r from i
  ),
  s as (
    select i.sku, min(i.kit) as kit,
           count(distinct i.order_id) filter (where i.classe in ('pago', 'cancelado', 'devolvido'))::integer as pedidos,
           coalesce(sum(i.qtd) filter (where i.classe in ('pago', 'cancelado', 'devolvido')), 0)::integer as unidades,
           coalesce(sum(i.valor_item) filter (where i.classe in ('pago', 'cancelado', 'devolvido')), 0) as vendas_brutas,
           sum(i.receita) as receita, sum(i.custo) as custo, sum(i.tarifas) as tarifas, sum(i.impemb) as impemb
      from i
     where i.modelo = p_modelo
     group by i.sku
  )
  select s.sku, s.kit, s.pedidos, s.unidades, s.vendas_brutas, s.receita,
         case when v.ve then s.custo end,
         case when v.ve then s.receita - s.custo - s.tarifas - s.impemb
                             - case when t.r > 0 then cp.total * s.receita / t.r else 0 end end
    from s
   cross join cp
   cross join t
   cross join (select core.has_perm('custos') as ve) v
   order by s.vendas_brutas desc, s.sku
$$;

-- ---------------------------------------------------------------------
-- Lista de pedidos do periodo (opcionalmente so os que tem um item do modelo)
-- ---------------------------------------------------------------------
create function analytics.dash_pedidos(p_canal text, p_de date, p_ate date, p_modelo text)
returns table (order_id text, data_venda date, sku text, sku_anuncio text, qtd integer, valor_venda numeric,
               classe text, custo_produto numeric, alerta_custo text)
language sql stable security invoker set search_path = '' as $$
  select b.order_id, b.data_venda, b.sku, b.sku_anuncio, b.qtd, b.valor_venda, b.classe,
         case when v.ve then b.custo_produto end,
         case when v.ve then b.alerta_custo end
    from analytics.dash_pedidos_base() b
   cross join (select core.has_perm('custos') as ve) v
   where (p_canal = 'consolidado' or b.channel = p_canal)
     and b.data_venda between p_de and p_ate
     and (p_modelo is null or exists (
           select 1
             from mkt.order_items oi
            cross join lateral analytics.ref_erp(oi.sku, oi.modelo, oi.cor, b.sale_ts) r
            where oi.channel = b.channel and oi.order_id = b.order_id and r.modelo = p_modelo))
   order by b.data_venda desc, b.order_id
$$;

grant execute on function analytics.dash_pedidos_base() to authenticated;
grant execute on function analytics.dash_ads_periodo(text, date, date) to authenticated;
grant execute on function analytics.dash_custos_periodo(text, date, date),
                          analytics.dash_resumo(text, date, date),
                          analytics.dash_serie(text, date, date, text),
                          analytics.dash_itens(text, date, date),
                          analytics.dash_modelos(text, date, date),
                          analytics.dash_skus(text, date, date, text),
                          analytics.dash_pedidos(text, date, date, text) to authenticated;
