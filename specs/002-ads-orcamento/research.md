# Research — Ads e Orçamento

Cada item: **Decisão**, **Racional**, **Alternativas**. Itens marcados *(verificar no 1º contato)* dependem da API real e têm um teste de fumaça no quickstart.

## R1. Fonte do investimento
- **Decisão:** cartões, gráfico e orçamento usam `mkt.ads_campaign_daily` (a mesma fonte de `analytics.dash_custos_periodo`, conferida contra o painel de Publicidade). A tabela por modelo usa `mkt.ads_metrics_daily` (por anúncio). A diferença entre as duas, no período, vira a linha "não atribuído a anúncio".
- **Racional:** FR-003 e o anti-objetivo "gasto que não bate". O cartão da tela Ads fica igual ao Product Ads da Visão Geral nos dias cobertos pela API.
- **Detalhe:** antes do primeiro dia da API, a Visão Geral usa a fatura (`ml_fatura`, categoria `product_ads`). A tela Ads usa o mesmo critério de `analytics.dash_ads_periodo` para o total do período. Assim períodos antigos também batem, e a tabela por modelo mostra "sem detalhe por anúncio" (caso de borda dos 90 dias).
- **Alternativas:** somar só `ads_metrics_daily` (nunca conferida; perde dias antigos).

## R2. ACOS de equilíbrio sem contar o Ads duas vezes
- **Decisão:** a contribuição do modelo vem de `analytics.dash_modelos` (mesma regra da Rentabilidade). O Ads aparece nela em dois lugares:
  1. `tarifas`: Product Ads da fatura ligada a pedido, via `dash_itens`;
  2. `custos_rateados`: `product_ads` de `dash_custos_periodo` × receita do modelo ÷ receita total.

  A função nova soma de volta essas duas partes: `contrib_antes_ads = contribuicao + ads_rateado_modelo + ads_fatura_pedido_modelo`. O Ads rateado é recalculado com a mesma fórmula do rateio, usando só a categoria `product_ads`. A parte da fatura ligada a pedido vem de `dash_pedidos_base.product_ads` × peso do item, o mesmo peso de `dash_itens`.
  - `acos_equilibrio = contrib_antes_ads ÷ receita`
  - `lucro_pos_ads = contrib_antes_ads − investimento atribuído ao modelo` (R3)
- **Racional:** FR-006. Não muda `dash_modelos` e não quebra a Rentabilidade.
- **Alternativas:** adicionar uma coluna `ads` em `dash_itens`/`dash_modelos` (muda o tipo de retorno, exige recriar dependentes e mexe em tela pronta).

## R3. Atribuição anúncio → modelo
- **Decisão:** peso de cada modelo dentro do anúncio = unidades vendidas daquele modelo no anúncio ÷ unidades do anúncio na janela, a partir de `dash_itens` (`item_id`, `modelo`, `qtd`). Sem venda, usa o modelo do `seller_sku` do anúncio (`mkt.items` / `item_variations`); havendo vários modelos, divide igualmente. Sem nenhum dos dois, fica "sem modelo".
  - Investimento, cliques, impressões e vendas por Ads do modelo = soma(métrica do anúncio × peso).
  - Para escolher o modelo a partir do SKU vale a regra de SKU → modelo que já existe (colunas geradas de `mkt.order_items` / de-para da 0007). A função auxiliar `analytics.ads_peso_modelo(p_de, p_ate)` é materializada uma vez por chamada.
- **Racional:** FR-007; escolha registrada no documento de projeto.
- **Alternativas:** o anúncio inteiro para o modelo que mais vendeu (distorce kits e variações).

## R4. Janela das sugestões e da distribuição
- **Decisão:**
  - Sugestões da tabela: janela de 30 dias terminando em `p_ate`, ou seja, `[p_ate − 29, p_ate]`.
  - Orçamento e distribuição: parâmetro `p_hoje` (padrão = hoje em Brasília); janela `[p_hoje − 30, p_hoje − 1]` e mês de `p_hoje`.
  - A função recebe `p_hoje` para os testes serem determinísticos.
- **Racional:** FR-011, FR-016 e a decisão "distribuição sempre sobre hoje".

## R5. Limites e orçamento editáveis
- **Decisão:** duas tabelas com vigência, no padrão de `core.parametros_custo`:
  - `core.orcamento_ads (channel, vigente_desde, valor_mensal)`;
  - `core.parametros_ads (channel, vigente_desde, ...limites)`.

  Leitura para `authenticated`; escrita só do admin, por RLS (`core.my_role() = 'admin'`). A vigência resolve "o parâmetro válido na data" com `vigente_desde <= data order by vigente_desde desc limit 1`. Seeds: ML e Shopee, desde 2026-11-01, com os valores do FR-011/FR-018.
