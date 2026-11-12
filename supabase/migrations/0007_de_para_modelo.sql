-- =====================================================================
-- 0007 - De-para de referencia (SKU do anuncio -> referencia do ERP)
-- Pode ser reexecutada. Ordem: 0003 -> 0006 -> 0007 (se a 0003 ou a 0006 forem
-- reaplicadas, reaplique esta depois).
--
-- Quando o SKU do anuncio tem um modelo errado, o painel passa a mostrar e a custear
-- a referencia do ERP: modelo, cor e SKU corrigidos em analytics.ml_pedidos e
-- analytics.ml_alertas. O SKU original fica em ml_pedidos.sku_anuncio.
-- "ate" limita a ligacao as vendas ate essa data (horario de Brasilia); vazio = sempre.
-- As unidades do kit continuam vindo do SKU original do anuncio.
--
-- Esta migration substitui as views ml_pedidos, ml_meses e ml_alertas da 0003.
-- =====================================================================

create schema if not exists map;
grant usage on schema map to authenticated;

create table if not exists map.modelo_de_para (
  id             bigserial primary key,
  modelo_anuncio text not null,          -- modelo como esta no SKU do anuncio (ex.: SQM148)
  modelo_erp     text not null,          -- Referencia no ERP (ex.: BMS148)
  ate            date,                   -- ultima data de venda coberta; vazio = sem limite
  obs            text,
  criado_em      timestamptz not null default now()
);
alter table map.modelo_de_para add column if not exists cor_anuncio text;  -- vazio = qualquer cor
alter table map.modelo_de_para add column if not exists cor_erp     text;  -- vazio = mantem a cor
alter table map.modelo_de_para add column if not exists sku_erp     text;  -- vazio = troca so modelo/cor
alter table map.modelo_de_para drop constraint if exists modelo_de_para_modelo_anuncio_ate_key;
create unique index if not exists modelo_de_para_chave
  on map.modelo_de_para (modelo_anuncio, (coalesce(cor_anuncio, '')), (coalesce(ate, '9999-12-31'::date)));

alter table map.modelo_de_para enable row level security;
drop policy if exists "de-para: leitura" on map.modelo_de_para;
drop policy if exists "de-para: admin altera" on map.modelo_de_para;
create policy "de-para: leitura" on map.modelo_de_para for select to authenticated using (true);
create policy "de-para: admin altera" on map.modelo_de_para for all to authenticated
  using (core.my_role() = 'admin') with check (core.my_role() = 'admin');
grant select, insert, update, delete on map.modelo_de_para to authenticated;
grant usage on sequence map.modelo_de_para_id_seq to authenticated;

-- Pedidos do dono em 12/11/2026 (SKU errado no anuncio), vendas ate essa data:
--   SQM148-*            -> BMS148-* (mesma cor e restante do SKU)
--   CMT44-CDE-67 .. 72  -> BOB01-PDR
delete from map.modelo_de_para                      -- versao anterior desta migration (sem cor)
 where modelo_anuncio = 'CMT44' and cor_anuncio is null and ate = '2026-11-12';
insert into map.modelo_de_para (modelo_anuncio, cor_anuncio, modelo_erp, cor_erp, sku_erp, ate, obs) values
  ('SQM148', null,  'BMS148', null,  null,        '2026-11-12', 'SKU errado no anuncio; corrigido a pedido do dono'),
  ('CMT44',  'CDE', 'BOB01',  'PDR', 'BOB01-PDR', '2026-11-12', 'CMT44-CDE-67/68/69/70/71/72 = BOB01-PDR; corrigido a pedido do dono')
on conflict (modelo_anuncio, (coalesce(cor_anuncio, '')), (coalesce(ate, '9999-12-31'::date))) do update
  set modelo_erp = excluded.modelo_erp, cor_erp = excluded.cor_erp, sku_erp = excluded.sku_erp, obs = excluded.obs;

