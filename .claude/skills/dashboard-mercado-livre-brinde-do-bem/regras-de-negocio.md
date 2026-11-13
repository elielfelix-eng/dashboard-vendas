# Regras de negócio — Mercado Livre (validadas na V1)

Origem: pipeline V1 em Python (`1_renovar_token.py`, `2_coletar.py`, `3_processar.py`), feito direto no claude.ai e conferido contra o painel do Mercado Livre. **Estas regras são a referência**; a implementação atual (TypeScript + Supabase) deve reproduzi-las.

## Conta
- Loja: **BRINDESVOCACAO** — seller `user_id` 494288862.
- Anunciante Product Ads: 2757617 (descoberto via `/advertising/advertisers?product_id=PADS`, header `Api-Version: 1`).
- O Brinde do Bem é a unidade de negócio da ONG Vocação que vende brindes para financiar os projetos da Vocação.

## Endpoints validados
| Dado | Endpoint | Observações |
|---|---|---|
| Pedidos | `/orders/search?seller=<id>&sort=date_asc&limit=50&offset=` | paginar |
| Custo de envio | `/shipments/{id}/costs` | usar `senders[0].cost` |
| Envio dos cancelados | `/shipments/{id}` | `status` e `substatus`, para separar devolvidos/divididos |
| Fatura (períodos) | `/billing/integration/monthly/periods?group=ML&document_type=BILL&limit=12` | máx. 12 |
| Fatura (linhas) | `/billing/integration/periods/key/{key}/group/ML/details?document_type=BILL&limit=1000` | às vezes vem **incompleta**: repetir até duas leituras seguidas com o mesmo nº de linhas e ficar com a mais completa |
| Product Ads | `/advertising/MLB/advertisers/{adv}/product_ads/campaigns/search?date_from&date_to&metrics=cost&aggregation_type=DAILY` | header `api-version: 2`; guarda **90 dias**, inclui hoje |

- **429 (local_rate_limited)**: esperar 10 s × nº da tentativa.
- **Refresh token de uso único**: gravar o novo imediatamente. Se a renovação falhar, **não repetir** — avisar o usuário para reconectar. Nunca restaurar credencial antiga. Access token vale 6 h.

## SKU
- `BLA68-AMA-K0010-V1` → modelo `BLA68`, cor `AMA`, kit de **10** unidades (número após o `K`), versão `V1`.
- `GFT10-AZU` → modelo `GFT10`, cor `AZU`, **sem kit = 1 unidade** (não é alerta).
- Unidades do pedido = unidades do kit × quantidade comprada.
- O **modelo** é a chave para o custo (`productId` da tabela de custos).

## Data da venda
Data da **aprovação do pagamento** (`date_closed`; se faltar, `date_created`), em **horário de Brasília (UTC−3)** — igual ao painel do ML.

## Classificação do pedido (igual às Métricas do ML)
| Situação | Classe |
|---|---|
| `status = paid` | **pago** |
| cancelado com `cancel_detail.code = pack_splitted` ou envio com substatus `pack_splitted` | **dividido** (não conta como venda) |
| cancelado com envio `delivered` ou substatus `returned` | **devolvido** |
| demais cancelados | **cancelado** |

- **Vendas brutas** = preço × qtd de pago + cancelado + devolvido (sem divididos). Qtd de vendas e unidades seguem a mesma regra.
- **Vendas líquidas (receita)** = só pagos. É a base da margem.

## Custo do produto (cotação de compra) — substitui a regra de faixas com validade da V1
Origem: tabela `Cotacoes` do ERP (banco NewFord, SQL Server 2008), via view `painel.faixas_custo` → gateway → `erp.cost_tiers`. Definido com o dono em 11/2026:
- O Brinde do Bem **compra do fornecedor a cada venda**, então a faixa é escolhida pelas **peças do pedido** (kit × quantidade).
- Só o **fornecedor padrão** (`Cotacoes.IdFornecedor = Produtos.Id_FornecedorPadrao`); preço > 0 (preços baixos como 0,10 são válidos); sem personalização.
- `Produtos.Referencia` = modelo do SKU; o custo é o mesmo para todas as cores.
- Dois tipos de linha na `Cotacoes`: tabela do fornecedor (faixas `Qtd..Qtd_Fin`, mesmo dia, `Validade` preenchida) e cotação pontual (`Qtd = Qtd_Fin`, `Validade = 1900`). Linhas antigas sem `Qtd_Fin` → faixa de uma quantidade. `Validade`, `IdStatus`, IPI/ST/Frete não são usados.

