-- =====================================================================
-- 0020 - Shopee: pagamentos (escrow) por pedido, view analytics.shopee_fatura
--        e a lista de pedidos que precisam ser buscados de novo.
-- Pode ser executada mais de uma vez (preserva os dados gravados).
--
-- Convencao de sinal igual a analytics.ml_fatura: custo POSITIVO, credito negativo.
-- Categorias (relatorio de cobertura aprovado em 26/11/2026):
--   comissao       commission_fee
--   taxa_servico   service_fee
--   taxa_transacao seller_transaction_fee + credit_card_transaction_fee
--   frete          actual_shipping_fee - shopee_shipping_rebate (negativo se o subsidio passar do frete)
--   cupom_vendedor voucher_from_seller (ou seller_voucher); seller_discount nao entra (ja esta no preco do item)
--   campanha       campaign_fee
--   processamento  seller_order_processing_fee
--   devolucao      return_handling_fee + reverse_shipping_fee
--   liquido        escrow_amount (valor que a loja recebe). NAO e tarifa: fica fora da view.
-- Tarifa ausente ou zero nao vira linha. Pedido sem escrow fica sem linha (e volta a ser buscado).
-- =====================================================================

create table if not exists mkt.shopee_escrow (
  channel       text not null default 'shopee' check (channel = 'shopee'),
  order_id      text not null,
  categoria     text not null check (categoria in ('comissao', 'taxa_servico', 'taxa_transacao', 'frete', 'cupom_vendedor',
                                                   'campanha', 'processamento', 'devolucao', 'liquido')),
  valor         numeric(14, 2) not null,
  data_ref      date not null,            -- data da criacao do pedido (America/Sao_Paulo)
  atualizado_em timestamptz not null default now(),
  primary key (order_id, categoria),
  foreign key (channel, order_id) references mkt.orders (channel, order_id) on delete cascade
);

-- Leitura so por quem ve custos e o canal Shopee (como mkt.billing_details / analytics.ml_fatura)
alter table mkt.shopee_escrow enable row level security;
drop policy if exists "escrow: quem ve custos" on mkt.shopee_escrow;
create policy "escrow: quem ve custos" on mkt.shopee_escrow for select to authenticated
  using ((select core.can_see_costs()) and (select core.can_see_channel('shopee')));
revoke all on mkt.shopee_escrow from anon, authenticated;
grant select on mkt.shopee_escrow to authenticated;

-- Mesmas colunas usadas de analytics.ml_fatura; security_invoker aplica a RLS da tabela
create or replace view analytics.shopee_fatura with (security_invoker = true) as
select e.order_id, e.categoria, e.valor, e.data_ref
  from mkt.shopee_escrow e
 where e.categoria <> 'liquido';
grant select on analytics.shopee_fatura to authenticated;

-- Grava o escrow dos pedidos informados: apaga as linhas deles e grava as novas (idempotente).
-- Linhas com valor zero ou de pedido fora da lista sao ignoradas. Uso so do job de sincronizacao.
create or replace function mkt.shopee_gravar_escrow(p_pedidos text[], p_linhas jsonb)
returns integer
language plpgsql set search_path = '' as $$
declare
  v_n integer;
begin
  delete from mkt.shopee_escrow where order_id = any (p_pedidos);
  insert into mkt.shopee_escrow (order_id, categoria, valor, data_ref, atualizado_em)
  select x.order_id, x.categoria, round(x.valor, 2), x.data_ref, now()
    from jsonb_to_recordset(coalesce(p_linhas, '[]'::jsonb)) as x(order_id text, categoria text, valor numeric, data_ref date)
   where x.order_id = any (p_pedidos) and coalesce(round(x.valor, 2), 0) <> 0
  on conflict (order_id, categoria) do update
     set valor = excluded.valor, data_ref = excluded.data_ref, atualizado_em = excluded.atualizado_em;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function mkt.shopee_gravar_escrow(text[], jsonb) from public, anon, authenticated;

-- Pedidos pagos dos ultimos 12 meses ainda sem pagamento final: sem nenhuma linha de escrow,
-- ou ainda nao concluidos na Shopee (o escrow pode mudar ate a entrega). Os mais antigos primeiro.
create or replace function mkt.shopee_pedidos_pendentes(p_limite integer default 500)
returns setof text
language sql stable set search_path = '' as $$
  select o.order_id
    from mkt.orders o
   where o.channel = 'shopee'
     and o.status = 'paid'
     and o.date_created >= now() - interval '365 days'
     and (coalesce(o.raw ->> 'order_status', '') <> 'COMPLETED'
          or not exists (select 1 from mkt.shopee_escrow e where e.order_id = o.order_id))
   order by o.date_created, o.order_id
   limit greatest(coalesce(p_limite, 500), 0)
$$;
revoke all on function mkt.shopee_pedidos_pendentes(integer) from public, anon, authenticated;