-- Referencia do ERP (sku, modelo, cor) para um item vendido numa data.
create or replace function analytics.ref_erp(p_sku text, p_modelo text, p_cor text, p_data timestamptz)
returns table (sku text, modelo text, cor text)
language sql stable set search_path = '' as $$
  select case when d.id is null then p_sku
              else coalesce(d.sku_erp,
                            concat_ws('-', d.modelo_erp, coalesce(d.cor_erp, p_cor),
                                      substring(p_sku from '^[^-]*-[^-]*-(.+)$')))
         end,
         coalesce(d.modelo_erp, p_modelo),
         case when d.id is null then p_cor else coalesce(d.cor_erp, p_cor) end
    from (select 1) x
    left join lateral (
      select m.*
        from map.modelo_de_para m
       where m.modelo_anuncio = p_modelo
         and (m.cor_anuncio is null or m.cor_anuncio = p_cor)
         and (m.ate is null or (p_data at time zone 'America/Sao_Paulo')::date <= m.ate)
       order by m.cor_anuncio nulls last, m.ate nulls last
       limit 1
    ) d on true;
$$;

-- Regra de custo da 0006 (a versao anterior desta migration fazia o de-para aqui dentro;
-- agora ele e feito nas views, antes de chamar esta funcao).
create or replace function analytics.resolve_unit_cost(p_modelo text, p_data timestamptz, p_units integer)
returns table (price numeric, flag text)
language sql stable set search_path = '' as $$
  with v as (
    select t.price,
           t.created_at,
           (t.created_at at time zone 'America/Sao_Paulo')::date
             <= (p_data at time zone 'America/Sao_Paulo')::date as antes,
           p_units between t.qty_start and coalesce(t.qty_end, 2147483647) as contem,
           case when p_units < t.qty_start then t.qty_start - p_units
                when p_units > coalesce(t.qty_end, 2147483647) then p_units - t.qty_end
                else 0 end as distancia
      from erp.cost_tiers t
     where t.product_id = p_modelo
  ),
  pick as (
    (select v.price, null::text as flag, 1 as pri from v where v.antes and v.contem
      order by v.created_at desc, v.price desc limit 1)
    union all
    (select v.price, null::text, 2 from v where v.antes
      order by (v.created_at at time zone 'America/Sao_Paulo')::date desc, v.distancia, v.created_at desc, v.price desc
      limit 1)
    union all
    (select v.price, 'faixa_atual'::text, 3 from v where not v.antes
      order by (v.created_at at time zone 'America/Sao_Paulo')::date, v.distancia, v.created_at, v.price desc
      limit 1)
    union all
    select 0::numeric, 'sem_custo'::text, 4
  )
  select p.price, p.flag from pick p order by p.pri limit 1;
$$;
drop function if exists analytics.modelo_erp(text, timestamptz);

-- ---------------------------------------------------------------------
-- Views (iguais as da 0003, com a referencia do ERP nos itens)
-- ---------------------------------------------------------------------
drop view if exists analytics.ml_alertas, analytics.ml_meses, analytics.ml_pedidos cascade;