- **Tela:** um bloco novo em `/configuracoes/parametros`.

## R6. Manual / Automático
- **Decisão:** `core.ads_modo (channel, tipo, chave, modo, alterado_por, alterado_em)`, com PK `(channel, tipo, chave)`.
  - Escrita só pela função definer `core.ads_definir_modo(...)`, que exige `core.has_perm('editar_ads')` e grava `auth.uid()` e `now()`.
  - Leitura para quem tem `ads`.
  - Nada no código chama API de gravação: o conector do ML continua sem métodos de escrita, e há um teste que verifica isso (procura `post|put|patch|delete` em `packages/connectors/src/mercadolivre`).
- **Racional:** FR-021, FR-022 e princípio II.

## R7. Dados de campanha e status do anúncio *(verificar no 1º contato)*
- **Decisão:**
  - **Campanhas:** `GET /advertising/{site}/advertisers/{adv}/product_ads/campaigns/search` sem `aggregation_type`, com `api-version: 2`, paginado. Cada resultado traz `id`, `name`, `status`, `budget` e `acos_target` (ou `strategy`/`roas_target`), gravados em `mkt.ads_campaigns` com `raw`.
  - **Status do anúncio:** os resultados de `product_ads/ads/search`, já usados por `listAdsMetrics`, trazem `status`, gravado numa tabela nova `mkt.ads_anuncios (channel, item_id, campaign_id, status, atualizado_em)`. O conector passa a devolver status e campanha mesmo quando o dia não tem métrica, para listar anúncios ativos sem gasto.
  - **Falhas:** nos dois casos não são fatais (mesmo padrão de `syncAds`) e ficam em `stats` do `sync_runs`.
- **Racional:** FR-014 e FR-023.
- **Plano B:** se a API não devolver `budget`/`status` nesses endpoints, inspecionar o `raw`. A coluna "orçamento diário atual" fica vazia, e o status vem de `GET /advertising/product_ads/items/{item_id}` (um por anúncio ativo; volume pequeno).

## R8. Conferência da coleta por anúncio
- **Decisão:** antes de liberar as sugestões, rodar a consulta do quickstart (cenário 1).
  - Primeiro, comparar a soma mensal de `ads_metrics_daily.cost` com `ads_campaign_daily.cost` e com o painel do Mercado Ads, com tolerância de 1%.
  - Se não bater, investigar duas possíveis causas: o filtro que descarta linhas sem impressão e sem custo, e o anúncio que aparece em mais de uma campanha no mesmo dia. A PK `(channel, item_id, day)` guarda uma campanha só; nesse caso a PK passa a incluir `campaign_id`.
- **Racional:** princípio IV e FR-024.

## R9. Tela
- **Decisão:**
  - **Rota:** `apps/web/app/(app)/ads/page.tsx`, com `exigirPermissao('ads')`. Reaproveita `FiltroTopo`, `CartaoIndicador`, `GraficoSerie` (duas séries), `TabelaDados` e `ComoCalculamos`.
  - **Abas por query string:** `?aba=modelos|campanhas|orcamento`.
  - **Chave Manual/Automático:** server action que chama `core.ads_definir_modo`.
  - **Chamadas tipadas:** em `apps/web/lib/ads.ts`, no padrão de `lib/dash.ts`.
  - **Funções puras:** formatação do motivo e dos selos em `lib/ads-regras.ts`, com teste.
- **Menu:** item "Ads" depois de "Rentabilidade"; a ordem das telas em `permissoes.ts` inclui `/ads`.

## R10. Testes
- **Decisão:**
  - **PGlite:** `supabase/tests/ads.test.mjs` cobre:
    - investimento igual a `dash_ads_periodo`;
    - linha "não atribuído";
    - atribuição por peso;
    - ACOS de equilíbrio sem dupla contagem;
    - cada regra de sugestão, incluindo a prioridade e o modelo sem custo;
    - pausado fora das sugestões;
    - orçamento (projeção, alertas, 1º e último dia, esgotado);
    - distribuição (passos 1–4 e soma = valor diário);
    - vigência dos parâmetros;
    - RLS e permissões (`ads`, `custos`, `editar_ads`, canal).
  - **Sync:** testes do conector com fetch falso (campanhas e status, falha não fatal).
  - **Web:** `node --test` de `ads-regras.ts`.
