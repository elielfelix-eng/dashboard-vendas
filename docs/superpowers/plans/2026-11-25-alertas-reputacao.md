# Alertas de atraso e reputação — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar no painel as vendas do Mercado Livre com risco de atraso de despacho e de entrega, usando a antecedência em dias úteis definida por grupo de anúncios, e acompanhar a reputação do vendedor.

**Architecture:**
- A sincronização que já roda às 08h, 13h e 17h ganha duas etapas não fatais:
  - os prazos dos envios em aberto vão para `mkt.envios_prazos`;
  - uma foto da reputação vai para `mkt.reputacao_fotos`.
- O cálculo do alerta (dias úteis, grupo, situação) fica em funções SQL `analytics.*`, protegidas pela permissão `operacao`.
- As telas Next.js só leem essas funções.

**Tech Stack:** Next.js 15 (apps/web), Supabase Postgres + RLS, jobs em Node 22 (tsx), PGlite nos testes SQL, `node --test` nos testes TS.

**Spec:** `docs/superpowers/specs/2026-11-25-alertas-reputacao-design.md`

## Global Constraints
- Ramo `004-alertas-reputacao`. Nenhum push nem merge no `main` sem autorização do dono, a cada vez.
- Conexão com o Mercado Livre **somente leitura** (só GET). ERP intocado.
- Segredos nunca impressos, comitados, logados ou gravados em arquivo. O levantamento imprime **nomes de campos, status e datas**; nunca token, nome, endereço ou telefone do comprador.
- Não guardar o JSON bruto do envio, porque ele tem o endereço do comprador. Guardar só os campos listados na Task 2.
- Migrations reexecutáveis (`if not exists`, `on conflict do nothing`, `drop ... if exists`) com numeração a partir de **0023**. As migrations 0020–0022 estão reservadas para a Shopee.
- Antecedência em **dias úteis**: segunda a sexta, sem os feriados de `core.feriados`. A data de referência é "hoje" no horário de Brasília (`America/Sao_Paulo`).
- Padrão de **4** dias úteis para anúncio sem grupo. "Perto do limite" = **80%** do limite. Os dois valores ficam editáveis em Parâmetros pelo administrador.
- Permissões novas:
  - `operacao` (ver a tela) liberada para admin, gestor e comercial;
  - `editar_grupos` liberada para admin e gestor.
- Textos da interface em português, como nas telas existentes. Commits em português, terminando com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Prazo ausente nunca vira "sem risco": aparece como `prazo_desconhecido`.

## Review Focus
1. **Venda em carrinho/pacote com anúncios de grupos diferentes:** vale a maior antecedência, e a venda aparece **uma vez** (por envio). Teste na Task 3.
2. **Prazo caindo em feriado ou fim de semana, e o dia exato da antecedência:** o alerta entra no dia útil certo, e "faltam" mostra 0 no dia do prazo. Teste na Task 3.
3. **Envio cancelado, ou pedido cancelado com o envio ainda `ready_to_ship`:** não pode aparecer em nenhuma lista. Teste na Task 3.
4. **Resposta do ML sem `lead_time`, ou envio que dá 404/403:** a venda vira "prazo desconhecido" e a sincronização não cai. Testes nas Tasks 4 e 5.
5. **Usuário sem `operacao` chamando a função direto pela API:** recebe zero linhas, e o contador no menu fica em 0. Teste na Task 3.

---

### Task 1: Levantamento dos prazos e da reputação no Mercado Livre

Confirma, com vendas reais, de onde vem cada prazo antes de fixar o código. Esta tarefa **termina num ponto de parada para o dono**: para rodar, o script e o workflow precisam estar no `main`, e isso exige autorização.

**Files:**
- Create: `jobs/src/ml-levantamento-envios.ts`
- Create: `.github/workflows/ml-levantamento.yml` (workflow_dispatch, no molde de `bitrix-config.yml`; secrets `DATABASE_URL`, `ML_CLIENT_ID`, `ML_CLIENT_SECRET`)
- Modify: `jobs/package.json` (script `"ml:levantamento": "tsx --env-file-if-exists=../.env src/ml-levantamento-envios.ts"`)
- Create (depois da execução): `docs/alertas/levantamento-ml.md`

