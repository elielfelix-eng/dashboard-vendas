-- =====================================================================
-- 0003 — Regras de negócio validadas na V1:
--   SKU (modelo/cor/kit), classificação do pedido, fatura do ML,
--   Ads por campanha, custos por faixa e views de margem.
-- Referência: .claude/skills/dashboard-mercado-livre-brinde-do-bem/regras-de-negocio.md
-- Pode ser executado mais de uma vez: pula o que já existe e recria as views.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. SKU: MODELO-COR-Knnnn-Vn  (ex.: BLA68-AMA-K0010-V1)
--    Colunas calculadas automaticamente a partir do SKU (inclui dados já gravados)
-- ---------------------------------------------------------------------
alter table mkt.order_items
  add column if not exists modelo text generated always as (nullif(split_part(sku, '-', 1), '')) stored,
  add column if not exists cor text generated always as (
    case when split_part(sku, '-', 2) ~ '^(K\d+|V\d+)?$' then null else split_part(sku, '-', 2) end
  ) stored,
  add column if not exists kit_units integer generated always as (((regexp_match(sku, '-K(\d+)(?:-|$)'))[1])::integer) stored,
  add column if not exists versao text generated always as ((regexp_match(sku, '-(V\d+)(?:-|$)'))[1]) stored,
  -- unidades físicas = unidades do kit × quantidade comprada (sem kit = 1)
  add column if not exists units integer generated always as (
    quantity * coalesce(((regexp_match(sku, '-K(\d+)(?:-|$)'))[1])::integer, 1)
  ) stored;

create index if not exists order_items_modelo_idx on mkt.order_items (modelo);

-- ---------------------------------------------------------------------
-- 2. Dados para classificar o pedido (pago / dividido / devolvido / cancelado)
-- ---------------------------------------------------------------------
alter table mkt.orders
  add column if not exists cancel_detail_code text generated always as (raw -> 'cancel_detail' ->> 'code') stored,
  add column if not exists shipment_status text,
  add column if not exists shipment_substatus text;

drop index if exists mkt.orders_shipment_id_idx1; -- nome automático de uma execução anterior
create index if not exists orders_cancelled_ship_pending_idx on mkt.orders (shipment_id) where status = 'cancelled' and shipment_status is null;

-- ---------------------------------------------------------------------
-- 3. Fatura do Mercado Livre
-- ---------------------------------------------------------------------
create table if not exists mkt.billing_periods (
  channel    text not null default 'mercadolivre',
  period_key text not null,
  date_from  date,
  date_to    date,
  rows_count integer not null default 0,
  fetched_at timestamptz not null default now(),
  raw        jsonb,
  primary key (channel, period_key)
);

create table if not exists mkt.billing_details (
  channel     text not null default 'mercadolivre',
  period_key  text not null,
  detail_id   text not null,
  created_at  timestamptz,
  detail_type text,            -- CHARGE soma, BONUS subtrai
  code        text,            -- ex.: CVVML, PADS, CDLIT
  amount      numeric(14, 2) not null default 0,
  order_id    text,
  description text,
  raw         jsonb,
  primary key (channel, period_key, detail_id)
);
create index if not exists billing_details_order_id_idx on mkt.billing_details (order_id) where order_id is not null;

-- ---------------------------------------------------------------------
-- 4. Product Ads por campanha e por dia (API, 90 dias)
-- ---------------------------------------------------------------------
create table if not exists mkt.ads_campaign_daily (
  channel     text not null default 'mercadolivre',
  campaign_id text not null,
  day         date not null,
  cost        numeric(14, 2) not null default 0,
  raw         jsonb,
  primary key (channel, campaign_id, day)
);

-- Segurança das novas tabelas
alter table mkt.billing_periods enable row level security;
alter table mkt.billing_details enable row level security;
alter table mkt.ads_campaign_daily enable row level security;
drop policy if exists "fatura: quem ve custos" on mkt.billing_periods;
drop policy if exists "fatura: quem ve custos" on mkt.billing_details;
drop policy if exists "canal liberado" on mkt.ads_campaign_daily;
create policy "fatura: quem ve custos" on mkt.billing_periods for select to authenticated
  using (core.can_see_costs() and core.can_see_channel(channel));
