# Contrato: sincronização de Ads do Mercado Livre (acréscimos)

Arquivos: `packages/connectors/src/mercadolivre/connector.ts`, `jobs/src/sync-mercadolivre.ts`. Somente leitura (GET). Cabeçalho `api-version: 2`.

| Passo | Endpoint | Grava | Falha |
|---|---|---|---|
| Campanhas | `GET /advertising/{site}/advertisers/{adv}/product_ads/campaigns/search?limit=50&offset=` (sem `aggregation_type`) | `mkt.ads_campaigns` (upsert: name, status, budget, acos_target, raw, atualizado_em) | não fatal; `stats.erro_ads_campanhas` |
| Anúncios (status) | `GET .../product_ads/ads/search` (o mesmo de `listAdsMetrics`; o status vem em cada resultado) | `mkt.ads_anuncios` (upsert item_id, campaign_id, status, atualizado_em) | não fatal; `stats.erro_ads_anuncios` |
| Métricas por anúncio | já existe (`syncAds`) | `mkt.ads_metrics_daily` | já não fatal |

Regras:
- O conector expõe `listAdsCampaigns()` e devolve `status` em `listAdsMetrics` (campo opcional; se ausente, `null`).
- O status é o da execução mais recente (upsert); anúncios que sumirem da busca ficam com o último status conhecido.
- 429: o tratamento já existente do `MercadoLivreClient` (10 s × tentativa).
- Erros registrados só com o rótulo `ml:<caminho sem ids>`, sem token.
- Nenhum método com POST/PUT/PATCH/DELETE (teste de guarda).
