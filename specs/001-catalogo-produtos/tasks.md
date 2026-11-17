---
description: "Lista de tarefas — Catálogo de produtos (fase 1)"
---

# Tasks: Catálogo de produtos — ERP → site e Bling (fase 1)

**Input**: Design documents from `/specs/001-catalogo-produtos/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: INCLUÍDOS. A constituição (princípio V, "Testes primeiro") exige testes antes da implementação. Cada tarefa de teste deve falhar antes da implementação correspondente.

**Organization**: tarefas agrupadas por história de usuário.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: pode rodar em paralelo (arquivos diferentes, sem dependência de tarefa incompleta)
- **[Story]**: US1–US5 conforme spec.md
- Caminhos relativos à raiz do repositório (monorepo: `supabase/`, `gateway/`, `apps/web/`)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: ramo, dependências e esqueleto de arquivos

- [ ] T001 Criar o ramo `001-catalogo-produtos` a partir do `main` e registrar a ordem de migrations `… 0013 → 0014 → 0015` no cabeçalho de `supabase/migrations/0014_catalogo_tabelas.sql` (arquivo novo, ainda vazio de conteúdo)
- [ ] T002 [P] Adicionar `boto3` e `Pillow` às dependências do gateway em `gateway/pyproject.toml` e ao build em `gateway/build/BrindeGateway.spec`
- [ ] T003 [P] Adicionar `node supabase/tests/catalogo.test.mjs` ao script `test:sql` em `package.json` e criar o esqueleto do teste (helpers `eq`/`erro`, stubs, `set role authenticated`) em `supabase/tests/catalogo.test.mjs`
- [ ] T004 [P] Acrescentar `create schema catalogo` e a tabela `auth.users` (se ainda não houver) a `supabase/tests/stubs.sql`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: tabelas, permissão, leitura do ERP e regras do documento desejado — base de todas as histórias

**⚠️ CRITICAL**: nenhuma história começa antes desta fase

### Testes da fundação (escrever primeiro, devem falhar)

- [ ] T005 [P] Testes de tabelas e RLS em `supabase/tests/catalogo.test.mjs`:
  - o seed da permissão `catalogo` deixa admin = true e os demais = false;
  - sem `has_perm('catalogo')`, `select` em `catalogo.produtos` volta 0 linhas;
  - as restrições de `data-model.md` → `catalogo.fotos.tipo` (`capa|cor|extra`), `catalogo.fotos.sku` (obrigatório se `tipo='cor'`), 1 `capa` por ref e 1 `cor` por sku são recusadas quando violadas;
  - `data-model.md` → `erp.cat_produtos.status` e `erp.cat_cores.status` aceitam só `colecao|standby|fora`.
- [ ] T006 [P] Testes da função `catalogo.produto_desejado(ref)` em `supabase/tests/catalogo.test.mjs`:
  - **preço** (`data-model.md` → `erp.cat_faixas.custo`, `erp.cat_faixas.margem`, `erp.cat_faixas.data_alt`): usa o conjunto de faixas mais recente; `round(custo/(1-margem),2)` arredondando meio para cima; a 1ª faixa começa com `qtyStart=1`; margem ≥ 1, margem nula ou custo ≤ 0 geram `preco_invalido`;
  - **status**: produto fora/standby → `visivel=false`; cor fora → `active=false`; cor standby → `available=false`; colecao → tudo true;
  - **Bling**: fora → `E`, standby → `I`, colecao → `A`;
  - **alertas**: `sem_capa`, `cor_sem_foto` (só para cor ativa), `sem_nome`, `sem_categoria`, `sem_ncm`, `pers_inexistente_no_site`;
  - **personalizações**: vêm de `erp.cat_personalizacoes`, menos as listadas em `catalogo.produto_pers_excluidas`, com preço de `erp.cat_pers_precos`.
- [ ] T007 [P] Testes do gateway para os datasets novos (mapeamento de colunas, `allow_empty=false`) em `gateway/tests/test_config.py` e `gateway/tests/test_runner.py`

### Implementação da fundação

- [ ] T008 Criar `supabase/migrations/0014_catalogo_tabelas.sql`. Deve ser reexecutável.
  - **Tabelas `erp.cat_*`**, conforme `data-model.md` §1: `erp.cat_produtos`, `erp.cat_cores`, `erp.cat_faixas`, `erp.cat_personalizacoes`, `erp.cat_pers_precos` e `erp.cat_site_*`, com os checks de `erp.cat_produtos.status` e `erp.cat_cores.status`.
  - **Tabelas `catalogo.*`**, conforme `data-model.md` §2–4:
    - `catalogo.produtos`, com `catalogo.produtos.nome` not null, `catalogo.produtos.versao` default 1 e `catalogo.produtos.slug` nulo até a 1ª publicação;
    - as listas ligadas;
    - `catalogo.fotos`, com os checks de `catalogo.fotos.tipo`, `catalogo.fotos.sku` e `catalogo.fotos.situacao`;
    - `catalogo.publicado`;
    - `catalogo.publicacoes`, com check em `catalogo.publicacoes.situacao` e `catalogo.publicacoes.destino`;
    - `catalogo.publicacao_itens`, com checks em `catalogo.publicacao_itens.site` e `catalogo.publicacao_itens.bling`;
    - `catalogo.bling_componentes` e `catalogo.alteracoes`.
  - **Permissão `catalogo`** em `core.role_permissions`: só admin = true.
  - **RLS** com `(select core.has_perm('catalogo'))`.
  - **Bucket privado** `catalogo-fotos` no Storage.
  - **Grants do `gateway_writer`**: escrita em `erp.cat_*` e execução apenas das funções da fila.
- [ ] T009 [P] Criar as views de leitura no SQL Server, `painel.cat_produtos`, `painel.cat_cores`, `painel.cat_faixas`, `painel.cat_personalizacoes` e `painel.cat_pers_precos`, com o grant para o usuário de leitura, em `gateway/sqlserver/views_catalogo.sql`. Seguir as colunas e regras de `contracts/gateway-datasets.md`, inclusive a normalização de status, o NCM pela lógica de `NEWFORD_NCM` e o `nome_padrao` vindo do bdb_pricing. Comentar a alternativa para quando SERPZERADO/bdb_pricing estiverem em outra instância.
- [ ] T010 [P] Criar as consultas dos datasets em `gateway/consultas/cat_produtos.sql`, `cat_cores.sql`, `cat_faixas.sql`, `cat_personalizacoes.sql` e `cat_pers_precos.sql`, e os blocos `[[datasets]]` correspondentes em `gateway/config.exemplo.toml`.
- [ ] T011 Estender `gateway/src/brinde_gateway/config.py` para ler as seções `[site]` (conexão ODBC; destino ativo `site_teste|site_producao`; segredo `site`), `[s3]` (bucket, região e prefixo; segredo `s3`) e `[bling]` (Client ID; segredo `bling`), mais o `source` opcional por dataset. A leitura das referências do site usa a conexão `[site]`.
- [ ] T012 Criar a função `catalogo.produto_desejado(ref) returns jsonb` em `supabase/migrations/0015_catalogo_funcoes.sql`, conforme `data-model.md` §3 e as regras validadas em T006. O arquivo deve ser reexecutável.
- [ ] T013 Criar `catalogo.apos_leitura()` em `supabase/migrations/0015_catalogo_funcoes.sql`. A função compara a contagem com a leitura anterior; se cair mais de 20%, grava o alerta `leitura_suspeita` e mantém a revisão anterior (FR-003). Chamar a função ao fim do `run` em `gateway/src/brinde_gateway/runner.py`, com teste em `supabase/tests/catalogo.test.mjs` (queda de 30% → alerta, nada desativado).

**Checkpoint**: a leitura diária grava `erp.cat_*` e o banco sabe montar o documento desejado de qualquer produto.

---

## Phase 3: User Story 5 - Ponto de partida sem redigitar nada (Priority: P1, pré-requisito)

**Goal**: importar do site (produção, somente leitura) os produtos publicados e, do Bling, os IDs dos SKUs.

**Independent Test**: depois da importação, 20 produtos sorteados mostram no Catálogo os mesmos dados do site, e as fotos existentes aparecem sem novo envio.

### Testes da US5

- [ ] T014 [P] [US5] Testes de `catalogo.importar_do_site()` em `supabase/tests/catalogo.test.mjs`:
  - o produto do site com referência no ERP vira uma linha em `catalogo.produtos`, com nome, descrição, categorias, quantidades, caixas e sessão;
  - as fotos existentes viram `catalogo.fotos` com `data-model.md` → `catalogo.fotos.s3_key` preenchido e `catalogo.fotos.situacao='publicada'`;
  - o `catalogo.publicado.documento` é gravado;
  - o produto sem referência no ERP é ignorado;
  - o `data-model.md` → `catalogo.produtos.slug` recebe o slug atual do site.
- [ ] T015 [P] [US5] Testes do comando `import-site` (somente leitura: nenhuma instrução de escrita é enviada ao site) em `gateway/tests/test_import_site.py`

### Implementação da US5

- [ ] T016 [US5] Criar, em `gateway/consultas/site_*.sql`, as consultas de leitura do site (products, productsPrices, productsCategories, productsQuantities, productsBoxes, productsImages, values, productsAttributesValues, valuesPrices) e as tabelas destino `erp.cat_site_produtos…` em `supabase/migrations/0014_catalogo_tabelas.sql`
- [ ] T017 [US5] Implementar o comando `import-site --from teste|producao`, que abre a conexão em modo somente leitura (`ApplicationIntent=ReadOnly` e transação com `SET TRANSACTION READ ONLY` quando suportado), em `gateway/src/brinde_gateway/cli.py` e `gateway/src/brinde_gateway/importar_site.py`
- [ ] T018 [US5] Implementar `catalogo.importar_do_site()` e o relatório de diferenças "desde a carga", usado antes da virada para produção (FR-026), em `supabase/migrations/0015_catalogo_funcoes.sql`

**Checkpoint**: o Catálogo e o `catalogo.publicado` refletem o site atual.

---

## Phase 4: User Story 1 - Revisar e publicar as mudanças diárias do ERP no site (Priority: P1) 🎯 MVP

**Goal**: revisão com antes e depois e publicação atômica por produto no site de teste.

**Independent Test**: mudar a margem de um produto no ERP. No dia seguinte ele aparece em "Preços" com o antes e depois de cada faixa; depois de publicar, o site de teste mostra os preços novos.

### Testes da US1

- [ ] T019 [P] [US1] Testes da view `catalogo.revisao` e de `catalogo.revisao_resumo()` em `supabase/tests/catalogo.test.mjs`:
  - os grupos `novo`, `preco` (comparação faixa a faixa), `texto_foto`, `desativado`, `reativado` e `personalizacao`;
  - `bloqueado = true` quando houver alerta bloqueante.
- [ ] T020 [P] [US1] Testes da fila em `supabase/tests/catalogo.test.mjs`:
  - `catalogo.pedir_publicacao()` congela os documentos, pula os bloqueados e exige a permissão;
  - `catalogo.pegar_publicacao()` usa skip locked: dois chamados seguidos não pegam o mesmo pedido, e um pedido `publicando` há mais de 2 h volta para a fila;
  - `catalogo.concluir_publicacao()` atualiza o `catalogo.publicado` só para os itens com `data-model.md` → `catalogo.publicacao_itens.site='ok'`;
  - as transições de `data-model.md` → `catalogo.publicacoes.situacao`.
- [ ] T021 [P] [US1] Testes de `site_escrita` com uma conexão falsa que registra o SQL, em `gateway/tests/test_site_escrita.py`:
  - a ordem e as tabelas seguem `contracts/site-escrita.md`;
  - o slug só é gravado no insert;
  - não há DELETE em products, values, productsAttributesValues nem productsImages;
  - o `externalId` recebe o código no fornecedor;
  - o peso não é arredondado;
  - uma falha no meio dá rollback e o produto fica com `site=erro`;
  - o produto sem referência no ERP não é tocado.
- [ ] T022 [P] [US1] Testes do laço `publish` em `gateway/tests/test_publicar.py`:
  - ordem fotos → site → Bling por item;
  - uma falha de site não interrompe os demais itens;
  - as mensagens de erro passam pelo `mask()`.

### Implementação da US1

- [ ] T023 [US1] Criar a view `catalogo.revisao` e as funções `catalogo.revisao_resumo()`, `catalogo.revisao()`, `catalogo.pedir_publicacao()`, `catalogo.pegar_publicacao()`, `catalogo.registrar_item()`, `catalogo.concluir_publicacao()` e `catalogo.publicacoes_recentes()` em `supabase/migrations/0015_catalogo_funcoes.sql`, seguindo `contracts/publicacao.md` e `contracts/painel-rpc.md`
- [ ] T024 [US1] Implementar a gravação de um produto no site (transação por produto, `SET XACT_ABORT ON`, upserts e inativações, `OUTPUT inserted.identify`) em `gateway/src/brinde_gateway/site_escrita.py`, conforme `contracts/site-escrita.md`
- [ ] T025 [US1] Implementar o comando `publish` (pegar pedido, processar itens, registrar resultados, concluir) e os helpers de conexão com o site (pyodbc, segredo `site`) em `gateway/src/brinde_gateway/publicar.py` e `gateway/src/brinde_gateway/cli.py`
- [ ] T026 [US1] Registrar a tarefa agendada `publish` a cada 5 minutos e a leitura do Catálogo às 05:00 em `gateway/install.ps1`, com as instruções em `gateway/LEIAME.md`
- [ ] T027 [P] [US1] Criar as chamadas tipadas (`revisao`, `revisaoResumo`, `pedirPublicacao`, `publicacoesRecentes`) em `apps/web/lib/catalogo.ts`
- [ ] T028 [US1] Criar a tela de revisão (resumo por grupo, lista com antes e depois por item, preços faixa a faixa, alertas bloqueantes com o motivo, botão Publicar com tudo ou os selecionados, acompanhamento "Na fila / Publicando / Publicado às HH:MM — site ✓ fotos ✓ Bling ✓" e aviso "aguardando o computador de publicação") em `apps/web/app/(app)/catalogo/revisao/page.tsx` e `apps/web/components/catalogo/tabela-revisao.tsx`
- [ ] T029 [US1] Criar a rota `POST /api/catalogo/publicar`, que chama `pedir_publicacao` e preenche as URLs assinadas das fotos, em `apps/web/app/api/catalogo/publicar/route.ts`
- [ ] T030 [US1] Adicionar a permissão `catalogo` em `apps/web/lib/permissoes.ts` (tipo, `PERMISSOES`, `ORDEM_TELAS`) e a seção "Catálogo" (Produtos, Revisão) em `apps/web/components/sidebar.tsx`

**Checkpoint**: MVP. Mudanças diárias do ERP (preço e status) são revisadas e publicadas no site de teste.

---

## Phase 5: User Story 2 - Cadastrar produto novo com fotos pela tela (Priority: P1)

**Goal**: completar os dados do site e enviar fotos com nomes padronizados.

**Independent Test**: produto novo com 3 cores, capa, 3 fotos de cor e 2 extras é publicado no site de teste com fotos nos nomes do padrão.

### Testes da US2

- [ ] T031 [P] [US2] Testes das funções puras de nome de foto em `apps/web/lib/catalogo.test.ts`:
  - capa `img_produto/{REF}-capa.jpg`, cor `cores/{SKU}.jpg`, extra `extras/{REF}-{letra}.jpg`;
  - a letra segue `data-model.md` → `catalogo.fotos.ordem` (1 → a, 2 → b; renumeração depois de excluir).
- [ ] T032 [P] [US2] Testes SQL em `supabase/tests/catalogo.test.mjs`:
  - `catalogo.salvar()` incrementa `data-model.md` → `catalogo.produtos.versao`;
  - `catalogo.copiar_de()` preenche categorias, caixas, quantidades e personalizações;
  - `catalogo.lista()` com os filtros "Novos no ERP" e "Com alertas";
  - `catalogo.fotos_ordenar()` e `catalogo.foto_remover()`;
  - o nome sugerido é `nome_padrao || ' ' || ref` (`data-model.md` → `catalogo.produtos.nome`).
- [ ] T033 [P] [US2] Testes de fotos no gateway (download por URL assinada, conversão PNG/WEBP → JPG, upload para a `s3_key` com S3 falso) em `gateway/tests/test_fotos.py`

### Implementação da US2

- [ ] T034 [US2] Criar as funções `catalogo.lista()`, `catalogo.produto()`, `catalogo.salvar()`, `catalogo.copiar_de()`, `catalogo.fotos_ordenar()` e `catalogo.foto_remover()` em `supabase/migrations/0015_catalogo_funcoes.sql`, seguindo `contracts/painel-rpc.md`
- [ ] T035 [US2] Implementar `gateway/src/brinde_gateway/fotos.py`: download, Pillow → JPG qualidade 85, boto3 com o segredo `s3`. Integrar ao `publish` e marcar `catalogo.fotos.situacao='publicada'` (`data-model.md`), apagando o arquivo do Storage depois do sucesso
- [ ] T036 [US2] Criar a rota `POST /api/catalogo/fotos/upload-url` (URL de envio assinada, valida tipo e tamanho ≤ 10 MB, exige a permissão) em `apps/web/app/api/catalogo/fotos/upload-url/route.ts`
- [ ] T037 [P] [US2] Criar as funções de nome de foto e as chamadas tipadas (`lista`, `produto`, `salvar`, `copiarDe`, `fotosOrdenar`, `fotoRemover`) em `apps/web/lib/catalogo.ts`
- [ ] T038 [US2] Criar a lista de produtos (busca e filtros todos / novos / alterados / alertas / inativos) em `apps/web/app/(app)/catalogo/page.tsx`
- [ ] T039 [US2] Criar a tela do produto em `apps/web/app/(app)/catalogo/[ref]/page.tsx`, `apps/web/app/(app)/catalogo/actions.ts` e `apps/web/components/catalogo/campos-produto.tsx`:
  - dados do ERP somente para leitura, marcados "vem do ERP";
  - campos do Catálogo;
  - categorias, caixas e sessão da home vindas de `erp.cat_site_*`;
  - personalizações com a opção de desmarcar;
  - botão "Copiar de outro produto".
- [ ] T040 [US2] Criar as áreas de foto Principal, Cores (um espaço por SKU) e Extras (arrastar e soltar, reordenar, excluir; pré-visualização pelo Storage ou pela URL do S3) em `apps/web/components/catalogo/area-fotos.tsx`

**Checkpoint**: cadastro completo de produtos novos sem o Access.

---

## Phase 6: User Story 3 - Manter o Bling igual ao site (Priority: P2)

**Goal**: cada publicação atualiza os SKUs de cor no Bling, com as regras de situação e a proteção de kits.

**Independent Test**: produto com 2 cores publicado aparece no Bling com os 2 SKUs. Uma cor STANDBY publicada vira "Inativo".

### Testes da US3

- [ ] T041 [P] [US3] Testes de `bling.py` com HTTP falso em `gateway/tests/test_bling.py`:
  - localizar pelo código e depois criar ou atualizar, sempre como produto simples e mantendo o id (FR-023a);
  - corpo conforme `contracts/bling.md`;
  - situação `A/I/E`, sendo que um SKU em `catalogo.bling_componentes` vai para `I` e gera alerta;
  - em `429`, espera e tenta de novo;
  - o refresh do token roda com trava;
  - nenhuma chamada usa endpoint de exclusão definitiva;
  - uma falha resulta em `data-model.md` → `catalogo.publicacao_itens.bling='pendente'`.
- [ ] T042 [P] [US3] Testes SQL em `supabase/tests/catalogo.test.mjs`:
  - `catalogo.bling_token()` e `catalogo.bling_salvar_token()` (Vault, trava);
  - `catalogo.bling_componentes_substituir()`;
  - item `sem_ncm` → `bling='bloqueado'` com o site publicado.

### Implementação da US3

- [ ] T043 [US3] Criar as funções `catalogo.bling_token()`, `catalogo.bling_salvar_token()` e `catalogo.bling_componentes_substituir()`, com os grants ao `gateway_writer`, em `supabase/migrations/0015_catalogo_funcoes.sql`
- [ ] T044 [US3] Implementar `gateway/src/brinde_gateway/bling.py` (cliente v3, refresh, criação e atualização, situações, cache de componentes de kit, limite de requisições) e integrá-lo ao `publish` em `gateway/src/brinde_gateway/publicar.py`
- [ ] T045 [US3] Criar as rotas OAuth `GET /api/bling/conectar` e `GET /api/bling/callback` (só admin, `state`, gravação no Vault) em `apps/web/app/api/bling/conectar/route.ts` e `apps/web/app/api/bling/callback/route.ts`, e o botão "Conectar Bling" em `apps/web/app/(app)/configuracoes/conexoes/page.tsx`
- [ ] T046 [US3] Adicionar o comando de diagnóstico `bling-check <SKU>` (mostra o id e o formato, sem alterar nada) em `gateway/src/brinde_gateway/cli.py`

**Checkpoint**: site e Bling atualizados juntos.

---

## Phase 7: User Story 4 - Trabalhar em equipe numa força-tarefa (Priority: P3)

**Goal**: presença, conflito de versão e auditoria.

**Independent Test**: duas pessoas no mesmo produto. A segunda vê quem está editando e recebe aviso de conflito ao salvar.

### Testes da US4

- [ ] T047 [P] [US4] Testes em `supabase/tests/catalogo.test.mjs`:
  - `catalogo.salvar()` com versão antiga → erro `conflito_versao` com quem e quando, e com `p_forcar=true` grava;
  - `catalogo.marcar_edicao()` grava `data-model.md` → `catalogo.produtos.editando_por` e `catalogo.produtos.editando_ate` (+5 min);
  - o gatilho registra em `catalogo.alteracoes` o antes e depois por campo.

### Implementação da US4

- [ ] T048 [US4] Implementar `catalogo.marcar_edicao()`, a checagem de versão em `catalogo.salvar()` e o gatilho de auditoria em `supabase/migrations/0015_catalogo_funcoes.sql`
- [ ] T049 [US4] Criar o aviso "Fulano está editando" (renovação a cada 2 min) e o diálogo de conflito (recarregar ou sobrescrever) em `apps/web/components/catalogo/aviso-edicao.tsx`, integrados a `apps/web/app/(app)/catalogo/[ref]/page.tsx`
- [ ] T050 [US4] Mostrar o histórico de alterações e de publicações do produto na tela do produto, em `apps/web/app/(app)/catalogo/[ref]/page.tsx`

**Checkpoint**: várias pessoas trabalham sem sobrescrever umas às outras.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T051 [P] Atualizar a skill do projeto em `.claude/skills/dashboard-mercado-livre-brinde-do-bem/SKILL.md`: seção Catálogo, ordem das migrations 0014→0015, comandos `run`, `publish`, `import-site` e `bling-check`, e a regra de que nenhum segredo vai para o chat
- [ ] T052 [P] Guia passo a passo do dono em `gateway/LEIAME.md`: `set-secret site|s3|bling`, criação das views, permissão de leitura, criação do app no Bling e troca do destino para produção
- [ ] T053 Rodar `npm run test:sql`, `npm run test:web`, `npm run typecheck`, `npm run build` e `cd gateway && python -m pytest -q`. Tudo deve passar
- [ ] T054 Executar os cenários 1–11 de `specs/001-catalogo-produtos/quickstart.md` no site de teste com o dono e registrar o resultado em `specs/001-catalogo-produtos/quickstart.md` (coluna de status)
- [ ] T055 Conferir com o Access o preço de 20 produtos (SC-005, diferença máxima de R$ 0,01) e anotar o resultado em `specs/001-catalogo-produtos/quickstart.md`

---

## Dependencies & Execution Order

### Phase Dependencies
- **Setup (F1)** → **Foundational (F2)** → histórias.
- **US5 (F3)** vem antes de US1, porque cria o `catalogo.publicado` de base. Sem ela, todo produto aparece como "novo".
- **US1 (F4)** depende de F2 e US5. É o MVP.
- **US2 (F5)** depende de F2 e usa a fila da US1 (T023–T025) para publicar.
- **US3 (F6)** depende do `publish` (US1). Pode ser feita em paralelo com a US2.
- **US4 (F7)** depende de `catalogo.salvar` (US2, T034).
- **Polish (F8)** vem por último.

### Within Each Story
Testes (falhando) → funções SQL → gateway → web. As migrations 0014 e 0015 são arquivos únicos: tarefas que mexem no mesmo arquivo **não** são paralelas entre si.

### Parallel Opportunities
- F1: T002, T003 e T004 juntas.
- F2: os testes T005, T006 e T007 juntos; T009 e T010 em paralelo com T008.
- US1: os testes T019–T022 juntos; T027 (web) em paralelo com T024 (gateway).
- US2: os testes T031–T033 juntos; T037 em paralelo com T035.
- US3: os testes T041 e T042 juntos; depois de T043, T044 e T045 em paralelo.

## Parallel Example: User Story 1

```text
T019 testes da revisão (SQL)        ┐
T020 testes da fila (SQL)           │ juntos
T021 testes site_escrita (pytest)   │
T022 testes publish (pytest)        ┘
depois: T023 (SQL) → T024 + T027 em paralelo → T025 → T026, T028, T029, T030
```

## Implementation Strategy

### MVP First
1. F1 + F2 (base), depois US5 (importação), depois US1 (revisão e publicação de preço e status no site de teste).
2. **Parar e validar**: cenários 2, 3, 4, 5, 7 e 11 do quickstart.

### Incremental Delivery
3. US2: produtos novos e fotos (cenários 1 e 6).
4. US3: Bling (cenários 3, 4, 5 e 8 no lado Bling).
5. US4: equipe (cenário 9).
6. Polish, conferência com o Access e virada para produção.