create view analytics.ml_pedidos with (security_invoker = true) as
with base as (
  select o.*,
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
),
itens as (
  select oi.order_id,
         string_agg(r.sku, ', ' order by oi.line_no) as sku,
         string_agg(oi.sku, ', ' order by oi.line_no) as sku_anuncio,
         min(r.modelo) as modelo,
         min(r.cor) as cor,
         min(oi.kit_units) as kit,
         sum(oi.quantity) as qtd,
         sum(oi.units) as unidades,
         sum(oi.unit_price * oi.quantity) as valor_venda,
         sum(coalesce(oi.sale_fee, 0) * oi.quantity) as comissao_estimada,
         sum(c.price * oi.units) as custo_produto_calc,
         string_agg(distinct c.flag, ', ') as alerta_custo
    from mkt.order_items oi
    join base b on b.channel = oi.channel and b.order_id = oi.order_id
    cross join lateral analytics.ref_erp(oi.sku, oi.modelo, oi.cor, b.sale_ts) r
    left join lateral analytics.resolve_unit_cost(r.modelo, b.sale_ts, oi.units) c on true
   where oi.channel = 'mercadolivre'
   group by oi.order_id
),
fat as (
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
   where f.order_id is not null
   group by f.order_id
),
-- Envios cujo frete já foi cobrado na fatura de algum dos pedidos do carrinho:
-- os outros pedidos do mesmo envio não recebem frete estimado (seria cobrança em dobro).
envio_faturado as (
  select distinct o.shipment_id
    from analytics.ml_fatura f
    join mkt.orders o on o.channel = 'mercadolivre' and o.order_id = f.order_id
   where f.categoria = 'frete' and o.shipment_id is not null
)
select b.order_id,
       b.pack_id,
       b.status,
       b.classe,
       b.sale_ts,
       (b.sale_ts at time zone 'America/Sao_Paulo')::date as data_venda,
       date_trunc('month', b.sale_ts at time zone 'America/Sao_Paulo')::date as mes,
       i.sku, i.modelo, i.cor, i.kit,
       coalesce(i.qtd, 0)::integer as qtd,
       coalesce(i.unidades, 0)::integer as unidades,
       coalesce(i.valor_venda, 0) as valor_venda,
       case when b.classe = 'pago' then coalesce(i.valor_venda, 0) else 0 end as receita,
       (f.order_id is null and b.classe = 'pago' and ef.shipment_id is null) as frete_estimado,
       -- Pedido ainda não faturado: estimativas (comissão = sale_fee × qtd; frete = custo do envio)
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
       case when b.classe = 'pago' and i.unidades > 0 then round(i.custo_produto_calc / i.unidades, 4) end as custo_unitario,
       case when b.classe = 'pago' then coalesce(i.custo_produto_calc, 0) else 0 end as custo_produto,
       case when b.classe = 'pago' then i.alerta_custo end as alerta_custo,
       i.sku_anuncio
  from base b
  left join itens i on i.order_id = b.order_id
  left join fat f on f.order_id = b.order_id
  left join envio_faturado ef on ef.shipment_id = b.shipment_id;

