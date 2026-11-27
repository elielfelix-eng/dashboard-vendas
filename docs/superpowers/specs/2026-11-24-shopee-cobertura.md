# Shopee: cobertura real da API (Tarefa 2)

Data: 26/11/2026. Fonte: sonda somente leitura rodada no GitHub Actions com a loja conectada. Status: **aprovado pelo dono em 26/11/2026**, com as três decisões abaixo aceitas como propostas.

## Resumo
- A Shopee oferece quase tudo o que o painel usa do Mercado Livre: pedidos, itens, variações, SKU, tarifas e frete reais por pedido, Ads da conta e avaliações.
- **Faltam dois dados:** o desempenho de Ads **por produto** (o endpoint respondeu 404) e as **visitas** dos anúncios (ainda não testadas).
- **Histórico:** a loja tem pedidos desde **junho de 2026**, 392 até hoje. A carga inicial leva menos de 1 minuto.

## Volume (pedidos por mês)

| Mês | 06/26 | 07/26 | 08/26 | 09/26 | 10/26 | 11/26 (parcial) |
|---|---|---|---|---|---|---|
| Pedidos | 16 | 23 | 39 | 67 | 82 | 165 |

De novembro de 2025 a maio de 2026 não há nenhum pedido. A janela máxima da lista de pedidos é de **15 dias**: com 16 dias a Shopee devolve `order.order_list_invalid_time`.

## Cobertura, dado a dado

| Dado no painel (Mercado Livre) | Shopee | Onde |
|---|---|---|
| Pedidos: número, data, status, total | **Tem** | `order/get_order_list` (lista, 100 por página) + `order/get_order_detail` (`order_sn`, `create_time`, `pay_time`, `order_status`, `total_amount`) |
| Itens do pedido: anúncio, variação, quantidade, preço | **Tem** | `item_list[]` (`item_id`, `model_id`, `model_quantity_purchased`, `model_discounted_price`, `model_original_price`) |
| SKU para ligar ao modelo do ERP | **Tem** | `item_sku` e `model_sku` no pedido e no pagamento; mesma regra do Mercado Livre (pelo SKU) |
| Cancelados e devolvidos | **Tem** | `order_status` no detalhe; quantidades `cancelled_qty`, `returned_qty`; `returns/get_return_list` |
| Tarifa de venda | **Tem** | Pagamento (`payment/get_escrow_detail_batch`, 50 por chamada): `commission_fee`, `service_fee`, `seller_transaction_fee`, com o detalhe em `net_commission_fee_info_list` e `net_service_fee_info_list` |
| Frete real | **Tem** | `actual_shipping_fee`, `final_shipping_fee`, `shopee_shipping_rebate`, `seller_shipping_discount`, `buyer_paid_shipping_fee` |
| Valor líquido recebido | **Tem** | `escrow_amount` (e `escrow_amount_after_adjustment`) |
| Cupons e descontos | **Tem** | `seller_voucher`, `shopee_voucher`, `coins`, `seller_discount`, `shopee_discount`, `pix_discount` |
| Anúncios: título, status, preço, estoque, categoria, foto | **Tem** | `product/get_item_list` (53 ativos) + `get_item_base_info` + `get_model_list` (variações com SKU, preço e estoque) |
| Tipo de anúncio (clássico/premium) | **Não tem** | A Shopee não tem esse conceito; a coluna fica vazia para a Shopee |
| Full (logística da plataforma) | **Tem** | `is_fulfillment_by_shopee` |
| Visitas e conversão por anúncio | **Não verificado** | A sonda não testou. Candidato: `product/get_item_extra_info` (visualizações acumuladas, sem série diária) |
| Ads da conta por dia: investimento, impressões, cliques, vendas por Ads, ROAS | **Tem** | `ads/get_all_cpc_ads_daily_performance` (`expense`, `impression`, `clicks`, `direct_gmv`, `broad_gmv`, `direct_roas`, `broad_roas`, pedidos e itens) |
| Ads por produto (ACOS por modelo, sugestão por produto) | **Não tem nesta sonda** | `ads/get_product_level_cpc_ads_daily_performance` respondeu **404 (error_not_found)**. Pode ser outro nome de endpoint ou falta de permissão; ver decisão 1 |
| Saldo de Ads | **Tem** | `ads/get_total_balance` (saldo atual; o orçamento mensal continua sendo o do painel) |
| Prazo de despacho (para alertas futuros) | **Tem** | `ship_by_date` e `days_to_ship` no detalhe do pedido; entrega estimada em `edt_from` / `edt_to` |
| Avaliações | **Tem** | `product/get_comment` (`rating_star`, `comment`, resposta) |
| Reputação da loja | **Não verificado** | Fora deste projeto (os alertas de reputação são só do Mercado Livre por enquanto) |

