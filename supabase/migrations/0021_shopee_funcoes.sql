-- =====================================================================
-- 0021 - Shopee nas funcoes do painel: vendas, tarifas, margem e Ads (Tarefa 5 do projeto Shopee).
-- Pode ser reexecutada. Aplicar depois da 0009, 0010, 0019, 0020, 0031 e 0032.
-- ATENCAO: a 0009, a 0010 e a 0019 recriam estas funcoes so com o Mercado Livre. Se uma delas for
-- reaplicada, reaplicar esta depois.
--
-- O Mercado Livre NAO muda: as partes do ML sao as mesmas da 0009/0019 (o teste shopee.test.mjs
-- compara o resultado do ML antes e depois desta migration).
--
-- Regras da Shopee (decisoes do dono, 26/11/2026):
--   * Data da venda = coalesce(date_closed, date_created), como no ML (date_closed = pay_time da Shopee).
--   * Classe: status 'paid' (inclui TO_RETURN, decisao 1) = pago; 'cancelled' com pagamento
--     (date_closed preenchido) = cancelado; cancelado sem pagamento, nao pago e o resto = outro
--     (fora das vendas brutas e da taxa de cancelamento, decisao 2). A Shopee nao tem 'devolvido'
--     nem 'dividido': o reembolso de uma devolucao sai da margem pelo escrow (categoria reembolso).
--   * Tarifas = analytics.shopee_fatura (escrow) de pedido pago e de pedido cancelado depois de pago
--     (decisao do dono, rodada 1: o custo do cancelado e perda do periodo; a venda continua fora da
--     receita). A sincronizacao rele o escrow dos cancelados depois de pagos na janela normal (pedidos
--     criados nos ultimos 30 dias sao relidos a cada execucao, e precisaEscrow inclui esses cancelados;
--     o pago mais antigo que vira cancelado e relido pelos pendentes na mesma execucao).
--     Colunas do painel (mapeamento num lugar so, CTE fat_col):
--       comissao = comissao + taxa_servico + taxa_transacao
--       frete    = frete
--       outras   = cupom_vendedor, campanha, processamento, devolucao, protecao_frete e reembolso
--     parcelamento, product_ads, seguidores, estornos e difal = 0 (nao existem por pedido na Shopee).
--   * Pedido pago ainda SEM escrow: tarifas ESTIMADAS e marcadas (frete_estimado = true, conta em
--     "estimados"): percentual (tarifa / valor dos itens) dos pedidos pagos da Shopee com escrow
--     vendidos nos 90 dias ate a venda (sem pedido nessa janela: todos os pedidos com escrow), por
--     coluna; devolucao e reembolso ficam fora da estimativa (dependem de o pedido ser devolvido).
--     Sem nenhum historico, a estimativa e 0, mas o pedido continua marcado como estimado.
--   * Imposto e embalagem: core.parametros_custo do canal 'shopee' (sem linha = 0).
--   * Sem a permissao 'custos' (decisao 5): tarifas, custo, imposto, embalagem e margem da Shopee
--     voltam nulos (e 'estimados' nao conta a Shopee). O Ads da Shopee continua visivel, como o do ML.
--   * Ads da Shopee: so no nivel da conta (decisao 3). Investimento = mkt.ads_campaign_daily
--     (channel 'shopee', campaign_id 'conta'). Entra em dash_custos_periodo como 'product_ads' (custo do
--     periodo, rateado pela receita nos modelos, como o Ads da API do ML), em dash_ads_periodo e na gemea
--     ads_serie. Sem ranking nem sugestao por produto da Shopee (ads_sugestoes).
--   * Visitas da Shopee: so acumuladas (decisao 4); nenhuma funcao daqui usa visitas.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Pedidos do Mercado Livre: corpo IDENTICO ao de analytics.dash_pedidos_base da 0009.
-- ---------------------------------------------------------------------
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
-- Pedidos da Shopee do PERIODO (mesmas colunas). Regras no cabecalho.
-- ---------------------------------------------------------------------
create or replace function analytics.dash_pedidos_base_shopee(p_de date, p_ate date)
returns table (
  order_id text, classe text, sale_ts timestamptz, data_venda date, sku text, sku_anuncio text,
  qtd integer, unidades integer, valor_venda numeric, receita numeric,
  comissao numeric, frete numeric, parcelamento numeric, product_ads numeric, seguidores numeric,
  estornos numeric, difal numeric, outras numeric, custo_produto numeric, alerta_custo text,
  channel text, imposto numeric, embalagem numeric, frete_estimado boolean
)
language sql stable security invoker set search_path = '' as $$
  with base as materialized (
    select o.order_id,
           coalesce(o.date_closed, o.date_created) as sale_ts,
           case
             when o.status = 'paid' then 'pago'                                       -- inclui TO_RETURN
             when o.status = 'cancelled' and o.date_closed is not null then 'cancelado' -- cancelado depois de pago
             else 'outro'                                                             -- nao pago / cancelado sem pagamento
           end as classe
      from mkt.orders o
     where o.channel = 'shopee'
       and (coalesce(o.date_closed, o.date_created) at time zone 'America/Sao_Paulo')::date between p_de and p_ate
       and (select core.can_see_channel('shopee'))
  ),
  itens as materialized (
    select oi.order_id,
           string_agg(r.sku, ', ' order by oi.line_no) as sku,
           string_agg(oi.sku, ', ' order by oi.line_no) as sku_anuncio,
           sum(oi.quantity) as qtd,
           sum(oi.units) as unidades,
           sum(oi.unit_price * oi.quantity) as valor_venda,
           sum(c.price * oi.units) as custo_produto_calc,
           string_agg(distinct c.flag, ', ') as alerta_custo
      from mkt.order_items oi
      join base b on b.order_id = oi.order_id
     cross join lateral analytics.ref_erp(oi.sku, oi.modelo, oi.cor, b.sale_ts) r
      left join lateral analytics.resolve_unit_cost(r.modelo, b.sale_ts, oi.units) c on true
     where oi.channel = 'shopee'
     group by oi.order_id
  ),
  -- Pedidos pagos ou cancelados depois de pagos que ja tem escrow (qualquer linha, inclusive so o liquido)
  com_escrow as materialized (
    select distinct e.order_id
      from mkt.shopee_escrow e
     where e.order_id in (select b.order_id from base b where b.classe in ('pago', 'cancelado'))
  ),
  -- UNICO lugar do mapeamento categoria do escrow -> coluna do painel (usado por fat e hist)
  fat_col as not materialized (
    select f.order_id, f.categoria, f.valor,
           case when f.categoria in ('comissao', 'taxa_servico', 'taxa_transacao') then 'comissao'
                when f.categoria = 'frete' then 'frete'
                else 'outras'   -- cupom_vendedor, campanha, processamento, devolucao, protecao_frete, reembolso
           end as coluna
      from analytics.shopee_fatura f
  ),
  fat as materialized (
    select f.order_id,
           sum(f.valor) filter (where f.coluna = 'comissao') as comissao,
           sum(f.valor) filter (where f.coluna = 'frete') as frete,
           sum(f.valor) filter (where f.coluna = 'outras') as outras
      from fat_col f
     where f.order_id in (select e.order_id from com_escrow e)
     group by f.order_id
  ),
  p as materialized (
    select b.order_id, b.classe, b.sale_ts,
           (b.sale_ts at time zone 'America/Sao_Paulo')::date as data_venda,
           i.sku, i.sku_anuncio,
           coalesce(i.qtd, 0)::integer as qtd,
           coalesce(i.unidades, 0)::integer as unidades,
           coalesce(i.valor_venda, 0) as valor_venda,
           case when b.classe = 'pago' then coalesce(i.valor_venda, 0) else 0 end as receita,
           case when b.classe = 'pago' then coalesce(i.custo_produto_calc, 0) else 0 end as custo_produto,
           case when b.classe = 'pago' then i.alerta_custo end as alerta_custo,
           (b.classe = 'pago' and e.order_id is null) as estimar,
           coalesce(f.comissao, 0) as comissao, coalesce(f.frete, 0) as frete, coalesce(f.outras, 0) as outras
      from base b
      left join itens i on i.order_id = b.order_id
      left join com_escrow e on e.order_id = b.order_id
      left join fat f on f.order_id = b.order_id
  ),
  -- Base da estimativa: pedidos pagos da Shopee com escrow (so calculada se houver pedido a estimar
  -- e permissao de custos). Devolucao e reembolso ficam fora (so existem em pedido devolvido).
  hist as materialized (
    select coalesce(o.date_closed, o.date_created) as sale_ts, v.valor_venda, h.comissao, h.frete, h.outras
      from mkt.orders o
      join (select oi.order_id, sum(oi.unit_price * oi.quantity) as valor_venda
              from mkt.order_items oi
             where oi.channel = 'shopee'
             group by oi.order_id) v on v.order_id = o.order_id
      join (select f.order_id,
                   coalesce(sum(f.valor) filter (where f.coluna = 'comissao'), 0) as comissao,
                   coalesce(sum(f.valor) filter (where f.coluna = 'frete'), 0) as frete,
                   coalesce(sum(f.valor) filter (where f.coluna = 'outras'), 0) as outras
              from fat_col f
             where f.categoria not in ('devolucao', 'reembolso')
             group by f.order_id) h on h.order_id = o.order_id
     where o.channel = 'shopee' and o.status = 'paid' and v.valor_venda > 0
       and (select core.has_perm('custos'))
       and exists (select 1 from p where p.estimar)
  ),
  todos as materialized (
    select sum(h.comissao) / sum(h.valor_venda) as c, sum(h.frete) / sum(h.valor_venda) as f,
           sum(h.outras) / sum(h.valor_venda) as o
      from hist h
  ),
  est as (
    select p.order_id,
           coalesce(j.c, t.c, 0) * p.valor_venda as comissao,
           coalesce(j.f, t.f, 0) * p.valor_venda as frete,
           coalesce(j.o, t.o, 0) * p.valor_venda as outras
      from p
     cross join todos t
      left join lateral (
        select sum(h.comissao) / sum(h.valor_venda) as c, sum(h.frete) / sum(h.valor_venda) as f,
               sum(h.outras) / sum(h.valor_venda) as o
          from hist h
         where h.sale_ts <= p.sale_ts and h.sale_ts > p.sale_ts - interval '90 days'
      ) j on true
     where p.estimar
  )
  select p.order_id::text, p.classe::text, p.sale_ts::timestamptz, p.data_venda, p.sku::text, p.sku_anuncio::text,
         p.qtd, p.unidades, p.valor_venda::numeric, p.receita::numeric,
         case when not v.ve then null when p.estimar then coalesce(es.comissao, 0) else p.comissao end::numeric,
         case when not v.ve then null when p.estimar then coalesce(es.frete, 0) else p.frete end::numeric,
         case when v.ve then 0 end::numeric,
         case when v.ve then 0 end::numeric,
         case when v.ve then 0 end::numeric,
         case when v.ve then 0 end::numeric,
         case when v.ve then 0 end::numeric,
         case when not v.ve then null when p.estimar then coalesce(es.outras, 0) else p.outras end::numeric,
         case when v.ve then p.custo_produto::numeric end,
         case when v.ve then p.alerta_custo::text end,
         'shopee'::text,
         case when not v.ve then null
              when p.classe = 'pago' then p.receita * coalesce(pc.imposto_pct, 0) / 100 else 0 end,
         case when not v.ve then null
              when p.classe = 'pago' then coalesce(pc.embalagem_pedido, 0) + coalesce(pc.embalagem_peca, 0) * p.unidades
              else 0 end,
         (v.ve and p.estimar)
    from p
   cross join (select core.has_perm('custos') as ve) v
    left join est es on es.order_id = p.order_id
    left join lateral (
      select c.imposto_pct, c.embalagem_pedido, c.embalagem_peca
        from core.parametros_custo c
       where c.channel = 'shopee' and c.vigente_desde <= p.data_venda
       order by c.vigente_desde desc
       limit 1
    ) pc on true
