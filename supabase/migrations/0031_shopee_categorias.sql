-- =====================================================================
-- 0031 - Shopee: categorias decididas com os dados reais (conferencia de 317 pedidos).
-- Pode ser executada mais de uma vez. Aplicar depois da 0020 e da 0030.
--
-- Categorias de mkt.shopee_escrow (custo POSITIVO, credito negativo; cada campo com o proprio sinal):
--   comissao       commission_fee (nao net_commission_fee: o descontado e o commission_fee)
--   taxa_servico   service_fee (nao net_service_fee)
--   taxa_transacao seller_transaction_fee. credit_card_transaction_fee NAO entra: nao e descontada
--                  do escrow_amount (pedido 260821UJHT4HEC)
--   frete          actual_shipping_fee - shopee_shipping_rebate - buyer_paid_shipping_fee (negativo = credito)
--   cupom_vendedor voucher_from_seller (ou seller_voucher); seller_discount nao entra (ja esta no preco do item)
--   campanha       campaign_fee
--   processamento  seller_order_processing_fee
--   devolucao      return_handling_fee + reverse_shipping_fee
--   protecao_frete shipping_seller_protection_fee_amount + delivery_seller_protection_fee_premium_amount (NOVA)
--   reembolso      -seller_return_refund (a Shopee manda negativo; vira custo positivo) (NOVA)
--   liquido        escrow_amount (valor que a loja recebe). NAO e tarifa: fica fora de analytics.shopee_fatura.
--
-- REGRAVACAO: esta migration APAGA mkt.shopee_escrow_campos. Com isso todo pedido pago dos ultimos
-- 12 meses volta para mkt.shopee_pedidos_pendentes (regra "sem campos" da 0030), e a proxima
-- sincronizacao busca de novo o pagamento e regrava as duas tabelas (tarifas e campos) com o
-- mapeamento novo. Reexecutar a migration so provoca uma nova regravacao (sem perda de dado).
-- Se a 0020 for reaplicada, reaplicar a 0030 e esta depois.
-- =====================================================================

alter table mkt.shopee_escrow drop constraint if exists shopee_escrow_categoria_check;
alter table mkt.shopee_escrow add constraint shopee_escrow_categoria_check
  check (categoria in ('comissao', 'taxa_servico', 'taxa_transacao', 'frete', 'cupom_vendedor', 'campanha',
                       'processamento', 'devolucao', 'protecao_frete', 'reembolso', 'liquido'));

delete from mkt.shopee_escrow_campos;
