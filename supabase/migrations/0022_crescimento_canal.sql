-- =====================================================================
-- 0022 - Crescimento por canal e parametros da sugestao (Tarefa 6 do projeto Shopee).
-- Pode ser reexecutada. Aplicar depois da 0021 (usa analytics.dash_resumo com a Shopee).
--
-- * core.parametros_crescimento: percentuais da sugestao por canal e vigencia (vale a linha com o
--   maior vigente_desde <= fim do periodo analisado). Leitura com a permissao 'vendas'; edicao so
--   pelo admin (como core.parametros_ads). Semente 10% / 10% nos dois canais desde 2025-01-01, para
--   os periodos historicos tambem terem parametros; on conflict do nothing preserva o que o admin mudou.
-- * analytics.crescimento_canal: por canal, vendas brutas do periodo, do periodo anterior (datas
--   recebidas) e do mesmo periodo do ano passado, e a margem depois do Ads (% da receita) do periodo e
--   do anterior. Tudo vem de analytics.dash_resumo: a margem de contribuicao de la ja desconta o Ads
--   (dash_ads_periodo), entao a margem depois do Ads e a propria margem de contribuicao, sem descontar
--   o Ads de novo. Sem 'custos', dash_resumo devolve a margem nula e as margens daqui tambem.
--   A sugestao (investir mais, manter, reduzir, sem historico) e calculada na tela
--   (apps/web/lib/crescimento.ts), com os percentuais devolvidos aqui.
-- =====================================================================

create table if not exists core.parametros_crescimento (
  channel         text not null check (channel in ('mercadolivre', 'shopee')),
  vigente_desde   date not null,
  pct_crescimento numeric not null default 10 check (pct_crescimento > 0),
  pct_queda       numeric not null default 10 check (pct_queda > 0 and pct_queda <= 100),
  primary key (channel, vigente_desde)
);
insert into core.parametros_crescimento (channel, vigente_desde, pct_crescimento, pct_queda) values
  ('mercadolivre', '2025-01-01', 10, 10),
  ('shopee', '2025-01-01', 10, 10)
on conflict (channel, vigente_desde) do nothing;

alter table core.parametros_crescimento enable row level security;
drop policy if exists "parametros crescimento: leitura" on core.parametros_crescimento;
drop policy if exists "parametros crescimento: admin altera" on core.parametros_crescimento;
create policy "parametros crescimento: leitura" on core.parametros_crescimento for select to authenticated
  using ((select core.has_perm('vendas')));
create policy "parametros crescimento: admin altera" on core.parametros_crescimento for all to authenticated
  using ((select core.my_role()) = 'admin') with check ((select core.my_role()) = 'admin');
grant select, insert, update, delete on core.parametros_crescimento to authenticated;

-- ---------------------------------------------------------------------
-- Crescimento por canal. p_canal: 'mercadolivre', 'shopee' ou 'consolidado' (uma linha por canal
-- visivel). Exige 'vendas' e respeita core.can_see_channel. Security invoker: dash_resumo e a tabela
-- de parametros seguem a RLS de quem consulta.
-- Margem depois do Ads = margem de contribuicao / receita * 100 (nula sem 'custos' ou sem receita).
-- ---------------------------------------------------------------------
create or replace function analytics.crescimento_canal(p_canal text, p_de date, p_ate date,
                                                       p_anterior_de date, p_anterior_ate date)
returns table (canal text, vendas_atual numeric, vendas_anterior numeric, vendas_ano_passado numeric,
               margem_pos_ads_atual numeric, margem_pos_ads_anterior numeric,
               pct_crescimento numeric, pct_queda numeric)
language sql stable security invoker set search_path = '' as $$
  with canais as (
    select c.canal
      from unnest(array['mercadolivre', 'shopee']) as c(canal)
     where (select core.has_perm('vendas'))
       and (p_canal = 'consolidado' or c.canal = p_canal)
       and core.can_see_channel(c.canal)
       and p_de is not null and p_ate is not null and p_anterior_de is not null and p_anterior_ate is not null
  )
  select c.canal,
         a.vendas_brutas,
         p.vendas_brutas,
         y.vendas_brutas,
         case when a.receita > 0 then round(a.margem_contribuicao / a.receita * 100, 4) end,
         case when p.receita > 0 then round(p.margem_contribuicao / p.receita * 100, 4) end,
         pc.pct_crescimento,
         pc.pct_queda
    from canais c
   cross join lateral analytics.dash_resumo(c.canal, p_de, p_ate) a
   cross join lateral analytics.dash_resumo(c.canal, p_anterior_de, p_anterior_ate) p
   cross join lateral analytics.dash_resumo(c.canal, (p_de - interval '1 year')::date, (p_ate - interval '1 year')::date) y
    left join lateral (
      select x.pct_crescimento, x.pct_queda
        from core.parametros_crescimento x
       where x.channel = c.canal and x.vigente_desde <= p_ate
       order by x.vigente_desde desc
       limit 1
    ) pc on true
   order by c.canal
$$;

revoke execute on function analytics.crescimento_canal(text, date, date, date, date) from public, anon;
grant execute on function analytics.crescimento_canal(text, date, date, date, date) to authenticated;
