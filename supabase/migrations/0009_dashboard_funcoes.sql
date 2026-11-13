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

drop function if exists analytics.dash_resultado_mensal(text, date, date);
drop function if exists analytics.dash_alertas(text, date, date);
drop function if exists analytics.dash_pedidos(text, date, date, text);
drop function if exists analytics.dash_skus(text, date, date, text);
drop function if exists analytics.dash_modelos(text, date, date);
drop function if exists analytics.dash_itens(text, date, date);
drop function if exists analytics.dash_abc(numeric, numeric);
drop function if exists analytics.foto_anuncio(text, text);
drop function if exists analytics.dash_resumo(text, date, date);
drop function if exists analytics.dash_serie(text, date, date, text);
drop function if exists analytics.dash_custos_periodo(text, date, date);
drop function if exists analytics.dash_ads_periodo(text, date, date);
drop view if exists analytics.dash_pedidos_base;
drop function if exists analytics.dash_pedidos_base();
drop function if exists analytics.dash_pedidos_base(date, date);

-- ---------------------------------------------------------------------
-- Pedidos do PERIODO com canal, imposto e embalagem (vigencia por data da venda).
-- Mesma regra de analytics.ml_pedidos (0003/0007: classificacao, fatura, estimativas,
-- frete de carrinho, de-para de referencia e custo por cotacao), mas filtrando os pedidos
-- pela data da venda ANTES de calcular o custo: ml_pedidos calcula a historia inteira
-- e estourava o tempo limite do Supabase para usuarios do site.
-- O teste "base no periodo inteiro = ml_pedidos" garante que as duas regras continuam iguais.
-- E uma FUNCAO (nao view): reaplicar a 0003/0007 recria ml_pedidos com "drop ... cascade".
-- Sem a permissao 'custos': custo do produto, alerta, imposto e embalagem voltam nulos.
-- ---------------------------------------------------------------------
create function analytics.dash_pedidos_base(p_de date, p_ate date)
returns table (
  order_id text, classe text, sale_ts timestamptz, data_venda date, sku text, sku_anuncio text,
  qtd integer, unidades integer, valor_venda numeric, receita numeric,
  comissao numeric, frete numeric, parcelamento numeric, product_ads numeric, seguidores numeric,
  estornos numeric, difal numeric, outras numeric, custo_produto numeric, alerta_custo text,
  channel text, imposto numeric, embalagem numeric, frete_estimado boolean
)
language sql stable security invoker set search_path = '' as $$
  with base as materialized (
    select o.order_id, o.shipment_id, o.shipping_cost_seller,
           coalesce(o.date_closed, o.date_created) as sale_ts,
           case
             when o.status = 'paid' then 'pago'
             when o.status = 'cancelled' and (o.cancel_detail_code = 'pack_splitted' or o.shipment_substatus = 'pack_splitted') then 'dividido'
             when o.status = 'cancelled' and (o.shipment_status = 'delivered' or o.shipment_substatus = 'returned') then 'devolvido'
             when o.status = 'cancelled' then 'cancelado'
             else 'outro'
           end as classe
      from mkt.orders o
     where o.channel = 'mercadolivre'
       and (coalesce(o.date_closed, o.date_created) at time zone 'America/Sao_Paulo')::date between p_de and p_ate
       and (select core.can_see_channel('mercadolivre'))
  ),
  itens as materialized (
    select oi.order_id,
           string_agg(r.sku, ', ' order by oi.line_no) as sku,
           string_agg(oi.sku, ', ' order by oi.line_no) as sku_anuncio,
           sum(oi.quantity) as qtd,
           sum(oi.units) as unidades,
           sum(oi.unit_price * oi.quantity) as valor_venda,
           sum(coalesce(oi.sale_fee, 0) * oi.quantity) as comissao_estimada,
           sum(c.price * oi.units) as custo_produto_calc,
           string_agg(distinct c.flag, ', ') as alerta_custo
      from mkt.order_items oi
      join base b on b.order_id = oi.order_id
     cross join lateral analytics.ref_erp(oi.sku, oi.modelo, oi.cor, b.sale_ts) r
      left join lateral analytics.resolve_unit_cost(r.modelo, b.sale_ts, oi.units) c on true
     where oi.channel = 'mercadolivre'
     group by oi.order_id
  ),
  fat as materialized (
    select f.order_id,
           sum(f.valor) filter (where f.categoria = 'comissao') as comissao,
           sum(f.valor) filter (where f.categoria = 'frete') as frete,
           sum(f.valor) filter (where f.categoria = 'parcelamento') as parcelamento,
           sum(f.valor) filter (where f.categoria = 'product_ads') as product_ads,
           sum(f.valor) filter (where f.categoria = 'seguidores') as seguidores,
           sum(f.valor) filter (where f.categoria = 'estornos_publicidade') as estornos,
           sum(f.valor) filter (where f.categoria = 'difal') as difal,
           sum(f.valor) filter (where f.categoria = 'outras') as outras
      from analytics.ml_fatura f
     where f.order_id in (select b.order_id from base b)
     group by f.order_id
  ),
  -- Envios cujo frete ja foi cobrado na fatura de algum pedido do carrinho (mesma regra da 0003)
  envio_faturado as materialized (
    select distinct o.shipment_id
      from analytics.ml_fatura f
      join mkt.orders o on o.channel = 'mercadolivre' and o.order_id = f.order_id
     where f.categoria = 'frete'
       and o.shipment_id in (select b.shipment_id from base b where b.shipment_id is not null)
  ),
  p as (
    select b.order_id, b.classe, b.sale_ts,
           (b.sale_ts at time zone 'America/Sao_Paulo')::date as data_venda,
           i.sku, i.sku_anuncio,
           coalesce(i.qtd, 0)::integer as qtd,
           coalesce(i.unidades, 0)::integer as unidades,
           coalesce(i.valor_venda, 0) as valor_venda,
           case when b.classe = 'pago' then coalesce(i.valor_venda, 0) else 0 end as receita,
           case when f.order_id is not null then coalesce(f.comissao, 0)
                when b.classe = 'pago' then coalesce(i.comissao_estimada, 0) else 0 end as comissao,
           case when f.order_id is not null then coalesce(f.frete, 0)
                when b.classe = 'pago' and ef.shipment_id is null then coalesce(b.shipping_cost_seller, 0)
                else 0 end as frete,
           coalesce(f.parcelamento, 0) as parcelamento,
           coalesce(f.product_ads, 0) as product_ads,
           coalesce(f.seguidores, 0) as seguidores,
           coalesce(f.estornos, 0) as estornos,
           coalesce(f.difal, 0) as difal,
           coalesce(f.outras, 0) as outras,
           case when b.classe = 'pago' then coalesce(i.custo_produto_calc, 0) else 0 end as custo_produto,
           case when b.classe = 'pago' then i.alerta_custo end as alerta_custo,
           (f.order_id is null and b.classe = 'pago' and ef.shipment_id is null) as frete_estimado
      from base b
      left join itens i on i.order_id = b.order_id
      left join fat f on f.order_id = b.order_id
      left join envio_faturado ef on ef.shipment_id = b.shipment_id
  )
  select p.order_id::text, p.classe::text, p.sale_ts::timestamptz, p.data_venda, p.sku::text, p.sku_anuncio::text,
         p.qtd, p.unidades, p.valor_venda::numeric, p.receita::numeric,
         p.comissao::numeric, p.frete::numeric, p.parcelamento::numeric, p.product_ads::numeric, p.seguidores::numeric,
         p.estornos::numeric, p.difal::numeric, p.outras::numeric,
         case when v.ve then p.custo_produto::numeric end,
         case when v.ve then p.alerta_custo::text end,
         'mercadolivre'::text,
         case when not v.ve then null
              when p.classe = 'pago' then p.receita * coalesce(pc.imposto_pct, 0) / 100 else 0 end,
         case when not v.ve then null
              when p.classe = 'pago' then coalesce(pc.embalagem_pedido, 0) + coalesce(pc.embalagem_peca, 0) * p.unidades
              else 0 end,
         p.frete_estimado
    from p
   cross join (select core.has_perm('custos') as ve) v
    left join lateral (
      select c.imposto_pct, c.embalagem_pedido, c.embalagem_peca
        from core.parametros_custo c
       where c.channel = 'mercadolivre' and c.vigente_desde <= p.data_venda
       order by c.vigente_desde desc
       limit 1
    ) pc on true
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
  embalagem numeric, margem_bruta numeric, margem_contribuicao numeric, pedidos_sem_custo integer,
  canceladas_valor numeric, devolvidas_valor numeric, estimados integer
)
language sql stable security invoker set search_path = '' as $$
  with b as (
    select * from analytics.dash_pedidos_base(p_de, p_ate)
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
           count(*) filter (where classe = 'pago' and alerta_custo like '%sem_custo%')::integer as sem_custo,
           coalesce(sum(valor_venda) filter (where classe = 'cancelado'), 0) as canceladas_valor,
           coalesce(sum(valor_venda) filter (where classe = 'devolvido'), 0) as devolvidas_valor,
           count(*) filter (where frete_estimado)::integer as estimados
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
         case when t.ve_custos then t.sem_custo end,
         t.canceladas_valor, t.devolvidas_valor, t.estimados
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
      from analytics.dash_pedidos_base(p_de, p_ate) b
     where (p_canal = 'consolidado' or b.channel = p_canal) and b.data_venda between p_de and p_ate
     group by 1
  )
  select e.periodo, coalesce(a.vendas_brutas, 0), coalesce(a.pedidos, 0), coalesce(a.receita, 0)
    from eixo e
    left join agg a on a.periodo = e.periodo
   order by e.periodo
