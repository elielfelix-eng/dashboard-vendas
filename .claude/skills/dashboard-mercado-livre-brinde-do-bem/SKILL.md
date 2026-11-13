---
name: dashboard-mercado-livre-brinde-do-bem
description: Contexto, regras de negócio e procedimentos do Painel de Vendas do Brinde do Bem (Mercado Livre, Shopee, ERP SQL Server via gateway, Bitrix24) publicado com Supabase + Vercel + GitHub Actions. Use ao trabalhar neste repositório - sincronização, cálculo de margem/custos por faixa, classificação de pedidos, fatura e Ads do ML, validação contra o painel do ML, deploy, OAuth, diagnóstico de erros ou dúvidas do usuário sobre o painel.
---

# Painel de Vendas — Brinde do Bem

O Brinde do Bem é a unidade de negócio da ONG Vocação que vende brindes para financiar os projetos da Vocação. Loja ML: **BRINDESVOCACAO** (seller 494288862, anunciante Product Ads 2757617).

**Regras de negócio validadas** (SKU/kit, data da venda, classificação de pedidos, custos por faixa, códigos da fatura, margem, números de referência): leia [regras-de-negocio.md](regras-de-negocio.md) antes de mexer em sincronização, cálculo ou KPIs.

## Como falar com o usuário
- Sempre em **português**, linguagem simples: o usuário é leigo em programação.
- Passo a passo numerado, com o nome exato dos botões/menus. Telas de Supabase, Vercel, GitHub e ML mudam com frequência: se o usuário não achar algo, ofereça caminhos alternativos e peça print.
- **Nunca peça** senhas, `DATABASE_URL`, `ML_CLIENT_SECRET` ou tokens no chat. URL do Supabase e chave publishable/anon podem aparecer.
- **Nunca** imprima, comite ou grave em arquivos do projeto chaves de acesso ou o conteúdo de arquivos de credenciais.
- Antes de dar um número como certo, compare com o painel do Mercado Livre.

## Onde as coisas estão
| Item | Local |
|---|---|
| Repositório (privado) | github.com/elielfelix-eng/dashboard-vendas |
| Site | https://dashboard-vendas-bice.vercel.app (Vercel, Root Directory `apps/web`) |
| Banco/Login | Supabase (Postgres + Auth + Vault + RLS), região São Paulo |
| Agendamento | `.github/workflows/sync.yml` — cron `0 11,16,20 * * *` (08/13/17h BRT) |
| Plano completo | `C:\Users\el_sa\.claude\plans\preciso-criar-um-projeto-cheeky-wreath.md` |

```
apps/web               Next.js 15 (login, menu, Conexões, OAuth ML)
packages/connectors    Interface MarketplaceConnector + mercadolivre/ + shopee/ (stub)
jobs                   Sincronização (tsx) — rodada pelo GitHub Actions
supabase/migrations    0001_core.sql, 0002_marketplaces.sql, 0003_regras_v1.sql (aplicar colando o CONTEÚDO no SQL Editor, em ordem)
supabase/tests         regras-v1.test.mjs (npm run test:sql)
```

Schemas: `core` (perfis, contas, tokens no Vault, sync_runs), `mkt` (items, orders, order_items, visits_daily, ads_*), e previstos `erp`, `crm`, `map`, `config`, `analytics`. Schemas `core` e `mkt` estão expostos na Data API.

## Regras de segurança (não quebrar)
- Tokens OAuth só via `core.save_oauth_tokens` / `core.read_oauth_tokens` (Vault). `core.oauth_tokens` não tem política RLS de propósito.
- Refresh token do ML é de **uso único**: renovar só dentro de `createTokenProvider` (jobs/src/token-store.ts), que usa `SELECT ... FOR UPDATE`. O workflow tem `concurrency: sync`.
- `DATABASE_URL` ignora RLS: só em rotas de servidor que checam o perfil antes (apps/web/lib/db.ts).
- Mensagens de erro exibidas ao usuário passam por sanitização (sem tokens/URLs com segredo). Erros de Bitrix não podem logar a URL do webhook.
- Perfis aplicados no banco (RLS): admin, gestor, comercial, visualizador, vendedor + `channels[]`. Custos/margem/financeiro só admin e gestor (`core.can_see_costs()`).
- Variáveis `NEXT_PUBLIC_*` só para URL e chave pública do Supabase.