**Interfaces:**
- Consumes: `createTokenProvider`, `refreshTokens`, `MercadoLivreConnector` e o `api.get` existente, como em `sync-mercadolivre.ts`.
- Produces: o relatório `docs/alertas/levantamento-ml.md`, que confirma ou corrige as regras de leitura da Task 4 (`lerPrazosEnvio`) e os limites semeados na Task 2.

- [ ] **Step 1: Escrever o script.**
  - Ele pega até 30 `shipment_id` de `mkt.orders` (canal `mercadolivre`, status `paid`, últimos 20 dias).
  - Para cada um, chama `GET /shipments/{id}` (header `x-format-new: true`) e `GET /shipments/{id}/sla`.
  - Imprime **só**:
    - status e substatus;
    - `logistic.mode` e `logistic.type`;
    - a lista de chaves de `lead_time` com as datas (`estimated_handling_limit`, `estimated_delivery_time`, `estimated_delivery_limit`, `estimated_delivery_final`, `buffering`);
    - as chaves e valores de `/sla` (`status`, `expected_date`);
    - `status_history` (só datas de `date_shipped` e `date_delivered`).
  - Depois chama `GET /users/me` e imprime `seller_reputation` inteiro: ele não tem dados pessoais.
  - Nada de token, comprador ou endereço na saída.
- [ ] **Step 2: Conferir sem rede.** Rode `npm run typecheck -w jobs`. Esperado: sem erros.
- [ ] **Step 3: Commit.** Mensagem: `Alertas: levantamento dos prazos de envio e da reputação no ML`.
- [ ] **Step 4 (PARADA, dono):**
  - Pedir autorização para levar este commit ao `main` e enviar ao GitHub.
  - O dono roda o workflow "ML - levantamento de envios" em Actions.
  - No mesmo dia, o dono anota de 3 a 5 vendas da página "Vendas › Para despachar" do ML, com o prazo mostrado, para comparar.
- [ ] **Step 5: Escrever `docs/alertas/levantamento-ml.md`.** Ele deve registrar:
  1. Qual campo bate com o prazo de "Para despachar". Candidato preferido: `sla.expected_date`; reserva: `lead_time.estimated_handling_limit.date`.
  2. Qual campo é a data prometida ao comprador. Preferido: `lead_time.estimated_delivery_time.date`; reserva: `estimated_delivery_final.date`.
  3. Quais status a página "Para despachar" mostra.
  4. O formato das taxas de reputação (fração ou percentual) e os nomes de `level_id`.
  5. Os limites de reclamações, cancelamentos e atrasos por cor, tirados da página de ajuda oficial do ML sobre reputação, com o link (use o agente web-fetch).

  Commit: `Alertas: relatório do levantamento no ML`.

### Task 2: Tabelas, permissões e sementes (migration 0023)

**Files:**
- Create: `supabase/migrations/0023_alertas_tabelas.sql`
- Create: `supabase/tests/alertas.test.mjs` (no molde de `ads.test.mjs`: stubs + migrations 0002..0013, 0018, 0019, 0023)
- Modify: `package.json` (acrescentar `&& node supabase/tests/alertas.test.mjs` ao `test:sql`)