$$;

-- ---------------------------------------------------------------------
-- Foto do anuncio: da variacao (quando informada e com foto propria) ou a principal;
-- sem fotos guardadas, a miniatura em https. Anuncio desconhecido -> nulo.
-- ---------------------------------------------------------------------
create function analytics.foto_anuncio(p_item text, p_variacao text) returns text
language sql stable security invoker set search_path = '' as $$
  select coalesce(
           (select p->>'secure_url'
              from jsonb_array_elements(case when jsonb_typeof(i.raw->'pictures') = 'array' then i.raw->'pictures' else '[]'::jsonb end) p
             where p->>'id' = (select v->'picture_ids'->>0
                                 from jsonb_array_elements(case when jsonb_typeof(i.raw->'variations') = 'array' then i.raw->'variations' else '[]'::jsonb end) v
                                where v->>'id' = p_variacao
                                limit 1)
             limit 1),
           i.raw->'pictures'->0->>'secure_url',
           replace(i.thumbnail, 'http://', 'https://'))
    from mkt.items i
   where i.channel = 'mercadolivre' and i.item_id = p_item
$$;

-- ---------------------------------------------------------------------
-- Itens vendidos com a referencia do ERP e a parte de cada item nos custos do pedido.
-- Tarifas, imposto e embalagem do pedido sao repartidos pelo valor de cada item.
-- ---------------------------------------------------------------------
create function analytics.dash_itens(p_canal text, p_de date, p_ate date)
returns table (order_id text, classe text, modelo text, sku text, kit integer, qtd integer,
               valor_item numeric, receita numeric, custo numeric, tarifas numeric, impemb numeric, sem_custo boolean,
               produto text, flag text, sale_ts timestamptz, item_id text, variation_id text)
