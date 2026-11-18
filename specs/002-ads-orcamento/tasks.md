# Tasks: Ads e Orçamento (Bloco B)

**Input**: Design documents from `/specs/002-ads-orcamento/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: obrigatórios (constituição, princípio V). Em cada história, os testes vêm primeiro e precisam falhar antes da implementação.

**Organization**: tarefas agrupadas por história de usuário (spec.md), para cada uma poder ser implementada e testada sozinha.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência pendente)
- **[Story]**: história de usuário (US1…US5)

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Criar `supabase/tests/ads.test.mjs` com o mesmo harness PGlite de `supabase/tests/dashboard-funcoes.test.mjs` (aplica `stubs.sql` + migrations 0001–0013 + 0018–0019, helpers para logar como `authenticated` com perfil/canais) e incluí-lo no script `test:sql` de `package.json`
- [ ] T001a Dono roda o cenário 1 do `quickstart.md` no Supabase de produção (só leitura, tabelas já existentes) e compara com o painel do Mercado Ads de outubro/2026. Se a diferença passar de 1%, criar a tarefa de correção da coleta (research R8) antes da US2

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: tabelas, permissões, parâmetros, atribuição anúncio→modelo e dados de campanha/status — base de todas as histórias.

### Testes da fundação (escrever primeiro, devem falhar)

- [X] T002 Testes em `supabase/tests/ads.test.mjs`:
  - tabelas e seeds: `core.orcamento_ads` e `core.parametros_ads` com os valores iniciais de data-model.md §2;
  - permissões `ads`/`editar_ads` por perfil (data-model.md §2 `core.role_permissions`);
  - RLS como `authenticated`: leitura de `mkt.ads_anuncios` por canal; escrita de `orcamento_ads` só com `editar_ads` (gestor sim, comercial não); escrita de `parametros_ads` só pelo admin;
  - resolução por vigência (data-model.md §2 "Resolução");
  - reaplicar 0018 duas vezes sem erro.
- [X] T003 Testes em `supabase/tests/ads.test.mjs` para a atribuição anúncio→modelo (research R3):
  - anúncio com 2 modelos vendidos 3:1 divide investimento/cliques/vendas 75/25;
  - anúncio sem venda usa o modelo do SKU do anúncio;
  - com vários SKUs, divide igualmente;
  - sem SKU, fica "sem modelo".
- [X] T004 [P] Testes em `packages/connectors/src/mercadolivre/connector.test.ts` (fetch falso) — contract `contracts/sync-ml-ads.md`:
  - `listAdsCampaigns()` pagina e mapeia `name/status/budget/roas_target/automatica` (ROAS objetivo; campanha automática);
  - `listAdsMetrics` devolve `status` (null se ausente);
  - 429 repete;
  - **guarda só leitura**: nenhum método do conector ML usa POST/PUT/PATCH/DELETE.

### Implementação da fundação

- [X] T005 Criar `supabase/migrations/0018_ads_tabelas.sql` (reexecutável), com:
  - `mkt.ads_anuncios` (data-model.md §1 `mkt.ads_anuncios.channel/item_id/campaign_id/status/atualizado_em`);
  - colunas novas data-model.md §1 `mkt.ads_campaigns.roas_target`, `mkt.ads_campaigns.automatica`, `mkt.ads_campaigns.atualizado_em`;
  - `core.orcamento_ads` (data-model.md §2 `core.orcamento_ads.channel`, restrito a mercadolivre|shopee; `core.orcamento_ads.vigente_desde`; `core.orcamento_ads.valor_mensal` > 0);
  - `core.parametros_ads` (data-model.md §2 `core.parametros_ads.channel`, `.vigente_desde`, `.pausar_gasto_min`, `.pausar_cliques_min`, `.min_dias_dados`, `.revisar_cliques_min`, `.revisar_conversao_max_pct`, `.escalar_folga_pp`, `.escalar_unidades_min`, `.testar_margem_min_pct`, `.testar_unidades_min`, `.teste_reserva_pct`, `.teste_max_modelos`, `.reduzir_fator`, `.teto_fator`, `.alerta_sobra_pct`);
  - `core.ads_modo` (data-model.md §2 `core.ads_modo.channel`, `core.ads_modo.tipo` ∈ modelo|campanha|anuncio, `core.ads_modo.chave`, `core.ads_modo.modo` ∈ manual|automatico, `core.ads_modo.alterado_por`, `core.ads_modo.alterado_em`);
  - seeds;
  - permissões `ads`/`editar_ads` com `on conflict do nothing`;
  - RLS com `(select core.fn())`;
  - grants para o papel do job gravar `mkt.ads_anuncios`/`ads_campaigns`.

  Fazer T002 passar.
- [X] T006 Criar `supabase/migrations/0019_ads_funcoes.sql` com:
  - `analytics.ads_parametros(p_channel, p_data)`;
  - `analytics.ads_peso_modelo(p_canal, p_de, p_ate)` (research R3, CTE materializada a partir de `analytics.dash_itens` e `mkt.items`);
  - `analytics.ads_metricas_modelo(p_canal, p_de, p_ate)`: investimento, impressões, cliques, vendas e unidades por Ads e dias com dados, por modelo, + linha "sem modelo".

  Fazer T003 passar.
- [X] T007 [P] Implementar `listAdsCampaigns()` e o campo `status` em `listAdsMetrics` em `packages/connectors/src/mercadolivre/connector.ts` (+ tipos em `packages/connectors/src/types.ts` se necessário). Fazer T004 passar.
- [X] T008 Em `jobs/src/sync-mercadolivre.ts`:
  - `syncAdsCampanhas` grava `mkt.ads_campaigns`;
  - `syncAds` grava também `mkt.ads_anuncios`;
  - as duas são não fatais, com `stats.erro_ads_campanhas` / `stats.erro_ads_anuncios` e erros só com rótulo `ml:<caminho>` (contracts/sync-ml-ads.md).

**Checkpoint**: `npm run test:sql` e `npm run test:web` verdes; base pronta.

---

## Phase 3: User Story 1 - Ver se o Ads está dando lucro (Priority: P1) 🎯 MVP

**Goal**: tela Ads com cartões, gráfico, tabela por modelo (com ACOS de equilíbrio e lucro) e aba por campanha.

**Independent Test**: outubro/2026 no ML. Investimento = Product Ads da Visão Geral; a soma da tabela mais "não atribuído" = cartão; o comercial não obtém equilíbrio/lucro pela API.

### Testes da US1

- [X] T009 [US1] Testes em `supabase/tests/ads.test.mjs` para `analytics.ads_resumo`:
  - investimento = `analytics.dash_ads_periodo` (inclusive período antes da API);
  - ROAS, ACOS, TACOS e % vendas via Ads;
  - `nao_atribuido`, `tem_detalhe`;
  - Consolidado sem o canal brindedobem (FR-010);
  - sem `ads` → linha zerada (contracts/painel-rpc.md).
- [X] T010 [US1] Testes para `analytics.ads_serie`:
  - soma diária = investimento do resumo;
  - vendas por Ads por dia.
- [X] T011 [US1] Testes para `analytics.ads_modelos`:
  - CTR, CPC, conversão;
  - ACOS de equilíbrio sem dupla contagem (research R2, comparando com `dash_modelos`: contribuição + Ads rateado + Ads de fatura ligada a pedido);
  - lucro depois do Ads;
  - linha "não atribuído";
  - modelo sem custo → equilíbrio/lucro nulos;
  - sem `custos` → `acos_equilibrio`/`lucro_pos_ads`/`contribuicao_pct` nulos (FR-009);
  - canal não liberado → nada.
- [X] T012 [US1] Testes para `analytics.ads_campanhas`:
  - agregação por campanha com nome/status/orçamento/ROAS objetivo (e ACOS equivalente)/automática de `mkt.ads_campaigns`;
  - número de modelos;
  - campanha sem nome mostra o id.
- [ ] T013 [P] [US1] Testes em `apps/web/lib/ads-regras.test.ts` para formatação de ROAS/ACOS/TACOS, rótulo "não atribuído a anúncio" e aviso "sem detalhe por anúncio".

### Implementação da US1

- [X] T014 [US1] Implementar `analytics.ads_resumo`, `analytics.ads_serie`, `analytics.ads_modelos` (ainda sem sugestão: `sugestao`/`motivo` nulos) e `analytics.ads_campanhas` em `supabase/migrations/0019_ads_funcoes.sql`, seguindo contracts/painel-rpc.md e o padrão de desempenho (CTEs materializadas, período filtrado primeiro). O universo de modelos segue data-model.md §3 "Universo de modelos". Fazer T009–T012 passar.
- [ ] T015 [P] [US1] Implementar `apps/web/lib/ads-regras.ts`. Fazer T013 passar.
- [ ] T016 [P] [US1] Criar `apps/web/lib/ads.ts`: chamadas tipadas a `ads_resumo/serie/modelos/campanhas`, no padrão de `apps/web/lib/dash.ts` (conversão de numeric, mensagem de erro amigável).
- [ ] T017 [US1] Em `apps/web/lib/permissoes.ts`:
  - adicionar `ads` e `editar_ads` (rótulos "Ads" e "Editar Ads (modo automático)");
  - incluir `/ads` em `ORDEM_TELAS` depois de rentabilidade.

  Em `apps/web/components/sidebar.tsx`, adicionar o item "Ads".
- [ ] T018 [US1] Criar `apps/web/app/(app)/ads/page.tsx`:
  - `exigirPermissao('ads')`, `FiltroTopo` (Consolidado/ML/Shopee);
  - cartões com variação contra o período anterior;
  - gráfico diário (investimento × vendas por Ads);
  - abas `?aba=modelos|campanhas` com `TabelaDados`;
  - aviso para Shopee sem dados e para período sem detalhe por anúncio;
  - `AvisoSincronizacao` quando a última sincronização do ML falhou ou registrou `stats.erro_ads_*` (caso de borda da spec);
  - `ComoCalculamos` explicando ACOS, ROAS, TACOS e ACOS de equilíbrio.

**Checkpoint**: US1 utilizável e testável sozinha (quickstart cenários 3, 4 e 8, parte de leitura).

---

## Phase 4: User Story 2 - Receber sugestões do que fazer em cada produto (Priority: P1)

**Goal**: sugestão e motivo por modelo, com filtros rápidos e limites editáveis.

**Independent Test**: dados conhecidos produzem cada sugestão; mudar um limite em Parâmetros muda o resultado.

### Testes da US2

- [ ] T019 [US2] Testes em `supabase/tests/ads.test.mjs` para a sugestão em `analytics.ads_modelos`, cobrindo os cenários 1–7 da US2 na spec:
  - prioridade entre as sugestões;
  - janela de 30 dias até `p_ate` (research R4);
  - limites lidos de `core.parametros_ads` vigentes em `p_ate` (data-model.md §2 `core.parametros_ads.*`);
  - modelo sem custo só Pausar/Revisar/Manter;
  - sem `custos` só Pausar/Revisar/null (data-model.md §3 "Sugestão");
  - anúncio/campanha pausados → `pausado = true` e sugestão nula (FR-014);
  - modelo sem nenhum dado de Ads, com vendas na janela, aparece na tabela com a sugestão Testar (data-model.md §3 "Universo de modelos");
  - Escalar conta unidades por Ads (data-model.md §2 `core.parametros_ads.escalar_unidades_min`) e Testar conta unidades pagas sem Ads (`core.parametros_ads.testar_unidades_min`);
  - motivo com os números.
- [ ] T020 [P] [US2] Testes em `apps/web/lib/ads-regras.test.ts` para rótulo, cor e ordem das sugestões e para a contagem dos filtros rápidos.

### Implementação da US2

- [ ] T021 [US2] Implementar a sugestão (função auxiliar `analytics.ads_sugestoes(p_canal, p_ate)` + colunas `sugestao/motivo/pausado` em `analytics.ads_modelos`) em `supabase/migrations/0019_ads_funcoes.sql`. Fazer T019 passar.
- [ ] T022 [P] [US2] Completar `apps/web/lib/ads-regras.ts` (rótulos, selos, ordem). Fazer T020 passar.
- [ ] T023 [US2] Em `apps/web/app/(app)/ads/page.tsx`:
  - coluna Sugestão com motivo e selo "pausado";
  - filtros rápidos por sugestão (`?sug=`), com contagem.
- [ ] T024 [US2] Em `apps/web/app/(app)/configuracoes/parametros/page.tsx` e `actions.ts`: bloco "Limites de Ads" por canal, com nova vigência, só admin, gravando `core.parametros_ads` (FR-013/FR-020). Campos editáveis: data-model.md §2 `core.parametros_ads.pausar_gasto_min`, `.pausar_cliques_min`, `.min_dias_dados`, `.revisar_cliques_min`, `.revisar_conversao_max_pct`, `.escalar_folga_pp`, `.escalar_unidades_min`, `.testar_margem_min_pct`, `.testar_unidades_min`, `.teste_reserva_pct`, `.teste_max_modelos`, `.reduzir_fator`, `.teto_fator`, `.alerta_sobra_pct`; a chave é `channel` + `vigente_desde`.

**Checkpoint**: US1 + US2 funcionando.

---

## Phase 5: User Story 3 - Controlar o orçamento de R$ 5.000 do mês (Priority: P1)

**Goal**: acompanhamento do mês por conta, com projeção, saldo diário e alertas.

**Independent Test**: dia 18 de um mês de 30 dias, com R$ 3.000 gastos até o dia 17 → projeção R$ 5.294,12, alerta de estouro e R$ 153,85 por dia.

### Testes da US3

- [ ] T025 [US3] Testes em `supabase/tests/ads.test.mjs` para `analytics.ads_orcamento(p_canal, p_hoje)`:
  - o exemplo do teste independente;
  - alerta de sobra (< 80%);
  - 1º dia sem projeção;
  - último dia;
  - orçamento esgotado (saldo 0);
  - vigência (nov 5.000 / dez 6.000);
  - consolidado só com contas conectadas (`core.accounts`);
  - ML soma Product Ads + Seguidores da fatura (FR-015a), com as duas parcelas expostas;
  - campos de data-model.md §3 "Orçamento do mês".

### Implementação da US3

- [ ] T026 [US3] Implementar `analytics.ads_orcamento` em `supabase/migrations/0019_ads_funcoes.sql`. Fazer T025 passar.
- [ ] T027 [P] [US3] Adicionar `ads_orcamento` em `apps/web/lib/ads.ts` e criar `apps/web/components/ads/cartao-orcamento.tsx`:
  - barra gasto × orçamento;
  - % do mês;
  - projeção;
  - saldo e valor diário;
  - alerta;
  - estados especiais: sem projeção (1º dia) e orçamento esgotado.
- [ ] T028 [US3] Em `apps/web/app/(app)/ads/page.tsx`, criar a aba `?aba=orcamento` com o cartão por conta (sempre do mês corrente, com a nota "independe do período escolhido").
- [ ] T029 [US3] Na aba Orçamento de `apps/web/app/(app)/ads/page.tsx`, criar o botão "Editar orçamento" (só com `editar_ads`) com o formulário `apps/web/components/ads/editar-orcamento.tsx` (valor mensal + "vale a partir de" + histórico) e a server action em `apps/web/app/(app)/ads/actions.ts`, gravando data-model.md §2 `core.orcamento_ads.channel`, `core.orcamento_ads.vigente_desde` e `core.orcamento_ads.valor_mensal` (> 0); mensagem simples se a gravação for recusada.

**Checkpoint**: US1–US3 funcionando.

---

## Phase 6: User Story 4 - Saber como distribuir o orçamento (Priority: P2)

**Goal**: valor diário sugerido por campanha (ML) e por modelo, com teste, reduções, teto e "sem destino".

**Independent Test**: soma da distribuição + sem destino = valor diário disponível (±R$ 0,01), e cada passo da regra confere.

### Testes da US4

- [ ] T030 [US4] Testes em `supabase/tests/ads.test.mjs` para `analytics.ads_distribuicao(p_canal, p_hoje)`:
  - cenários 1–5 da US4;
  - passo 0: linha `seguidores` com o gasto médio de 30 dias, limitado a V (data-model.md §3 "Distribuição");
  - campanha automática recebe só valor de orçamento, sem marca `mudar_campanha`;
  - passo 3 com R < 0 (reduções escaladas);
  - teto com redistribuição iterativa;
  - nenhum lucrativo → tudo em sem destino;
  - orçamento esgotado → zeros;
  - ML somado por campanha, com linha `nova_campanha_teste` e marca `mudar_campanha`;
  - invariante da soma;
  - sem `custos` → zero linhas;
  - pausados fora (data-model.md §3 "Distribuição").

### Implementação da US4

- [ ] T031 [US4] Implementar `analytics.ads_distribuicao` em `supabase/migrations/0019_ads_funcoes.sql` (plpgsql para o laço do teto). Fazer T030 passar.
- [ ] T032 [P] [US4] Adicionar `ads_distribuicao` em `apps/web/lib/ads.ts` e criar `apps/web/components/ads/tabela-distribuicao.tsx`: por campanha, expansível por modelo, com "Nova campanha de teste", "sem destino" e "mudar de campanha". Com o orçamento esgotado, mostra tudo em zero com o aviso.
- [ ] T033 [US4] Exibir a distribuição na aba Orçamento de `apps/web/app/(app)/ads/page.tsx`, só quando houver linhas (o usuário sem custos não vê).

**Checkpoint**: US1–US4 funcionando.

---

## Phase 7: User Story 5 - Marcar o que poderá ser automático no futuro (Priority: P3)

**Goal**: chave Manual/Automático por modelo/campanha/anúncio, gravada e sem efeito.

**Independent Test**: marcar Automático, recarregar, ver "aguardando liberação"; nenhuma chamada de escrita existe no conector.

### Testes da US5

- [ ] T034 [US5] Testes em `supabase/tests/ads.test.mjs` para `core.ads_definir_modo`:
  - exige `editar_ads` e canal visível;
  - grava `alterado_por/alterado_em`;
  - `manual` apaga a linha (data-model.md §2 `core.ads_modo.modo`);
  - tipo inválido dá erro (data-model.md §2 `core.ads_modo.tipo`);
  - comercial não grava nem por `insert` direto (RLS);
  - `ads_modelos`/`ads_campanhas`/`ads_distribuicao` devolvem `modo`.

### Implementação da US5

- [ ] T035 [US5] Implementar `core.ads_definir_modo` e a coluna `modo` nas funções em `supabase/migrations/0019_ads_funcoes.sql`. Fazer T034 passar.
- [ ] T036 [US5] Criar `apps/web/components/ads/chave-modo.tsx` e `apps/web/app/(app)/ads/actions.ts` (server action chamando `core.ads_definir_modo`, mensagens simples). Usar a chave nas tabelas de modelos, campanhas e distribuição, com o selo "aguardando liberação"; ela fica só leitura sem `editar_ads`.

**Checkpoint**: todas as histórias funcionando.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T037 [P] Atualizar `.claude/skills/dashboard-mercado-livre-brinde-do-bem/SKILL.md` (e `regras-de-negocio.md` se couber) com a seção "Ads e Orçamento", contendo:
  - fontes do gasto;
  - regra do equilíbrio;
  - sugestões e distribuição;
  - ordem das migrations 0018 → 0019;
  - permissões;
  - prazo de conferência de 31/01/2027.
- [ ] T038 Rodar `npm run typecheck`, `npm run test:sql`, `npm run test:web`, `npm run build` (com as variáveis públicas de exemplo) e `npm audit`; corrigir o que falhar.
- [ ] T039 Medir as funções `ads_*` com o papel `authenticated` num banco com 90 dias de dados de teste (ou explicar a medição no Supabase para o dono); ajustar índices se alguma passar de 8 s (SC-007).
- [ ] T040 Revisão geral do ramo (requisito + qualidade + segurança), antes de pedir ao dono autorização para juntar ao `main`.
- [ ] T041 Guia do dono (passos em português simples): aplicar 0018 e 0019, rodar a sincronização e executar os cenários 1, 2 e 3 do quickstart. **O ramo só é juntado ao `main` com o cenário 1 conferido (T001a, FR-024).**

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)** → **Foundational (2)** → histórias.
- **US1** depende da fundação.
- **US2** depende de US1 (completa `ads_modelos`).
- **US3** depende só da fundação (pode correr em paralelo com US1/US2 na parte de banco).
- **US4** depende de US2 (sugestões) e de US3 (valor diário).
- **US5** depende de US1 (tabelas na tela); o banco pode ser feito em paralelo.
- **Polish** depois das histórias desejadas.

### Within Each Story

Testes (falhando) → funções SQL → `lib/` → tela. Todas as funções ficam em `0019_ads_funcoes.sql`, portanto as tarefas de SQL são sequenciais entre si. Cada tarefa passa por revisão independente (requisito + qualidade) antes da próxima (constituição).

### Parallel Opportunities

- T004/T007 (conector) em paralelo com T002–T006 (banco).
- Em cada história, os testes e o código de `apps/web/lib/ads-regras.ts` [P] em paralelo com o SQL.
- T027 e T032 (componentes) em paralelo com a função SQL correspondente, depois de fixado o contrato.

## Parallel Example: User Story 1

```text
Em paralelo: T013 (testes ads-regras) e T009–T012 (testes SQL)
Depois:      T014 (SQL) | T015 (ads-regras) | T016 (lib/ads.ts)
Por fim:     T017 → T018 (tela)
```

## Implementation Strategy

### MVP First

Setup + Fundação + **US1** + **US2** + **US3**: a tela de Ads com números conferidos, sugestões e o acompanhamento dos R$ 5.000. Parar para o dono validar com outubro (quickstart 1–6).

### Incremental Delivery

1. Fundação e US1 → conferência de números (quickstart 1–4).
2. US2 → sugestões.
3. US3 → orçamento.
4. US4 → distribuição.
5. US5 → chave Manual/Automático.
6. Polish e revisão geral → autorização do dono para juntar ao `main`.
