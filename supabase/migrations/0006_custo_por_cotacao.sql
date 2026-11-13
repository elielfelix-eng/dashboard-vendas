-- =====================================================================
-- 0006 - Custo do produto pela cotacao de compra (substitui a regra da V1)
-- Pode ser reexecutada. Se a 0003 for reaplicada, reaplique esta depois.
-- A 0007 recria as views com o de-para de referencia: reaplicar a 0007 depois desta.
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
language plpgsql stable set search_path = '' as $$
-- Mesma regra de antes, mas cada passo usa o indice (product_id, created_at) em vez de
-- reler todas as cotacoes do modelo a cada item vendido. "Ate a data D" = cotacao feita
-- antes do inicio do dia seguinte a D, em horario de Brasilia.
declare
  v_lim   timestamptz;
  v_ini   timestamptz;
  v_fim   timestamptz;
  v_dia   date;
  v_price numeric;
begin
  if p_modelo is null then
    return query select 0::numeric, 'sem_custo'::text;
    return;
  end if;
  v_lim := (((p_data at time zone 'America/Sao_Paulo')::date + 1)::timestamp at time zone 'America/Sao_Paulo');

  -- 1. cotacao mais recente ate D cuja faixa contem N (empate no horario: maior preco)
  select t.price into v_price
    from erp.cost_tiers t
   where t.product_id = p_modelo and t.created_at < v_lim
     and p_units between t.qty_start and coalesce(t.qty_end, 2147483647)
   order by t.created_at desc, t.price desc
   limit 1;
  if found then
    return query select v_price, null::text;
    return;
  end if;

  -- 2. nenhuma contem N: dia da cotacao mais recente ate D; nesse dia, a faixa mais proxima de N
  select (max(t.created_at) at time zone 'America/Sao_Paulo')::date into v_dia
    from erp.cost_tiers t
   where t.product_id = p_modelo and t.created_at < v_lim;
  if v_dia is not null then
    v_ini := (v_dia::timestamp at time zone 'America/Sao_Paulo');
    v_fim := ((v_dia + 1)::timestamp at time zone 'America/Sao_Paulo');
    select t.price into v_price
      from erp.cost_tiers t
     where t.product_id = p_modelo and t.created_at >= v_ini and t.created_at < v_fim
     order by case when p_units < t.qty_start then t.qty_start - p_units
                   when p_units > coalesce(t.qty_end, 2147483647) then p_units - t.qty_end
                   else 0 end,
              t.created_at desc, t.price desc
     limit 1;
    return query select v_price, null::text;
    return;
  end if;

  -- 3. nenhuma cotacao ate D: o primeiro dia com cotacao depois de D (alerta 'faixa_atual')
  select (min(t.created_at) at time zone 'America/Sao_Paulo')::date into v_dia
    from erp.cost_tiers t
   where t.product_id = p_modelo and t.created_at >= v_lim;
  if v_dia is not null then
    v_ini := (v_dia::timestamp at time zone 'America/Sao_Paulo');
    v_fim := ((v_dia + 1)::timestamp at time zone 'America/Sao_Paulo');
    select t.price into v_price
      from erp.cost_tiers t
     where t.product_id = p_modelo and t.created_at >= v_ini and t.created_at < v_fim
     order by case when p_units < t.qty_start then t.qty_start - p_units
                   when p_units > coalesce(t.qty_end, 2147483647) then p_units - t.qty_end
                   else 0 end,
              t.created_at, t.price desc
     limit 1;
    return query select v_price, 'faixa_atual'::text;
    return;
  end if;

  -- 4. modelo sem cotacao
  return query select 0::numeric, 'sem_custo'::text;
end $$;

grant execute on function analytics.resolve_unit_cost(text, timestamptz, integer) to authenticated;