## Tarifas que o pagamento da Shopee separa
Comissão (`commission_fee`, com regras em `net_commission_fee_info_list`), taxa de serviço (`service_fee`, com categorias em `net_service_fee_info_list`), taxa de transação (`seller_transaction_fee`, `credit_card_transaction_fee`), frete (`actual_shipping_fee`, `final_shipping_fee`, menos `shopee_shipping_rebate`), cupons do vendedor e da Shopee, moedas, campanhas (`campaign_fee`), processamento de pedido (`seller_order_processing_fee`) e devolução (`return_handling_fee`, `reverse_shipping_fee`). O valor que a loja recebe é `escrow_amount`.

## Privacidade
O pagamento traz `buyer_user_name` e o detalhe do pedido traz dados de envio. Assim como no Mercado Livre, o painel não guarda nome nem endereço do comprador em colunas próprias.

## Validação (Tarefa 8, 27/11/2026)

Painel conferido com o Seller Center, o Shopee Ads e o Mercado Ads.

| Outubro/2026 | Plataforma | Painel | Resultado |
|---|---|---|---|
| Shopee: vendas | R$ 31.587,34 | R$ 31.587,34 | igual |
| Shopee: pedidos / cancelados | 71 / 4 | 71 / 4 | igual |
| Shopee Ads: investimento | R$ 2.617,30 | R$ 2.617,32 | arredondamento |
| Shopee Ads: vendas por Ads / ROAS | R$ 30.481,28 / 11,65 | R$ 30.481,28 / 11,65 | igual |
| Mercado Livre: Product Ads | R$ 8.224 | R$ 8.224,41 | igual |
| Mercado Livre: receita por Ads | R$ 40.531 | R$ 40.531,39 | igual |

- **Novembro (01 a 27/11):** a Shopee mostra R$ 56.594,30 em 153 pedidos. O Seller Center mostra R$ 54.359,61 em 151 pedidos, porque ainda não inclui o dia em curso. A diferença é exatamente a venda do dia: R$ 2.234,69 em 2 pedidos.
- **Consolidado:** é a soma exata dos dois canais em vendas, pedidos, margens, Ads e cancelados.
- **Tarifas da Shopee:** o escrow de 327 pedidos fecha centavo a centavo com o valor repassado.
- **Pontos anteriores ao projeto Shopee**, que não vêm desta mudança e ficam para decisão do dono:
  - **Pedidos sem fatura no ML:** com a comissão isenta desde 10/2026, muitos pedidos do ML nunca recebem linha de fatura. O painel estima o frete desses pedidos: em outubro foram R$ 4.288,49, contra R$ 1.539,44 na fatura.
  - **Seguidores pela data da fatura:** o painel mostra R$ 52,12 em outubro. O Mercado Ads mostra R$ 539, contado pelo dia do gasto.
  - **Imposto e embalagem sem cadastro:** estão em 0% no ML, e a Shopee não tem cadastro.

## Decisões para o dono
1. **Ads por produto.** Sem esse dado, a Shopee entra no Ads só no nível da conta: investimento, ROAS, ACOS e TACOS gerais, sem ranking nem sugestão por produto. Proposta: seguir assim e tentar o endpoint correto na Tarefa 4. Se ele existir, o ranking por produto entra lá.
2. **Visitas e conversão.** Proposta: testar `get_item_extra_info` na Tarefa 3. Se só houver o total acumulado (sem série diária), a conversão da Shopee fica fora da comparação por período.
3. **Histórico.** Carregar tudo desde junho de 2026 (392 pedidos) na primeira sincronização. A comparação com o "mesmo período do ano passado" fica sem dado da Shopee até junho de 2027.
