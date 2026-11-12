# Dashboard Bloco A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Telas Visão Geral, Vendas, Rentabilidade e Metas/Projeção do Mercado Livre, mais administração de permissões, parâmetros de custo e metas.

**Architecture:** O banco calcula: migrations 0008–0010 criam tabelas de administração em `core` e funções `analytics.dash_*` (security invoker) sobre `analytics.ml_pedidos`; o site Next.js (Server Components) chama essas funções via `supabase.schema('analytics').rpc(...)` com a sessão do usuário e só desenha. Permissões por perfil numa tabela, aplicadas no banco (custos `null`) e no menu.

**Tech Stack:** Postgres/Supabase (PGlite nos testes), Next.js 15, React 19, Tailwind 4, Recharts 3, `read-excel-file` e `write-excel-file` (navegador), testes `node --test` para TS puro.

**Spec:** `docs/superpowers/specs/2026-11-12-dashboard-bloco-a-design.md`

## Global Constraints

- Migrations reexecutáveis; ordem de aplicação **0003 → 0006 → 0007 → 0008 → 0009 → 0010** (escrever isso no cabeçalho de cada nova migration).
- Funções `analytics.dash_*`: `language sql|plpgsql stable security invoker set search_path = ''`, `grant execute ... to authenticated`.
- Datas em horário de Brasília (`America/Sao_Paulo`); data da venda = `analytics.ml_pedidos.data_venda`.
- Vendas brutas / pedidos / unidades = classes `pago`, `cancelado`, `devolvido` (sem `dividido`); unidades = soma de `qtd` (igual a `ml_meses.unidades_vendidas`). Receita = só `pago`.
- Sem permissão `custos`: `custo_produto`, `imposto`, `embalagem`, `margem_*`, `contribuicao*`, `abc`, `pedidos_sem_custo` voltam `null`. Tarifas do ML e Ads continuam visíveis.
- Canais: `mercadolivre`, `shopee`, `brindedobem`; filtro `consolidado` = todos os canais com dados (hoje só ML). Sempre respeitar `core.can_see_channel`.
- Textos de tela em português do Brasil, valores em `R$` com `toLocaleString('pt-BR')`.
- Nunca escrever segredos no código; nenhum dado de pedido em arquivos versionados (testes usam dados sintéticos).
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Verificação final de cada task: `npm run test:sql`, `npm run test:web` (a partir da Task 5) e `npm run typecheck` verdes.

## Review Focus

- Período sem nenhuma venda → funções devolvem uma linha de resumo com zeros/`null` (não erro) e a tela mostra "Sem vendas no período". Teste na Task 2.
- Período anterior com zero → variação "novo", não divisão por zero/Infinity. Teste na Task 5 (`variacao`).
- Pedido com vários itens de modelos diferentes → `dash_modelos` soma por item (não duplica valor do pedido). Teste na Task 3.
- Planilha com vírgula decimal, mês em minúsculas/acentuado ("mar", "Mar", 3) e canal com variação de maiúsculas → aceita; meta em branco → linha inválida. Teste na Task 9.
- Usuário sem o canal liberado chamando a função direto → zero linhas. Teste na Task 2.

---

### Task 1: Tabelas de administração (permissões, parâmetros, metas, premissas)

**Files:**
- Create: `supabase/migrations/0008_dashboard_admin.sql`
- Create: `supabase/tests/dashboard-admin.test.mjs`
- Modify: `package.json` (script `test:sql` inclui os novos testes, em ordem)

**Interfaces:**
- Produces:
  - `core.role_permissions(role core.app_role, permission text, allowed boolean not null default false, primary key(role, permission))`, sementes conforme a tabela da spec §7 (permissões `visao_geral, vendas, rentabilidade, metas, custos, editar_metas, configuracoes`), `on conflict do nothing`.
  - `core.has_perm(p text) returns boolean` (security definer, `coalesce(..., false)`, usa `core.my_role()`).
  - `core.can_see_costs()` reescrita = `core.has_perm('custos')`.
  - `core.parametros_custo(id bigserial pk, channel text not null, imposto_pct numeric(6,3) not null default 0, embalagem_pedido numeric(12,2) not null default 0, embalagem_peca numeric(12,4) not null default 0, vigente_desde date not null, unique(channel, vigente_desde))`; semente `('mercadolivre', 0, 0, 0, '2019-01-01')`.
  - `core.metas(channel text check in ('mercadolivre','shopee','brindedobem'), ano int, mes int check 1..12, valor numeric(14,2) not null check >= 0, carregado_em timestamptz default now(), primary key(channel, ano, mes))`.
  - `core.premissas_projecao(channel text, ano int, mes int null, crescimento_pct numeric(7,3) not null)`; unicidade por `(channel, ano, coalesce(mes, 0))`; `mes null` = padrão do canal no ano.
  - `core.substituir_metas(p_linhas jsonb) returns integer` (security invoker): apaga `core.metas` dos anos presentes em `p_linhas` e insere todas (`[{channel, ano, mes, valor}]`), retorna nº inserido.
  - RLS: leitura de `role_permissions` e `parametros_custo` para `authenticated`; escrita só `core.my_role()='admin'`. `metas`/`premissas_projecao`: leitura com `has_perm('metas')`, escrita com `has_perm('editar_metas')`.
  - Trava: trigger em `role_permissions` que recusa `allowed=false` ou delete para `(admin, configuracoes)` com mensagem `'o perfil admin precisa manter a permissao configuracoes'`.