**Interfaces:**
- Produces (exatamente estes nomes e colunas):
  - `mkt.envios_prazos(channel text, shipment_id text, account_id uuid, status text, substatus text, prazo_despacho date, prazo_entrega date, despachado_em timestamptz, entregue_em timestamptz, atualizado_em timestamptz default now(), primary key (channel, shipment_id))`. Leitura: RLS `can_see_channel(channel)` **e** `has_perm('operacao')`.
  - `mkt.reputacao_fotos(account_id uuid, capturado_em timestamptz default now(), level_id text, power_seller_status text, reclamacoes_taxa numeric, cancelamentos_taxa numeric, atrasos_taxa numeric, vendas_periodo integer, periodo text, primary key (account_id, capturado_em))`. As taxas são guardadas **em percentual** (0–100), já convertidas pela Task 4. Leitura: `has_perm('operacao')`.
  - `core.grupos_anuncio(id bigint generated always as identity primary key, account_id uuid references core.accounts on delete cascade, nome text not null, antecedencia_dias integer not null check (antecedencia_dias between 0 and 30), unique (account_id, nome))`.
  - `core.grupo_anuncio_itens(channel text not null, item_id text not null, grupo_id bigint not null references core.grupos_anuncio on delete cascade, primary key (channel, item_id))`. Um anúncio fica em um único grupo.
  - Grupos e itens:
    - leitura com `operacao` **ou** `editar_grupos`;
    - escrita com `editar_grupos`.
  - `core.parametros_alertas(id boolean primary key default true check (id), antecedencia_padrao integer not null default 4 check (antecedencia_padrao between 0 and 30), perto_limite_pct numeric not null default 80 check (perto_limite_pct between 1 and 100))`. Uma linha só. Leitura com `operacao`; escrita com `configuracoes`.
  - `core.feriados(data date primary key, nome text not null)`. Leitura para `authenticated`; escrita com `configuracoes`.
  - `core.reputacao_limites(level_id text, indicador text check (indicador in ('reclamacoes','cancelamentos','atrasos')), limite_pct numeric not null, primary key (level_id, indicador))`. Leitura com `operacao`; escrita com `configuracoes`.
  - Permissões `operacao` e `editar_grupos`, semeadas para os 5 perfis como na 0018.

- [ ] **Step 1: Escrever os testes em `alertas.test.mjs` (eles devem falhar).**
  - `permissao operacao` → `['admin','gestor','comercial']`.
  - `permissao editar_grupos` → `['admin','gestor']`.
  - `parametros_alertas` → `[{antecedencia_padrao: 4, perto_limite_pct: 80}]`.
  - Feriados 2026 incluem `'2026-04-03'`, `'2026-11-20'` e `'2026-12-25'`; 2027 inclui `'2027-03-26'`.
  - `antecedencia_dias = 31` → erro de check.
  - Mesmo anúncio em dois grupos → erro de chave.
  - Como `comercial`:
    - `insert` em `core.grupos_anuncio` → `'negado'`;
    - `select` de `mkt.envios_prazos` funciona.
  - Como `visualizador`: `select count(*)` de `mkt.envios_prazos` → 0.
  - Reexecutar a 0023 duas vezes não dá erro e não duplica sementes.
- [ ] **Step 2: Rodar `node supabase/tests/alertas.test.mjs`.** Esperado: FALHA (a migration não existe).
- [ ] **Step 3: Escrever a 0023.**
  - Feriados nacionais semeados para 2026 e 2027: 01/01, Sexta-feira Santa (2026-04-03, 2027-03-26), 21/04, 01/05, 07/09, 12/10, 02/11, 15/11, 20/11, 25/12. Carnaval e Corpus Christi ficam de fora, porque são ponto facultativo; o admin acrescenta se quiser.
  - Limites de reputação semeados com os valores do relatório da Task 1. Se o relatório não os trouxe, nenhuma linha é semeada e a tela mostra "limite não cadastrado".
- [ ] **Step 4: Rodar o teste.** Esperado: todas as linhas `OK`, zero `FALHA`.
- [ ] **Step 5: Commit.** Mensagem: `Alertas: tabelas, permissões e feriados (0023)`.

### Task 3: Funções de cálculo (migration 0024)

**Files:**
- Create: `supabase/migrations/0024_alertas_funcoes.sql`
- Modify: `supabase/tests/alertas.test.mjs` (aplicar também a 0024 e acrescentar os casos abaixo)

