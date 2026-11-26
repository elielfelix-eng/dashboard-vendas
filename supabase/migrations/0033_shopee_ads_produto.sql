-- =====================================================================
-- 0033 - Shopee Ads por produto: ranking e sugestoes por modelo (Tarefa 5b do projeto Shopee).
-- Pode ser reexecutada. Aplicar depois da 0019, 0021 e 0032.
-- ATENCAO: a 0019 e a 0021 recriam estas funcoes sem o Ads por produto da Shopee. Se uma delas for
-- reaplicada, reaplicar esta depois.
--
-- Decisao do dono (26/11/2026): o Ads por produto da Shopee funciona em producao (mkt.ads_metrics_daily,
-- channel 'shopee', item_id real; a sobra da conta no item 'conta'). Ligar o ranking e as sugestoes por
-- produto da Shopee com os MESMOS limites do Mercado Livre.
--
-- O Mercado Livre NAO muda (o teste shopee.test.mjs compara o resultado do ML antes e depois desta migration).
--
-- Regras:
--   * Sugestao da Shopee: so dados da Shopee (metricas por anuncio, vendas e margem de dash_itens('shopee'),
--     custos do periodo de dash_custos_periodo('shopee')), mesmas regras e textos do ML. A Shopee nao tem
--     Product Ads da fatura por pedido: a parte "fatura ligada a pedido" (fat_mod) e 0 na Shopee.
--   * Consolidado: metricas de Ads, vendas e margem dos dois canais somadas por modelo; canal da sugestao =
--     o de maior investimento na janela (sem Ads: mercadolivre), como no desenho da 0019. ads_modelos usa a
--     mesma base (dash_modelos('consolidado')), assim o ACOS de equilibrio da tabela = o do motivo.
--   * Peso do modelo no anuncio (ads_peso_modelo): passo 1 (vendas do anuncio na janela) tambem para a Shopee.
--   * Item 'conta' (sobra da conta, so na Shopee) nunca vira modelo: fica em "nao atribuido".
--     Nao atribuido = investimento do cartao (dash_ads_periodo, ads_campaign_daily 'conta') - atribuido.
--     A sincronizacao (combinarAdsShopee) grava em 'conta' so a SOBRA do dia (conta - soma dos anuncios,
--     nunca negativa) quando ha linhas por anuncio, entao nada conta duas vezes.
--   * Por campanha (ads_campanhas): campanha real da Shopee = gasto das metricas por anuncio dela; a linha
--     'conta' = so a sobra (cartao da Shopee - campanhas reais). Soma das linhas da Shopee = cartao
--     (salvo o ruido de centavos escondido, abaixo).
--   * Limites: COPIA UNICA (decisao do dono, 26/11) da ultima linha do ML para a Shopee, mesma vigencia e
--     valores (cria ou atualiza). Edicoes posteriores: em Configuracoes > Parametros. Reexecutar esta
--     migration copia o ML de novo.
--   * Ruido de centavos (decisao do dono, rodada final): a sobra da Shopee ("nao atribuido" em ads_modelos e
--     a linha 'conta' em ads_campanhas, na Shopee e na parte da Shopee do consolidado) nao aparece quando
--     |investimento| < 0,05 e vendas/unidades tambem < 0,05; investimento negativo nunca aparece (vira 0).
--     Nesse caso a soma da tabela pode diferir do cartao em centavos. O ML nao muda.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Limites da Shopee = os do Mercado Livre (COPIA UNICA decidida pelo dono em 26/11/2026).
-- A ultima linha do ML (maior vigente_desde) e copiada para a Shopee com a mesma vigencia e os mesmos
-- valores: cria a linha ou atualiza a que ja existe (ex.: a linha padrao que a 0018 criou). Duas
-- execucoes dao o mesmo resultado. Depois disso os limites da Shopee sao editados em Configuracoes >
-- Parametros. ATENCAO: reexecutar esta migration copia o ML de novo por cima da Shopee nessa vigencia.
-- ---------------------------------------------------------------------
insert into core.parametros_ads as s (channel, vigente_desde, pausar_gasto_min, pausar_cliques_min, min_dias_dados,
                                      revisar_cliques_min, revisar_conversao_max_pct, escalar_folga_pp, escalar_unidades_min,
                                      testar_margem_min_pct, testar_unidades_min, teste_reserva_pct, teste_max_modelos,
                                      reduzir_fator, teto_fator, alerta_sobra_pct)