create policy "fatura: quem ve custos" on mkt.billing_details for select to authenticated
  using (core.can_see_costs() and core.can_see_channel(channel));
create policy "canal liberado" on mkt.ads_campaign_daily for select to authenticated
  using (core.can_see_channel(channel));
grant select on mkt.billing_periods, mkt.billing_details, mkt.ads_campaign_daily to authenticated;

-- ---------------------------------------------------------------------
-- 5. Custos por faixa (virão do ERP pelo gateway; equivalente ao custos.csv da V1)
-- ---------------------------------------------------------------------
create table if not exists erp.cost_tiers (
  id         bigserial primary key,
  product_id text not null,              -- modelo do SKU (ex.: BLA68)
  qty_start  integer not null,
  qty_end    integer,                    -- vazio = sem limite
  price      numeric(14, 4) not null,    -- preço por unidade
  created_at timestamptz not null,       -- início da vigência
  expired_at timestamptz,                -- vazio = vigente hoje
  source     text not null default 'manual',
  loaded_at  timestamptz not null default now()
);
create index if not exists cost_tiers_product_id_idx on erp.cost_tiers (product_id);

alter table erp.cost_tiers enable row level security;
drop policy if exists "custos: quem ve custos" on erp.cost_tiers;
drop policy if exists "custos: admin altera" on erp.cost_tiers;
create policy "custos: quem ve custos" on erp.cost_tiers for select to authenticated using (core.can_see_costs());
create policy "custos: admin altera" on erp.cost_tiers for all to authenticated
  using (core.my_role() = 'admin') with check (core.my_role() = 'admin');
grant usage on schema erp to authenticated;
grant select, insert, update, delete on erp.cost_tiers to authenticated;
grant usage on sequence erp.cost_tiers_id_seq to authenticated;

/*
  Escolha do preço unitário (regras da V1):
  - faixa válida: created_at <= data do pedido e (expired_at vazio ou data < expired_at)
  - sem faixa válida na data: usa as vigentes hoje (expired_at vazio) -> alerta 'faixa_atual'
  - modelo sem nenhuma faixa: preço 0 -> alerta 'sem_custo'
  - entre as válidas: a que contém as unidades; acima da última ou num buraco -> a faixa
    imediatamente abaixo; abaixo da primeira -> a primeira. Empate: cadastro mais recente,
    depois maior preço.
*/
create or replace function analytics.resolve_unit_cost(p_modelo text, p_data timestamptz, p_units integer)
returns table (price numeric, flag text)
language plpgsql stable set search_path = '' as $$
declare
  v_mode text;
  v_flag text := null;
begin
  if p_modelo is null then
    return query select 0::numeric, 'sem_custo'::text;
    return;
  end if;

  if exists (select 1 from erp.cost_tiers t
              where t.product_id = p_modelo and t.created_at <= p_data
                and (t.expired_at is null or p_data < t.expired_at)) then
    v_mode := 'data';
  elsif exists (select 1 from erp.cost_tiers t where t.product_id = p_modelo and t.expired_at is null) then
    v_mode := 'atual';
    v_flag := 'faixa_atual';
  else
    return query select 0::numeric, 'sem_custo'::text;
    return;
  end if;

  return query
  with v as (
    select t.qty_start, coalesce(t.qty_end, 2147483647) as qty_end, t.price, t.created_at
      from erp.cost_tiers t
     where t.product_id = p_modelo
       and case when v_mode = 'data'
                then t.created_at <= p_data and (t.expired_at is null or p_data < t.expired_at)
                else t.expired_at is null end
  ),
  pick as (
    (select v.price, 1 as pri from v where p_units between v.qty_start and v.qty_end
      order by v.created_at desc, v.price desc limit 1)
    union all
    (select v.price, 2 from v where v.qty_end < p_units
      order by v.qty_end desc, v.created_at desc, v.price desc limit 1)
    union all
    (select v.price, 3 from v where v.qty_start > p_units
      order by v.qty_start asc, v.created_at desc, v.price desc limit 1)
  )
  select p.price, v_flag from pick p order by p.pri limit 1;