**Interfaces:**
- Consumes: as tabelas da Task 2, mais `mkt.orders`, `mkt.order_items` e `mkt.items`.
- Produces:
  - `core.subtrai_dias_uteis(p_data date, p_n integer) returns date`. Volta `p_n` dias úteis a partir de `p_data`.
  - `core.dias_uteis_ate(p_de date, p_ate date) returns integer`. Conta os dias úteis em `(p_de, p_ate]`; é negativo quando `p_ate < p_de`.
  - `analytics.alertas_envio(p_tipo text, p_hoje date default (now() at time zone 'America/Sao_Paulo')::date)`, com `p_tipo` em `'despacho'|'entrega'`. Retorna `table(situacao text, shipment_id text, order_id text, pack_id text, item_id text, titulo text, grupo text, antecedencia integer, prazo date, faltam integer, status_envio text, substatus text, despachado boolean)`.
    - `situacao` ∈ `'atrasada'|'em_risco'|'prazo_desconhecido'`.
    - Uma linha por envio. `item_id`, `titulo` e `grupo` vêm do item com a maior antecedência.
    - `security definer`; retorna zero linhas sem `operacao`.
  - `analytics.alertas_contagem(p_hoje date default ...)`. Retorna `integer`: o número de `shipment_id` distintos nas duas listas.
  - `analytics.reputacao_atual()`. Retorna `table(level_id text, power_seller_status text, capturado_em timestamptz, indicador text, valor_pct numeric, limite_pct numeric, perto boolean, acima boolean)`, com 3 linhas a partir da foto mais recente.
    - `perto = valor_pct >= limite_pct * perto_limite_pct / 100`.
    - `acima = valor_pct > limite_pct`.
    - Com limite nulo, `perto` e `acima` também ficam nulos.
  - `analytics.reputacao_serie(p_dias integer default 180)`. Retorna `table(dia date, level_id text, reclamacoes numeric, cancelamentos numeric, atrasos numeric)`, com a última foto de cada dia.

Regras de `alertas_envio`:
- Entram envios de pedidos `paid` (pedido não cancelado) cujo envio não está em `cancelled`.
- **despacho:** `status in ('pending','handling','ready_to_ship')`, ou a lista corrigida pelo relatório da Task 1. Usa `prazo_despacho`.
- **entrega:** `status not in ('delivered','not_delivered','cancelled')`. Usa `prazo_entrega`.
- **Antecedência:** a maior entre os itens do envio. Para cada item, vale a do grupo dele ou, sem grupo, `parametros_alertas.antecedencia_padrao`.
- **Situação:**
  - `prazo is null` → `prazo_desconhecido`;
  - `p_hoje > prazo` → `atrasada`;
  - `p_hoje >= core.subtrai_dias_uteis(prazo, antecedencia)` → `em_risco`;
  - fora disso, a venda não entra.
- `faltam = core.dias_uteis_ate(p_hoje, prazo)`.
- **Ordem:** `prazo_desconhecido` por último. Na entrega, os não despachados vêm primeiro. Depois, o prazo em ordem crescente.