- [ ] **Step 1: Write the failing test** (`dashboard-admin.test.mjs`, padrão de `custo-cotacao.test.mjs`: stubs + 0002 + 0003 + 0006 + 0007 + 0008 aplicada 2×). Para trocar o perfil, redefinir o stub: `create or replace function core.my_role() returns core.app_role language sql as $$ select current_setting('teste.perfil')::core.app_role $$` e `set teste.perfil = 'comercial'`. Asserções:
  - sementes: `select role, array_agg(permission order by permission) from core.role_permissions where allowed group by role` = tabela da spec (admin 7, gestor 6 sem `configuracoes`, comercial `{metas,vendas,visao_geral}`, visualizador `{visao_geral}`, vendedor nenhuma).
  - `has_perm('custos')`: admin true, gestor true, comercial false; `can_see_costs()` acompanha.
  - `update core.role_permissions set allowed=false where role='admin' and permission='configuracoes'` → erro com a mensagem da trava.
  - reexecutar 0008 não duplica sementes nem desfaz uma alteração feita (ex.: comercial `custos` = true continua true).
  - `substituir_metas('[{"channel":"shopee","ano":2027,"mes":1,"valor":29000}, ...]')` com 2 linhas → 2; chamada de novo com 1 linha de 2027 → sobram 1 de 2027 e as de 2026 intactas.
  - `insert into core.metas ... valor -1` → erro de check.

- [ ] **Step 2: Run** `node supabase/tests/dashboard-admin.test.mjs` → FALHA (0008 não existe).
- [ ] **Step 3: Implement** `0008_dashboard_admin.sql` com as interfaces acima (seções comentadas; cabeçalho com a ordem de aplicação).
- [ ] **Step 4: Run** `npm run test:sql` → "Todos os testes passaram" em todos os arquivos (regras-v1 e custo-cotacao continuam verdes com o novo `can_see_costs`).
- [ ] **Step 5: Commit** `git add supabase/migrations/0008_dashboard_admin.sql supabase/tests/dashboard-admin.test.mjs package.json` → `"Dashboard: tabelas de permissoes, parametros de custo e metas (0008)"`.

---

### Task 2: Base de pedidos do dashboard, custos do período, resumo e série

**Files:**
- Create: `supabase/migrations/0009_dashboard_funcoes.sql`
- Create: `supabase/tests/dashboard-funcoes.test.mjs`
- Modify: `package.json` (`test:sql`)