## Git neste computador
O PATH do VS Code pode não ter o Git: use `& "C:\Program Files\Git\cmd\git.exe" ...`. O push funciona com as credenciais já salvas. Mensagens de commit terminam com a linha Co-Authored-By indicada pelo sistema.

## Verificar antes de dizer que está pronto
```
npm run typecheck
$env:NEXT_PUBLIC_SUPABASE_URL='https://exemplo.supabase.co'; $env:NEXT_PUBLIC_SUPABASE_ANON_KEY='teste'; npm run build
npm audit
```

## Validar dados sincronizados (SQL Editor do Supabase)
Referência: **outubro/2026** no painel do ML (ver tabela em regras-de-negocio.md). Usar a data de aprovação (`date_closed`) em horário de Brasília:
```sql
select count(*) pedidos_pagos, sum(total_amount) receita from mkt.orders
 where status = 'paid'
   and coalesce(date_closed, date_created) at time zone 'America/Sao_Paulo' >= '2026-10-01'
   and coalesce(date_closed, date_created) at time zone 'America/Sao_Paulo' <  '2026-11-01';
```
Comparação completa com o painel (vendas brutas, quantidade, unidades, canceladas, devolvidas, Ads, Seguidores):
```sql
select vendas_brutas, vendas_qtd, unidades_vendidas, cancelados, canceladas_valor,
       devolvidas, devolvidas_valor, product_ads, seguidores, receita, margem_liquida
  from analytics.ml_meses where mes = '2026-10-01';
```
Status das execuções: `select * from core.sync_runs order by started_at desc limit 10;`

## Fase 2b — regras da V1 implementadas (migration 0003)
| Regra | Onde |
|---|---|
| SKU → modelo, cor, kit, versão, unidades | colunas geradas em `mkt.order_items` |
| Classificação pago/dividido/devolvido/cancelado | `analytics.ml_pedidos.classe` (+ `syncCancelledShipments`) |
| Data da venda (aprovação, Brasília) | `ml_pedidos.data_venda` / `mes` |
| Fatura com re-leitura de período incompleto | `mkt.billing_*`, `syncBilling`, view `analytics.ml_fatura` |
| Publicidade −1 dia; API de Ads prevalece nos dias cobertos | `ml_fatura.data_ref`, `analytics.ml_meses` |
| Ads por campanha (endpoint da V1) | `mkt.ads_campaign_daily`, `listAdsCampaignDaily` |
| Estimativas para pedidos não faturados | `ml_pedidos.frete_estimado` |
| Custos por faixa + alertas | `erp.cost_tiers`, `analytics.resolve_unit_cost`, `analytics.ml_alertas` |
| 429 do ML: 10 s × tentativa | `MercadoLivreClient` |

Testes: `npm run test:sql` (Postgres em memória, PGlite) — roda no CI. **Ao mudar regra de negócio, atualize o teste em `supabase/tests/regras-v1.test.mjs`.**

Ainda não validado com a API real: o formato da resposta da fatura (`charge_info.detail_sub_type` como código) e do `campaigns/search`. Se vierem vazios, inspecione a coluna `raw` em `mkt.billing_details` / `mkt.ads_campaign_daily`.

Comissão isenta desde 10/2026 (`sale_fee` = 0) — não é erro. A V1 está em `Dash_V1/` (só skill/plugin; fora do Git).

## Problemas já resolvidos (consultar antes de investigar)
| Sintoma | Causa | Solução |
|---|---|---|
| SQL Editor: `syntax error at or near "supabase"` | Colou o nome do arquivo | Colar o conteúdo (Ctrl+A/Ctrl+C) |
| `relation "items" already exists` | Migration já tinha rodado | Conferir tabelas/políticas; não rodar de novo |
| Vercel `MIDDLEWARE_INVOCATION_FAILED` | Variáveis do Supabase ausentes ou sem Redeploy | Cadastrar e fazer Redeploy (middleware agora mostra "Configuração incompleta") |
| Aviso da Vercel sobre `NEXT_PUBLIC_` | Aviso genérico | Manter o prefixo nas duas variáveis do Supabase |
| `ENOTFOUND` ao gravar no banco | URL "Direct" ou senha com símbolos | Usar Transaction pooler (porta 6543), senha só alfanumérica |
| `28P01 password authentication failed` | Senha errada na URL | Reset da senha do banco e remontar a URL; atualizar Vercel e GitHub Secrets |
| `O Mercado Livre nao enviou o refresh token` | Fluxo "Refresh Token" desmarcado no app ML | App ML → Fluxos OAuth → marcar **Refresh Token**; revogar o app e reconectar |
| Dependabot: postcss (high) | Next 15 traz postcss 8.4.31 | `overrides.postcss` no package.json raiz (já aplicado) |

