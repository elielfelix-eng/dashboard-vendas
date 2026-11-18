-- =====================================================================
-- 0019 - Ads e Orcamento: funcoes analytics.ads_*
-- Pode ser reexecutada. Aplicar depois da 0018.
-- Este arquivo guarda as funcoes analytics.ads_* (parametros, peso por modelo, metricas,
-- sugestoes, distribuicao e orcamento do mes). Elas sao acrescentadas pelas tarefas seguintes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Limites do Ads validos numa data: a linha com o maior vigente_desde <= data (0 linhas se nao houver).
-- ---------------------------------------------------------------------
create or replace function analytics.ads_parametros(p_channel text, p_data date)
returns setof core.parametros_ads
language sql stable security invoker set search_path = '' as $$
  select p.*
    from core.parametros_ads p
   where p.channel = p_channel and p.vigente_desde <= p_data
   order by p.vigente_desde desc
   limit 1
$$;

-- ---------------------------------------------------------------------
-- Peso de cada modelo dentro de cada anuncio com metricas na janela (pesquisa R3).
--  1. Com venda na janela: unidades do modelo no anuncio / unidades do anuncio (dash_itens; pago, cancelado, devolvido).
--  2. Sem venda: modelo(s) do SKU do anuncio (mkt.items e mkt.item_variations), via ref_erp; varios = divisao igual.
--  3. Sem nada: uma linha com modelo nulo ("sem modelo"), peso 1.
-- O peso de cada (canal, anuncio) soma 1. Vendas so existem para o Mercado Livre (dash_itens).
-- dash_itens (caro) so roda quando ha anuncio do Mercado Livre na janela (nunca para p_canal = 'shopee').
-- ---------------------------------------------------------------------
create or replace function analytics.ads_peso_modelo(p_canal text, p_de date, p_ate date)
returns table (channel text, item_id text, modelo text, peso numeric)
language sql stable security invoker set search_path = '' as $$
  with ads as materialized (
    select distinct m.channel, m.item_id
      from mkt.ads_metrics_daily m
     where m.day between p_de and p_ate
       and (p_canal = 'consolidado' and m.channel in ('mercadolivre', 'shopee') or m.channel = p_canal)
  ),
  vendas as materialized (
    select 'mercadolivre'::text as channel, i.item_id, i.modelo, sum(i.qtd)::numeric as unid
      from analytics.dash_itens('mercadolivre', p_de, p_ate) i
     where p_canal in ('consolidado', 'mercadolivre')
       and exists (select 1 from ads a0 where a0.channel = 'mercadolivre')
       and i.classe in ('pago', 'cancelado', 'devolvido') and i.modelo is not null
       and exists (select 1 from ads a where a.channel = 'mercadolivre' and a.item_id = i.item_id)
     group by i.item_id, i.modelo
    having sum(i.qtd) > 0
  ),
  por_venda as materialized (
    select v.channel, v.item_id, v.modelo, v.unid / sum(v.unid) over (partition by v.channel, v.item_id) as peso
      from vendas v
  ),
  skus as materialized (
    select a.channel, a.item_id, s.sku
      from ads a
      join lateral (
        select it.sku from mkt.items it where it.channel = a.channel and it.item_id = a.item_id
        union
        select v.sku from mkt.item_variations v where v.channel = a.channel and v.item_id = a.item_id
      ) s on true
     where not exists (select 1 from por_venda p where p.channel = a.channel and p.item_id = a.item_id)
       and nullif(split_part(s.sku, '-', 1), '') is not null
  ),
  modelos_sku as materialized (
    select distinct k.channel, k.item_id, r.modelo
      from skus k
     cross join lateral analytics.ref_erp(
       k.sku,
       nullif(split_part(k.sku, '-', 1), ''),
       case when split_part(k.sku, '-', 2) ~ '^(K\d+|V\d+)?$' then null else split_part(k.sku, '-', 2) end,
       (p_ate::timestamp + time '12:00') at time zone 'America/Sao_Paulo') r
     where r.modelo is not null
  ),
  por_sku as materialized (
    select channel, item_id, modelo, 1.0 / count(*) over (partition by channel, item_id) as peso
      from modelos_sku
  )
  select p.channel, p.item_id, p.modelo, p.peso from por_venda p
  union all
  select s.channel, s.item_id, s.modelo, s.peso from por_sku s
  union all
  select a.channel, a.item_id, null::text, 1.0
    from ads a
   where not exists (select 1 from por_venda p where p.channel = a.channel and p.item_id = a.item_id)
     and not exists (select 1 from por_sku s where s.channel = a.channel and s.item_id = a.item_id)