**Interfaces:**
- Consumes: Task 1 (`core.parametros_custo`, `core.has_perm`); `analytics.ml_pedidos`, `analytics.ml_fatura`, `mkt.ads_campaign_daily` (0003/0007).
- Produces:
  - `analytics.dash_pedidos_base` (view, security_invoker): todas as colunas de `ml_pedidos` + `channel text` (`'mercadolivre'`) + `imposto numeric` (= `receita × imposto_pct/100`) + `embalagem numeric` (= pedidos pagos: `embalagem_pedido + embalagem_peca × unidades`; demais 0), usando a vigência com maior `vigente_desde <= data_venda` do canal. Filtra `core.can_see_channel(channel)`.
  - `analytics.dash_custos_periodo(p_canal text, p_de date, p_ate date) returns table(categoria text, valor numeric)`: custos sem pedido no período, mesma regra de `ml_meses`: linhas de `ml_fatura` com `order_id is null` e `data_ref between p_de and p_ate` por categoria, sendo `product_ads` da fatura só quando `data_ref < min(ads_campaign_daily.day)`; mais `product_ads` da API (`ads_campaign_daily.day between p_de and p_ate`). Categorias: `comissao, frete, parcelamento, product_ads, seguidores, estornos_publicidade, difal, outras`.
  - `analytics.dash_resumo(p_canal text, p_de date, p_ate date) returns table(pedidos int, vendas_brutas numeric, unidades int, ticket_medio numeric, cancelados int, devolvidos int, pct_cancel_devol numeric, receita numeric, comissao numeric, frete numeric, parcelamento numeric, product_ads numeric, seguidores numeric, estornos numeric, difal numeric, outras numeric, custo_produto numeric, imposto numeric, embalagem numeric, margem_bruta numeric, margem_contribuicao numeric, pedidos_sem_custo int)` — sempre exatamente 1 linha. Tarifas = parte do pedido (`dash_pedidos_base`) + parte do período (`dash_custos_periodo`). `margem_bruta = receita − custo_produto`; `margem_contribuicao = receita − (todas as tarifas) − imposto − embalagem − custo_produto`. `pct_cancel_devol = (cancelados+devolvidos)/pedidos×100` (0 se pedidos=0). Campos de custo `null` sem `has_perm('custos')`.
  - `analytics.dash_serie(p_canal text, p_de date, p_ate date, p_grao text) returns table(periodo date, vendas_brutas numeric, pedidos int, receita numeric)`; `p_grao in ('dia','semana','mes')` (`date_trunc`, semana começando na segunda); períodos sem venda aparecem com 0 (`generate_series`).
  - `p_canal`: `'consolidado'` = todos; outro valor = só aquele canal (`'shopee'` hoje → zeros).

- [ ] **Step 1: Write the failing test** `dashboard-funcoes.test.mjs` (stubs + 0002 + 0003 + 0006 + 0007 + 0008 + 0009 ×2). Reaproveitar o cenário de pedidos/fatura/ads de `regras-v1.test.mjs` (copiar os inserts dos pedidos 1–8, fatura a–i, s7f, ads c1/c2) e uma cotação `('BLA68', 1, 49, 4.00, '2026-01-01', 'erp')`. Asserções:
  - **consistência com `ml_meses`:** `dash_resumo('mercadolivre','2026-10-01','2026-10-31')` → `vendas_brutas 180, pedidos 4, unidades 6, cancelados 1, devolvidos 2, receita 60, product_ads 100, seguidores 8, estornos -3, difal 2, outras 1, comissao 7.2, frete 10, custo_produto 0, margem_contribuicao -65.2` (mesmos números do teste "resumo de outubro").
  - **imposto/embalagem por vigência:** inserir `('mercadolivre', 10, 2, 0.5, '2026-10-12')`; outubro: só o pedido 2 (pago em 10/10) é anterior → imposto 0; mudar vigência para `'2026-10-01'` → `imposto 6` (10% de 60), `embalagem 3.5` (2 + 0.5×3 unidades), `margem_contribuicao -74.7`.
  - **período vazio:** `dash_resumo('mercadolivre','2020-01-01','2020-01-31')` → 1 linha, `pedidos 0, vendas_brutas 0, ticket_medio 0, pct_cancel_devol 0`.
  - **shopee:** `dash_resumo('shopee', ...)` → `pedidos 0`; `consolidado` = mesmos números do ML.
  - **permissão:** com perfil `comercial` → `custo_produto, margem_bruta, margem_contribuicao, imposto, embalagem, pedidos_sem_custo` = `null`, `vendas_brutas` e `product_ads` preenchidos.
  - **canal bloqueado:** stub `core.can_see_channel` retornando false → `pedidos 0`.
  - **série:** `dash_serie('mercadolivre','2026-10-10','2026-10-14','dia')` → 5 linhas, dia 10 `vendas_brutas 60`, dia 11 `0` (dividido não conta); `'mes'` em `2026-09-01..2026-10-31` → 2 linhas.
- [ ] **Step 2: Run** `node supabase/tests/dashboard-funcoes.test.mjs` → FALHA.
- [ ] **Step 3: Implement** a primeira parte de `0009_dashboard_funcoes.sql` (view base, `dash_custos_periodo`, `dash_resumo`, `dash_serie`).
- [ ] **Step 4: Run** `npm run test:sql` → tudo verde.
- [ ] **Step 5: Commit** → `"Dashboard: base de pedidos, custos do periodo, resumo e serie (0009)"`.

---

### Task 3: Modelos (vendas, rentabilidade com rateio e curva ABC), SKUs e pedidos