language sql stable security invoker set search_path = '' as $$
  select b.order_id, b.classe, r.modelo, r.sku, oi.kit_units, oi.quantity,
         oi.unit_price * oi.quantity,
         case when b.classe = 'pago' then oi.unit_price * oi.quantity else 0 end,
         case when not v.ve then null when b.classe = 'pago' then coalesce(c.price, 0) * oi.units else 0 end,
         w.peso * (b.comissao + b.frete + b.parcelamento + b.product_ads + b.seguidores + b.estornos + b.difal + b.outras),
         w.peso * (b.imposto + b.embalagem),
         case when v.ve then (b.classe = 'pago' and c.flag = 'sem_custo') end,
         oi.title,
         case when v.ve and b.classe = 'pago' then c.flag end,
         b.sale_ts, oi.item_id, oi.variation_id
    from analytics.dash_pedidos_base(p_de, p_ate) b
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
-- Curva ABC: entre as linhas com valor positivo, em ordem decrescente, o acumulado
-- ANTES da linha < 80% -> A, < 95% -> B, senao C. Valor <= 0 -> 'prejuizo' (lucro) / null (receita).
-- ---------------------------------------------------------------------
create function analytics.dash_abc(p_antes numeric, p_total numeric) returns text
language sql immutable set search_path = '' as $$
  select case when p_total is null or p_total <= 0 then null
              when p_antes / p_total < 0.80 then 'A'
              when p_antes / p_total < 0.95 then 'B'
              else 'C' end
$$;