Configuração correta do app ML: Fluxos OAuth = Authorization Code + Refresh Token (Client Credentials desmarcado); PKCE marcado; todas as permissões em **Leitura**.

## Status das fases
- [x] Fase 0 — contas, migrations, deploy, ML conectado, 1ª sincronização OK
- [ ] Validar números da 1ª carga contra outubro/2026 e confirmar dados de Ads
- [x] Fase 2b — regras da V1 em código e testadas (falta aplicar 0003 e conferir com outubro/2026)
- [x] Fase 3 — Gateway ERP implementado e testado (falta instalar na máquina da rede, definir a consulta real das faixas e conferir em `core.sync_runs`)
- [x] Fase 4 / Bloco A — Visão Geral, Vendas, Rentabilidade, Metas e Projeção, Permissões, Parâmetros (migrations 0008–0010; falta aplicar e conferir out/2026)
- [ ] Fase 4 / Bloco B — Anúncios e Ads por anúncio (ACOS de equilíbrio); C — Novos Produtos/simulador; D — Estoque e Financeiro

## Dashboard (Bloco A)
Spec `docs/superpowers/specs/2026-11-12-dashboard-bloco-a-design.md`, plano `docs/superpowers/plans/2026-11-12-dashboard-bloco-a.md`. **O banco calcula, a tela só mostra.**
- **Ordem das migrations:** 0003 → 0006 → 0007 → 0008 → 0009 → 0010 → 0011 (todas reexecutáveis). Reaplicou alguma? Reaplique todas as seguintes da lista.
- **Desempenho (incidente 12/11/2026: telas com "statement timeout" de 8 s):** (1) `analytics.dash_pedidos_base(p_de, p_ate)` refaz a regra de `ml_pedidos` só para o período (teste garante igualdade) com CTEs `as materialized` — sem isso o Postgres reexecutava fatura/frete de carrinho por pedido (1,2 milhão de laços num ano); (2) `resolve_unit_cost` em plpgsql usando o índice (product_id, created_at); (3) 0011: políticas RLS com `(select core.my_channels())` / `(select core.can_see_costs())` (calcula uma vez por consulta). Nunca usar `ml_pedidos` inteiro nas telas. Medir com o papel `authenticated` (o SQL Editor ignora RLS).
- **Permissões por perfil:** `core.role_permissions` (visao_geral, vendas, rentabilidade, metas, custos, editar_metas, configuracoes), `core.has_perm(text)`; `core.can_see_costs()` = `has_perm('custos')`. Trava: admin nunca perde `configuracoes`. Escrita de permissões/parâmetros só pelo perfil admin.
- **Imposto/embalagem:** `core.parametros_custo` por canal com `vigente_desde`; só pedidos pagos.
- **Funções (security invoker):** `analytics.dash_resumo`, `dash_serie(…, 'dia'|'semana'|'mes')`, `dash_modelos` (rateio dos custos sem pedido pela receita + curva ABC por lucro: acumulado antes do modelo < 80% A, < 95% B, senão C; ≤ 0 = prejuizo), `dash_skus`, `dash_pedidos`, `dash_custos_periodo`, `dash_itens`, `dash_metas(canal, ano, hoje)`. Parâmetros `(p_canal 'consolidado'|'mercadolivre'|…, p_de, p_ate)`. Sem `custos`: custo, imposto, embalagem, margens, ABC e alertas voltam nulos.
- **Metas:** `core.metas` (canal mercadolivre|shopee|brindedobem, ano, mês, valor), upload em `/configuracoes/metas` (xlsx Canal|Ano|Mês|Meta; substitui os anos do arquivo via `core.substituir_metas`). Projeção: parte do último mês fechado; mês = anterior × (1 + crescimento); crescimento do mês em `core.premissas_projecao` ou o padrão do canal no ano (mes nulo).
- **Testes:** `npm run test:sql` (inclui `dashboard-admin`, `dashboard-funcoes`, `dashboard-metas`) e `npm run test:web` (período, formatos, planilha de metas; Node 24).
- [ ] Fase 5 — Bitrix24 (webhook somente leitura, usuário técnico)
- [ ] Fase 6 — Shopee (aguarda aprovação no Open Platform)
- [ ] Fase 7 — Healthchecks.io, backup semanal criptografado