**Files:**
- Modify: `supabase/migrations/0009_dashboard_funcoes.sql` (acrescentar)
- Modify: `supabase/tests/dashboard-funcoes.test.mjs` (acrescentar)

**Interfaces:**
- Consumes: Task 2 (`dash_pedidos_base`, `dash_custos_periodo`).
- Produces:
  - `analytics.dash_modelos(p_canal text, p_de date, p_ate date) returns table(modelo text, pedidos int, unidades int, vendas_brutas numeric, ticket_medio numeric, pct_cancel_devol numeric, receita numeric, custo_produto numeric, tarifas_frete numeric, custos_rateados numeric, imposto_embalagem numeric, contribuicao numeric, contribuicao_pct numeric, abc text, sem_custo int)`. Linha por modelo **de item** (base em `mkt.order_items` + `analytics.ref_erp`, valores do item; tarifas/frete/imposto/embalagem do pedido repartidos entre os itens pela participação do item no valor do pedido). `tarifas_frete` = comissão + frete + parcelamento + demais tarifas ligadas ao pedido. `custos_rateados` = soma de `dash_custos_periodo` × (receita do modelo ÷ receita total do período). `abc`: entre modelos com `contribuicao > 0` ordenados desc, acumulado ≤ 80% → `'A'`, ≤ 95% → `'B'`, resto `'C'`; `contribuicao <= 0` → `'prejuizo'`; modelo sem receita → `null`. Colunas de custo e `abc` `null` sem `custos`.
  - `analytics.dash_skus(p_canal text, p_de date, p_ate date, p_modelo text) returns table(sku text, kit int, pedidos int, unidades int, vendas_brutas numeric, receita numeric, custo_produto numeric, contribuicao numeric)` — mesmo cálculo de `dash_modelos`, agrupado por SKU (referência do ERP) do modelo.
  - `analytics.dash_pedidos(p_canal text, p_de date, p_ate date, p_modelo text) returns table(order_id text, data_venda date, sku text, sku_anuncio text, qtd int, valor_venda numeric, classe text, custo_produto numeric, alerta_custo text)` ordenado por `data_venda desc`; `p_modelo null` = todos.

- [ ] **Step 1: Write the failing tests** (acrescentar no mesmo arquivo, **depois** das asserções da Task 2, que dependem do cenário original; o pedido 'M1' muda outubro, e o cenário ABC usa pedidos sintéticos em 2025 para não interferir):
  - outubro: `dash_modelos` → GFT10 com `vendas_brutas 180` (itens 2,4,5,6), `receita 60`; soma de `custos_rateados` de todos os modelos = soma de `dash_custos_periodo` (tolerância 0.01).
  - **pedido com 2 modelos:** novo pedido pago 'M1' em 2026-10-20, total 100, itens `BLA68-AMA` (qtd 1, R$ 70) e `GFT10-AZU` (qtd 1, R$ 30), fatura `CVVML 10` no pedido → BLA68 recebe `tarifas_frete 7`, GFT10 `3`; `vendas_brutas` somadas por modelo não contam o pedido 2×.
  - **ABC:** cenário sintético com contribuições 80, 15, 5, −10 → `A, B, C, prejuizo`.
  - `dash_skus('mercadolivre','2026-10-01','2026-10-31','GFT10')` → 1 linha `GFT10-AZU`.
  - `dash_pedidos(..., 'GFT10')` → pedidos de outubro do GFT10 com `classe`; dividido aparece com `classe 'dividido'`.
  - perfil `comercial` → `abc`, `custo_produto`, `contribuicao` `null` em `dash_modelos`.
- [ ] **Step 2: Run** → FALHA.
- [ ] **Step 3: Implement** as três funções.
- [ ] **Step 4: Run** `npm run test:sql` → verde.
- [ ] **Step 5: Commit** → `"Dashboard: modelos com rateio e curva ABC, SKUs e pedidos (0009)"`.

---

### Task 4: Metas e projeção no banco

**Files:**
- Create: `supabase/migrations/0010_dashboard_metas.sql`
- Create: `supabase/tests/dashboard-metas.test.mjs`
- Modify: `package.json` (`test:sql`)