$$;

-- ---------------------------------------------------------------------
-- Base de pedidos do periodo: Mercado Livre (como na 0009) + Shopee. Mesma assinatura e colunas.
-- ---------------------------------------------------------------------
create or replace function analytics.dash_pedidos_base(p_de date, p_ate date)
returns table (
  order_id text, classe text, sale_ts timestamptz, data_venda date, sku text, sku_anuncio text,
  qtd integer, unidades integer, valor_venda numeric, receita numeric,
  comissao numeric, frete numeric, parcelamento numeric, product_ads numeric, seguidores numeric,
  estornos numeric, difal numeric, outras numeric, custo_produto numeric, alerta_custo text,
  channel text, imposto numeric, embalagem numeric, frete_estimado boolean
)
language sql stable security invoker set search_path = '' as $$
  select * from analytics.dash_pedidos_base_ml(p_de, p_ate)
  union all
  select * from analytics.dash_pedidos_base_shopee(p_de, p_ate)
$$;

-- ---------------------------------------------------------------------
-- Custos do periodo sem pedido. Mercado Livre igual a 0009 (fatura sem pedido + Product Ads da API);
-- Shopee: Ads da conta (campaign_id 'conta') como 'product_ads'.
-- ---------------------------------------------------------------------
create or replace function analytics.dash_custos_periodo(p_canal text, p_de date, p_ate date)
returns table (categoria text, valor numeric)
language sql stable security invoker set search_path = '' as $$
  with api as (
    select min(a.day) as d from mkt.ads_campaign_daily a where a.channel = 'mercadolivre'
  )
  select x.categoria, sum(x.valor)
    from (
      select y.categoria, y.valor
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
        ) y
       where p_canal in ('consolidado', 'mercadolivre')
         and core.can_see_channel('mercadolivre')
      union all
      select 'product_ads', a.cost
        from mkt.ads_campaign_daily a
       where a.channel = 'shopee' and a.campaign_id = 'conta' and a.day between p_de and p_ate
         and p_canal in ('consolidado', 'shopee')
         and core.can_see_channel('shopee')
    ) x
   group by x.categoria
$$;