Regra (`analytics.resolve_unit_cost`, migration 0006), N peças na data D, datas em Brasília:
1. Cotações até D cuja faixa contém N → a mais recente (empate no horário → maior preço).
2. Nenhuma contém N → a cotação mais recente até D; no mesmo dia, a faixa mais próxima de N.
3. Nenhuma cotação até D → a primeira depois de D, alerta `faixa_atual`.
4. Modelo sem cotação → custo 0, alerta `sem_custo`. Não há alerta de "custo antigo" (o dono não quer).
- `expired_at` não é usado. Custo do produto = preço × peças. **Só pedidos pagos têm custo.**
- Exemplos reais BLA68: 12 peças em 15/10/2026 → R$ 4,14 (tabela 19/08, faixa 11–2549); 10 peças → R$ 4,18; 30 peças em 01/03/2026 → R$ 4,90 (tabela 12/02, faixa 1–254).
- Próximo passo planejado: custo real pela NF de entrada (XML), com a cotação como reserva.
- **De-para de referência** (migration 0007, `map.modelo_de_para` + `analytics.ref_erp`): SKU errado no anúncio → o dashboard **mostra e custeia** a referência do ERP. `ml_pedidos.sku/modelo/cor` já vêm corrigidos; o SKU original fica em `ml_pedidos.sku_anuncio`; `ml_alertas.codigo` também usa a referência do ERP. Campos: `modelo_anuncio`, `cor_anuncio` (vazio = qualquer), `modelo_erp`, `cor_erp` (vazio = mantém), `sku_erp` (SKU inteiro; vazio = troca só modelo/cor), `ate` (vazio = sempre). Unidades do kit continuam vindo do SKU original. Casos (12/11/2026, vendas até essa data): SQM148 → BMS148; CMT44-CDE-67..72 → BOB01-PDR. A 0007 substitui as views ml_pedidos/ml_meses/ml_alertas da 0003 — ordem de aplicação 0003 → 0006 → 0007. Telas da Fase 4 devem ler modelo/sku dessas views.
- A view `painel.faixas_custo` aceita qualquer fornecedor quando o produto não tem fornecedor padrão (casos KON09, BOB01).

## Custos do Mercado Livre (fatura)
| Categoria | Códigos |
|---|---|
| Comissão | CVVML, BVVML, CVVPRC, BVVPRC, CVVFNU, BVVFNU |
| Frete | CXDE, BXDE, CXDI, BXDI, CDSB, BDSB, CXDED, BXDED, CDSDB, BDSDB |
| Parcelamento | CFONPN, BFONPN |
| Product Ads | PADS |
| Seguidores | CDLIT |
| Estornos de publicidade | BPAD, BDLIT |
| ICMS-DIFAL | CDIFAL, BDIFAL |
| Outras | demais (Minha página CESM/BESM, garantia Decola CSTP) |

- `detail_type` CHARGE soma; BONUS subtrai.
- Linha com `sales_info[0].order_id` → vai para o pedido; demais → vão para o mês.
- **Publicidade** (PADS, CDLIT) é cobrada na madrugada seguinte ao consumo: voltar **1 dia** na `creation_date_time`. Nos dias cobertos pela API de Ads, Product Ads vem da **API** (bate com o painel de Publicidade). Seguidores não tem API: o dia de hoje só aparece na fatura de amanhã.
- **Estornos** de publicidade: coluna própria, no mês do estorno.
- Pedidos ainda não faturados: estimar comissão = `sale_fee × qtd` e frete = custo de envio do pedido (`frete_estimado = true`).
- **Carrinho (vários pedidos no mesmo envio)** — *correção em relação à V1, que contava o frete em dobro*:
  - o custo do envio (`/shipments/{id}/costs`) é rateado só entre os pedidos **não cancelados** do envio;
  - se a fatura já cobrou o frete em **algum** pedido do envio, os outros ficam com frete **0** e não são "estimados" (o ML cobra o frete do carrinho uma vez só).
  - Diferenças conhecidas contra a V1 por causa disso: setembro/2026 −R$ 101,50 (pedido 2000018525336576) e novembro/2026 −R$ 158,04 (pedidos 2000019457170756/758).
- **Product Ads**: diferença de centavos contra a V1 (−R$ 0,42 em 09/2026, −R$ 0,53 em 10/2026) é aceitável (arredondamento da API).
- **Comissão isenta desde outubro/2026** (benefício ONG): `sale_fee` vem 0 a partir daí.

## Margem
Margem líquida = vendas líquidas − (comissão + frete + parcelamento + Product Ads + Seguidores + estornos + DIFAL + outras) − custo dos produtos.

## Saídas da V1 (referência para as views do dashboard)
- **Por mês**: mes, ano, pedidos, cancelados, devolvidas, devolvidas_valor, canceladas_valor, vendas_qtd, vendas_brutas, unidades_vendidas, unidades, receita, cada custo, custo_produto, estimados.
- **Por pedido**: status, sku, modelo, cor, kit, qtd, unidades, valor_venda, receita, custos, custo_unitario, custo_produto, frete_estimado.
- **Alertas**: tipo (`sem_custo`, `faixa_atual`), codigo, pedidos.

## Números de referência para validar
| Métrica | Outubro/2026 (painel ML) |
|---|---|
| Vendas brutas | R$ 54.341,55 |
| Quantidade de vendas | 93 |
| Unidades | 106 |
| Canceladas | 8 (R$ 4.054,95) |
| Devolvidas | 2 (R$ 1.529,06) |
| Product Ads | R$ 8.224 |
| Seguidores | ≈ R$ 538 |

**Atualização em 13/11/2026:** o próprio painel do ML revisou outubro/2026 para vendas brutas **R$ 51.270**, **90** vendas, **102** unidades (canceladas 8 / R$ 4.055; devolvidas 2 / R$ 1.530; preço médio por venda R$ 569,67). O dashboard bate com esses números, inclusive as variações contra o período anterior. Use sempre o painel do ML **do dia** como referência.

Se algo divergir, investigar **nesta ordem**: data usada → classificação do pedido → defasagem da fatura. Só depois mudar regras.
