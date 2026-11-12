-- =====================================================================
-- 0007 - De-para de modelo (SKU do anuncio -> Referencia do ERP)
-- Pode ser reexecutada. Aplicar depois da 0006 (e reaplicar se a 0003/0006 forem reaplicadas).
--
-- Quando o SKU do anuncio tem um modelo que nao existe no ERP, o custo e buscado
-- no modelo do ERP indicado aqui. "ate" limita a ligacao as vendas ate essa data
-- (horario de Brasilia); vazio = vale sempre.
-- =====================================================================

create schema if not exists map;
grant usage on schema map to authenticated;

create table if not exists map.modelo_de_para (
  id             bigserial primary key,
  modelo_anuncio text not null,          -- modelo como esta no SKU do anuncio (ex.: SQM148)
  modelo_erp     text not null,          -- Referencia no ERP (ex.: BMS148)
  ate            date,                   -- ultima data de venda coberta; vazio = sem limite
  obs            text,
  criado_em      timestamptz not null default now(),
  unique (modelo_anuncio, ate)
);

alter table map.modelo_de_para enable row level security;
drop policy if exists "de-para: leitura" on map.modelo_de_para;
drop policy if exists "de-para: admin altera" on map.modelo_de_para;
create policy "de-para: leitura" on map.modelo_de_para for select to authenticated using (true);
create policy "de-para: admin altera" on map.modelo_de_para for all to authenticated
  using (core.my_role() = 'admin') with check (core.my_role() = 'admin');
grant select, insert, update, delete on map.modelo_de_para to authenticated;
grant usage on sequence map.modelo_de_para_id_seq to authenticated;

-- Pedidos do dono em 12/11/2026 (SKU errado no anuncio), vendas ate essa data:
--   SQM148 -> BMS148
--   CMT44 (CMT44-CDE-67..72, os unicos CMT44 vendidos) -> BOB01 (BOB01-PDR)
insert into map.modelo_de_para (modelo_anuncio, modelo_erp, ate, obs) values
  ('SQM148', 'BMS148', '2026-11-12', 'SKU errado no anuncio; corrigido a pedido do dono'),
  ('CMT44',  'BOB01',  '2026-11-12', 'CMT44-CDE-67/68/69/70/71/72 = BOB01-PDR; corrigido a pedido do dono')
on conflict (modelo_anuncio, ate) do nothing;

-- Modelo do ERP para um modelo de anuncio numa data.
create or replace function analytics.modelo_erp(p_modelo text, p_data timestamptz)
returns text
language sql stable set search_path = '' as $$
  select coalesce(
    (select d.modelo_erp
       from map.modelo_de_para d
      where d.modelo_anuncio = p_modelo
        and (d.ate is null or (p_data at time zone 'America/Sao_Paulo')::date <= d.ate)
      order by d.ate nulls last
      limit 1),
    p_modelo);
$$;

-- Regra de custo da 0006 + de-para de modelo.
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
     where t.product_id = analytics.modelo_erp(p_modelo, p_data)
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

grant execute on function analytics.modelo_erp(text, timestamptz),
                          analytics.resolve_unit_cost(text, timestamptz, integer) to authenticated;