## ERP (SQL Server) — gateway
O ERP é próprio (SQL Server), ligado 24h. O gateway roda em **outra máquina Windows da rede** (estilo Power BI Gateway): Python + pyodbc empacotado em `BrindeGateway.exe` (PyInstaller), tarefa agendada **BrindeGateway** como SYSTEM às **07:45, 12:45 e 16:45** (com "executar se perdeu o horário", limite 1 h). Usa um usuário SQL somente leitura (`gateway_leitura`, SELECT no schema `painel`) e envia só de saída para o schema `erp` do Supabase com o papel restrito `gateway_writer` (migration `supabase/migrations/0005_gateway.sql`; pooler porta 6543, usuário `gateway_writer.<project_ref>`, `sslmode=require`).

Como funciona: `config.toml` define `[source]`, `[target]` e `[[datasets]]` (nome, `target_table` `erp.<tabela>`, `mode` `replace_source`|`replace_all`, `query` ou `query_file` relativo ao config). Cada dataset é apagado e reinserido **na mesma transação** (em `replace_source` só as linhas `source='erp'`; `replace_all` é recusado em tabelas com `source`). Cada execução registra `core.sync_runs` (`source='erp'`). Segredos (`sqlserver`, `supabase`) ficam em `secrets.json` protegido por DPAPI (escopo máquina).

Comandos: `BrindeGateway.exe run|test|set-secret NOME [--config caminho]`. Home: `%PROGRAMDATA%\BrindeGateway` (`config.toml`, `secrets.json`, `logs\gateway.log`; override `BRINDE_GATEWAY_HOME`). Saída: 0 ok, 1 falha de dataset/erro inesperado, 2 sem acesso ao Supabase/config inválida.

Arquivos (`gateway/`): `src/brinde_gateway/` (código), `tests/`, `build.ps1`, `install.ps1`, `uninstall.ps1`, `config.exemplo.toml`, `consultas/faixas_custo.exemplo.sql` (aliases `product_id, qty_start, qty_end, price, created_at, expired_at`), `sqlserver/usuario_leitura.sql`, `LEIAME.md` (guia para o dono). Testes: `gateway/.venv/Scripts/python.exe -m pytest gateway/tests -q` e `npm run test:sql`; CI no job `gateway`.

Opções do `config.toml`: por dataset, `allow_empty` (padrão `false`: consulta com 0 linhas dá erro e mantém os dados anteriores, em vez de apagar tudo); em `[source]`, `query_timeout_seconds` (padrão 600; vale para cada consulta, o `timeout` de 30 s só cobre o login). No início de cada execução o gateway marca como `error` ("execucao interrompida (sem finalizacao)") as linhas `core.sync_runs` `source='erp'` ainda `running` há mais de 2 h. O `product_id` da consulta deve vir como `UPPER(LTRIM(RTRIM(...)))` (char(n) e caixa quebram o casamento com o modelo do SKU). **Nova tabela `erp.*` com RLS ligado precisa de policy própria para `gateway_writer`** (os grants padrão não bastam) — ver `0005_gateway.sql`.

De-para ML × ERP: o **modelo** do SKU (ex.: `BLA68` em `BLA68-AMA-K0010-V1`) é o `productId` da tabela de custos. Custos são **por faixa de quantidade com vigência** (`qtyStart`, `qtyEnd`, `price`, `createdAt`, `expiredAt`) — a view do ERP precisa entregar esse formato.

Pendente do usuário:
- Driver/DSN, servidor e banco (sem senha)
- Tabela/consulta do ERP que gera as faixas de custo (equivalente ao `custos.csv` da V1), além de estoque, notas fiscais e financeiro
- Confirmar se o código do modelo no ERP é igual ao modelo do SKU do ML
- % de imposto por canal e custo de embalagem
- Bitrix24: campo que liga o negócio ao ERP (nº pedido/NF ou CNPJ/CPF)
