# Data Model — Ads e Orçamento

Convenções: o "dia" é o dia de Brasília; valores em R$ com 2 casas; percentuais em pontos (0–100). Migrations novas: `0018_ads_tabelas.sql` e `0019_ads_funcoes.sql`. A numeração pula 0014–0017, que estão reservadas ao ramo do Catálogo.

## 1. Dados sincronizados (schema `mkt`, RLS por canal)

### mkt.ads_metrics_daily (já existe) — por anúncio e dia
| Campo | Tipo | Regra |
|---|---|---|
| channel, item_id, day | PK | (a PK pode passar a incluir `campaign_id` se a conferência R8 mostrar anúncio em 2 campanhas no mesmo dia) |
| campaign_id | text | |
| impressions, clicks | int | |
| cost | numeric(14,2) | investimento |
| direct_amount, indirect_amount | numeric(14,2) | vendas por Ads = soma das duas |
| direct_units, indirect_units, organic_units | int | unidades por Ads = direct + indirect |

### mkt.ads_campaigns (já existe; passa a ser preenchida)
`channel, campaign_id` PK; `name`, `status` (`active`|`paused`|outros), `budget` (orçamento diário), `acos_target` (legado, não usado), `raw`, **novos** `roas_target numeric` (ROAS objetivo; ACOS equivalente = 100 ÷ roas_target), `automatica boolean` (campanha gerida pelo ML), `atualizado_em timestamptz`.

### mkt.ads_anuncios (nova) — situação atual de cada anúncio patrocinado
| Campo | Tipo | Regra |
|---|---|---|
| channel, item_id | PK | |
| campaign_id | text null | campanha atual |
| status | text | `active` \| `paused` \| outros da API |
| atualizado_em | timestamptz | |

RLS: `select` para `authenticated` com `(select core.can_see_channel(channel))`; escrita só pelo papel do job (como as demais `mkt.*`).

### mkt.ads_campaign_daily (já existe) — fonte conferida do investimento.

## 2. Configuração (schema `core`)

### core.orcamento_ads
| Campo | Tipo | Regra |
|---|---|---|
| channel | text | `mercadolivre` \| `shopee` |
| vigente_desde | date | PK com channel |
| valor_mensal | numeric(14,2) | > 0 |

Seed: (mercadolivre, 2026-11-01, 5000), (shopee, 2026-11-01, 5000).

### core.parametros_ads
| Campo | Tipo | Valor inicial | Uso |
|---|---|---|---|
| channel, vigente_desde | PK | | |
| pausar_gasto_min | numeric | 50 | FR-011 Pausar |
| pausar_cliques_min | int | 100 | FR-011 Pausar |
| min_dias_dados | int | 7 | FR-011 Pausar |
| revisar_cliques_min | int | 100 | FR-011 Revisar |
| revisar_conversao_max_pct | numeric | 1 | FR-011 Revisar |
| escalar_folga_pp | numeric | 10 | FR-011 Escalar |
| escalar_unidades_min | int | 3 | FR-011 Escalar (unidades por Ads: diretas + indiretas) |
| testar_margem_min_pct | numeric | 20 | FR-011 Testar |
| testar_unidades_min | int | 3 | FR-011 Testar (unidades pagas no canal na janela) |
| teste_reserva_pct | numeric | 10 | FR-018 passo 1 |
| teste_max_modelos | int | 5 | FR-018 passo 1 |
| reduzir_fator | numeric | 0.7 | FR-018 passo 2 |
| teto_fator | numeric | 2 | FR-018 passo 4 |
| alerta_sobra_pct | numeric | 80 | FR-017 |

Resolução: o parâmetro válido em uma data `d` é a linha com o maior `vigente_desde <= d`.
RLS: leitura `authenticated` nas duas. Escrita de `core.orcamento_ads`: quem tem `(select core.has_perm('editar_ads'))` (tela Ads, aba Orçamento). Escrita de `core.parametros_ads`: só `core.my_role() = 'admin'` (Configurações → Parâmetros).

### core.ads_modo
| Campo | Tipo | Regra |
|---|---|---|
| channel | text | |
| tipo | text | `modelo` \| `campanha` \| `anuncio` |
| chave | text | modelo, campaign_id ou item_id |
| modo | text | `manual` \| `automatico` |
| alterado_por | uuid | `auth.uid()` |
| alterado_em | timestamptz | |