**Interfaces:**
- Consumes: Task 1 (`core.metas`, `core.premissas_projecao`), Task 2 (`dash_pedidos_base`).
- Produces: `analytics.dash_metas(p_canal text, p_ano int, p_hoje date default (now() at time zone 'America/Sao_Paulo')::date) returns table(mes date, situacao text, realizado numeric, crescimento_pct numeric, crescimento_editado boolean, projecao numeric, meta numeric)`. Meses de `date_trunc('month', p_hoje) − 12 meses` até dezembro de `p_ano`. `situacao`: `'realizado'` (mês < mês de p_hoje), `'em_andamento'` (mês de p_hoje), `'projetado'` (depois). Realizado = soma de `receita` por mês (para `'consolidado'`, todos os canais; meta consolidada = soma das metas dos canais). Projeção: o 1º mês ≥ mês de p_hoje parte do último mês `'realizado'`; cada mês = anterior × (1 + crescimento/100), crescimento = premissa do mês (`crescimento_editado = true`) senão padrão do canal no ano do mês, senão 0. Meses realizados têm `projecao null`. Sem permissão `metas` → zero linhas.

- [ ] **Step 1: Write the failing test** (`p_hoje = '2026-11-12'`; pedidos pagos sintéticos: out/2026 receita 1000; nov/2026 parcial 300; metas 2027 jan 26711; premissa padrão ML 2027 = 10, padrão 2026 = 0, jan/2027 editado = 5):
  - nov/2026 `em_andamento`, `realizado 300`, `projecao 1000` (0% sobre 1000);
  - dez/2026 `projecao 1000`; jan/2027 `crescimento_pct 5`, `crescimento_editado true`, `projecao 1050`, `meta 26711`; fev/2027 `crescimento_pct 10`, `projecao 1155`;
  - out/2026 `realizado 1000`, `projecao null`; primeira linha = nov/2025; última = dez/2027 (26 linhas);
  - perfil `visualizador` → 0 linhas.
- [ ] **Step 2: Run** → FALHA.
- [ ] **Step 3: Implement** `0010_dashboard_metas.sql` (plpgsql com laço mês a mês ou CTE recursiva).
- [ ] **Step 4: Run** `npm run test:sql` → verde.
- [ ] **Step 5: Commit** → `"Dashboard: metas e projecao mensal (0010)"`.

---

### Task 5: Base do site (período, formatos, permissões, filtros, cartão, menu)