-- ---------------------------------------------------------------------
-- Vendas e rentabilidade por modelo, com rateio dos custos do periodo e curva ABC
-- por lucro (abc) e por receita (abc_receita).
-- ---------------------------------------------------------------------
create function analytics.dash_modelos(p_canal text, p_de date, p_ate date)
returns table (
  modelo text, pedidos integer, unidades integer, vendas_brutas numeric, ticket_medio numeric,
  pct_cancel_devol numeric, receita numeric, custo_produto numeric, tarifas_frete numeric,
  custos_rateados numeric, imposto_embalagem numeric, contribuicao numeric, contribuicao_pct numeric,
  abc text, sem_custo integer, produto text, abc_receita text, foto text, link text
)
language sql stable security invoker set search_path = '' as $$
  with i as materialized (
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
           count(distinct i.order_id) filter (where i.sem_custo)::integer as sem_custo,
           (array_agg(i.produto order by i.sale_ts desc))[1] as produto
      from i
     group by i.modelo
  ),
  -- Anuncio que mais vendeu (em R$) de cada modelo no periodo: fonte da foto principal e do link
  topo as (
    select distinct on (x.modelo) x.modelo, x.item_id
      from (select i.modelo, i.item_id, sum(i.valor_item) as v from i where i.item_id is not null group by 1, 2) x
     order by x.modelo, x.v desc, x.item_id
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
  ),
  acum_r as (
    select c2.modelo,
           coalesce(sum(c2.receita) over (order by c2.receita desc, c2.modelo
                                          rows between unbounded preceding and 1 preceding), 0) as antes,
           sum(c2.receita) over () as total
      from c2
     where c2.receita > 0
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
              else analytics.dash_abc(a.antes, a.total) end,
         case when v.ve then c2.sem_custo end,
         c2.produto,
         analytics.dash_abc(ar.antes, ar.total),
         analytics.foto_anuncio(tp.item_id, null),
         (select it.permalink from mkt.items it where it.channel = 'mercadolivre' and it.item_id = tp.item_id)
    from c2
    left join acum a on a.modelo = c2.modelo
    left join acum_r ar on ar.modelo = c2.modelo
    left join topo tp on tp.modelo is not distinct from c2.modelo
   cross join (select core.has_perm('custos') as ve) v
   order by c2.vendas_brutas desc, c2.modelo
$$;

-- ---------------------------------------------------------------------
-- Por SKU: de um modelo (p_modelo) ou de todos (p_modelo nulo), mesmo calculo e curvas ABC.
-- ---------------------------------------------------------------------
create function analytics.dash_skus(p_canal text, p_de date, p_ate date, p_modelo text)
returns table (sku text, kit integer, pedidos integer, unidades integer, vendas_brutas numeric,
               receita numeric, custo_produto numeric, contribuicao numeric,
               modelo text, produto text, tarifas_frete numeric, contribuicao_pct numeric, abc text, abc_receita text,
               foto text, link text)
language sql stable security invoker set search_path = '' as $$
  with i as materialized (
    select * from analytics.dash_itens(p_canal, p_de, p_ate)
  ),
  cp as (
    select coalesce(sum(valor), 0) as total from analytics.dash_custos_periodo(p_canal, p_de, p_ate)
  ),
  t as (
    select sum(receita) as r from i
  ),
  s as (
    select i.sku, min(i.modelo) as modelo, min(i.kit) as kit,
           count(distinct i.order_id) filter (where i.classe in ('pago', 'cancelado', 'devolvido'))::integer as pedidos,
           coalesce(sum(i.qtd) filter (where i.classe in ('pago', 'cancelado', 'devolvido')), 0)::integer as unidades,
           coalesce(sum(i.valor_item) filter (where i.classe in ('pago', 'cancelado', 'devolvido')), 0) as vendas_brutas,
           sum(i.receita) as receita, sum(i.custo) as custo, sum(i.tarifas) as tarifas, sum(i.impemb) as impemb,
           (array_agg(i.produto order by i.sale_ts desc))[1] as produto
      from i
     where p_modelo is null or i.modelo = p_modelo
     group by i.sku
  ),
  -- Anuncio/variacao que mais vendeu (em R$) de cada SKU: fonte da foto e do link.
  -- SKU completo (MODELO-COR...) usa a foto da variacao; SKU so com o modelo usa a foto principal.
  topo as (
    select distinct on (x.sku) x.sku, x.item_id, x.variation_id
      from (select i.sku, i.item_id, i.variation_id, sum(i.valor_item) as v
              from i where i.item_id is not null group by 1, 2, 3) x
     order by x.sku, x.v desc, x.item_id
  ),
  s2 as (
    select s.*,
           s.receita - s.custo - s.tarifas - s.impemb
             - case when t.r > 0 then cp.total * s.receita / t.r else 0 end as contrib
      from s cross join cp cross join t
  ),
  acum as (
    select s2.sku,
           coalesce(sum(s2.contrib) over (order by s2.contrib desc, s2.sku rows between unbounded preceding and 1 preceding), 0) as antes,
           sum(s2.contrib) over () as total
      from s2 where s2.contrib > 0 and s2.receita > 0
  ),
  acum_r as (
    select s2.sku,
           coalesce(sum(s2.receita) over (order by s2.receita desc, s2.sku rows between unbounded preceding and 1 preceding), 0) as antes,
           sum(s2.receita) over () as total
      from s2 where s2.receita > 0
  )
  select s2.sku, s2.kit, s2.pedidos, s2.unidades, s2.vendas_brutas, s2.receita,
         case when v.ve then s2.custo end,
         case when v.ve then s2.contrib end,
         s2.modelo, s2.produto, s2.tarifas,
         case when v.ve and s2.receita > 0 then round(s2.contrib * 100 / s2.receita, 2) end,
         case when not v.ve or s2.receita <= 0 then null
              when s2.contrib <= 0 then 'prejuizo'
              else analytics.dash_abc(a.antes, a.total) end,
         analytics.dash_abc(ar.antes, ar.total),
         analytics.foto_anuncio(tp.item_id, case when s2.sku like '%-%' then tp.variation_id end),
         (select it.permalink from mkt.items it where it.channel = 'mercadolivre' and it.item_id = tp.item_id)
    from s2
    left join acum a on a.sku = s2.sku
    left join acum_r ar on ar.sku = s2.sku
    left join topo tp on tp.sku is not distinct from s2.sku
   cross join (select core.has_perm('custos') as ve) v
   order by s2.vendas_brutas desc, s2.sku
$$;

-- ---------------------------------------------------------------------
-- Pontos de atencao: modelos com pedidos pagos sem custo ou com custo de cotacao posterior a venda
-- ---------------------------------------------------------------------
create function analytics.dash_alertas(p_canal text, p_de date, p_ate date)
returns table (codigo text, tipo text, pedidos integer)
language sql stable security invoker set search_path = '' as $$
  select i.modelo, i.flag, count(distinct i.order_id)::integer
    from analytics.dash_itens(p_canal, p_de, p_ate) i
   where i.flag is not null
   group by i.modelo, i.flag
   order by count(distinct i.order_id) desc, i.modelo
$$;

-- ---------------------------------------------------------------------
-- Resultado mes a mes (mesmos campos do resumo), cortado no periodo pedido
-- ---------------------------------------------------------------------
create function analytics.dash_resultado_mensal(p_canal text, p_de date, p_ate date)
returns table (
  mes date, pedidos integer, vendas_brutas numeric, unidades integer, ticket_medio numeric,
  cancelados integer, devolvidos integer, pct_cancel_devol numeric, receita numeric,
  comissao numeric, frete numeric, parcelamento numeric, product_ads numeric, seguidores numeric,
  estornos numeric, difal numeric, outras numeric, custo_produto numeric, imposto numeric,
  embalagem numeric, margem_bruta numeric, margem_contribuicao numeric, pedidos_sem_custo integer,
  canceladas_valor numeric, devolvidas_valor numeric, estimados integer
)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_m date := date_trunc('month', p_de)::date;
begin
  while v_m <= p_ate loop
    return query
      select v_m, r.pedidos, r.vendas_brutas, r.unidades, r.ticket_medio, r.cancelados, r.devolvidos,
             r.pct_cancel_devol, r.receita, r.comissao, r.frete, r.parcelamento, r.product_ads, r.seguidores,
             r.estornos, r.difal, r.outras, r.custo_produto, r.imposto, r.embalagem, r.margem_bruta,
             r.margem_contribuicao, r.pedidos_sem_custo, r.canceladas_valor, r.devolvidas_valor, r.estimados
        from analytics.dash_resumo(p_canal, greatest(v_m, p_de),
                                   least((v_m + interval '1 month' - interval '1 day')::date, p_ate)) r;
    v_m := (v_m + interval '1 month')::date;
  end loop;
end $$;

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
    from analytics.dash_pedidos_base(p_de, p_ate) b
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

grant execute on function analytics.dash_pedidos_base(date, date) to authenticated;
grant execute on function analytics.dash_ads_periodo(text, date, date) to authenticated;
grant execute on function analytics.dash_custos_periodo(text, date, date),
                          analytics.dash_resumo(text, date, date),
                          analytics.dash_serie(text, date, date, text),
                          analytics.dash_itens(text, date, date),
                          analytics.dash_modelos(text, date, date),
                          analytics.dash_skus(text, date, date, text),
                          analytics.dash_pedidos(text, date, date, text),
                          analytics.dash_alertas(text, date, date),
                          analytics.dash_resultado_mensal(text, date, date),
                          analytics.dash_abc(numeric, numeric),
                          analytics.foto_anuncio(text, text) to authenticated;