- [ ] **Step 1: Acrescentar os testes (eles devem falhar).** Datas fixas com `p_hoje`; 2026-11-20 (sexta) é feriado; 2026-11-23 é uma segunda.
  - `subtrai_dias_uteis('2026-11-30', 4)` → `'2026-11-24'` (prazo na segunda, alerta na terça anterior).
  - `subtrai_dias_uteis('2026-11-23', 1)` → `'2026-11-19'` (pula o feriado de sexta e o fim de semana).
  - `dias_uteis_ate('2026-11-24', '2026-11-30')` → 4.
  - `dias_uteis_ate('2026-11-30', '2026-11-30')` → 0.
  - `dias_uteis_ate('2026-12-01', '2026-11-30')` → -1.
  - Envio A: prazo de despacho 2026-11-30, sem grupo (padrão 4).
    - Com `p_hoje='2026-11-23'`, não aparece.
    - Com `'2026-11-24'`, aparece `em_risco` e `faltam 4`.
    - Com `'2026-12-01'`, aparece `atrasada`.
  - Envio B: pacote com dois itens, grupos de 2 e 6 dias, prazo 2026-12-04. Com `p_hoje='2026-11-26'` aparece **uma** linha, `antecedencia 6`, `em_risco`.
  - Envio C: `prazo_despacho null` → `prazo_desconhecido`, última linha.
  - Envio D: pedido `cancelled` com envio `ready_to_ship` → ausente.
  - Envio E: `status='shipped'` → ausente em despacho; presente em entrega com `despachado=true`, depois dos não despachados.
  - `alertas_contagem` conta B uma vez só, mesmo quando B está nas duas listas.
  - Como `visualizador`: `alertas_envio('despacho')` e `alertas_contagem()` → 0.
  - Reputação: foto com reclamações a 0,9%, limite 1% → `perto=true` e `acima=false`. Sem limite cadastrado → `perto` e `acima` nulos.
- [ ] **Step 2: Rodar o teste.** Esperado: FALHA (as funções não existem).
- [ ] **Step 3: Escrever a 0024 com as assinaturas acima.**
- [ ] **Step 4: Rodar `npm run test:sql`.** Esperado: todos os arquivos sem `FALHA`.
- [ ] **Step 5: Commit.** Mensagem: `Alertas: cálculo em dias úteis, listas e reputação (0024)`.

### Task 4: Leitura dos prazos e da reputação no conector

**Files:**
- Create: `packages/connectors/src/mercadolivre/prazos.ts`
- Create: `packages/connectors/src/mercadolivre/prazos.test.ts`
- Modify: `packages/connectors/src/mercadolivre/connector.ts` (métodos novos, ao lado de `getShipmentStatus`)
- Modify: `packages/connectors/src/index.ts` (exportar)

**Interfaces:**
- Produces:
  - `interface PrazosEnvio { status: string | null; substatus: string | null; prazoDespacho: string | null; prazoEntrega: string | null; despachadoEm: string | null; entregueEm: string | null }`. As datas de prazo saem como `YYYY-MM-DD` no horário de Brasília; os eventos saem como ISO.
  - `lerPrazosEnvio(envio: unknown, sla: unknown): PrazosEnvio`. Função pura, com os campos escolhidos no relatório da Task 1. Ordem padrão:
    - despacho: `sla.expected_date`, depois `lead_time.estimated_handling_limit.date`;
    - entrega: `lead_time.estimated_delivery_time.date`, depois `lead_time.estimated_delivery_final.date`.
  - `interface Reputacao { levelId: string | null; powerSellerStatus: string | null; reclamacoesPct: number | null; cancelamentosPct: number | null; atrasosPct: number | null; vendasPeriodo: number | null; periodo: string | null }`.
  - `lerReputacao(sellerReputation: unknown): Reputacao`. Converte as taxas para percentual conforme o formato registrado no relatório.
  - `MercadoLivreConnector.getPrazosEnvio(shipmentId: string): Promise<PrazosEnvio | null>`. Faz `/shipments/{id}` (x-format-new) e `/shipments/{id}/sla`. Um 404/403 no `/sla` vira `sla = null`; um 404/403 no envio retorna `null`.
  - `MercadoLivreConnector.getReputacao(): Promise<Reputacao>`. Usa `me()`.

- [ ] **Step 1: Escrever os testes em `prazos.test.ts`.**
  - `sla.expected_date '2026-11-30T23:59:59.000-03:00'` → `prazoDespacho '2026-11-30'`.
  - `'2026-12-01T01:00:00.000Z'` → `'2026-11-30'` (conversão para Brasília).
  - Sem `sla` e com `lead_time.estimated_handling_limit.date` → usa o lead_time.
  - Sem `lead_time` nenhum → prazos `null`, sem exceção.
  - `envio` `null` → todos os campos `null`.
  - `lerReputacao({level_id:'5_green', metrics:{claims:{rate:0.009}, cancellations:{rate:0}, delayed_handling_time:{rate:0.03}, sales:{period:'60 days', completed:120}}})` → `reclamacoesPct 0.9`, `atrasosPct 3`, `levelId '5_green'`. Ajuste se o relatório mostrar outro formato.
  - `lerReputacao(undefined)` → tudo `null`.
