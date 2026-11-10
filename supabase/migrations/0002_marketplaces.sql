-- =====================================================================
-- 0002 — Dados dos marketplaces (Mercado Livre e Shopee na mesma estrutura).
-- A coluna "channel" permite a visão individual e a consolidada.
-- =====================================================================

create table mkt.items (
  channel        text not null,
  item_id        text not null,
  account_id     uuid references core.accounts (id) on delete cascade,
  title          text,
  sku            text,
  price          numeric(14, 2),
  status         text,
  category_id    text,
  listing_type   text,          -- ex.: gold_special (clássico), gold_pro (premium)
  logistic_type  text,          -- ex.: fulfillment (Full), cross_docking, self_service (Flex)
  available_qty  integer,
  sold_qty       integer,
  health         numeric(5, 2),
  permalink      text,
  thumbnail      text,
  date_created   timestamptz,
  updated_at     timestamptz not null default now(),
  raw            jsonb,
  primary key (channel, item_id)
);

create table mkt.item_variations (
  channel       text not null,
  item_id       text not null,
  variation_id  text not null,
  sku           text,
  price         numeric(14, 2),
  available_qty integer,
  sold_qty      integer,
  attributes    jsonb,
  primary key (channel, item_id, variation_id),
  foreign key (channel, item_id) references mkt.items (channel, item_id) on delete cascade
);

create table mkt.orders (
  channel              text not null,
  order_id             text not null,
  account_id           uuid references core.accounts (id) on delete cascade,
  pack_id              text,
  status               text,
  date_created         timestamptz,
  date_closed          timestamptz,
  date_last_updated    timestamptz,
  total_amount         numeric(14, 2),
  paid_amount          numeric(14, 2),
  currency             text,
  buyer_id             text,
  shipment_id          text,
  shipping_cost_seller numeric(14, 2),   -- frete pago pelo vendedor
  tags                 text[],
  raw                  jsonb,
  primary key (channel, order_id)
);
create index on mkt.orders (channel, date_created);
create index on mkt.orders (shipment_id) where shipping_cost_seller is null;

create table mkt.order_items (
  channel      text not null,
  order_id     text not null,
  line_no      integer not null,
  item_id      text,
  variation_id text,
  sku          text,
  title        text,
  quantity     integer,
  unit_price   numeric(14, 2),
  sale_fee     numeric(14, 2),    -- tarifa de venda do marketplace (por unidade)
  listing_type text,
  primary key (channel, order_id, line_no),
  foreign key (channel, order_id) references mkt.orders (channel, order_id) on delete cascade
);
create index on mkt.order_items (channel, item_id);

create table mkt.visits_daily (
  channel text not null,
  item_id text not null,
  day     date not null,
  visits  integer not null default 0,
  primary key (channel, item_id, day)
);

create table mkt.ads_campaigns (
  channel     text not null,
  campaign_id text not null,
  name        text,
  status      text,
  budget      numeric(14, 2),
  acos_target numeric(7, 2),
  raw         jsonb,
  primary key (channel, campaign_id)
);

create table mkt.ads_metrics_daily (
  channel          text not null,
  item_id          text not null,
  day              date not null,
  campaign_id      text,
  impressions      integer,
  clicks           integer,
  cost             numeric(14, 2),
  direct_amount    numeric(14, 2),  -- vendas atribuídas diretamente ao anúncio patrocinado
  indirect_amount  numeric(14, 2),
  direct_units     integer,
  indirect_units   integer,
  organic_units    integer,
  primary key (channel, item_id, day)
);

-- ---------------------------------------------------------------------
-- Segurança: cada usuário só vê os canais liberados no seu perfil
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['items', 'item_variations', 'orders', 'order_items',
                           'visits_daily', 'ads_campaigns', 'ads_metrics_daily']
  loop
    execute format('alter table mkt.%I enable row level security', t);
    execute format(
      'create policy "canal liberado" on mkt.%I for select to authenticated using (core.can_see_channel(channel))', t);
  end loop;
end $$;

grant usage on schema mkt to authenticated;
grant select on all tables in schema mkt to authenticated;