create view analytics.ml_meses with (security_invoker = true) as
with api_inicio as (
  select min(day) as d from mkt.ads_campaign_daily where channel = 'mercadolivre'
),
ped as (
  select mes,
         count(*) filter (where classe <> 'outro') as pedidos,
         count(*) filter (where classe in ('pago', 'cancelado', 'devolvido')) as vendas_qtd,
         sum(valor_venda) filter (where classe in ('pago', 'cancelado', 'devolvido')) as vendas_brutas,
         (sum(qtd) filter (where classe in ('pago', 'cancelado', 'devolvido')))::integer as unidades_vendidas,
         count(*) filter (where classe = 'cancelado') as cancelados,
         sum(valor_venda) filter (where classe = 'cancelado') as canceladas_valor,
         count(*) filter (where classe = 'devolvido') as devolvidas,
         sum(valor_venda) filter (where classe = 'devolvido') as devolvidas_valor,
         count(*) filter (where classe = 'dividido') as divididos,
         sum(receita) as receita,
         (sum(unidades) filter (where classe = 'pago'))::integer as unidades,
         sum(comissao) as comissao, sum(frete) as frete, sum(parcelamento) as parcelamento,
         sum(product_ads) as product_ads, sum(seguidores) as seguidores, sum(estornos) as estornos,
         sum(difal) as difal, sum(outras) as outras,
         sum(custo_produto) as custo_produto,
         count(*) filter (where frete_estimado) as estimados
    from analytics.ml_pedidos
   group by mes
),
-- Linhas da fatura sem pedido vão para o mês da data de referência.
-- Product Ads: nos dias cobertos pela API, vale a API (abaixo); antes disso, a fatura.
fat_mes as (
  select date_trunc('month', f.data_ref)::date as mes,
         sum(f.valor) filter (where f.categoria = 'comissao') as comissao,
         sum(f.valor) filter (where f.categoria = 'frete') as frete,
         sum(f.valor) filter (where f.categoria = 'parcelamento') as parcelamento,
         sum(f.valor) filter (where f.categoria = 'product_ads'
                              and f.data_ref < coalesce((select d from api_inicio), 'infinity'::date)) as product_ads,
         sum(f.valor) filter (where f.categoria = 'seguidores') as seguidores,
         sum(f.valor) filter (where f.categoria = 'estornos_publicidade') as estornos,
         sum(f.valor) filter (where f.categoria = 'difal') as difal,
         sum(f.valor) filter (where f.categoria = 'outras') as outras
    from analytics.ml_fatura f
   where f.order_id is null
   group by 1
),
ads_api as (
  select date_trunc('month', day)::date as mes, sum(cost) as product_ads
    from mkt.ads_campaign_daily
   where channel = 'mercadolivre'
   group by 1
),
meses as (
  select mes from ped union select mes from fat_mes union select mes from ads_api
),
tot as (
  select m.mes,
         coalesce(p.pedidos, 0) as pedidos,
         coalesce(p.vendas_qtd, 0) as vendas_qtd,
         coalesce(p.vendas_brutas, 0) as vendas_brutas,
         coalesce(p.unidades_vendidas, 0) as unidades_vendidas,
         coalesce(p.cancelados, 0) as cancelados,
         coalesce(p.canceladas_valor, 0) as canceladas_valor,
         coalesce(p.devolvidas, 0) as devolvidas,
         coalesce(p.devolvidas_valor, 0) as devolvidas_valor,
         coalesce(p.divididos, 0) as divididos,
         coalesce(p.receita, 0) as receita,
         coalesce(p.unidades, 0) as unidades,
         coalesce(p.comissao, 0) + coalesce(f.comissao, 0) as comissao,
         coalesce(p.frete, 0) + coalesce(f.frete, 0) as frete,
         coalesce(p.parcelamento, 0) + coalesce(f.parcelamento, 0) as parcelamento,
         coalesce(p.product_ads, 0) + coalesce(f.product_ads, 0) + coalesce(a.product_ads, 0) as product_ads,
         coalesce(p.seguidores, 0) + coalesce(f.seguidores, 0) as seguidores,
         coalesce(p.estornos, 0) + coalesce(f.estornos, 0) as estornos,
         coalesce(p.difal, 0) + coalesce(f.difal, 0) as difal,
         coalesce(p.outras, 0) + coalesce(f.outras, 0) as outras,
         coalesce(p.custo_produto, 0) as custo_produto,
         coalesce(p.estimados, 0) as estimados
    from meses m
    left join ped p on p.mes = m.mes
    left join fat_mes f on f.mes = m.mes
    left join ads_api a on a.mes = m.mes
)
select t.*,
       extract(year from t.mes)::int as ano,
       extract(month from t.mes)::int as mes_num,
       t.receita - (t.comissao + t.frete + t.parcelamento + t.product_ads + t.seguidores
                    + t.estornos + t.difal + t.outras) - t.custo_produto as margem_liquida
  from tot t
 order by t.mes;

create view analytics.ml_alertas with (security_invoker = true) as
select c.flag as tipo,
       r.modelo as codigo,
       count(distinct oi.order_id) as qtd_pedidos,
       array_agg(distinct oi.order_id) as pedidos
  from mkt.order_items oi
  join mkt.orders o on o.channel = oi.channel and o.order_id = oi.order_id
  cross join lateral analytics.ref_erp(oi.sku, oi.modelo, oi.cor, coalesce(o.date_closed, o.date_created)) r
  cross join lateral analytics.resolve_unit_cost(r.modelo, coalesce(o.date_closed, o.date_created), oi.units) c
 where oi.channel = 'mercadolivre' and o.status = 'paid' and c.flag is not null
 group by c.flag, r.modelo;

grant select on analytics.ml_pedidos, analytics.ml_meses, analytics.ml_alertas to authenticated;
grant execute on function analytics.ref_erp(text, text, text, timestamptz),
                          analytics.resolve_unit_cost(text, timestamptz, integer) to authenticated;
