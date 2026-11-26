-- =====================================================================
-- 0034 - Nome da linha 'conta' da Shopee em Ads > Campanhas (Tarefa 7 do projeto Shopee).
-- Pode ser reexecutada. Aplicar depois da 0032 e da 0033.
--
-- Desde a 0033 a linha 'conta' da Shopee em ads_campanhas mostra so a SOBRA da conta (o que nao entrou
-- em nenhuma campanha real). O nome "Shopee Ads (conta inteira)" ficou errado: passa a
-- "Shopee Ads (sobra da conta)". So muda essa linha; reaplicar a 0032 nao volta o nome antigo
-- (la o insert e "on conflict do nothing").
-- =====================================================================

update mkt.ads_campaigns
   set name = 'Shopee Ads (sobra da conta)'
 where channel = 'shopee' and campaign_id = 'conta'
   and name is distinct from 'Shopee Ads (sobra da conta)';
