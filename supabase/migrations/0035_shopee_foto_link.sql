-- =====================================================================
-- 0035 - Foto e link dos anuncios da Shopee nas tabelas por modelo e por SKU (Tarefa 7 do projeto Shopee).
-- Pode ser reexecutada. Aplicar depois da 0009 e da 0021.
-- ATENCAO: a 0009 recria estas funcoes so com o Mercado Livre. Se ela for reaplicada, reaplicar esta depois.
--
-- A sincronizacao da Shopee ja grava a miniatura (thumbnail = 1a imagem do anuncio) e o link do anuncio
-- (permalink = https://shopee.com.br/product/<loja>/<item>) em mkt.items. Ate aqui a foto e o link das
-- tabelas so olhavam o Mercado Livre (channel = 'mercadolivre'), e a Shopee vinha vazia.
--
-- O Mercado Livre NAO muda: os anuncios do ML continuam com a mesma foto e o mesmo link (o anuncio do ML
-- tem prioridade se um codigo existir nos dois canais). Os corpos de dash_modelos e dash_skus sao os da
-- 0009; muda so o link (analytics.link_anuncio no lugar da subconsulta so do ML).
-- Fotos por variacao da Shopee: nao sao guardadas; o SKU da Shopee usa a foto principal do anuncio.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Foto do anuncio: da variacao (quando informada e com foto propria) ou a principal;
-- sem fotos guardadas, a miniatura em https. Mercado Livre e Shopee. Anuncio desconhecido -> nulo.
-- ---------------------------------------------------------------------
create or replace function analytics.foto_anuncio(p_item text, p_variacao text) returns text
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
   where i.channel in ('mercadolivre', 'shopee') and i.item_id = p_item
   order by (i.channel = 'mercadolivre') desc
   limit 1
$$;

-- ---------------------------------------------------------------------
-- Link do anuncio (Mercado Livre ou Shopee). Anuncio desconhecido -> nulo.
-- ---------------------------------------------------------------------
create or replace function analytics.link_anuncio(p_item text) returns text
language sql stable security invoker set search_path = '' as $$
  select i.permalink
    from mkt.items i
   where i.channel in ('mercadolivre', 'shopee') and i.item_id = p_item
   order by (i.channel = 'mercadolivre') desc
   limit 1
$$;

-- ---------------------------------------------------------------------
-- Vendas e rentabilidade por modelo, com rateio dos custos do periodo e curva ABC
-- por lucro (abc) e por receita (abc_receita).
-- ---------------------------------------------------------------------
create or replace function analytics.dash_modelos(p_canal text, p_de date, p_ate date)
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
         analytics.link_anuncio(tp.item_id)
    from c2
    left join acum a on a.modelo = c2.modelo
    left join acum_r ar on ar.modelo = c2.modelo
    left join topo tp on tp.modelo is not distinct from c2.modelo
   cross join (select core.has_perm('custos') as ve) v
   order by c2.vendas_brutas desc, c2.modelo
$$;


-- Por SKU: de um modelo (p_modelo) ou de todos (p_modelo nulo), mesmo calculo e curvas ABC.
-- ---------------------------------------------------------------------
create or replace function analytics.dash_skus(p_canal text, p_de date, p_ate date, p_modelo text)
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
         analytics.link_anuncio(tp.item_id)
    from s2
    left join acum a on a.sku = s2.sku
    left join acum_r ar on ar.sku = s2.sku
    left join topo tp on tp.sku is not distinct from s2.sku
   cross join (select core.has_perm('custos') as ve) v
   order by s2.vendas_brutas desc, s2.sku
$$;


grant execute on function analytics.foto_anuncio(text, text),
                          analytics.link_anuncio(text),
                          analytics.dash_modelos(text, date, date),
                          analytics.dash_skus(text, date, date, text) to authenticated;