-- ---------------------------------------------------------------------
-- Ads do periodo para QUALQUER perfil que veja o canal (security definer, como na 0009).
-- Mercado Livre: mesma conta da 0009 (fatura ligada a pedido + Product Ads de dash_custos_periodo do ML).
-- Shopee: Ads da conta (mkt.ads_campaign_daily, 'conta'). Consolidado = soma.
-- A gemea analytics.ads_serie repete esta regra dia a dia: quem mudar uma muda a outra.
-- ---------------------------------------------------------------------
create or replace function analytics.dash_ads_periodo(p_canal text, p_de date, p_ate date)
returns numeric
language sql stable security definer set search_path = '' as $$
  select case
    when p_canal in ('consolidado', 'mercadolivre') and core.can_see_channel('mercadolivre') then
      coalesce((select sum(f.valor)
                  from analytics.ml_fatura f
                  join mkt.orders o on o.channel = 'mercadolivre' and o.order_id = f.order_id
                 where f.categoria = 'product_ads'
                   and (coalesce(o.date_closed, o.date_created) at time zone 'America/Sao_Paulo')::date between p_de and p_ate), 0)
      + coalesce((select sum(c.valor) from analytics.dash_custos_periodo('mercadolivre', p_de, p_ate) c
                   where c.categoria = 'product_ads'), 0)
    else 0
  end
  + case
    when p_canal in ('consolidado', 'shopee') and core.can_see_channel('shopee') then
      coalesce((select sum(a.cost)
                  from mkt.ads_campaign_daily a
                 where a.channel = 'shopee' and a.campaign_id = 'conta' and a.day between p_de and p_ate), 0)
    else 0
  end
$$;

-- ---------------------------------------------------------------------
-- Resumo do periodo: igual a 0009, mas sem a permissao 'custos' as tarifas da Shopee voltam nulas
-- quando p_canal = 'shopee' (no consolidado, ficam so as do ML, como antes).
-- ---------------------------------------------------------------------
create or replace function analytics.dash_resumo(p_canal text, p_de date, p_ate date)
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
           core.has_perm('custos') as ve_custos,
           (p_canal = 'shopee' and not core.has_perm('custos')) as oculta
      from v, c
  )
  select t.pedidos, t.vendas_brutas, t.unidades,
         case when t.pedidos > 0 then round(t.vendas_brutas / t.pedidos, 2) else 0 end,
         t.cancelados, t.devolvidos,
         case when t.pedidos > 0 then round((t.cancelados + t.devolvidos) * 100.0 / t.pedidos, 2) else 0 end,
         t.receita,
         case when not t.oculta then t.t_comissao end,
         case when not t.oculta then t.t_frete end,
         case when not t.oculta then t.t_parcelamento end,
         t.t_product_ads,
         case when not t.oculta then t.t_seguidores end,
         case when not t.oculta then t.t_estornos end,
         case when not t.oculta then t.t_difal end,
         case when not t.oculta then t.t_outras end,
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
-- Metas: igual a 0010, com o realizado (receita dos pedidos pagos) tambem para a Shopee.
-- ---------------------------------------------------------------------
create or replace function analytics.dash_metas(p_canal text, p_ano integer,
                                                p_hoje date default (now() at time zone 'America/Sao_Paulo')::date)
returns table (mes date, situacao text, realizado numeric, crescimento_pct numeric,
               crescimento_editado boolean, projecao numeric, meta numeric)
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_atual  date := date_trunc('month', p_hoje)::date;
  v_inicio date := (date_trunc('month', p_hoje) - interval '12 months')::date;
  v_fim    date := make_date(p_ano, 12, 1);
  v_m      date;
  v_base   numeric := 0;
  v_proj   numeric;
  v_cresc  numeric;
  v_edit   boolean;
  v_meses  date[] := '{}';
  v_vals   numeric[] := '{}';
  v_i      integer;
begin
  if not core.has_perm('metas') then
    return;
  end if;

  if p_canal = 'consolidado' then
    return query
      select d.mes,
             min(d.situacao),
             sum(d.realizado),
             null::numeric,
             null::boolean,
             sum(d.projecao),
             sum(d.meta)
        from (
          select * from analytics.dash_metas('mercadolivre', p_ano, p_hoje)
          union all select * from analytics.dash_metas('shopee', p_ano, p_hoje)
          union all select * from analytics.dash_metas('brindedobem', p_ano, p_hoje)
        ) d
       group by d.mes
       order by d.mes;
    return;
  end if;

  -- Receita mensal calculada UMA vez (a base de pedidos e cara); so canais com vendas no painel.
  if p_canal in ('mercadolivre', 'shopee') then
    select coalesce(array_agg(x.m order by x.m), '{}'), coalesce(array_agg(x.r order by x.m), '{}')
      into v_meses, v_vals
      from (select date_trunc('month', b.data_venda)::date as m, sum(b.receita) as r
              from analytics.dash_pedidos_base(v_inicio, (v_atual + interval '1 month' - interval '1 day')::date) b
             where b.channel = p_canal and b.data_venda >= v_inicio and b.data_venda < (v_atual + interval '1 month')
             group by 1) x;
  end if;

  v_m := v_inicio;
  while v_m <= v_fim loop
    mes := v_m;
    meta := (select mt.valor from core.metas mt
              where mt.channel = p_canal and mt.ano = extract(year from v_m) and mt.mes = extract(month from v_m));

    if v_m <= v_atual then
      v_i := array_position(v_meses, v_m);
      realizado := coalesce(case when v_i is null then 0 else v_vals[v_i] end, 0);
    else
      realizado := null;
    end if;

    if v_m < v_atual then
      situacao := 'realizado';
      crescimento_pct := null;
      crescimento_editado := null;
      projecao := null;
      v_base := realizado;
    else
      situacao := case when v_m = v_atual then 'em_andamento' else 'projetado' end;
      select p.crescimento_pct into v_cresc
        from core.premissas_projecao p
       where p.channel = p_canal and p.ano = extract(year from v_m) and p.mes = extract(month from v_m);
      v_edit := found;
      if not v_edit then
        v_cresc := coalesce((select p.crescimento_pct from core.premissas_projecao p
                              where p.channel = p_canal and p.ano = extract(year from v_m) and p.mes is null), 0);
      end if;
      v_proj := coalesce(v_proj, v_base) * (1 + v_cresc / 100);
      crescimento_pct := v_cresc;
      crescimento_editado := v_edit;
      projecao := round(v_proj, 2);
    end if;

    return next;
    v_m := (v_m + interval '1 month')::date;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Cartoes do Ads (igual a 0019). Muda so a consulta leve das vendas brutas: passa a trazer a Shopee
-- com a mesma classificacao de dash_pedidos_base_shopee (pago, ou cancelado com pagamento).
-- O investimento (dash_ads_periodo) ja inclui a Shopee: ROAS/ACOS/TACOS e "nao atribuido" do
-- consolidado ficam coerentes (o gasto da conta Shopee cai em "nao atribuido", nunca negativo).
-- ---------------------------------------------------------------------
create or replace function analytics.ads_resumo(p_canal text, p_de date, p_ate date, p_detalhe boolean default true)
returns table (investimento numeric, vendas_ads numeric, roas numeric, acos numeric, tacos numeric,
               pct_vendas_ads numeric, vendas_brutas_canal numeric, nao_atribuido numeric, tem_detalhe boolean)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  v_inv  numeric := 0;
  v_vend numeric := 0;
  v_vb   numeric := 0;
  v_atr  numeric := 0;
  v_det  boolean := false;