- [ ] **Step 2: Rodar `node --experimental-transform-types --test packages/connectors/src/mercadolivre/prazos.test.ts`.** Esperado: FALHA.
- [ ] **Step 3: Implementar `prazos.ts` e os dois métodos.** Só GET, com o mesmo tratamento de erro de `getShipmentStatus`.
- [ ] **Step 4: Rodar `npm run test:web` e `npm run typecheck`.** Esperado: PASS.
- [ ] **Step 5: Commit.** Mensagem: `Alertas: leitura dos prazos de envio e da reputação no conector ML`.

### Task 5: Sincronização dos prazos e da reputação

**Files:**
- Modify: `jobs/src/sync-mercadolivre.ts`
- Create: `jobs/src/prazos-envio.ts` (a consulta que escolhe os envios e a gravação)
- Create: `jobs/src/prazos-envio.test.ts` (PGlite, no molde de `token-store.test.ts`)

**Interfaces:**
- Consumes: `getPrazosEnvio` e `getReputacao` (Task 4); as tabelas da Task 2.
- Produces:
  - `enviosParaAtualizar(sql: Sql, limite?: number): Promise<string[]>`. Seleciona os `shipment_id` de pedidos `mercadolivre` `paid` dos últimos **45 dias** que ainda não estão em `mkt.envios_prazos` ou cujo status salvo não é final (`delivered`, `not_delivered`, `cancelled`). Limite padrão 1500, com os mais antigos (`date_created`) primeiro.
  - `salvarPrazos(sql: Sql, accountId: string, shipmentId: string, p: PrazosEnvio | null): Promise<void>`. Faz upsert. Um `null` grava `status = 'sem_envio'`, que conta como final.
  - `salvarReputacao(sql: Sql, accountId: string, r: Reputacao): Promise<void>`.
  - Em `syncMercadoLivre`, depois de `syncCancelledShipments`, duas etapas **não fatais**, no padrão de `syncItems`:
    - `stats.prazos_envio`, valendo `-1` em erro;
    - `stats.reputacao`, valendo `1`, ou `-1` em erro.
  - O log de erro mostra só a mensagem, sem token.

- [ ] **Step 1: Escrever os testes.**
  - Pedido pago de 10 dias, sem prazo salvo → selecionado.
  - Pedido com envio salvo `delivered` → não selecionado.
  - Pedido de 60 dias → não selecionado.
  - Pedido cancelado → não selecionado.
  - `salvarPrazos` duas vezes atualiza e não duplica.
  - `salvarPrazos(..., null)` grava `sem_envio`.
  - `salvarReputacao` grava as taxas em percentual.
- [ ] **Step 2: Rodar `node --experimental-transform-types --test jobs/src/prazos-envio.test.ts`.** Esperado: FALHA.
- [ ] **Step 3: Implementar e ligar em `syncMercadoLivre`.**
- [ ] **Step 4: Rodar `npm run test:web` e `npm run typecheck`.** Esperado: PASS.
- [ ] **Step 5: Commit.** Mensagem: `Alertas: sincronização dos prazos de envio e da reputação`.

### Task 6: Tela "Alertas e Reputação" e contador no menu