select 'shopee', p.vigente_desde, p.pausar_gasto_min, p.pausar_cliques_min, p.min_dias_dados,
       p.revisar_cliques_min, p.revisar_conversao_max_pct, p.escalar_folga_pp, p.escalar_unidades_min,
       p.testar_margem_min_pct, p.testar_unidades_min, p.teste_reserva_pct, p.teste_max_modelos,
       p.reduzir_fator, p.teto_fator, p.alerta_sobra_pct
  from core.parametros_ads p
 where p.channel = 'mercadolivre'
 order by p.vigente_desde desc
 limit 1
on conflict (channel, vigente_desde) do update set
  pausar_gasto_min = excluded.pausar_gasto_min, pausar_cliques_min = excluded.pausar_cliques_min,
  min_dias_dados = excluded.min_dias_dados, revisar_cliques_min = excluded.revisar_cliques_min,
  revisar_conversao_max_pct = excluded.revisar_conversao_max_pct, escalar_folga_pp = excluded.escalar_folga_pp,
  escalar_unidades_min = excluded.escalar_unidades_min, testar_margem_min_pct = excluded.testar_margem_min_pct,
  testar_unidades_min = excluded.testar_unidades_min, teste_reserva_pct = excluded.teste_reserva_pct,
  teste_max_modelos = excluded.teste_max_modelos, reduzir_fator = excluded.reduzir_fator,
  teto_fator = excluded.teto_fator, alerta_sobra_pct = excluded.alerta_sobra_pct;

-- ---------------------------------------------------------------------
-- Peso dos anuncios SEM venda: igual a 0019, mas o item 'conta' da Shopee (sobra da conta) nunca
-- procura SKU: sempre "sem modelo" (peso 1, modelo nulo).
-- ---------------------------------------------------------------------
create or replace function analytics.ads_peso_sem_venda(p_canal text, p_de date, p_ate date, p_com_venda text[])
returns table (channel text, item_id text, modelo text, peso numeric)
language sql stable security invoker set search_path = '' as $$
  with ads as materialized (
    select distinct m.channel, m.item_id
      from mkt.ads_metrics_daily m
     where m.day between p_de and p_ate
       and (p_canal = 'consolidado' and m.channel in ('mercadolivre', 'shopee') or m.channel = p_canal)
       and not (m.channel || ':' || m.item_id = any (coalesce(p_com_venda, '{}'::text[])))
  ),
  skus as materialized (
    select a.channel, a.item_id, s.sku
      from ads a
      join lateral (
        select it.sku from mkt.items it where it.channel = a.channel and it.item_id = a.item_id
        union
        select v.sku from mkt.item_variations v where v.channel = a.channel and v.item_id = a.item_id
      ) s on true
     where nullif(split_part(s.sku, '-', 1), '') is not null
       and not (a.channel = 'shopee' and a.item_id = 'conta')
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
    select ms.channel, ms.item_id, ms.modelo, 1.0 / count(*) over (partition by ms.channel, ms.item_id) as peso
      from modelos_sku ms
  )
  select s.channel, s.item_id, s.modelo, s.peso from por_sku s
  union all
  select a.channel, a.item_id, null::text, 1.0
    from ads a
   where not exists (select 1 from por_sku s where s.channel = a.channel and s.item_id = a.item_id)
$$;