$$;

-- ---------------------------------------------------------------------
-- Metricas de Ads por modelo = soma(metrica do anuncio x peso). Inclui a linha "sem modelo" (modelo nulo).
-- ---------------------------------------------------------------------
create or replace function analytics.ads_metricas_modelo(p_canal text, p_de date, p_ate date)
returns table (channel text, modelo text, investimento numeric, impressoes numeric, cliques numeric,
               vendas_ads numeric, unidades_ads numeric, unidades_organicas numeric, dias_com_dados integer)
language sql stable security invoker set search_path = '' as $$
  with pesos as materialized (
    select * from analytics.ads_peso_modelo(p_canal, p_de, p_ate)
  )
  select m.channel, p.modelo,
         round(sum(coalesce(m.cost, 0) * p.peso), 2),
         sum(coalesce(m.impressions, 0) * p.peso),
         sum(coalesce(m.clicks, 0) * p.peso),
         round(sum((coalesce(m.direct_amount, 0) + coalesce(m.indirect_amount, 0)) * p.peso), 2),
         sum((coalesce(m.direct_units, 0) + coalesce(m.indirect_units, 0)) * p.peso),
         sum(coalesce(m.organic_units, 0) * p.peso),
         count(distinct m.day)::integer
    from mkt.ads_metrics_daily m
    join pesos p on p.channel = m.channel and p.item_id = m.item_id
   where m.day between p_de and p_ate
   group by m.channel, p.modelo
$$;

-- =====================================================================
-- Tela Ads (US1): resumo, serie, tabela por modelo e por campanha (contracts/painel-rpc.md)
-- Sem a permissao 'ads': zero linhas (ads_resumo: uma linha zerada).
-- Consolidado = so marketplaces (mercadolivre + shopee), nunca brindedobem (FR-010).
-- Dinheiro e percentuais com 2 casas; razao com denominador zero = nulo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Cartoes do periodo (sempre 1 linha).
--  investimento    = analytics.dash_ads_periodo (mesma fonte conferida da Visao Geral, pesquisa R1)
--  vendas_ads      = vendas diretas + indiretas por anuncio (mkt.ads_metrics_daily)
--  vendas_brutas   = mesma regra de dash_resumo.vendas_brutas (pago + cancelado + devolvido), so marketplaces
--  nao_atribuido   = investimento - investimento atribuido a modelos (= linha modelo nulo de ads_modelos;
--                    inclui o gasto de anuncios "sem modelo")
--  tem_detalhe     = ha dados por anuncio no periodo
-- ---------------------------------------------------------------------
create or replace function analytics.ads_resumo(p_canal text, p_de date, p_ate date)
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
  -- pago, ou cancelado que nao seja carrinho dividido (cancelado + devolvido); data da venda em Brasilia.
  -- Mesmo escopo de dash_resumo/dash_pedidos_base: so o Mercado Livre (Shopee = 0). O projeto
  -- "Shopee completa" deve estender dash_pedidos_base e esta consulta juntos.
  select coalesce(sum(oi.unit_price * oi.quantity), 0)
    into v_vb
    from mkt.orders o
    join mkt.order_items oi on oi.channel = o.channel and oi.order_id = o.order_id
   where o.channel = 'mercadolivre'
     and p_canal in ('consolidado', 'mercadolivre')
     and o.channel = any ((select core.my_channels())::text[])
     and (coalesce(o.date_closed, o.date_created) at time zone 'America/Sao_Paulo')::date between p_de and p_ate
     and (o.status = 'paid'
          or (o.status = 'cancelled'
              and coalesce(o.cancel_detail_code, '') <> 'pack_splitted'
              and coalesce(o.shipment_substatus, '') <> 'pack_splitted'));

  if v_det then
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
    round(v_inv - v_atr, 2),
    v_det;
end $$;

