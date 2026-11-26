-- =====================================================================
-- 0032 - Shopee Ads: gravacao das metricas diarias da Shopee (Tarefa 4 do projeto Shopee).
-- Pode ser executada mais de uma vez (preserva os dados gravados). Aplicar depois da 0018.
--
-- Onde fica cada dado do Ads da Shopee (channel = 'shopee'):
--   mkt.ads_campaign_daily  campaign_id 'conta' = investimento do dia da CONTA inteira
--                           (get_all_cpc_ads_daily_performance: expense). raw = demais numeros da Shopee
--                           (pedidos, ROAS, CTR, custo por conversao). Fonte do cartao de investimento
--                           (analytics.dash_ads_periodo passa a ler a Shopee daqui na 0021).
--   mkt.ads_metrics_daily   uma linha por anuncio e dia quando a Shopee der o desempenho por campanha de
--                           produto; o que sobra da conta fica no item 'conta' (sem anuncio no cadastro:
--                           cai em "sem modelo"). Sem acesso por anuncio: so o item 'conta' com o dia inteiro.
--                           direct_amount = direct_gmv; indirect_amount = broad_gmv - direct_gmv;
--                           direct_units = direct_item_sold; indirect_units = broad_item_sold - direct_item_sold.
--   mkt.ads_campaigns       pseudo-campanha 'conta' (nome) e as campanhas de produto (se houver acesso).
-- Nova busca de um dia: as linhas da Shopee daquele dia sao APAGADAS e regravadas (nunca somadas), assim um
-- dia lido de novo, com ou sem o detalhe por anuncio, nunca conta duas vezes.
-- =====================================================================

insert into mkt.ads_campaigns (channel, campaign_id, name)
values ('shopee', 'conta', 'Shopee Ads (conta inteira)')
on conflict (channel, campaign_id) do nothing;

-- Grava o Ads da Shopee dos dias informados (uso so do job de sincronizacao).
--   p_dias     dias lidos da Shopee nesta execucao (os que a conta devolveu)
--   p_metricas [{item_id, day, campaign_id, impressions, clicks, cost, direct_amount, indirect_amount,
--                direct_units, indirect_units, organic_units}]
--   p_conta    [{day, cost, raw}] (investimento da conta por dia)
-- Apaga as linhas da Shopee desses dias nas duas tabelas e grava as novas. Linha de dia fora de p_dias e
-- ignorada; anuncio/dia repetido no mesmo envio vale uma vez (o ultimo). Devolve as linhas por anuncio gravadas.
create or replace function mkt.shopee_gravar_ads(p_dias date[], p_metricas jsonb, p_conta jsonb)
returns integer
language plpgsql set search_path = '' as $$
declare
  v_n integer;
begin
  delete from mkt.ads_metrics_daily where channel = 'shopee' and day = any (p_dias);
  delete from mkt.ads_campaign_daily where channel = 'shopee' and day = any (p_dias);

  insert into mkt.ads_campaign_daily (channel, campaign_id, day, cost, raw)
  select distinct on (x.day) 'shopee', 'conta', x.day, round(coalesce(x.cost, 0), 2), x.raw
    from jsonb_array_elements(coalesce(p_conta, '[]'::jsonb)) with ordinality as e(v, n)
   cross join lateral jsonb_to_record(e.v) as x(day date, cost numeric, raw jsonb)
   where x.day = any (p_dias)
   order by x.day, e.n desc;

  insert into mkt.ads_metrics_daily (channel, item_id, day, campaign_id, impressions, clicks, cost, direct_amount,
                                     indirect_amount, direct_units, indirect_units, organic_units)
  select distinct on (x.item_id, x.day)
         'shopee', x.item_id, x.day, x.campaign_id, coalesce(x.impressions, 0), coalesce(x.clicks, 0),
         round(coalesce(x.cost, 0), 2), round(coalesce(x.direct_amount, 0), 2), round(coalesce(x.indirect_amount, 0), 2),
         coalesce(x.direct_units, 0), coalesce(x.indirect_units, 0), coalesce(x.organic_units, 0)
    from jsonb_array_elements(coalesce(p_metricas, '[]'::jsonb)) with ordinality as e(v, n)
   cross join lateral jsonb_to_record(e.v) as x(
           item_id text, day date, campaign_id text, impressions integer, clicks integer, cost numeric,
           direct_amount numeric, indirect_amount numeric, direct_units integer, indirect_units integer,
           organic_units integer)
   where x.day = any (p_dias) and nullif(x.item_id, '') is not null
   order by x.item_id, x.day, e.n desc;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function mkt.shopee_gravar_ads(date[], jsonb, jsonb) from public, anon, authenticated;