**Files:**
- Create: `apps/web/lib/alertas.ts`
- Create: `apps/web/lib/alertas-formato.ts`
- Create: `apps/web/lib/alertas-formato.test.ts`
- Create: `apps/web/app/(app)/alertas/page.tsx`
- Modify: `apps/web/lib/permissoes.ts` (tipo `Permissao` + `PERMISSOES` com `operacao` "Alertas e Reputação" e `editar_grupos` "Editar grupos de anúncios"; `ORDEM_TELAS` com `['operacao', '/alertas']`)
- Modify: `apps/web/components/sidebar.tsx` (item `{ href: '/alertas', label: 'Alertas e Reputação', perm: 'operacao' }` logo depois de Vendas; prop `alertas?: number`, mostrada como selo vermelho quando > 0)
- Modify: `apps/web/app/(app)/layout.tsx` (chamar `contarAlertas()` só quando o usuário tem `operacao`)

**Interfaces:**
- Consumes: as funções `analytics.*` da Task 3.
- Produces:
  - `listarAlertas(tipo: 'despacho' | 'entrega'): Promise<AlertaEnvio[]>`.
  - `contarAlertas(): Promise<number>`.
  - `reputacaoAtual(): Promise<IndicadorReputacao[]>`.
  - `reputacaoSerie(dias?: number): Promise<PontoReputacao[]>`.
  - Os tipos espelham as colunas da Task 3, com numeric convertido para number, como em `lib/ads.ts`.
  - `textoFaltam(faltam: number | null, situacao: string): string`.
  - `corDoNivel(levelId: string | null): { nome: string; classe: string }`.

- [ ] **Step 1: Escrever os testes em `alertas-formato.test.ts`.**
  - `textoFaltam(4,'em_risco')` → `'4 dias úteis'`.
  - `textoFaltam(1,'em_risco')` → `'1 dia útil'`.
  - `textoFaltam(0,'em_risco')` → `'vence hoje'`.
  - `textoFaltam(-2,'atrasada')` → `'atrasada há 2 dias úteis'`.
  - `textoFaltam(null,'prazo_desconhecido')` → `'prazo desconhecido'`.
  - `corDoNivel('5_green').nome` → `'Verde'`; `'4_light_green'` → `'Verde-claro'`; `'3_yellow'` → `'Amarelo'`; `'2_orange'` → `'Laranja'`; `'1_red'` → `'Vermelho'`; `null` → `'Sem reputação'`.
- [ ] **Step 2: Rodar `node --test apps/web/lib/alertas-formato.test.ts`.** Esperado: FALHA.
- [ ] **Step 3: Implementar a lib e a página.**
  - A página usa `exigirPermissao('operacao')`.
  - No topo, o cartão de reputação: cor e os três indicadores no formato "valor% / limite%". Destaque amarelo quando `perto`, vermelho quando `acima`, e "limite não cadastrado" quando o limite é nulo.
  - Abas "Despacho em risco (n)" e "Entrega em risco (n)", trocadas por `?aba=`.
  - Tabela com as colunas Venda (link para a venda no ML: `https://www.mercadolivre.com.br/vendas/{order_id}/detalhe`), Anúncio, Grupo, Prazo (dd/mm), Faltam, Status do envio.
  - As linhas `atrasada` ficam em vermelho, e as `prazo_desconhecido` numa faixa "Prazo desconhecido" no fim.
  - Abaixo, o gráfico da evolução com `grafico-serie.tsx` (três linhas, 180 dias).
  - Estado vazio: "Nenhuma venda em risco agora."
- [ ] **Step 4: Rodar `npm run test:web`, `npm run typecheck` e `npm run build`.** Esperado: PASS.
- [ ] **Step 5: Commit.** Mensagem: `Alertas: tela de alertas e reputação e contador no menu`.

### Task 7: Grupos de anúncios e parâmetros dos alertas

**Files:**
- Create: `apps/web/app/(app)/configuracoes/grupos-anuncios/page.tsx`
- Create: `apps/web/app/(app)/configuracoes/grupos-anuncios/actions.ts`
- Create: `apps/web/lib/grupos.ts`
- Create: `apps/web/lib/grupos.test.ts`
- Modify: `apps/web/app/(app)/configuracoes/parametros/page.tsx` e `actions.ts` (seção "Alertas e reputação")
- Modify: `apps/web/components/sidebar.tsx` (item `{ href: '/configuracoes/grupos-anuncios', label: 'Grupos de anúncios', perm: 'editar_grupos' }`)

