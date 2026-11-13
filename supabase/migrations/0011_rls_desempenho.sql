-- =====================================================================
-- 0011 - Desempenho das regras de seguranca por linha (RLS)
-- Pode ser reexecutada. Aplicar depois da 0010 (e de novo se a 0002, 0003 ou 0007 forem reaplicadas).
--
-- As politicas chamavam core.can_see_channel(channel) / core.can_see_costs() em CADA linha
-- lida (cada uma consulta o perfil do usuario). Com milhares de pedidos e 112 mil cotacoes,
-- isso estourava o tempo limite do Supabase. Aqui a permissao e calculada uma vez por consulta
-- ("(select ...)" vira um InitPlan), com o mesmo resultado.
-- =====================================================================

-- Canais liberados ao usuario (calculado uma vez por consulta nas politicas)
create or replace function core.my_channels() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(c), '{}')
    from unnest(array['mercadolivre', 'shopee', 'crm']) as c
   where core.can_see_channel(c)
$$;
grant execute on function core.my_channels() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['items', 'item_variations', 'orders', 'order_items', 'visits_daily',
                           'ads_campaigns', 'ads_metrics_daily', 'ads_campaign_daily']
  loop
    if to_regclass('mkt.' || t) is not null then
      execute format('drop policy if exists "canal liberado" on mkt.%I', t);
      execute format('create policy "canal liberado" on mkt.%I for select to authenticated
                        using (channel = any ((select core.my_channels())::text[]))', t);
    end if;
  end loop;

  foreach t in array array['billing_periods', 'billing_details']
  loop
    if to_regclass('mkt.' || t) is not null then
      execute format('drop policy if exists "fatura: quem ve custos" on mkt.%I', t);
      execute format('create policy "fatura: quem ve custos" on mkt.%I for select to authenticated
                        using ((select core.can_see_costs()) and channel = any ((select core.my_channels())::text[]))', t);
    end if;
  end loop;
end $$;

drop policy if exists "custos: quem ve custos" on erp.cost_tiers;
drop policy if exists "custos: admin altera" on erp.cost_tiers;
create policy "custos: quem ve custos" on erp.cost_tiers for select to authenticated
  using ((select core.can_see_costs()));
create policy "custos: admin altera" on erp.cost_tiers for all to authenticated
  using ((select core.my_role()) = 'admin') with check ((select core.my_role()) = 'admin');

drop policy if exists "de-para: admin altera" on map.modelo_de_para;
create policy "de-para: admin altera" on map.modelo_de_para for all to authenticated
  using ((select core.my_role()) = 'admin') with check ((select core.my_role()) = 'admin');

drop policy if exists "parametros: leitura" on core.parametros_custo;
drop policy if exists "parametros: admin altera" on core.parametros_custo;
create policy "parametros: leitura" on core.parametros_custo for select to authenticated
  using ((select core.has_perm('custos')) or (select core.has_perm('configuracoes')));
create policy "parametros: admin altera" on core.parametros_custo for all to authenticated
  using ((select core.my_role()) = 'admin') with check ((select core.my_role()) = 'admin');
