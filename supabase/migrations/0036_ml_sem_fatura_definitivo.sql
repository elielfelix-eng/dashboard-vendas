-- =====================================================================
-- 0036: pedidos do Mercado Livre SEM fatura passam a valer como definitivos quando o mes fecha.
--
-- Decisao do dono (27/11/2026). Desde 10/2026 a comissao do ML esta isenta e muitos pedidos
-- nunca ganham linha na fatura (analytics.ml_fatura). O dono conferiu 3 pedidos: em todos, o frete
-- que o painel usa (mkt.orders.shipping_cost_seller) e igual a "Tarifa do Mercado Envios (por sua
-- conta)" que o ML desconta direto da venda. Ou seja, o valor ja esta correto e final.
--
-- O que muda: SOMENTE o marcador frete_estimado (e, por consequencia, a contagem 'estimados' do
-- dash_resumo / cartao "Aguardando a fatura do ML"). Ele so fica verdadeiro quando a venda e do mes
-- corrente (horario de Brasilia) ou posterior; mes fechado sem fatura = definitivo.
-- NENHUM valor muda: comissao, frete e os demais montantes saem exatamente como na 0021.
--
-- Corpo identico ao de analytics.dash_pedidos_base_ml da 0021, exceto a linha de frete_estimado.
-- Reexecutavel (create or replace); mantem search_path = ''.
-- =====================================================================

create or replace function analytics.dash_pedidos_base_ml(p_de date, p_ate date)
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
           (f.order_id is null and b.classe = 'pago' and ef.shipment_id is null
            and (b.sale_ts at time zone 'America/Sao_Paulo')::date >= date_trunc('month', now() at time zone 'America/Sao_Paulo')::date) as frete_estimado
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
