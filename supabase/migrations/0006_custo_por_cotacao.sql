-- =====================================================================
-- 0006 - Custo do produto pela cotacao de compra (substitui a regra da V1)
-- Pode ser reexecutada. Se a 0003 for reaplicada, reaplique esta depois.
-- A 0007 redefine resolve_unit_cost (acrescenta o de-para de modelo): reaplicar a 0007 depois desta.
--
-- erp.cost_tiers passa a receber o HISTORICO de cotacoes do ERP (tabela Cotacoes,
-- fornecedor padrao): cada linha e uma faixa qty_start..qty_end cotada em created_at.
-- Tabelas do fornecedor (varias faixas no mesmo dia) e cotacoes pontuais
-- (qty_start = qty_end) convivem. expired_at nao e usado.
--
-- Para N pecas vendidas na data D (datas em horario de Brasilia):
--   1. cotacoes feitas ate D cuja faixa contem N -> a mais recente
--   2. nenhuma contem N -> a cotacao mais recente ate D; no mesmo dia, a faixa mais
--      proxima de N
--   3. nenhuma cotacao ate D -> a primeira depois de D (alerta 'faixa_atual')
--   4. modelo sem cotacao -> 0 (alerta 'sem_custo')
-- Empate (mesmo horario): maior preco.
-- =====================================================================

create index if not exists cost_tiers_product_created_idx on erp.cost_tiers (product_id, created_at);

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

grant execute on function analytics.resolve_unit_cost(text, timestamptz, integer) to authenticated;
