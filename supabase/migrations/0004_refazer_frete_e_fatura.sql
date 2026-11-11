-- =====================================================================
-- 0004 — Correções de dados após a comparação com a V1.
-- Pode ser executado mais de uma vez.
--  1) Frete de envios com mais de um pedido: limpa para ser recalculado
--     (o pedido cancelado/dividido não entra mais no rateio).
--  2) Fatura: força a releitura de todos os períodos na próxima sincronização
--     (a leitura anterior podia parar antes do fim).
-- =====================================================================

update mkt.orders
   set shipping_cost_seller = null
 where channel = 'mercadolivre'
   and shipment_id in (
     select shipment_id from mkt.orders
      where channel = 'mercadolivre' and shipment_id is not null
      group by shipment_id having count(*) > 1
   );

delete from mkt.billing_periods where channel = 'mercadolivre';