-- ---------------------------------------------------------------------
-- Peso de cada modelo dentro de cada anuncio: igual a 0019 + o passo 1 (vendas do anuncio na janela)
-- tambem para a Shopee (dash_itens('shopee'), so quando ha anuncio da Shopee na janela). Item 'conta' fora.
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
    union all
    select 'shopee'::text, i.item_id, i.modelo, sum(i.qtd)::numeric
      from analytics.dash_itens('shopee', p_de, p_ate) i
     where p_canal in ('consolidado', 'shopee')
       and exists (select 1 from ads a0 where a0.channel = 'shopee' and a0.item_id <> 'conta')
       and i.classe in ('pago', 'cancelado', 'devolvido') and i.modelo is not null and i.item_id <> 'conta'
       and exists (select 1 from ads a where a.channel = 'shopee' and a.item_id = i.item_id)
     group by i.item_id, i.modelo
    having sum(i.qtd) > 0
  ),
  por_venda as materialized (
    select v.channel, v.item_id, v.modelo, v.unid / sum(v.unid) over (partition by v.channel, v.item_id) as peso
      from vendas v
  )
  select p.channel, p.item_id, p.modelo, p.peso from por_venda p
  union all
  select s.channel, s.item_id, s.modelo, s.peso
    from analytics.ads_peso_sem_venda(p_canal, p_de, p_ate,
                                      array(select distinct p.channel || ':' || p.item_id from por_venda p)) s
$$;

