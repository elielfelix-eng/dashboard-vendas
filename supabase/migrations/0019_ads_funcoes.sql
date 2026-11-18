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
     where i.classe in ('pago', 'cancelado', 'devolvido') and i.modelo is not null
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

grant execute on function analytics.ads_parametros(text, date),
                          analytics.ads_peso_modelo(text, date, date),
                          analytics.ads_metricas_modelo(text, date, date) to authenticated;