PK `(channel, tipo, chave)`. Sem linha = manual. Leitura: quem tem `ads`. Escrita só por `core.ads_definir_modo(p_channel, p_tipo, p_chave, p_modo)` (definer, exige `editar_ads` e o canal visível).

### core.role_permissions (seeds novos, `on conflict do nothing`)
- `ads`: admin, gestor, comercial = true; visualizador, vendedor = false.
- `editar_ads`: admin, gestor = true.

## 3. Resultados calculados (funções `analytics.ads_*`, security invoker)

### Universo de modelos
Entram os modelos com dados de Ads no período (ou na janela de 30 dias) **ou** com venda paga no canal na janela de 30 dias (`dash_itens`). Um modelo vendido sem Ads aparece com investimento zero e é candidato a Testar Ads.

### Sugestão (por modelo)
Estados: `pausar` \| `reduzir` \| `revisar` \| `escalar` \| `testar` \| `manter` \| null (pausado, sem dados ou sem permissão para a regra). Prioridade e regras: spec FR-011, com os limites de `core.parametros_ads` vigentes em `p_ate`.
- Sem `custos`: só `pausar`, `revisar` ou null.
- Modelo sem custo (`sem_custo > 0` e contribuição nula): só `pausar`, `revisar` ou `manter`.
- `motivo` é um texto com os números, por exemplo "gastou R$ 60,00 em 30 dias sem venda" ou "ACOS 35% acima do equilíbrio 30%".

### Distribuição (por modelo, depois por campanha)
Passo 0 (ML): a linha `seguidores` recebe `S = min(gasto diário médio de Seguidores em 30 dias, V)`; os passos abaixo usam `V − S` no lugar de `V`. Na invariante, `S` entra na soma.
Entrada: valor diário disponível `V`, sugestão de cada modelo na janela de hoje, gasto diário médio de 30 dias `g`, lucro depois do Ads de 30 dias `L`.
1. `T = V × teste_reserva_pct/100` dividido igualmente entre até `teste_max_modelos` modelos `testar`, escolhidos pela maior margem %. Sem candidatos, `T = 0`.
2. `pausar` = 0; `reduzir` = g × reduzir_fator; `revisar` = g.
3. `R = V − T − Σ(passo 2)`. Se R < 0, os valores do passo 2 são escalados para caber em `V − T` e R = 0. `escalar`/`manter` com L > 0 recebem `R × L/ΣL`.
4. Teto de `g × teto_fator` para os modelos do passo 3; o excedente é redistribuído entre os que não bateram o teto, iterando até estabilizar. O que sobra fica em `sem_destino`.

Invariante: Σ valores + sem_destino = V (±0,01).
- ML: a soma é feita por campanha (o modelo pertence à campanha de maior gasto em 30 dias); os modelos `testar` vão para a linha `nova_campanha_teste`. Há a marca `mudar_campanha` quando a sugestão do modelo difere da sugestão predominante (maior gasto) da campanha.
- Shopee: por anúncio (no projeto Shopee).

### Orçamento do mês (por canal)
No ML, todo gasto = Product Ads (mesmo critério de `dash_ads_periodo`) + Seguidores (`analytics.ml_fatura`, categoria `seguidores`, pela `data_ref`), com as duas parcelas também expostas (`gasto_product_ads`, `gasto_seguidores`).
`orcamento`, `gasto_mes` (até agora), `gasto_ate_ontem`, `dias_mes`, `dias_completos = dia(p_hoje) − 1`, `dias_restantes = dias_mes − dias_completos`, `projecao` (null se `dias_completos = 0`), `saldo = max(orcamento − gasto_mes, 0)`, `valor_diario = saldo ÷ dias_restantes`, `alerta` (`estouro` \| `sobra` \| null). O consolidado soma os canais **conectados**, ou seja, com conta em `core.accounts`.

## Relações
`ads_metrics_daily.item_id → ads_anuncios.item_id → ads_campaigns.campaign_id`; anúncio → modelo pelo peso (research R3); modelo/campanha/anúncio → `ads_modo`; canal → `orcamento_ads` e `parametros_ads` pela vigência.