begin
  if not core.has_perm('ads') or coalesce(p_canal, '') not in ('consolidado', 'mercadolivre', 'shopee') then
    return query select 0::numeric, 0::numeric, null::numeric, null::numeric, null::numeric, null::numeric,
                        0::numeric, 0::numeric, false;
    return;
  end if;

  v_inv := coalesce(analytics.dash_ads_periodo(p_canal, p_de, p_ate), 0);

  select coalesce(sum(coalesce(m.direct_amount, 0) + coalesce(m.indirect_amount, 0)), 0), count(*) > 0
    into v_vend, v_det
    from mkt.ads_metrics_daily m
   where m.day between p_de and p_ate
     and (p_canal = 'consolidado' and m.channel in ('mercadolivre', 'shopee') or m.channel = p_canal);

  -- Consulta leve (sem o custo por item de dash_pedidos_base), mesma classificacao:
  --   Mercado Livre: pago, ou cancelado que nao seja carrinho dividido (cancelado + devolvido);
  --   Shopee: pago, ou cancelado depois de pago (date_closed = pagamento).
  -- Data da venda em Brasilia. Mesmo escopo de dash_resumo.
  select coalesce(sum(oi.unit_price * oi.quantity), 0)
    into v_vb
    from mkt.orders o
    join mkt.order_items oi on oi.channel = o.channel and oi.order_id = o.order_id
   where o.channel in ('mercadolivre', 'shopee')
     and (p_canal = 'consolidado' or o.channel = p_canal)
     and o.channel = any ((select core.my_channels())::text[])
     and (coalesce(o.date_closed, o.date_created) at time zone 'America/Sao_Paulo')::date between p_de and p_ate
     and ((o.channel = 'mercadolivre'
           and (o.status = 'paid'
                or (o.status = 'cancelled'
                    and coalesce(o.cancel_detail_code, '') <> 'pack_splitted'
                    and coalesce(o.shipment_substatus, '') <> 'pack_splitted')))
          or (o.channel = 'shopee'
              and (o.status = 'paid' or (o.status = 'cancelled' and o.date_closed is not null))));

  if v_det and coalesce(p_detalhe, true) then
    select coalesce(sum(a.investimento), 0) into v_atr
      from analytics.ads_metricas_modelo(p_canal, p_de, p_ate) a
     where a.modelo is not null;
  end if;

  return query select
    round(v_inv, 2),
    round(v_vend, 2),
    case when v_inv > 0 then round(v_vend / v_inv, 2) end,
    case when v_vend > 0 then round(v_inv / v_vend * 100, 2) end,
    case when v_vb > 0 then round(v_inv / v_vb * 100, 2) end,
    case when v_vb > 0 then round(v_vend / v_vb * 100, 2) end,
    round(v_vb, 2),
    case when coalesce(p_detalhe, true) then round(v_inv - v_atr, 2) end,
    v_det;
end $$;

-- ---------------------------------------------------------------------
-- Serie diaria do Ads: igual a 0019 + o Ads da conta Shopee (gemea de dash_ads_periodo:
-- a soma dos dias = dash_ads_periodo). EXCECAO DOCUMENTADA (security definer), como na 0019:
-- exige core.has_perm('ads') e respeita core.can_see_channel / core.my_channels() explicitamente.
-- ---------------------------------------------------------------------
create or replace function analytics.ads_serie(p_canal text, p_de date, p_ate date)
returns table (dia date, investimento numeric, vendas_ads numeric)
language sql stable security definer set search_path = '' as $$
  with ok as materialized (
    select core.has_perm('ads') and coalesce(p_canal, '') in ('consolidado', 'mercadolivre', 'shopee') as ads,
           coalesce(p_canal, '') in ('consolidado', 'mercadolivre') and core.can_see_channel('mercadolivre') as ml,
           coalesce(p_canal, '') in ('consolidado', 'shopee') and core.can_see_channel('shopee') as sh,
           core.my_channels() as canais
  ),
  api as materialized (
    select min(a.day) as d from mkt.ads_campaign_daily a where a.channel = 'mercadolivre'
  ),
  inv as materialized (
    select (coalesce(o.date_closed, o.date_created) at time zone 'America/Sao_Paulo')::date as dia, f.valor
      from analytics.ml_fatura f
      join mkt.orders o on o.channel = 'mercadolivre' and o.order_id = f.order_id
     where (select ok.ads and ok.ml from ok)
       and f.categoria = 'product_ads'
       and (coalesce(o.date_closed, o.date_created) at time zone 'America/Sao_Paulo')::date between p_de and p_ate
    union all
    select f.data_ref, f.valor
      from analytics.ml_fatura f
     where (select ok.ads and ok.ml from ok)
       and f.order_id is null and f.categoria = 'product_ads'
       and f.data_ref between p_de and p_ate
       and f.data_ref < coalesce((select api.d from api), 'infinity'::date)
    union all
    select a.day, a.cost
      from mkt.ads_campaign_daily a
     where (select ok.ads and ok.ml from ok)
       and a.channel = 'mercadolivre' and a.day between p_de and p_ate
    union all
    select a.day, a.cost
      from mkt.ads_campaign_daily a
     where (select ok.ads and ok.sh from ok)
       and a.channel = 'shopee' and a.campaign_id = 'conta' and a.day between p_de and p_ate
  ),
  vend as materialized (
    select m.day as dia, sum(coalesce(m.direct_amount, 0) + coalesce(m.indirect_amount, 0)) as valor
      from mkt.ads_metrics_daily m
     where (select ok.ads from ok)
       and m.day between p_de and p_ate
       and (p_canal = 'consolidado' and m.channel in ('mercadolivre', 'shopee') or m.channel = p_canal)
       and m.channel = any ((select ok.canais from ok)::text[])
     group by m.day
  ),
  inv_dia as (
    select i.dia, sum(i.valor) as valor from inv i group by i.dia
  )
  select e.d::date, round(coalesce(i.valor, 0), 2), round(coalesce(v.valor, 0), 2)
    from generate_series(p_de::timestamp, p_ate::timestamp, interval '1 day') e(d)
    left join inv_dia i on i.dia = e.d::date
    left join vend v on v.dia = e.d::date
   where (select ok.ads from ok)
   order by 1
$$;

