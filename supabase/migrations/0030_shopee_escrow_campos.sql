-- =====================================================================
-- 0030 - Shopee: todos os campos em dinheiro do pagamento (escrow), para conferencia.
-- Pode ser executada mais de uma vez (preserva os dados). Aplicar depois da 0020
-- (e de novo se a 0020 for reaplicada: ela redefine mkt.shopee_pedidos_pendentes).
--
-- mkt.shopee_escrow guarda so as categorias mapeadas. Esta tabela guarda, por pedido, todos os
-- campos NUMERICOS (diferentes de zero) do nivel de cima de escrow_detail.order_income, para achar
-- o que a conferencia (analytics.shopee_conciliacao) ainda nao explica. Nunca textos; nunca campos
-- buyer_* (exceto buyer_paid_shipping_fee, que e dinheiro); nunca identificadores (id, *_id).
-- O mapeamento das tarifas NAO muda aqui.
-- =====================================================================

create table if not exists mkt.shopee_escrow_campos (
  channel       text not null default 'shopee' check (channel = 'shopee'),
  order_id      text primary key,
  campos        jsonb not null,
  atualizado_em timestamptz not null default now(),
  foreign key (channel, order_id) references mkt.orders (channel, order_id) on delete cascade
);

-- Mesma protecao de mkt.shopee_escrow: so quem ve custos e o canal Shopee
alter table mkt.shopee_escrow_campos enable row level security;
drop policy if exists "escrow campos: quem ve custos" on mkt.shopee_escrow_campos;
create policy "escrow campos: quem ve custos" on mkt.shopee_escrow_campos for select to authenticated
  using ((select core.can_see_costs()) and (select core.can_see_channel('shopee')));
revoke all on mkt.shopee_escrow_campos from anon, authenticated;
grant select on mkt.shopee_escrow_campos to authenticated;

-- Grava os campos dos pedidos informados: apaga as linhas deles e grava as novas (idempotente).
-- p_campos = {"<order_sn>": {"campo": numero, ...}, ...}. O filtro e refeito aqui (defesa em
-- profundidade): so numeros diferentes de zero, sem buyer_* (exceto buyer_paid_shipping_fee) e sem ids.
-- Pedido fora de p_pedidos e ignorado; pedido sem nenhum numero nao vira linha. Uso so do job.
create or replace function mkt.shopee_gravar_escrow_campos(p_pedidos text[], p_campos jsonb)
returns integer
language plpgsql set search_path = '' as $$
declare
  v_n integer;
begin
  delete from mkt.shopee_escrow_campos where order_id = any (p_pedidos);
  insert into mkt.shopee_escrow_campos (order_id, campos, atualizado_em)
  select p.key, c.campos, now()
    from jsonb_each(case when jsonb_typeof(p_campos) = 'object' then p_campos else '{}'::jsonb end) as p
    cross join lateral (
      select jsonb_object_agg(f.key, f.value) as campos
        from jsonb_each(case when jsonb_typeof(p.value) = 'object' then p.value else '{}'::jsonb end) as f
       where coalesce(case when jsonb_typeof(f.value) = 'number' then (f.value)::numeric end, 0) <> 0
         and (f.key not like 'buyer\_%' or f.key = 'buyer_paid_shipping_fee')
         and f.key <> 'id' and f.key not like '%\_id'
    ) as c
   where p.key = any (p_pedidos) and c.campos is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function mkt.shopee_gravar_escrow_campos(text[], jsonb) from public, anon, authenticated;

-- Pendentes (redefinicao da 0020): pagos dos ultimos 12 meses sem escrow, ainda nao concluidos,
-- ou com escrow mas SEM os campos desta tabela (carga unica dos pedidos gravados antes da 0030).
create or replace function mkt.shopee_pedidos_pendentes(p_limite integer default 500)
returns setof text
language sql stable set search_path = '' as $$
  select o.order_id
    from mkt.orders o
   where o.channel = 'shopee'
     and o.status = 'paid'
     and o.date_created >= now() - interval '365 days'
     and (coalesce(o.raw ->> 'order_status', '') <> 'COMPLETED'
          or not exists (select 1 from mkt.shopee_escrow e where e.order_id = o.order_id)
          or not exists (select 1 from mkt.shopee_escrow_campos c where c.order_id = o.order_id))
   order by o.date_created, o.order_id
   limit greatest(coalesce(p_limite, 500), 0)
$$;
revoke all on function mkt.shopee_pedidos_pendentes(integer) from public, anon, authenticated;

-- Um campo por linha, para o diagnostico (ex.: campos que aparecem nos pedidos com diferenca)
create or replace view analytics.shopee_escrow_campos_longo with (security_invoker = true) as
select c.order_id, f.key as campo, case when jsonb_typeof(f.value) = 'number' then (f.value)::numeric end as valor
  from mkt.shopee_escrow_campos c
 cross join lateral jsonb_each(c.campos) as f
 where jsonb_typeof(f.value) = 'number';
grant select on analytics.shopee_escrow_campos_longo to authenticated;