-- ---------------------------------------------------------------------
-- Sugestao por modelo (regras, prioridade e textos da 0019; ver o comentario de la).
-- Mercado Livre: igual a 0019/0021. Shopee: so dados da Shopee (fatura por pedido = 0). Consolidado: Ads,
-- vendas e margem dos dois canais por modelo; custos do periodo = dash_custos_periodo('consolidado'), rateados
-- pela receita de todos os modelos (mesma base de dash_modelos/ads_modelos no consolidado); limites do canal
-- de maior investimento do modelo na janela (sem Ads: mercadolivre).
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
  v_ve := core.has_perm('custos');

  return query
  with itens as materialized (
    -- vendas da janela, com o canal (dash_itens nao devolve o canal)
    select 'mercadolivre'::text as channel, i.*
      from analytics.dash_itens('mercadolivre', v_de, p_ate) i
     where p_canal in ('consolidado', 'mercadolivre')
    union all
    select 'shopee'::text, i.*
      from analytics.dash_itens('shopee', v_de, p_ate) i
     where p_canal in ('consolidado', 'shopee')
  ),
  met as materialized (
    select m.channel, m.item_id, m.day, m.campaign_id,
           coalesce(m.cost, 0) as inv, coalesce(m.clicks, 0) as cli,
           coalesce(m.direct_amount, 0) + coalesce(m.indirect_amount, 0) as vend,
           coalesce(m.direct_units, 0) + coalesce(m.indirect_units, 0) as un
      from mkt.ads_metrics_daily m
     where m.day between v_de and p_ate
       and (p_canal = 'consolidado' and m.channel in ('mercadolivre', 'shopee') or m.channel = p_canal)
  ),
  vendas as materialized (
    -- passo 1 de ads_peso_modelo, com o dash_itens desta funcao (por canal; item 'conta' fora)
    select i.channel, i.item_id, i.modelo, sum(i.qtd)::numeric as unid
      from itens i
     where i.classe in ('pago', 'cancelado', 'devolvido') and i.modelo is not null
       and not (i.channel = 'shopee' and i.item_id = 'conta')
       and exists (select 1 from met a where a.channel = i.channel and a.item_id = i.item_id)
     group by i.channel, i.item_id, i.modelo
    having sum(i.qtd) > 0
  ),
  pesos as materialized (
    select v.channel, v.item_id, v.modelo, v.unid / sum(v.unid) over (partition by v.channel, v.item_id) as peso
      from vendas v
    union all
    select s.channel, s.item_id, s.modelo, s.peso
      from analytics.ads_peso_sem_venda(p_canal, v_de, p_ate,
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
    -- vendas por modelo na janela, canais do p_canal somados (como dash_modelos, sem o rateio)
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
      from analytics.dash_custos_periodo(p_canal, v_de, p_ate) c
  ),
  fped as materialized (
    -- Product Ads da fatura do ML ligada a pedidos da janela (pela data da venda), como ads_modelos.
    -- A Shopee nao tem Product Ads por pedido: na Shopee nao roda.
    select o.order_id, coalesce(o.date_closed, o.date_created) as sale_ts, sum(f.valor) as ads
      from analytics.ml_fatura f
      join mkt.orders o on o.channel = 'mercadolivre' and o.order_id = f.order_id
     where v_ve and p_canal in ('consolidado', 'mercadolivre')
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
           coalesce(a.canal, case when p_canal = 'shopee' then 'shopee' else 'mercadolivre' end) as canal,
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
-- Tabela por modelo: igual a 0021, mas o ACOS de equilibrio volta a usar a base do proprio canal em todos
-- os canais (no consolidado, dash_modelos('consolidado'): os dois canais), a mesma de ads_sugestoes. A base
-- so do ML no consolidado (rodada 1 da Tarefa 5) existia porque a Shopee nao tinha Ads por produto.
-- Shopee: investimento, ACOS, equilibrio e sugestao por modelo; o item 'conta' (sobra) fica em "nao atribuido"
-- (investimento do cartao - atribuido), assim a soma da tabela continua = cartao.
-- ---------------------------------------------------------------------
create or replace function analytics.ads_modelos(p_canal text, p_de date, p_ate date)
returns table (modelo text, produto text, foto text, investimento numeric, impressoes numeric, cliques numeric,
               ctr numeric, cpc numeric, conversao numeric, vendas_ads numeric, unidades_ads numeric, acos numeric,
               acos_equilibrio numeric, lucro_pos_ads numeric, contribuicao_pct numeric, sugestao text, motivo text,
               pausado boolean, campanha_id text, modo text)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  v_inv    numeric;
  v_inv_sh numeric;
  v_ve     boolean;
begin
  if not core.has_perm('ads') or coalesce(p_canal, '') not in ('consolidado', 'mercadolivre', 'shopee') then
    return;
  end if;
  v_inv := coalesce(analytics.dash_ads_periodo(p_canal, p_de, p_ate), 0);
  -- parte da Shopee do cartao (no consolidado, v_inv - v_inv_sh = parte do ML)
  v_inv_sh := case when p_canal in ('consolidado', 'shopee')
                   then coalesce(analytics.dash_ads_periodo('shopee', p_de, p_ate), 0) else 0 end;
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
    -- vendas por modelo do canal (Shopee incluida desde a 0021; consolidado = os dois canais)
    select * from analytics.dash_modelos(p_canal, p_de, p_ate)
  ),
  rt as materialized (
    select coalesce((select sum(dm.receita) from dm), 0) as receita,
           coalesce((select sum(c.valor) from analytics.dash_custos_periodo(p_canal, p_de, p_ate) c
                      where c.categoria = 'product_ads'), 0) as ads_cp
  ),
  fped as materialized (
    -- Product Ads da fatura do ML ligada a pedidos do periodo (pela data da venda), como dash_pedidos_base.
    -- A Shopee nao tem Product Ads por pedido.
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
     cross join rt
  ),
  -- "Nao atribuido" por canal: investimento do cartao do canal - atribuido a modelos do canal, e as
  -- metricas dos anuncios "sem modelo" do canal. ML: regra de sempre. Shopee: sem o ruido de centavos.
  sem as (
    select pm.channel,
           coalesce(sum(pm.inv) filter (where pm.modelo is not null), 0) as atr,
           coalesce(sum(pm.imp) filter (where pm.modelo is null), 0) as imp,
           coalesce(sum(pm.cli) filter (where pm.modelo is null), 0) as cli,
           coalesce(sum(pm.vend) filter (where pm.modelo is null), 0) as vend,
           coalesce(sum(pm.un) filter (where pm.modelo is null), 0) as un,
           count(*) filter (where pm.modelo is null) > 0 as tem
      from pm
     group by pm.channel
  ),
  ml as (
    select round(v_inv - v_inv_sh - coalesce((select s.atr from sem s where s.channel = 'mercadolivre'), 0), 2) as inv,
           coalesce((select s.imp from sem s where s.channel = 'mercadolivre'), 0) as imp,
           coalesce((select s.cli from sem s where s.channel = 'mercadolivre'), 0) as cli,
           coalesce((select s.vend from sem s where s.channel = 'mercadolivre'), 0) as vend,
           coalesce((select s.un from sem s where s.channel = 'mercadolivre'), 0) as un,
           coalesce((select s.tem from sem s where s.channel = 'mercadolivre'), false) as tem
  ),
  sh0 as (
    select round(v_inv_sh - coalesce((select s.atr from sem s where s.channel = 'shopee'), 0), 2) as inv,
           coalesce((select s.imp from sem s where s.channel = 'shopee'), 0) as imp,
           coalesce((select s.cli from sem s where s.channel = 'shopee'), 0) as cli,
           coalesce((select s.vend from sem s where s.channel = 'shopee'), 0) as vend,
           coalesce((select s.un from sem s where s.channel = 'shopee'), 0) as un
  ),
  sh as (
    -- mostra a sobra da Shopee so se nao for ruido; investimento negativo nunca aparece
    select greatest(sh0.inv, 0) as inv, sh0.imp, sh0.cli, sh0.vend, sh0.un,
           not (sh0.inv < 0.05 and abs(sh0.vend) < 0.05 and abs(sh0.un) < 0.05) as mostra
      from sh0
  ),
  nao as (
    select ml.inv + case when sh.mostra then sh.inv else 0 end as inv,
           ml.imp + case when sh.mostra then sh.imp else 0 end as imp,
           ml.cli + case when sh.mostra then sh.cli else 0 end as cli,
           ml.vend + case when sh.mostra then sh.vend else 0 end as vend,
           ml.un + case when sh.mostra then sh.un else 0 end as un,
           ml.inv <> 0 or ml.tem or sh.mostra as tem
      from ml, sh
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
       where n.tem
    ) r
   order by r.ordem, r.investimento desc, r.modelo;
end $$;

-- ---------------------------------------------------------------------
-- Por campanha: igual a 0019 para o Mercado Livre (investimento de mkt.ads_campaign_daily).
-- Shopee: o investimento da conta inteira fica em ads_campaign_daily ('conta'), mas cada campanha real
-- tem o proprio gasto nas metricas por anuncio. Entao, na Shopee:
--   campanha real  = soma de mkt.ads_metrics_daily.cost da campanha (do anuncio; sem campanha na linha, a do
--                    cadastro do anuncio) no periodo; vendas por Ads das mesmas linhas -> ROAS/ACOS certos;
--   'conta'        = so a sobra: Ads da Shopee do cartao (dash_ads_periodo('shopee')) - soma das campanhas
--                    reais; vendas = as das linhas 'conta' (sobra). Sem investimento e sem vendas: some.
-- A soma das linhas da Shopee continua = cartao da Shopee. Consolidado = ML (como antes) + Shopee.
-- ---------------------------------------------------------------------
create or replace function analytics.ads_campanhas(p_canal text, p_de date, p_ate date)
returns table (campanha_id text, nome text, status text, automatica boolean, orcamento_diario numeric,
               roas_target numeric, acos_equivalente numeric, investimento numeric, vendas_ads numeric,
               acos numeric, roas numeric, modelos integer, modo text)
language plpgsql stable security invoker set search_path = '' as $$
#variable_conflict use_column
declare
  v_inv    numeric;
  v_inv_sh numeric;
begin
  if not core.has_perm('ads') or coalesce(p_canal, '') not in ('consolidado', 'mercadolivre', 'shopee') then
    return;
  end if;
  v_inv := coalesce(analytics.dash_ads_periodo(p_canal, p_de, p_ate), 0);
  -- parte da Shopee do cartao (no consolidado, v_inv - v_inv_sh = parte do ML)
  v_inv_sh := case when p_canal in ('consolidado', 'shopee')
                   then coalesce(analytics.dash_ads_periodo('shopee', p_de, p_ate), 0) else 0 end;

  return query
  with met as materialized (
    select m.channel, m.item_id, coalesce(m.campaign_id, an.campaign_id) as campaign_id,
           sum(coalesce(m.cost, 0)) as inv,
           sum(coalesce(m.direct_amount, 0) + coalesce(m.indirect_amount, 0)) as vend
      from mkt.ads_metrics_daily m
      left join mkt.ads_anuncios an on an.channel = m.channel and an.item_id = m.item_id
     where m.day between p_de and p_ate
       and (p_canal = 'consolidado' and m.channel in ('mercadolivre', 'shopee') or m.channel = p_canal)
     group by m.channel, m.item_id, coalesce(m.campaign_id, an.campaign_id)
  ),
  -- campanhas reais da Shopee: investimento das metricas por anuncio
  ci_sh as materialized (
    select met.campaign_id, sum(met.inv) as inv
      from met
     where met.channel = 'shopee' and met.campaign_id is not null and met.campaign_id <> 'conta'
     group by met.campaign_id
  ),
  ci as materialized (
    select a.channel, a.campaign_id, sum(a.cost) as inv
      from mkt.ads_campaign_daily a
     where a.day between p_de and p_ate
       and a.channel = 'mercadolivre' and p_canal in ('consolidado', 'mercadolivre')
     group by a.channel, a.campaign_id
    union all
    select 'shopee'::text, c.campaign_id, c.inv from ci_sh c
    union all
    -- sobra da conta Shopee: cartao da Shopee - campanhas reais (negativa nunca aparece; o ruido some em linhas)
    select 'shopee'::text, 'conta'::text, greatest(v_inv_sh - coalesce((select sum(c.inv) from ci_sh c), 0), 0)
     where p_canal in ('consolidado', 'shopee')
  ),
  sobra_sh as (
    select v_inv_sh - coalesce((select sum(c.inv) from ci_sh c), 0) as inv
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
  ,
  linhas as (
    select k.channel, k.campaign_id,
           coalesce(nullif(c.name, ''), k.campaign_id) as nome,
           c.status,
           c.automatica,
           c.budget::numeric as orc,
           c.roas_target,
           case when c.roas_target > 0 then round(100 / c.roas_target, 2) end as acos_eq,
           round(coalesce(ci.inv, 0), 2) as inv,
           round(coalesce(vc.vend, 0), 2) as vend,
           case when vc.vend > 0 then round(coalesce(ci.inv, 0) / vc.vend * 100, 2) end as acos,
           case when ci.inv > 0 then round(coalesce(vc.vend, 0) / ci.inv, 2) end as roas,
           coalesce(mc.n, 0)::integer as n,
           coalesce((select x.modo from core.ads_modo x
                      where x.channel = k.channel and x.tipo = 'campanha' and x.chave = k.campaign_id), 'manual') as modo,
           k.campaign_id as desempate
      from k
      left join mkt.ads_campaigns c on c.channel = k.channel and c.campaign_id = k.campaign_id
      left join ci on ci.channel = k.channel and ci.campaign_id = k.campaign_id
      left join vc on vc.channel = k.channel and vc.campaign_id = k.campaign_id
      left join mc on mc.channel = k.channel and mc.campaign_id = k.campaign_id
     -- 'conta' da Shopee sem sobra de verdade (investimento < 0,05, inclusive negativo, e vendas < 0,05): some
     where not (k.channel = 'shopee' and k.campaign_id = 'conta'
                and (select s.inv from sobra_sh s) < 0.05 and abs(coalesce(vc.vend, 0)) < 0.05)
  ),
  nao as (
    -- so a parte do ML (a Shopee ja soma o proprio cartao nas linhas dela, salvo o ruido escondido)
    select round(v_inv - v_inv_sh - coalesce((select sum(l.inv) from linhas l where l.channel = 'mercadolivre'), 0), 2) as inv,
           round(coalesce((select sum(m.vend) from met m where m.campaign_id is null), 0), 2) as vend,
           exists (select 1 from met m where m.campaign_id is null) as tem
  )
  select r.campaign_id, r.nome, r.status, r.automatica, r.orc, r.roas_target, r.acos_eq, r.inv, r.vend, r.acos, r.roas, r.n, r.modo
    from (
      select l.campaign_id, l.nome, l.status, l.automatica, l.orc, l.roas_target, l.acos_eq, l.inv, l.vend, l.acos, l.roas,
             l.n, l.modo, l.desempate, 0 as ordem
        from linhas l
      union all
      select null::text, null::text, null::text, null::boolean, null::numeric, null::numeric, null::numeric,
             n.inv, n.vend, null::numeric, null::numeric, null::integer, null::text, null::text, 1
        from nao n
       where n.inv <> 0 or n.tem
    ) r
   order by r.ordem, r.inv desc, r.nome, r.desempate;
end $$;

grant execute on function analytics.ads_campanhas(text, date, date) to authenticated;

grant execute on function analytics.ads_peso_sem_venda(text, date, date, text[]),
                          analytics.ads_peso_modelo(text, date, date),
                          analytics.ads_sugestoes(text, date),
                          analytics.ads_modelos(text, date, date) to authenticated;