revoke execute on function analytics.ads_serie(text, date, date) from public, anon;
grant execute on function analytics.ads_serie(text, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- Sugestao por modelo: igual a 0019 para o Mercado Livre. Shopee: nenhuma linha (sem Ads por produto,
-- decisao 3). Consolidado: as sugestoes do Mercado Livre (a Shopee nao gera sugestao por produto e as
-- vendas dela nao mudam a regra do Ads do ML).
-- ---------------------------------------------------------------------
create or replace function analytics.ads_sugestoes(p_canal text, p_ate date)
returns table (modelo text, canal text, sugestao text, motivo text, pausado boolean,
               investimento_30d numeric, cliques_30d numeric, vendas_ads_30d numeric, unidades_ads_30d numeric,
               conversao_30d numeric, acos_30d numeric, acos_equilibrio_30d numeric, contribuicao_pct_30d numeric,
               lucro_pos_ads_30d numeric, unidades_pagas_30d numeric, dias_com_dados integer)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  v_de date := p_ate - 29;
  v_ve boolean;
begin
  if p_ate is null or not core.has_perm('ads') or coalesce(p_canal, '') not in ('consolidado', 'mercadolivre', 'shopee') then
    return;
  end if;
  -- Shopee: Ads so no nivel da conta, sem sugestao por produto (decisao 3 do dono).
  if p_canal = 'shopee' then
    return;
  end if;
  -- Daqui em diante p_canal e 'mercadolivre' ou 'consolidado', e os dois dao as sugestoes do Mercado Livre
  -- (unico canal com Ads por produto), com a margem e as unidades do proprio ML: tudo abaixo e so do ML.
  v_ve := core.has_perm('custos');

  return query
  with itens as materialized (
    select i.* from analytics.dash_itens('mercadolivre', v_de, p_ate) i
  ),
  met as materialized (
    select m.channel, m.item_id, m.day, m.campaign_id,
           coalesce(m.cost, 0) as inv, coalesce(m.clicks, 0) as cli,
           coalesce(m.direct_amount, 0) + coalesce(m.indirect_amount, 0) as vend,
           coalesce(m.direct_units, 0) + coalesce(m.indirect_units, 0) as un
      from mkt.ads_metrics_daily m
     where m.day between v_de and p_ate
       and m.channel = 'mercadolivre'
  ),
  vendas as materialized (
    -- passo 1 de ads_peso_modelo, com o dash_itens desta funcao
    select 'mercadolivre'::text as channel, i.item_id, i.modelo, sum(i.qtd)::numeric as unid
      from itens i
     where i.classe in ('pago', 'cancelado', 'devolvido') and i.modelo is not null
       and exists (select 1 from met a where a.channel = 'mercadolivre' and a.item_id = i.item_id)
     group by i.item_id, i.modelo
    having sum(i.qtd) > 0
  ),
  pesos as materialized (
    select v.channel, v.item_id, v.modelo, v.unid / sum(v.unid) over (partition by v.channel, v.item_id) as peso
      from vendas v
    union all
    select s.channel, s.item_id, s.modelo, s.peso
      from analytics.ads_peso_sem_venda('mercadolivre', v_de, p_ate,
                                        array(select distinct v.channel || ':' || v.item_id from vendas v)) s
  ),
  anuncio as materialized (
    -- anuncio pausado (ele ou a campanha dele), como ads_modelos
    select a.channel, a.item_id,
           coalesce(lower(an.status) = 'paused', false) or coalesce(lower(c.status) = 'paused', false) as pausado
      from (select m.channel, m.item_id,
                   (array_agg(m.campaign_id order by m.day desc) filter (where m.campaign_id is not null))[1] as campaign_id
              from met m
             group by m.channel, m.item_id) a
      left join mkt.ads_anuncios an on an.channel = a.channel and an.item_id = a.item_id
      left join mkt.ads_campaigns c on c.channel = a.channel and c.campaign_id = coalesce(a.campaign_id, an.campaign_id)
  ),
  am as materialized (
    select m.channel, m.item_id, m.day, p.modelo,
           m.inv * p.peso as inv, m.cli * p.peso as cli, m.vend * p.peso as vend, m.un * p.peso as un
      from met m
      join pesos p on p.channel = m.channel and p.item_id = m.item_id
     where p.modelo is not null
  ),
  pm as (
    select am.channel, am.modelo, round(sum(am.inv), 2) as inv, sum(am.cli) as cli,
           round(sum(am.vend), 2) as vend, sum(am.un) as un
      from am
     group by am.channel, am.modelo
  ),
  ads_mod as materialized (
    select pm.modelo, sum(pm.inv) as inv, sum(pm.cli) as cli, sum(pm.vend) as vend, sum(pm.un) as un,
           (array_agg(pm.channel order by pm.inv desc, pm.channel))[1] as canal
      from pm
     group by pm.modelo
  ),
  dias as (
    select am.modelo, count(distinct am.day)::integer as dias from am group by am.modelo
  ),
  pau as (
    select x.modelo, bool_and(an.pausado) as pausado
      from (select distinct am.channel, am.item_id, am.modelo from am) x
      join anuncio an on an.channel = x.channel and an.item_id = x.item_id
     group by x.modelo
  ),
  vm as materialized (
    -- vendas por modelo na janela (como dash_modelos, sem o rateio)
    select i.modelo, sum(i.receita) as receita, sum(i.custo) as custo, sum(i.tarifas) as tarifas, sum(i.impemb) as impemb,
           coalesce(bool_or(i.sem_custo), false) as sem_custo,
           coalesce(sum(i.qtd) filter (where i.classe = 'pago'), 0) as pagas
      from itens i
     group by i.modelo
  ),
  cp as materialized (
    -- custos do periodo (rateio de dash_modelos) e a parte product_ads (devolvida no equilibrio, R2)
    select coalesce(sum(c.valor), 0) as total,
           coalesce(sum(c.valor) filter (where c.categoria = 'product_ads'), 0) as ads,
           (select coalesce(sum(v.receita), 0) from vm v) as receita
      from analytics.dash_custos_periodo('mercadolivre', v_de, p_ate) c
  ),
  fped as materialized (
    -- Product Ads da fatura ligada a pedidos da janela (pela data da venda), como ads_modelos
    select o.order_id, coalesce(o.date_closed, o.date_created) as sale_ts, sum(f.valor) as ads
      from analytics.ml_fatura f
      join mkt.orders o on o.channel = 'mercadolivre' and o.order_id = f.order_id
     where v_ve
       and f.categoria = 'product_ads'
       and (coalesce(o.date_closed, o.date_created) at time zone 'America/Sao_Paulo')::date between v_de and p_ate
     group by o.order_id, coalesce(o.date_closed, o.date_created)
  ),
  fat_mod as (
    select r.modelo,
           sum(fp.ads * case when t.vv > 0 then oi.unit_price * oi.quantity / t.vv else 1.0 / t.n end) as ads
      from fped fp
      join mkt.order_items oi on oi.channel = 'mercadolivre' and oi.order_id = fp.order_id
     cross join lateral (select sum(x.unit_price * x.quantity) as vv, count(*) as n
                           from mkt.order_items x
                          where x.channel = 'mercadolivre' and x.order_id = fp.order_id) t
     cross join lateral analytics.ref_erp(oi.sku, oi.modelo, oi.cor, fp.sale_ts) r
     group by r.modelo
  ),
  uni as (
    select a.modelo from ads_mod a
    union
    select v.modelo from vm v where v.modelo is not null and v.pagas > 0
  ),
  base as (
    select u.modelo,
           coalesce(a.canal, 'mercadolivre') as canal,
           coalesce(a.inv, 0) as inv, coalesce(a.cli, 0) as cli_b, coalesce(a.vend, 0) as vend, coalesce(a.un, 0) as un_b,
           coalesce(d.dias, 0) as dias, coalesce(pa.pausado, false) as pausado,
           coalesce(v.pagas, 0) as pagas, coalesce(v.receita, 0) as receita,
           v_ve and coalesce(v.sem_custo, false) as sem_custo,
           case when not v_ve then null
                when v.modelo is null then 0                  -- Ads sem venda na janela
                when v.sem_custo then null                    -- modelo sem custo
                else v.receita - v.custo - v.tarifas - v.impemb
                     - case when cp.receita > 0 then (cp.total - cp.ads) * v.receita / cp.receita else 0 end
                     + coalesce(fm.ads, 0)
           end as antes
      from uni u
      left join ads_mod a on a.modelo = u.modelo
      left join dias d on d.modelo = u.modelo
      left join pau pa on pa.modelo = u.modelo
      left join vm v on v.modelo = u.modelo
      left join fat_mod fm on fm.modelo = u.modelo
     cross join cp
  ),
  calc as (
    select b.*, round(b.cli_b, 2) as cli, round(b.un_b, 2) as un,
           case when b.cli_b > 0 then round(b.un_b / b.cli_b * 100, 2) end as conv,
           case when b.vend > 0 then round(b.inv / b.vend * 100, 2) end as acos,
           case when b.receita > 0 then round(b.antes / b.receita * 100, 2) end as eqb
      from base b
  ),
  regra as (
    select c.*, pa.vigente_desde, pa.pausar_gasto_min, pa.pausar_cliques_min, pa.min_dias_dados,
           pa.revisar_cliques_min, pa.revisar_conversao_max_pct, pa.escalar_folga_pp, pa.escalar_unidades_min,
           pa.testar_margem_min_pct, pa.testar_unidades_min
      from calc c
      left join lateral analytics.ads_parametros(c.canal, p_ate) pa on true   -- sem linha vigente: sugestao nula
  ),
  dec as (
    select r.*,
           case
             when r.pausado or r.vigente_desde is null then null
             when (r.inv >= r.pausar_gasto_min or r.cli >= r.pausar_cliques_min)
                  and r.un = 0 and r.dias >= r.min_dias_dados then 'pausar'
             when r.acos is not null and r.eqb is not null and r.acos > r.eqb then 'reduzir'
             when r.cli >= r.revisar_cliques_min and r.conv < r.revisar_conversao_max_pct then 'revisar'
             when r.acos is not null and r.eqb is not null and r.acos <= r.eqb - r.escalar_folga_pp
                  and r.un >= r.escalar_unidades_min then 'escalar'
             when r.eqb is not null and r.inv = 0 and r.eqb >= r.testar_margem_min_pct
                  and r.pagas >= r.testar_unidades_min then 'testar'
             when v_ve then 'manter'
           end as sug
      from regra r
  )
  select d.modelo, d.canal, d.sug,
         case d.sug
           when 'pausar' then
             case when d.inv >= d.pausar_gasto_min
                  then format('gastou R$ %s em 30 dias sem venda', analytics.ads_fmt(d.inv))
                  else format('%s em 30 dias sem venda (gastou R$ %s)', analytics.ads_qtd(d.cli, 'clique', 'cliques'), analytics.ads_fmt(d.inv))
             end
           when 'reduzir' then format('ACOS %s%% acima do equilíbrio %s%%', analytics.ads_fmt(d.acos), analytics.ads_fmt(d.eqb))
           when 'revisar' then format('%s e conversão %s%% (abaixo de %s%%)',
                                      analytics.ads_qtd(d.cli, 'clique', 'cliques'), analytics.ads_fmt(d.conv), analytics.ads_fmt(d.revisar_conversao_max_pct))
           when 'escalar' then format('ACOS %s%% bem abaixo do equilíbrio %s%% com %s por Ads',
                                      analytics.ads_fmt(d.acos), analytics.ads_fmt(d.eqb), analytics.ads_qtd(d.un, 'unidade vendida', 'unidades vendidas'))
           when 'testar' then format('margem %s%% e %s sem Ads', analytics.ads_fmt(d.eqb), analytics.ads_qtd(d.pagas, 'unidade vendida', 'unidades vendidas'))
           when 'manter' then   -- diz por que nenhuma regra disparou
             case when (d.inv >= d.pausar_gasto_min or d.cli >= d.pausar_cliques_min) and d.un = 0
                    then format('%s em 30 dias sem venda, mas só %s com dados; mínimo %s',
                                case when d.inv >= d.pausar_gasto_min then format('gastou R$ %s', analytics.ads_fmt(d.inv))
                                     else analytics.ads_qtd(d.cli, 'clique', 'cliques') end,
                                analytics.ads_qtd(d.dias, 'dia', 'dias'), d.min_dias_dados)
                  when d.sem_custo and d.inv > 0
                    then format('sem custo cadastrado, sem ACOS de equilíbrio: investiu R$ %s em 30 dias e vendeu %s por Ads',
                                analytics.ads_fmt(d.inv), analytics.ads_qtd(d.un, 'unidade', 'unidades'))
                  when d.sem_custo
                    then format('sem custo cadastrado e sem investimento em Ads em 30 dias; %s',
                                analytics.ads_qtd(d.pagas, 'unidade vendida', 'unidades vendidas'))
                  when d.acos is not null and d.eqb is not null and d.acos <= d.eqb - d.escalar_folga_pp
                    then format('ACOS %s%% bem abaixo do equilíbrio %s%%, mas só %s por Ads; mínimo %s',
                                analytics.ads_fmt(d.acos), analytics.ads_fmt(d.eqb), analytics.ads_qtd(d.un, 'unidade vendida', 'unidades vendidas'),
                                d.escalar_unidades_min)
                  when d.acos is not null and d.eqb is not null
                    then format('ACOS %s%% dentro do equilíbrio %s%%, sem folga de %s pontos para escalar',
                                analytics.ads_fmt(d.acos), analytics.ads_fmt(d.eqb), analytics.ads_fmt(d.escalar_folga_pp))
                  when d.inv > 0 and d.vend = 0
                    then format('investiu R$ %s e teve %s em 30 dias sem venda, abaixo dos limites para pausar (R$ %s ou %s)',
                                analytics.ads_fmt(d.inv), analytics.ads_qtd(d.cli, 'clique', 'cliques'),
                                analytics.ads_fmt(d.pausar_gasto_min), analytics.ads_qtd(d.pausar_cliques_min::numeric, 'clique', 'cliques'))
                  when d.inv > 0
                    then format('ACOS %s%% sem ACOS de equilíbrio (sem venda paga em 30 dias)', analytics.ads_fmt(d.acos))
                  when d.eqb is not null and d.eqb < d.testar_margem_min_pct
                    then format('sem Ads em 30 dias: margem %s%% abaixo do mínimo de %s%% para testar',
                                analytics.ads_fmt(d.eqb), analytics.ads_fmt(d.testar_margem_min_pct))
                  when d.eqb is not null
                    then format('sem Ads em 30 dias: margem %s%%, mas só %s; mínimo %s para testar',
                                analytics.ads_fmt(d.eqb), analytics.ads_qtd(d.pagas, 'unidade vendida', 'unidades vendidas'), d.testar_unidades_min)
                  else format('sem Ads em 30 dias e sem margem calculada; %s', analytics.ads_qtd(d.pagas, 'unidade vendida', 'unidades vendidas'))
             end
         end,
         d.pausado, d.inv, d.cli, d.vend, d.un, d.conv, d.acos, d.eqb, d.eqb,
         case when d.antes is not null then round(d.antes - d.inv, 2) end,
         d.pagas::numeric, d.dias
    from dec d
   order by d.modelo;
end $$;


-- ---------------------------------------------------------------------
-- Tabela por modelo: igual a 0019, mas as vendas por modelo (dash_modelos) passam a valer tambem para a
-- Shopee. O Ads da conta Shopee nao e atribuido a modelo: fica na linha final "nao atribuido"
-- (investimento do cartao - atribuido), assim a soma da tabela continua = cartao. Shopee sem sugestao.
-- Consolidado: lucro apos Ads e margem somam os dois canais, mas o ACOS de equilibrio e o do Mercado
-- Livre (mesma base de ads_sugestoes, decisao do dono na rodada 1).
-- ---------------------------------------------------------------------
create or replace function analytics.ads_modelos(p_canal text, p_de date, p_ate date)
returns table (modelo text, produto text, foto text, investimento numeric, impressoes numeric, cliques numeric,
               ctr numeric, cpc numeric, conversao numeric, vendas_ads numeric, unidades_ads numeric, acos numeric,
               acos_equilibrio numeric, lucro_pos_ads numeric, contribuicao_pct numeric, sugestao text, motivo text,
               pausado boolean, campanha_id text, modo text)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  v_inv numeric;
  v_ve  boolean;
begin
  if not core.has_perm('ads') or coalesce(p_canal, '') not in ('consolidado', 'mercadolivre', 'shopee') then
    return;
  end if;
  v_inv := coalesce(analytics.dash_ads_periodo(p_canal, p_de, p_ate), 0);
  v_ve := core.has_perm('custos');

  return query
  with met as materialized (
    -- metricas por anuncio no periodo (filtro de periodo primeiro)
    select m.channel, m.item_id,
           sum(coalesce(m.cost, 0)) as inv,
           sum(coalesce(m.impressions, 0)) as imp,
           sum(coalesce(m.clicks, 0)) as cli,
           sum(coalesce(m.direct_amount, 0) + coalesce(m.indirect_amount, 0)) as vend,
           sum(coalesce(m.direct_units, 0) + coalesce(m.indirect_units, 0)) as un,
           (array_agg(m.campaign_id order by m.day desc) filter (where m.campaign_id is not null))[1] as campaign_id
      from mkt.ads_metrics_daily m
     where m.day between p_de and p_ate
       and (p_canal = 'consolidado' and m.channel in ('mercadolivre', 'shopee') or m.channel = p_canal)
     group by m.channel, m.item_id
  ),
  pesos as materialized (
    select * from analytics.ads_peso_modelo(p_canal, p_de, p_ate)
  ),
  am as materialized (
    -- por anuncio e modelo
    select a.channel, a.item_id, p.modelo,
           a.inv * p.peso as inv, a.imp * p.peso as imp, a.cli * p.peso as cli,
           a.vend * p.peso as vend, a.un * p.peso as un,
           coalesce(a.campaign_id, an.campaign_id) as campaign_id,
           coalesce(lower(an.status) = 'paused', false) or coalesce(lower(c.status) = 'paused', false) as pausado
      from met a
      join pesos p on p.channel = a.channel and p.item_id = a.item_id
      left join mkt.ads_anuncios an on an.channel = a.channel and an.item_id = a.item_id
      left join mkt.ads_campaigns c on c.channel = a.channel and c.campaign_id = coalesce(a.campaign_id, an.campaign_id)
  ),
  pm as materialized (
    -- por canal e modelo, arredondado como ads_metricas_modelo
    select am.channel, am.modelo, round(sum(am.inv), 2) as inv, sum(am.imp) as imp, sum(am.cli) as cli,
           round(sum(am.vend), 2) as vend, sum(am.un) as un, bool_and(am.pausado) as pausado
      from am
     group by am.channel, am.modelo
  ),
  ads_mod as materialized (
    select pm.modelo, sum(pm.inv) as inv, sum(pm.imp) as imp, sum(pm.cli) as cli,
           sum(pm.vend) as vend, sum(pm.un) as un, bool_and(pm.pausado) as pausado
      from pm
     where pm.modelo is not null
     group by pm.modelo
  ),
  -- campanha em que o modelo mais gastou no periodo
  camp as (
    select distinct on (x.modelo) x.modelo, x.campaign_id
      from (select am.modelo, am.campaign_id, sum(am.inv) as inv
              from am where am.modelo is not null and am.campaign_id is not null
             group by am.modelo, am.campaign_id) x
     order by x.modelo, x.inv desc, x.campaign_id
  ),
  -- anuncio de maior investimento do modelo: nome e foto de reserva (modelo sem venda no periodo)
  topo as (
    select distinct on (am.modelo) am.modelo, am.channel, am.item_id
      from am where am.modelo is not null
     order by am.modelo, am.inv desc, am.channel, am.item_id
  ),
  vendidos as materialized (
    -- venda paga no canal nos 30 dias ate p_ate
    select distinct r.modelo
      from mkt.orders o
      join mkt.order_items oi on oi.channel = o.channel and oi.order_id = o.order_id
     cross join lateral analytics.ref_erp(oi.sku, oi.modelo, oi.cor, coalesce(o.date_closed, o.date_created)) r
     where o.status = 'paid'
       and (p_canal = 'consolidado' and o.channel in ('mercadolivre', 'shopee') or o.channel = p_canal)
       and (coalesce(o.date_closed, o.date_created) at time zone 'America/Sao_Paulo')::date between p_ate - 29 and p_ate
       and r.modelo is not null
  ),
  sug as materialized (
    select sg.modelo, sg.sugestao, sg.motivo, sg.pausado from analytics.ads_sugestoes(p_canal, p_ate) sg
  ),
  dm as materialized (
    -- vendas por modelo do canal (Shopee incluida desde a 0021)
    select * from analytics.dash_modelos(p_canal, p_de, p_ate)
  ),
  rt as materialized (
    select coalesce((select sum(dm.receita) from dm), 0) as receita,
           coalesce((select sum(c.valor) from analytics.dash_custos_periodo(p_canal, p_de, p_ate) c
                      where c.categoria = 'product_ads'), 0) as ads_cp
  ),
  -- Consolidado: o ACOS de equilibrio usa a mesma base de ads_sugestoes (so o Mercado Livre), para a
  -- tabela e o motivo da sugestao mostrarem o mesmo numero. Nos outros canais nao roda.
  dm_eq as materialized (
    select * from analytics.dash_modelos('mercadolivre', p_de, p_ate) where p_canal = 'consolidado'
  ),
  rt_eq as materialized (
    select coalesce((select sum(de.receita) from dm_eq de), 0) as receita,
           coalesce((select sum(c.valor) from analytics.dash_custos_periodo('mercadolivre', p_de, p_ate) c
                      where p_canal = 'consolidado' and c.categoria = 'product_ads'), 0) as ads_cp
  ),
  fped as materialized (
    -- Product Ads da fatura ligada a pedidos do periodo (pela data da venda), como dash_pedidos_base
    select o.order_id, coalesce(o.date_closed, o.date_created) as sale_ts, sum(f.valor) as ads
      from analytics.ml_fatura f
      join mkt.orders o on o.channel = 'mercadolivre' and o.order_id = f.order_id
     where v_ve and p_canal in ('consolidado', 'mercadolivre')
       and f.categoria = 'product_ads'
       and (coalesce(o.date_closed, o.date_created) at time zone 'America/Sao_Paulo')::date between p_de and p_ate
     group by o.order_id, coalesce(o.date_closed, o.date_created)
  ),
  fat_mod as (
    -- repartido pelo valor de cada item (mesmo peso de dash_itens)
    select r.modelo,
           sum(fp.ads * case when t.vv > 0 then oi.unit_price * oi.quantity / t.vv else 1.0 / t.n end) as ads
      from fped fp
      join mkt.order_items oi on oi.channel = 'mercadolivre' and oi.order_id = fp.order_id
     cross join lateral (select sum(x.unit_price * x.quantity) as vv, count(*) as n
                           from mkt.order_items x
                          where x.channel = 'mercadolivre' and x.order_id = fp.order_id) t
     cross join lateral analytics.ref_erp(oi.sku, oi.modelo, oi.cor, fp.sale_ts) r
     group by r.modelo
  ),
  uni as (
    -- + os modelos das sugestoes (Ads nos 30 dias, mesmo sem nada no periodo): a contagem por sugestao
    -- da tela bate com a tabela (ex.: Pausar de quem gastou antes de um periodo curto)
    select a.modelo from ads_mod a
    union
    select v.modelo from vendidos v
    union
    select sg.modelo from sug sg
  ),
  linhas as (
    select u.modelo,
           coalesce(d.produto, it.title) as produto,
           coalesce(d.foto, analytics.foto_anuncio(tp.item_id, null)) as foto,
           coalesce(a.inv, 0) as inv, coalesce(a.imp, 0) as imp, coalesce(a.cli, 0) as cli,
           coalesce(a.vend, 0) as vend, coalesce(a.un, 0) as un,
           coalesce(d.receita, 0) as receita,
           case when not v_ve then null
                when d.modelo is null and a.modelo is null then null   -- sem venda e sem Ads no periodo
                when d.modelo is null then 0
                when d.contribuicao is null or coalesce(d.sem_custo, 0) > 0 then null
                else d.contribuicao
                     + case when rt.receita > 0 then rt.ads_cp * d.receita / rt.receita else 0 end
                     + coalesce(fm.ads, 0)
           end as antes,
           -- base do ACOS de equilibrio no consolidado (so ML; mesma conta de antes com dm_eq/rt_eq)
           case when not v_ve or de.modelo is null then null
                when de.contribuicao is null or coalesce(de.sem_custo, 0) > 0 then null
                else de.contribuicao
                     + case when rte.receita > 0 then rte.ads_cp * de.receita / rte.receita else 0 end
                     + coalesce(fm.ads, 0)
           end as antes_ml,
           coalesce(de.receita, 0) as receita_ml,
           case when v_ve and coalesce(d.sem_custo, 0) = 0 then d.contribuicao_pct end as cpct,
           -- mesmo conjunto de anuncios da sugestao (30 dias); sem linha nas sugestoes, os anuncios do periodo
           coalesce(sg.pausado, a.pausado, false) as pausado,
           sg.sugestao as sug, sg.motivo as mot,
           cm.campaign_id,
           coalesce((select min(x.modo) from core.ads_modo x   -- 'automatico' < 'manual'
                      where x.tipo = 'modelo' and x.chave = u.modelo
                        and (p_canal = 'consolidado' and x.channel in ('mercadolivre', 'shopee') or x.channel = p_canal)),
                    'manual') as modo
      from uni u
      left join ads_mod a on a.modelo = u.modelo
      left join dm d on d.modelo = u.modelo
      left join fat_mod fm on fm.modelo = u.modelo
      left join camp cm on cm.modelo = u.modelo
      left join topo tp on tp.modelo = u.modelo
      left join sug sg on sg.modelo = u.modelo
      left join mkt.items it on it.channel = tp.channel and it.item_id = tp.item_id
      left join dm_eq de on de.modelo = u.modelo
     cross join rt
     cross join rt_eq rte
  ),
  sem as (
    select coalesce(sum(pm.imp), 0) as imp, coalesce(sum(pm.cli), 0) as cli, coalesce(sum(pm.vend), 0) as vend,
           coalesce(sum(pm.un), 0) as un, count(*) > 0 as tem
      from pm where pm.modelo is null
  ),
  nao as (
    select round(v_inv - coalesce((select sum(a.inv) from ads_mod a), 0), 2) as inv, sem.*
      from sem
  )
  select r.modelo, r.produto, r.foto, r.investimento, r.impressoes, r.cliques, r.ctr, r.cpc, r.conversao,
         r.vendas_ads, r.unidades_ads, r.acos, r.acos_equilibrio, r.lucro_pos_ads, r.contribuicao_pct,
         r.sugestao, r.motivo, r.pausado, r.campanha_id, r.modo
    from (
      select l.modelo, l.produto, l.foto,
             round(l.inv, 2) as investimento, round(l.imp, 2) as impressoes, round(l.cli, 2) as cliques,
             case when l.imp > 0 then round(l.cli / l.imp * 100, 2) end as ctr,
             case when l.cli > 0 then round(l.inv / l.cli, 2) end as cpc,
             case when l.cli > 0 then round(l.un / l.cli * 100, 2) end as conversao,
             round(l.vend, 2) as vendas_ads, round(l.un, 2) as unidades_ads,
             case when l.vend > 0 then round(l.inv / l.vend * 100, 2) end as acos,
             case when p_canal = 'consolidado' then
                    case when l.receita_ml > 0 then round(l.antes_ml / l.receita_ml * 100, 2) end
                  when l.receita > 0 then round(l.antes / l.receita * 100, 2) end as acos_equilibrio,
             round(l.antes - l.inv, 2) as lucro_pos_ads,
             l.cpct as contribuicao_pct,
             case when not l.pausado then l.sug end as sugestao,
             case when not l.pausado then l.mot end as motivo,
             l.pausado, l.campaign_id as campanha_id, l.modo,
             0 as ordem
        from linhas l
      union all
      select null::text, null::text, null::text,
             n.inv, round(n.imp, 2), round(n.cli, 2), null::numeric, null::numeric, null::numeric,
             round(n.vend, 2), round(n.un, 2), null::numeric, null::numeric, null::numeric, null::numeric,
             null::text, null::text, false, null::text, null::text,
             1
        from nao n
       where n.inv <> 0 or n.tem
    ) r
   order by r.ordem, r.investimento desc, r.modelo;
end $$;


grant execute on function analytics.dash_pedidos_base_ml(date, date),
                          analytics.dash_pedidos_base_shopee(date, date),
                          analytics.dash_pedidos_base(date, date),
                          analytics.dash_ads_periodo(text, date, date),
                          analytics.dash_custos_periodo(text, date, date),
                          analytics.dash_resumo(text, date, date),
                          analytics.dash_metas(text, integer, date),
                          analytics.ads_resumo(text, date, date, boolean),
                          analytics.ads_sugestoes(text, date),
                          analytics.ads_modelos(text, date, date) to authenticated;