**Interfaces:**
- Produces:
  - Server actions:
    - `criarGrupo(form: FormData)`, com os campos `nome` e `antecedencia`;
    - `editarGrupo(form: FormData)`, com `id`, `nome` e `antecedencia`;
    - `excluirGrupo(form: FormData)`, com `id` (os anúncios voltam ao padrão);
    - `atribuirAnuncios(form: FormData)`, com vários `item_id` e um `grupo_id`; vazio = tirar do grupo.

    Todas validam com `validarGrupo` e chamam `exigirPermissao('editar_grupos')`.
  - `validarGrupo(nome: string, antecedencia: string): { ok: true; nome: string; antecedencia: number } | { ok: false; erro: string }`.
    - Exige nome com o espaço das pontas removido, de 1 a 60 caracteres.
    - Exige antecedência inteira entre 0 e 30.
  - Actions de Parâmetros (só admin, `exigirPermissao('configuracoes')`):
    - `salvarParametrosAlertas`, com `antecedencia_padrao` e `perto_limite_pct`;
    - `adicionarFeriado` e `excluirFeriado`;
    - `salvarLimiteReputacao`.

- [ ] **Step 1: Escrever os testes em `grupos.test.ts`.**
  - `validarGrupo(' Personalizados ', '6')` → `{ok:true, nome:'Personalizados', antecedencia:6}`.
  - `validarGrupo('', '3').ok` → false.
  - `validarGrupo('X', '31').ok` → false.
  - `validarGrupo('X', '2.5').ok` → false.
  - `validarGrupo('X', '0').ok` → true.
- [ ] **Step 2: Rodar `node --test apps/web/lib/grupos.test.ts`.** Esperado: FALHA.
- [ ] **Step 3: Implementar a tela de grupos.**
  - Uma lista de grupos com nome, antecedência e quantidade de anúncios, editável.
  - Abaixo, a tabela de anúncios ativos (`mkt.items`, canal `mercadolivre`) com título, grupo atual e uma caixa de seleção.
  - O filtro "Sem grupo" vem marcado de início, com o aviso "usando o padrão de N dias úteis".
  - Barra "Mover selecionados para: [grupo] [Aplicar]".
  - Busca por título.
- [ ] **Step 4: Implementar a seção em Parâmetros.**
  - Antecedência padrão e "perto do limite (%)".
  - Lista de feriados com botão para adicionar e excluir.
  - Tabela de limites por cor e indicador.
- [ ] **Step 5: Rodar `npm run test:web`, `npm run typecheck` e `npm run build`.** Esperado: PASS.
- [ ] **Step 6: Commit.** Mensagem: `Alertas: grupos de anúncios e parâmetros dos alertas`.

### Task 8: Validação com o dono

Esta tarefa é toda de pontos de parada: são ações fora do ramo.

- [ ] **Step 1:** Rodar `npm run test:sql`, `npm run test:web`, `npm run typecheck` e `npm run build`. Esperado: tudo PASS.
- [ ] **Step 2 (dono):** Autorizar o merge no `main` e o envio ao GitHub. Aplicar a `0023` e a `0024` no Supabase (SQL Editor), nessa ordem.
- [ ] **Step 3 (dono):** Rodar a sincronização manual em Actions ("source = mercadolivre") e conferir em `core.sync_runs` que `prazos_envio > 0` e `reputacao = 1`.
- [ ] **Step 4 (dono):** Comparar a lista "Despacho em risco" com "Vendas › Para despachar" do ML: as vendas e os prazos têm de bater. Comparar o cartão de reputação com a página de reputação do ML.
- [ ] **Step 5 (dono):** Criar dois grupos com antecedências diferentes, colocar um anúncio em cada um e conferir, no dia certo, que a venda entra no alerta.
- [ ] **Step 6:** Registrar o resultado no ledger e na memória do projeto.