end $$;

-- ---------------------------------------------------------------------
-- 6. Categorias da fatura
-- ---------------------------------------------------------------------
create or replace function analytics.ml_billing_category(p_code text) returns text
language sql immutable as $$
  select case
    when p_code in ('CVVML','BVVML','CVVPRC','BVVPRC','CVVFNU','BVVFNU') then 'comissao'
    when p_code in ('CXDE','BXDE','CXDI','BXDI','CDSB','BDSB','CXDED','BXDED','CDSDB','BDSDB') then 'frete'
    when p_code in ('CFONPN','BFONPN') then 'parcelamento'
    when p_code = 'PADS' then 'product_ads'
    when p_code = 'CDLIT' then 'seguidores'
    when p_code in ('BPAD','BDLIT') then 'estornos_publicidade'
    when p_code in ('CDIFAL','BDIFAL') then 'difal'
    else 'outras'
  end
$$;

drop view if exists analytics.ml_alertas, analytics.ml_meses, analytics.ml_pedidos, analytics.ml_fatura cascade;

-- Linhas da fatura com valor assinado e data de referência
-- (publicidade é cobrada na madrugada seguinte: volta 1 dia)
create view analytics.ml_fatura with (security_invoker = true) as
select d.period_key,
       d.detail_id,
       d.code,
       analytics.ml_billing_category(d.code) as categoria,
       case when d.detail_type = 'BONUS' then -abs(d.amount) else abs(d.amount) end as valor,
       d.order_id,
       ((d.created_at at time zone 'America/Sao_Paulo')::date
         - case when d.code in ('PADS', 'CDLIT') then 1 else 0 end) as data_ref
  from mkt.billing_details d
 where d.channel = 'mercadolivre';

-- ---------------------------------------------------------------------
-- 7. Pedidos com classificação, custos e margem
-- ---------------------------------------------------------------------
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
         string_agg(oi.sku, ', ' order by oi.line_no) as sku,
         min(oi.modelo) as modelo,
         min(oi.cor) as cor,
         min(oi.kit_units) as kit,
         sum(oi.quantity) as qtd,
         sum(oi.units) as unidades,
         sum(oi.unit_price * oi.quantity) as valor_venda,
         sum(coalesce(oi.sale_fee, 0) * oi.quantity) as comissao_estimada,
         sum(c.price * oi.units) as custo_produto_calc,
         string_agg(distinct c.flag, ', ') as alerta_custo
    from mkt.order_items oi
    join base b on b.channel = oi.channel and b.order_id = oi.order_id
    left join lateral analytics.resolve_unit_cost(oi.modelo, b.sale_ts, oi.units) c on true
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
       case when b.classe = 'pago' then i.alerta_custo end as alerta_custo
  from base b
  left join itens i on i.order_id = b.order_id
  left join fat f on f.order_id = b.order_id
  left join envio_faturado ef on ef.shipment_id = b.shipment_id;

-- ---------------------------------------------------------------------
-- 8. Resumo mensal (equivalente ao ml_meses.json da V1)
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 9. Alertas de custo (equivalente ao ml_alertas.json da V1)
-- ---------------------------------------------------------------------
create view analytics.ml_alertas with (security_invoker = true) as
select c.flag as tipo,
       oi.modelo as codigo,
       count(distinct oi.order_id) as qtd_pedidos,
       array_agg(distinct oi.order_id) as pedidos
  from mkt.order_items oi
  join mkt.orders o on o.channel = oi.channel and o.order_id = oi.order_id
  cross join lateral analytics.resolve_unit_cost(oi.modelo, coalesce(o.date_closed, o.date_created), oi.units) c
 where oi.channel = 'mercadolivre' and o.status = 'paid' and c.flag is not null
 group by c.flag, oi.modelo;

grant usage on schema analytics to authenticated;
grant select on analytics.ml_fatura, analytics.ml_pedidos, analytics.ml_meses, analytics.ml_alertas to authenticated;
grant execute on function analytics.resolve_unit_cost(text, timestamptz, integer), analytics.ml_billing_category(text) to authenticated;