**Files:**
- Modify: `apps/web/package.json` (deps `recharts@^3`, `read-excel-file`, `write-excel-file`; versões atuais no momento da instalação, `npm audit` sem alta/crítica), `package.json` raiz (script `"test:web": "node --test apps/web/lib/"`), `.github/workflows/ci.yml` (rodar `npm run test:web`)
- Create: `apps/web/lib/periodo.ts` + `apps/web/lib/periodo.test.ts`
- Create: `apps/web/lib/formato.ts` + `apps/web/lib/formato.test.ts`
- Create: `apps/web/lib/permissoes.ts`
- Create: `apps/web/lib/dash.ts`
- Create: `apps/web/components/filtro-topo.tsx`, `apps/web/components/cartao-indicador.tsx`, `apps/web/components/aviso-sincronizacao.tsx`
- Modify: `apps/web/components/sidebar.tsx`, `apps/web/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: Tasks 1–4 (funções/tabelas).
- Produces:
  - `periodo.ts`: `type Canal = 'consolidado'|'mercadolivre'|'shopee'`; `type PeriodoChave = 'hoje'|'7d'|'30d'|'mes'|'mes_anterior'|'ano'|'personalizado'`; `interface Periodo { de: string; ate: string; anteriorDe: string; anteriorAte: string; rotulo: string }` (datas `YYYY-MM-DD`); `resolverPeriodo(chave: PeriodoChave, hoje: string, de?: string, ate?: string): Periodo`; `lerFiltros(searchParams: Record<string, string|string[]|undefined>, hoje: string): { canal: Canal; chave: PeriodoChave; periodo: Periodo }` (padrão `consolidado`/`mes`); `hojeBrasilia(): string`.
  - `formato.ts`: `brl(v: number|null): string` (`'—'` para null), `num(v)`, `pct(v)`, `variacao(atual: number, anterior: number): { valor: number|null; rotulo: string }` (`anterior = 0` e `atual > 0` → `{ valor: null, rotulo: 'novo' }`; ambos 0 → `'—'`).
  - `permissoes.ts`: `type Permissao = 'visao_geral'|'vendas'|'rentabilidade'|'metas'|'custos'|'editar_metas'|'configuracoes'`; `getPermissoes(): Promise<Set<Permissao>>` (lê `core.role_permissions` do perfil logado); `exigirPermissao(p: Permissao): Promise<void>` (redirect `/` sem permissão; `/` sem `visao_geral` → primeira tela permitida ou página "sem acesso").
  - `dash.ts`: wrappers tipados `resumo(canal, de, ate)`, `serie(canal, de, ate, grao)`, `modelos(...)`, `skus(..., modelo)`, `pedidos(..., modelo)`, `metas(canal, ano)` chamando `supabase.schema('analytics').rpc('dash_*', {...})`, com tipos de retorno espelhando as tabelas das Tasks 2–4; lançam `Error` com mensagem amigável em erro.
  - `<FiltroTopo canal chave periodo atualizadoEm />` (client; altera a URL; botões Consolidado | Mercado Livre | Shopee, este desativado com "em breve"; mostra "dd/mm – dd/mm · comparado a dd/mm – dd/mm" e "Atualizado às HH:MM" da última sincronização com sucesso), `<CartaoIndicador titulo valor variacao inverterCores? ajuda? />`, `<AvisoSincronizacao />` (server; mostra faixa se a última `core.sync_runs` de `mercadolivre` ou `erp` está `error`).
  - Sidebar recebe `permissoes: Permissao[]`; itens `Visão Geral (visao_geral)`, `Vendas (vendas)`, `Rentabilidade (rentabilidade)`, `Metas e Projeção (metas)`, `Administração: Permissões / Parâmetros (configuracoes)`, `Metas (editar_metas)`, `Conexões (configuracoes)`; demais continuam "em breve".

- [ ] **Step 1: Write failing tests** `periodo.test.ts`: `resolverPeriodo('mes','2026-11-12')` → `{de:'2026-11-01', ate:'2026-11-12', anteriorDe:'2026-10-01', anteriorAte:'2026-10-12'}`; `'mes'` em `'2026-03-31'` → anterior `2026-02-01..2026-02-28`; `'7d'` em `2026-11-12` → `2026-11-06..2026-11-12` e anterior `2026-10-30..2026-11-05`; `'mes_anterior'` → `2026-10-01..2026-10-31` / `2026-09-01..2026-09-30`; `'personalizado'` sem datas → cai em `'mes'`. `formato.test.ts`: `variacao(10,0).rotulo === 'novo'`, `variacao(0,0).rotulo === '—'`, `variacao(108,100).valor === 8`, `brl(1234.5) === 'R$ 1.234,50'` (normalizar espaço não separável).
- [ ] **Step 2: Run** `npm run test:web` → FALHA.
- [ ] **Step 3: Implement** os arquivos acima; instalar deps; layout busca permissões e passa ao Sidebar; `AvisoSincronizacao` no topo do `<main>`.
- [ ] **Step 4: Run** `npm run test:web`, `npm run typecheck`, `npm run test:sql` → verdes.
- [ ] **Step 5: Commit** → `"Dashboard: base do site (periodo, formatos, permissoes, filtros, menu)"`.

---

### Task 6: Visão Geral

**Files:**
- Modify: `apps/web/app/(app)/page.tsx`
- Create: `apps/web/components/grafico-serie.tsx`, `apps/web/components/painel-atencao.tsx`

**Interfaces:**
- Consumes: Task 5 (`lerFiltros`, `dash.resumo/serie/modelos/metas`, `CartaoIndicador`, `FiltroTopo`, `exigirPermissao('visao_geral')`).
- Produces: `<GraficoSerie atual={SeriePonto[]} anterior={SeriePonto[]} medida="vendas_brutas"|"receita" />` (client, Recharts: barras = atual, linha = anterior alinhada por posição), `<PainelAtencao pedidosSemCusto sincronizacoes />`.

- [ ] **Step 1:** Página com os cartões da spec §3 (resumo atual × anterior em paralelo com `Promise.all`), cartão "Mês atual: realizado × meta" quando `dash_metas` do mês corrente tiver `meta`, gráfico diário, top 5 de `dash_modelos` por `vendas_brutas` (margem % só com `custos`), painel de atenção; estado "Sem vendas no período" quando `pedidos = 0`. Cartões de margem omitidos quando os campos vêm `null`.
- [ ] **Step 2: Verify** `npm run typecheck`; `npm run dev -w web` e abrir `/` logado como admin: cartões preenchidos; `?periodo=personalizado&de=2026-10-01&ate=2026-10-31` mostra vendas brutas R$ 54.341,55, 93 pedidos, 106 unidades (aceite da spec §9, com dados reais). Registrar no relatório o que foi conferido.
- [ ] **Step 3: Commit** → `"Dashboard: Visao Geral"`.

---

### Task 7: Vendas (tabela por modelo, detalhe por SKU, pedidos, Excel)

**Files:**
- Create: `apps/web/app/(app)/vendas/page.tsx`, `apps/web/app/(app)/vendas/[modelo]/page.tsx`
- Create: `apps/web/components/tabela-dados.tsx`, `apps/web/lib/exportar.ts`

**Interfaces:**
- Consumes: Task 5, Task 6 (`GraficoSerie`).
- Produces: `<TabelaDados colunas={Coluna[]} linhas={T[]} busca?={keyof T} nomeArquivo={string} linkLinha?={(l: T) => string} />` (client; ordenar clicando no cabeçalho, busca por texto, botão "Excel"); `interface Coluna<T> { chave: keyof T; titulo: string; tipo: 'texto'|'brl'|'num'|'pct'|'variacao' }`; `exportarXlsx(nomeArquivo: string, colunas: Coluna[], linhas: object[]): Promise<void>` (write-excel-file).

- [ ] **Step 1:** `/vendas`: cartões (sem margem), gráfico com seletor dia/semana/mês (`?grao=`), tabela por modelo com Variação (dash_modelos do período anterior, por modelo; ausente → "novo") e Participação (% das vendas brutas totais). `/vendas/[modelo]`: tabela `dash_skus` + tabela `dash_pedidos` (com `sku_anuncio`), mesmo filtro da URL. `exigirPermissao('vendas')`.
- [ ] **Step 2: Verify** typecheck; no navegador: ordenar por "Vendas brutas", buscar "GCH", baixar Excel e abrir; clicar em GCH25 e ver SKUs e pedidos; BOB01 aparece no lugar de CMT44.
- [ ] **Step 3: Commit** → `"Dashboard: Vendas"`.

---

### Task 8: Rentabilidade

**Files:**
- Create: `apps/web/app/(app)/rentabilidade/page.tsx`, `apps/web/components/cascata-custos.tsx`

**Interfaces:**
- Consumes: Tasks 5–7 (`TabelaDados`, `dash.resumo/modelos/skus`).
- Produces: `<CascataCustos itens={{ rotulo: string; valor: number }[]} />` (barras horizontais da receita até a contribuição).

- [ ] **Step 1:** `exigirPermissao('rentabilidade')` e `exigirPermissao('custos')`; cartões Receita, Margem bruta, Margem de contribuição (variação em pontos percentuais), Pedidos sem custo (link para `/vendas` filtrado não é necessário: lista os modelos com `sem_custo > 0` num quadro); cascata (custo produto, comissão, frete, parcelamento, Ads, Seguidores, estornos, DIFAL, outras, imposto+embalagem); tabela por modelo com colunas da spec §5, "prejuízo" em vermelho, coluna "Custos (rateio)"; detalhe por SKU reaproveita `/vendas/[modelo]` com colunas de custo quando houver permissão.
- [ ] **Step 2: Verify** typecheck; outubro/2026: contribuição do topo = soma da coluna Contribuição da tabela (±R$ 1); usuário comercial não vê o item de menu e `/rentabilidade` redireciona.
- [ ] **Step 3: Commit** → `"Dashboard: Rentabilidade"`.

---

### Task 9: Metas e Projeção + upload de metas

**Files:**
- Create: `apps/web/lib/metas-planilha.ts` + `apps/web/lib/metas-planilha.test.ts`
- Create: `apps/web/app/(app)/metas/page.tsx`, `apps/web/app/(app)/metas/actions.ts`, `apps/web/components/grafico-metas.tsx`, `apps/web/components/tabela-projecao.tsx`
- Create: `apps/web/app/(app)/configuracoes/metas/page.tsx`, `apps/web/app/(app)/configuracoes/metas/actions.ts`, `apps/web/components/upload-metas.tsx`

**Interfaces:**
- Consumes: Task 1 (`core.substituir_metas`, `core.premissas_projecao`), Task 4 (`dash_metas`), Task 5.
- Produces: `validarLinhasMetas(linhas: unknown[][]): { validas: { channel: 'mercadolivre'|'shopee'|'brindedobem'; ano: number; mes: number; valor: number }[]; erros: { linha: number; motivo: string }[]; totais: Record<string, number> }` (linha 1 = cabeçalho com colunas Canal/Marketplace, Ano, Mês, Meta em qualquer ordem; números da planilha podem vir como number ou texto com vírgula); server actions `salvarPremissa(canal, ano, mes: number|null, crescimento: number|null)` (null = remove → volta ao padrão) e `gravarMetas(linhas)` (chama `core.substituir_metas`), ambas exigindo `editar_metas`.

- [ ] **Step 1: Write failing tests** `metas-planilha.test.ts`: cabeçalho `['Marketplace','Ano','Mês','Meta']` + `['Mercado livre',2027,'Jan',26711]` → `channel 'mercadolivre', mes 1`; `'mar'`, `'Mar'`, `3`, `'Março'` → 3; `'Brinde do Bem'` → `brindedobem`; `'26.711,50'` → 26711.5; ano vazio → erro `'linha 2: ano ausente'`; canal `'Amazon'` → erro de canal; meta vazia → erro; meta negativa → erro; duas linhas mesmo canal/ano/mês → erro de duplicada; cabeçalho sem coluna Ano → erro único `'coluna Ano não encontrada'`; totais por canal somados.
- [ ] **Step 2: Run** `npm run test:web` → FALHA.
- [ ] **Step 3: Implement** o parser; `/configuracoes/metas` (`exigirPermissao('editar_metas')`): escolher arquivo, ler com `read-excel-file`, mostrar prévia (totais por canal e erros), botão "Gravar" só sem erros; `/metas` (`exigirPermissao('metas')`): seletor de canal (`mercadolivre`, `shopee`, `brindedobem`, `consolidado` como "Total") e ano (padrão 2027), `<GraficoMetas>` (barras realizado, linha tracejada projeção, linha meta), `<TabelaProjecao>` com crescimento editável por mês (input %; ↺ remove) e campo de crescimento padrão do canal, editáveis só com `editar_metas`; total do ano; mês em andamento marcado "parcial".
- [ ] **Step 4: Verify** `npm run test:web`, typecheck; no navegador: subir `diagnostico/Meta_2027.xlsx` corrigida → prévia com ML R$ 733.641, Shopee R$ 698.011, Brinde do Bem R$ 7.235.042; a versão com o ano faltando mostra os erros e não grava; mudar crescimento padrão do ML para 3% altera a projeção para todos (recarregar em outra sessão).
- [ ] **Step 5: Commit** → `"Dashboard: Metas e Projecao e upload de metas"`.

---

### Task 10: Administração — Permissões e Parâmetros de custo

**Files:**
- Create: `apps/web/app/(app)/configuracoes/permissoes/page.tsx` + `actions.ts`
- Create: `apps/web/app/(app)/configuracoes/parametros/page.tsx` + `actions.ts`

**Interfaces:**
- Consumes: Task 1 (tabelas e trava), Task 5 (`exigirPermissao('configuracoes')`).
- Produces: actions `alterarPermissao(role, permissao, allowed)` (erro da trava exibido como mensagem amigável) e `salvarParametro({ channel, imposto_pct, embalagem_pedido, embalagem_peca, vigente_desde })` / `excluirParametro(id)` (não permite excluir a última vigência do canal).

- [ ] **Step 1:** Matriz perfil × permissão com caixas (rótulos em português: "Visão Geral", "Vendas", "Rentabilidade", "Metas e Projeção", "Vê custo/margem", "Editar metas e premissas", "Administração"); caixa admin/Administração desabilitada com dica. Tabela de vigências por canal com "+ nova vigência" (valores com vírgula aceitos).
- [ ] **Step 2: Verify** typecheck; no navegador: tirar "Vê custo/margem" do gestor → com um usuário gestor, cartões de margem somem e `/rentabilidade` redireciona; recolocar. Criar vigência de imposto 5% a partir de 01/11/2026 → margem de novembro cai 5% da receita, outubro não muda; voltar a 0.
- [ ] **Step 3: Commit** → `"Dashboard: administracao de permissoes e parametros de custo"`.

---

### Task 11: Documentação e aceite

**Files:**
- Modify: `.claude/skills/dashboard-mercado-livre-brinde-do-bem/SKILL.md` (seção do dashboard: telas, funções `dash_*`, permissões, ordem das migrations 0003→0010, como subir metas)

- [ ] **Step 1:** Atualizar a skill; listar no relatório final o checklist de aceite para o dono: aplicar 0008, 0009, 0010 no SQL Editor (nessa ordem), conferir outubro/2026 (R$ 54.341,55 / 93 / 106 / cancelados 8 R$ 4.054,95 / devolvidos 2 R$ 1.529,06), subir a planilha de metas corrigida, revisar permissões.
- [ ] **Step 2: Run** `npm run test:sql`, `npm run test:web`, `npm run typecheck`, `npm run build -w web` → verdes.
- [ ] **Step 3: Commit** → `"Dashboard Bloco A: documentacao e checklist de aceite"`.
