-- =====================================================================
-- 0037 - Desempenho do painel (decisao do dono, 27/11/2026). Pode ser reexecutada.
-- Aplicar depois da 0021 (e da 0035/0036). Se a 0009, a 0010 ou a 0021 forem reaplicadas,
-- reaplicar esta depois (elas recriam dash_resumo, dash_serie, dash_itens, dash_pedidos e dash_metas).
--
-- NENHUM numero muda (Mercado Livre, Shopee e consolidado): o teste shopee.test.mjs compara o
-- resultado de todas as funcoes abaixo antes e depois desta migration, como admin e sem 'custos'.
--
-- A. analytics.dash_metas: o realizado (receita mensal dos pedidos pagos) passa a ser calculado direto
--    de mkt.orders + mkt.order_items, sem a base cara de pedidos (custo do ERP por item, fatura, escrow).
--    Mesma regra da base: receita = soma de unit_price * quantity dos itens dos pedidos com classe 'pago'
--    (status 'paid' no ML e na Shopee, inclusive TO_RETURN), data da venda = coalesce(date_closed,
--    date_created) em America/Sao_Paulo. (analytics.ref_erp e analytics.resolve_unit_cost devolvem
--    sempre exatamente uma linha por item, entao a base nao muda a contagem de itens.)
--
-- B. analytics.dash_pedidos_base(p_de, p_ate, p_canal): nova versao que so calcula o canal pedido
--    ('consolidado' = os dois). Em plpgsql com IF, para que o canal fora do filtro nunca seja executado
--    (nao depende de o planejador podar o ramo do union). A versao de 2 argumentos continua igual.
--    dash_resumo, dash_serie, dash_itens e dash_pedidos passam a usar a nova versao; dash_modelos,
--    dash_skus, dash_alertas e dash_resultado_mensal ganham junto (chamam dash_itens / dash_resumo).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Base de pedidos so do canal pedido. Mesmas colunas e mesma ordem (ML, depois Shopee) da 0021.
-- Canal desconhecido ou nulo: nenhuma linha (os chamadores ja descartavam essas linhas pelo filtro).
-- ---------------------------------------------------------------------
create or replace function analytics.dash_pedidos_base(p_de date, p_ate date, p_canal text)
returns table (
  order_id text, classe text, sale_ts timestamptz, data_venda date, sku text, sku_anuncio text,
  qtd integer, unidades integer, valor_venda numeric, receita numeric,
  comissao numeric, frete numeric, parcelamento numeric, product_ads numeric, seguidores numeric,
  estornos numeric, difal numeric, outras numeric, custo_produto numeric, alerta_custo text,
  channel text, imposto numeric, embalagem numeric, frete_estimado boolean
)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_canal in ('consolidado', 'mercadolivre') then
    return query select * from analytics.dash_pedidos_base_ml(p_de, p_ate);
  end if;
  if p_canal in ('consolidado', 'shopee') then
    return query select * from analytics.dash_pedidos_base_shopee(p_de, p_ate);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Resumo do periodo: corpo da 0021, so troca a base pela versao por canal.
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
    select * from analytics.dash_pedidos_base(p_de, p_ate, p_canal)
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
-- Serie por dia, semana ou mes: corpo da 0009, so troca a base.
-- ---------------------------------------------------------------------
create or replace function analytics.dash_serie(p_canal text, p_de date, p_ate date, p_grao text)
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
      from analytics.dash_pedidos_base(p_de, p_ate, p_canal) b
     where (p_canal = 'consolidado' or b.channel = p_canal) and b.data_venda between p_de and p_ate
     group by 1
  )
  select e.periodo, coalesce(a.vendas_brutas, 0), coalesce(a.pedidos, 0), coalesce(a.receita, 0)
    from eixo e
    left join agg a on a.periodo = e.periodo
   order by e.periodo
$$;

-- ---------------------------------------------------------------------
-- Itens vendidos: corpo da 0009, so troca a base.
-- ---------------------------------------------------------------------
create or replace function analytics.dash_itens(p_canal text, p_de date, p_ate date)
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
    from analytics.dash_pedidos_base(p_de, p_ate, p_canal) b
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
-- Lista de pedidos: corpo da 0009, so troca a base.
-- ---------------------------------------------------------------------
create or replace function analytics.dash_pedidos(p_canal text, p_de date, p_ate date, p_modelo text)
returns table (order_id text, data_venda date, sku text, sku_anuncio text, qtd integer, valor_venda numeric,
               classe text, custo_produto numeric, alerta_custo text)
language sql stable security invoker set search_path = '' as $$
  select b.order_id, b.data_venda, b.sku, b.sku_anuncio, b.qtd, b.valor_venda, b.classe,
         case when v.ve then b.custo_produto end,
         case when v.ve then b.alerta_custo end
    from analytics.dash_pedidos_base(p_de, p_ate, p_canal) b
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

-- ---------------------------------------------------------------------
-- Metas: corpo da 0021, so troca o calculo da receita mensal (consulta leve, mesma regra).
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

  -- Receita mensal dos pedidos pagos (status 'paid' = classe 'pago' no ML e na Shopee), calculada UMA vez
  -- direto dos pedidos e itens; so canais com vendas no painel e so se o usuario ve o canal.
  if p_canal in ('mercadolivre', 'shopee') then
    select coalesce(array_agg(x.m order by x.m), '{}'), coalesce(array_agg(x.r order by x.m), '{}')
      into v_meses, v_vals
      from (select date_trunc('month', y.data_venda)::date as m, sum(y.valor) as r
              from (select (coalesce(o.date_closed, o.date_created) at time zone 'America/Sao_Paulo')::date as data_venda,
                           oi.unit_price * oi.quantity as valor
                      from mkt.orders o
                      join mkt.order_items oi on oi.channel = o.channel and oi.order_id = o.order_id
                     where o.channel = p_canal
                       and o.status = 'paid'
                       and (coalesce(o.date_closed, o.date_created) at time zone 'America/Sao_Paulo')::date
                           between v_inicio and (v_atual + interval '1 month' - interval '1 day')::date
                       and (select core.can_see_channel(p_canal))) y
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

revoke execute on function analytics.dash_pedidos_base(date, date, text) from public, anon;
grant execute on function analytics.dash_pedidos_base(date, date, text),
                          analytics.dash_resumo(text, date, date),
                          analytics.dash_serie(text, date, date, text),
                          analytics.dash_itens(text, date, date),
                          analytics.dash_pedidos(text, date, date, text),
                          analytics.dash_metas(text, integer, date) to authenticated;