-- ---------------------------------------------------------------------
-- Serie diaria: investimento (mesmos componentes de dash_ads_periodo, dia a dia) e vendas por Ads.
-- EXCECAO DOCUMENTADA (security definer), como analytics.dash_ads_periodo: a fatura do ML so e
-- legivel por quem ve custos (RLS da 0003/0011), mas o investimento em Ads aparece para todos que
-- tem 'ads'. Roda com os direitos do dono e devolve so agregados por dia; exige core.has_perm('ads')
-- e respeita core.can_see_channel / core.my_channels() explicitamente (a RLS nao vale aqui).
-- Componentes: fatura de Product Ads ligada a pedido (pela data da venda) + fatura sem pedido antes
-- do primeiro dia da API (data_ref) + mkt.ads_campaign_daily. A soma dos dias = dash_ads_periodo.
-- ---------------------------------------------------------------------
create or replace function analytics.ads_serie(p_canal text, p_de date, p_ate date)
returns table (dia date, investimento numeric, vendas_ads numeric)
language sql stable security definer set search_path = '' as $$
  with ok as materialized (
    select core.has_perm('ads') and coalesce(p_canal, '') in ('consolidado', 'mercadolivre', 'shopee') as ads,
           coalesce(p_canal, '') in ('consolidado', 'mercadolivre') and core.can_see_channel('mercadolivre') as ml,
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

-- ---------------------------------------------------------------------
-- Tabela por modelo (sugestao/motivo ficam para a tarefa das sugestoes: nulos aqui).
-- Universo (data-model §3): modelos com dados de Ads no periodo ou com venda paga no canal nos
-- 30 dias ate p_ate. Linha final modelo nulo = "nao atribuido a anuncio": investimento do cartao
-- (dash_ads_periodo) menos o atribuido aos modelos; inclui os anuncios "sem modelo" (uma so linha nula),
-- assim a soma da tabela = cartao.
-- Metricas = soma(metrica do anuncio x peso de ads_peso_modelo), arredondadas por canal e modelo
-- como ads_metricas_modelo; no consolidado, somadas por modelo entre os canais.
-- ACOS de equilibrio (pesquisa R2): contribuicao de dash_modelos + Product Ads rateado ao modelo
-- (parte product_ads de dash_custos_periodo x receita do modelo / receita total, mesmo rateio) +
-- Product Ads da fatura ligada a pedido (repartido pelo valor do item, mesmo peso de dash_itens).
-- Lucro pos-Ads = contribuicao antes do Ads - investimento atribuido. Nulos sem 'custos' (FR-009)
-- e para modelo sem custo (sem_custo > 0). Modelo sem venda no periodo: contribuicao 0
-- (lucro = -investimento); sem venda e sem Ads no periodo (so venda na janela de 30 dias): nulos.
-- pausado: todos os anuncios do modelo pausados (anuncio ou campanha). modo: core.ads_modo (padrao manual).
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
  dm as materialized (
    -- vendas por modelo so existem no Mercado Livre: na Shopee nao roda (dash_itens e caro)
    select * from analytics.dash_modelos(p_canal, p_de, p_ate) where p_canal <> 'shopee'
  ),
  rt as materialized (
    select coalesce((select sum(dm.receita) from dm), 0) as receita,
           coalesce((select sum(c.valor) from analytics.dash_custos_periodo(p_canal, p_de, p_ate) c
                      where c.categoria = 'product_ads'), 0) as ads_cp
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
    select a.modelo from ads_mod a
    union
    select v.modelo from vendidos v
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
           case when v_ve and coalesce(d.sem_custo, 0) = 0 then d.contribuicao_pct end as cpct,
           coalesce(a.pausado, false) as pausado,
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
      left join mkt.items it on it.channel = tp.channel and it.item_id = tp.item_id
     cross join rt
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
             case when l.receita > 0 then round(l.antes / l.receita * 100, 2) end as acos_equilibrio,
             round(l.antes - l.inv, 2) as lucro_pos_ads,
             l.cpct as contribuicao_pct,
             null::text as sugestao, null::text as motivo,
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

-- ---------------------------------------------------------------------
-- Por campanha (FR-008). Investimento: mkt.ads_campaign_daily (fonte conferida);
-- vendas por Ads: mkt.ads_metrics_daily pela campanha do anuncio; cadastro: mkt.ads_campaigns
-- (nome -- ou o id --, status, orcamento diario, ROAS objetivo, ACOS equivalente = 100 / ROAS objetivo,
-- automatica). modelos = modelos distintos atribuidos aos anuncios da campanha no periodo.
-- Entram as campanhas com dados no periodo e as ativas no cadastro.
-- ---------------------------------------------------------------------
create or replace function analytics.ads_campanhas(p_canal text, p_de date, p_ate date)
returns table (campanha_id text, nome text, status text, automatica boolean, orcamento_diario numeric,
               roas_target numeric, acos_equivalente numeric, investimento numeric, vendas_ads numeric,
               acos numeric, roas numeric, modelos integer, modo text)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
begin
  if not core.has_perm('ads') or coalesce(p_canal, '') not in ('consolidado', 'mercadolivre', 'shopee') then
    return;
  end if;

  return query
  with ci as materialized (
    select a.channel, a.campaign_id, sum(a.cost) as inv
      from mkt.ads_campaign_daily a
     where a.day between p_de and p_ate
       and (p_canal = 'consolidado' and a.channel in ('mercadolivre', 'shopee') or a.channel = p_canal)
     group by a.channel, a.campaign_id
  ),
  met as materialized (
    select m.channel, m.item_id, coalesce(m.campaign_id, an.campaign_id) as campaign_id,
           sum(coalesce(m.direct_amount, 0) + coalesce(m.indirect_amount, 0)) as vend
      from mkt.ads_metrics_daily m
      left join mkt.ads_anuncios an on an.channel = m.channel and an.item_id = m.item_id
     where m.day between p_de and p_ate
       and (p_canal = 'consolidado' and m.channel in ('mercadolivre', 'shopee') or m.channel = p_canal)
     group by m.channel, m.item_id, coalesce(m.campaign_id, an.campaign_id)
  ),
  vc as (
    select met.channel, met.campaign_id, sum(met.vend) as vend
      from met where met.campaign_id is not null
     group by met.channel, met.campaign_id
  ),
  pesos as materialized (
    select * from analytics.ads_peso_modelo(p_canal, p_de, p_ate)
  ),
  mc as (
    select met.channel, met.campaign_id, count(distinct p.modelo) as n
      from met
      join pesos p on p.channel = met.channel and p.item_id = met.item_id
     where met.campaign_id is not null and p.modelo is not null
     group by met.channel, met.campaign_id
  ),
  k as (
    select ci.channel, ci.campaign_id from ci
    union
    select vc.channel, vc.campaign_id from vc
    union
    select c.channel, c.campaign_id
      from mkt.ads_campaigns c
     where lower(c.status) = 'active'
       and (p_canal = 'consolidado' and c.channel in ('mercadolivre', 'shopee') or c.channel = p_canal)
  )
  select k.campaign_id,
         coalesce(nullif(c.name, ''), k.campaign_id),
         c.status,
         c.automatica,
         c.budget::numeric,
         c.roas_target,
         case when c.roas_target > 0 then round(100 / c.roas_target, 2) end,
         round(coalesce(ci.inv, 0), 2),
         round(coalesce(vc.vend, 0), 2),
         case when vc.vend > 0 then round(coalesce(ci.inv, 0) / vc.vend * 100, 2) end,
         case when ci.inv > 0 then round(coalesce(vc.vend, 0) / ci.inv, 2) end,
         coalesce(mc.n, 0)::integer,
         coalesce((select x.modo from core.ads_modo x
                    where x.channel = k.channel and x.tipo = 'campanha' and x.chave = k.campaign_id), 'manual')
    from k
    left join mkt.ads_campaigns c on c.channel = k.channel and c.campaign_id = k.campaign_id
    left join ci on ci.channel = k.channel and ci.campaign_id = k.campaign_id
    left join vc on vc.channel = k.channel and vc.campaign_id = k.campaign_id
    left join mc on mc.channel = k.channel and mc.campaign_id = k.campaign_id
   order by coalesce(ci.inv, 0) desc, coalesce(nullif(c.name, ''), k.campaign_id), k.campaign_id;
end $$;

grant execute on function analytics.ads_parametros(text, date),
                          analytics.ads_peso_modelo(text, date, date),
                          analytics.ads_metricas_modelo(text, date, date),
                          analytics.ads_resumo(text, date, date),
                          analytics.ads_serie(text, date, date),
                          analytics.ads_modelos(text, date, date),
                          analytics.ads_campanhas(text, date, date) to authenticated;
