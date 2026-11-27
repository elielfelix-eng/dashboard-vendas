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
| Sync: `HTTP 403 ... /items: Resource deprecated ... ResourceDeprecated` (13/11/2026) | ML recusou a consulta de anúncios em lote (`/items?ids=`) para o app | `listItems` cai para `/items/{id}` um por um; anúncios e visitas são não fatais (pedidos seguem) |
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
- **Ordem das migrations:** 0003 → 0006 → 0007 → 0008 → 0009 → 0010 → 0011 → 0012 → 0013 (todas reexecutáveis). Reaplicou alguma? Reaplique todas as seguintes da lista.
- **Desempenho (incidente 12/11/2026: telas com "statement timeout" de 8 s):** (1) `analytics.dash_pedidos_base(p_de, p_ate)` refaz a regra de `ml_pedidos` só para o período (teste garante igualdade) com CTEs `as materialized` — sem isso o Postgres reexecutava fatura/frete de carrinho por pedido (1,2 milhão de laços num ano); (2) `resolve_unit_cost` em plpgsql usando o índice (product_id, created_at); (3) 0011: políticas RLS com `(select core.my_channels())` / `(select core.can_see_costs())` (calcula uma vez por consulta). Nunca usar `ml_pedidos` inteiro nas telas. Medir com o papel `authenticated` (o SQL Editor ignora RLS).
- **Permissões por perfil:** `core.role_permissions` (visao_geral, vendas, rentabilidade, metas, custos, editar_metas, configuracoes), `core.has_perm(text)`; `core.can_see_costs()` = `has_perm('custos')`. Trava: admin nunca perde `configuracoes`. Escrita de permissões/parâmetros só pelo perfil admin.
- **Imposto/embalagem:** `core.parametros_custo` por canal com `vigente_desde`; só pedidos pagos.
- **Funções (security invoker):** `analytics.dash_resumo`, `dash_serie(…, 'dia'|'semana'|'mes')`, `dash_modelos` (rateio dos custos sem pedido pela receita + curva ABC por lucro: acumulado antes do modelo < 80% A, < 95% B, senão C; ≤ 0 = prejuizo), `dash_skus`, `dash_pedidos`, `dash_custos_periodo`, `dash_itens`, `dash_metas(canal, ano, hoje)`. Parâmetros `(p_canal 'consolidado'|'mercadolivre'|…, p_de, p_ate)`. Sem `custos`: custo, imposto, embalagem, margens, ABC e alertas voltam nulos.
- **Metas:** `core.metas` (canal mercadolivre|shopee|brindedobem, ano, mês, valor), upload em `/configuracoes/metas` (xlsx Canal|Ano|Mês|Meta; substitui os anos do arquivo via `core.substituir_metas`). Projeção: parte do último mês fechado; mês = anterior × (1 + crescimento); crescimento do mês em `core.premissas_projecao` ou o padrão do canal no ano (mes nulo).
- **Testes:** `npm run test:sql` (inclui `dashboard-admin`, `dashboard-funcoes`, `dashboard-metas`) e `npm run test:web` (período, formatos, planilha de metas; Node 24).
- [x] Fase 5 — Bitrix24 (webhook somente leitura, usuário técnico): implementado em 14/11/2026; falta a 1ª carga e a conferência (ver seção CRM Bitrix24)
- [x] Fase 6 — Shopee (loja conectada; dados, Ads e telas no ramo 003-shopee — ver seção Shopee)
- [ ] Fase 7 — Healthchecks.io, backup semanal criptografado

## CRM Bitrix24 — funil, vendedores e origens
Spec `docs/superpowers/specs/2026-11-13-crm-bitrix24-design.md` (decisões na seção 1). Migrations `0012_crm.sql` (tabelas, permissões, RLS) e `0013_crm_funcoes.sql` (funções `analytics.crm_*`). **Reexecutar a 0013 sozinha** sempre que as funções `crm_*` mudarem; a 0012 só quando mudar tabela, permissão ou RLS.
- **Escopo:** só o funil **10 (Brinde do Bem)** do Bitrix da ONG (16 funis). Não há filtro de funil.
- **Leads** contam pela **origem** (`SOURCE_ID`), a partir da lista `crm.origens_brinde` (editável em Configurações → Vendedores do CRM). **Negócios** contam pelo funil 10, qualquer que seja a origem.
- **Motivo de perda** = a etapa de perda do funil 10. `C10:LOSE` aparece como "Cancelado (sem motivo)" (é a maioria dos perdidos).
- **Área de Negócio** (`UF_CRM_1740402485`: Brinde do Bem | Brindes Vocação | Pedido Online) é filtro nas telas; vale para negócios, não para leads.
- **Fuso:** o portal devolve horários com `+03:00`; os dias são contados no horário de Brasília (`America/Sao_Paulo`), como no ML. `CLOSEDATE` é só data (meia-noite no fuso do portal): o `mapDeal` grava o dia como veio, à meia-noite de Brasília (`AAAA-MM-DDT00:00:00-03:00`), senão o fechamento cairia no dia anterior.
- **Vínculo vendedor × usuário do painel:** automático pelo **e-mail**; a exceção manual fica em `crm.vinculo_vendedor` (`bitrix_id` null = desligado). `core.user_profiles.bitrix_user_id` não é usado.
- **Sincronização:** job `bitrix` da ação "Sincronizacao de dados" (`source` = `bitrix24`). Primeira execução = carga completa (pode levar mais de 1 h; não medido); depois incremental por `DATE_MODIFY`; domingo faz reconciliação (IDs sumidos saem do painel). Registro em `core.sync_runs.source = 'bitrix24'` (o canal de RLS é `crm`). Comando do batch que falha é repetido a partir do último ID bom (3 vezes: 2 s, 4 s, 8 s). Falha na 1ª atividade ou na reconciliação não derruba a execução (fica em `stats.erros_atividade` / `stats.erro_atividade` / `stats.erro_reconciliacao`); falha em leads, negócios ou histórico sim. As telas do CRM mostram aviso quando a última execução do Bitrix falhou. Falha do Bitrix não afeta o ML.
- **Conferir a carga:** `crm.users` deve ter cerca de **309** usuários. Se der cerca de **132**, o `user.get` trouxe só os usuários ativos.
- **Ação "Bitrix - listar configuracao"** (manual, só leitura): lista funis, etapas, origens e campos. Use para conferir IDs antes de mudar listas ou filtros.
- **Webhook:** a URL fica **só** no GitHub Secret `BITRIX_WEBHOOK_URL`. **Nunca** peça, cole ou repita a URL no chat, em logs ou em arquivos. Erros mostram só o nome do método.
- **Somente leitura:** o conector só usa métodos de leitura (`crm.*.list`, `crm.deal.fields`, `user.get` e `batch` com esses métodos). Nunca adicione métodos de gravação (`add`, `update`, `delete`). O usuário técnico do Bitrix deve ter só "Ler" no CRM.
- **Privacidade:** só os campos listados na spec (seção 2) são buscados; nunca `select: ['*', 'UF_*']`.
- **Permissões:** ver dados do CRM exige o canal `crm` **e** alguma permissão `crm_funil`/`crm_vendedores`/`crm_origens` (RLS das tabelas `crm.*`). Sem a permissão da tela, `crm_resumo`/`crm_funil`/`crm_etapas`/`crm_motivos_perda` (`crm_funil`), `crm_origens` (`crm_origens`) e `crm_opcoes` (qualquer `crm_*`) devolvem zero linhas; `crm_vendedores` dá erro. O schema `crm` não é exposto na Data API: a tela de admin usa `core.crm_vinculos()` e `core.crm_origens_admin()`; o vínculo do vendedor logado vem de `core.my_bitrix_id()`.

## Ads e Orçamento (tela `/ads`)
Spec `specs/002-ads-orcamento/` (spec, plan, data-model, contracts/painel-rpc.md, quickstart) e design `docs/superpowers/specs/2026-11-18-ads-orcamento-design.md`. **Só sugere**: a conexão com o ML continua somente leitura; o modo Manual/Automático (US5, ainda não feito) nunca altera a conta de Ads.
- **Migrations:** `0018_ads_tabelas.sql` → `0019_ads_funcoes.sql` (ambas reexecutáveis; depois de 0003–0013). Mudou só função `ads_*`? Reexecute a 0019.
- **Fontes do gasto:** investimento = mesmo critério de `dash_ads_periodo` (0009): métricas diárias do Product Ads + fatura Ads ligada a pedido/anterior à API. **Cartão Investimento da tela Ads = Product Ads + Seguidores** (`analytics.ads_seguidores`, security definer, só com `ads`); ACOS, ROAS e TACOS usam só o Product Ads. A Visão Geral continua mostrando só o Product Ads.
- **Fatura do ML (sync):** `getBillingDetails` relê o período até duas leituras iguais. Limite de chamadas vem como HTTP 400 "code 429" e é tentado de novo (`http.ts`). Outubro/2026: Seguidores R$ 537,71 (painel R$ 539). Por anúncio: `mkt.ads_anuncios` (status, campanha) e `mkt.ads_campaigns` (`roas_target`, `automatica`); job `syncAdsCampanhas`/`syncAdsAnuncios` (não fatais: `stats.erro_ads_campanhas`/`erro_ads_anuncios`; `ads_campaign_days`/`ads_items` = -1 também acende o aviso na tela). `ads_serie` repete a regra de `dash_ads_periodo`: **mudar as duas juntas**. Métricas por anúncio são **rebuscadas nos últimos 30 dias** a cada execução (`ADS_REFETCH_DAYS`, `jobs/src/ads-janela.ts`): o ML atribui vendas ao dia do clique dias depois; com só 3 dias, outubro/2026 ficou com receita 7,6% abaixo do painel e custo igual. Correção pontual: rodar a ação "Sincronizacao de dados" com `ads_dias` = 89.
- **Equilíbrio e lucro:** ACOS de equilíbrio = margem de contribuição ANTES do Ads (devolve o Ads rateado e a fatura Ads ligada a pedido, desconta os custos rateados do período) ÷ receita. Lucro pós-Ads = essa margem − Ads atribuído ao modelo. Atribuição anúncio→modelo pelas unidades vendidas; senão pelo SKU; senão "sem modelo". Linha "não atribuído a anúncio" (modelos) e "não atribuído a campanha" (campanhas) fazem a tabela somar o cartão. Campanhas usam **ROAS objetivo** (ACOS equivalente = 100 ÷ ROAS).
- **Sugestões** (`ads_sugestoes`): janela de 30 dias até o fim do período; limites em `core.parametros_ads` (por canal, com vigência; semente desde 2025-01-01; tela Parâmetros → "Limites de Ads", só admin). Prioridade Pausar > Reduzir > Revisar > Escalar > Testar > Manter. Sem `custos`, só Pausar/Revisar. A tabela de modelos inclui todo modelo com sugestão, mesmo com métricas do período zeradas.
- **Orçamento** (`ads_orcamento`): `core.orcamento_ads` por canal com vigência (semente R$ 5.000 desde 2026-11-01; é **meta de redução**, outubro gastou R$ 8.763). Orçamento = **Product Ads + Seguidores** (fatura `seguidores`). Projeção pelo ritmo até ontem, saldo diário, alertas estouro/sobra. Editável na própria tela (aba Orçamento) por quem tem `editar_ads`.
- **Distribuição (US4) e Manual/Automático (US5):** ainda não implementados (T030–T036).
- **Permissões:** `ads` (admin, gestor, comercial) vê a tela; `editar_ads` (admin, gestor) edita o orçamento. `ads_serie` e `ads_orcamento` são `security definer` (só agregados; checam `ads` e canal); as demais `ads_*` são invoker.
- **Conferência obrigatória:** números de outubro/2026 (quickstart cenário 1: Product Ads R$ 8.224, receita R$ 40.531, 75 vendas atribuídas, ACOS 20,29%, TACOS 16,97%, Seguidores R$ 539) **até 31/01/2027**; é a trava para juntar ao `main` (FR-024).
- **Testes:** `supabase/tests/ads.test.mjs` (em `test:sql`), `apps/web/lib/ads-regras.test.ts`, `ads-limites.test.ts`.

## Shopee
Spec `docs/superpowers/specs/2026-11-24-shopee-design.md`, cobertura da API `docs/superpowers/specs/2026-11-24-shopee-cobertura.md`, plano `docs/superpowers/plans/2026-11-24-shopee.md` (ledger `.superpowers/sdd/2026-11-24-shopee/progress.md`). Mesmas tabelas do ML com `channel = 'shopee'`; conexão **somente leitura**.
- **Conexão:** Configurações › Conexões › "Conectar Shopee" (só admin; rotas `api/oauth/shopee/start` e `callback/<state>`, o state vai no caminho). Partner ID/Key só no GitHub Secrets e nas variáveis de servidor da Vercel (`SHOPEE_PARTNER_ID`, `SHOPEE_PARTNER_KEY`). Access token vale 4 h; o refresh token vale 30 dias e é de **uso único** (o `token-store` grava o novo antes de devolver). Autorização vencida/recusada vira `ShopeeAuthError` ("Autorização da Shopee vencida: reconecte em Configurações › Conexões") no `core.sync_runs.error`; a faixa do topo pede "reconecte a Shopee" e o ML segue normal na mesma execução. Problemas já vistos: `invalid_partner_id` (app ainda não Live) e `source_ip_undeclared` (lista de IPs ligada com IP errado: manter a chave desligada, não há IP fixo).
- **Pedidos e janela de 15 dias:** `get_order_list` aceita no máximo **15 dias** por chamada (16 dá `order.order_list_invalid_time`); o conector anda em janelas de 15 dias com 1 s de sobreposição e cursor. Histórico desde 06/2026 (antes não há pedido). Classe: `paid` (inclui TO_RETURN) = pago; cancelado com pagamento = cancelado; cancelado sem pagamento fica fora das vendas brutas. Data da venda = pagamento.
- **Escrow (tarifas e frete reais):** `payment/get_escrow_detail_batch` → `mkt.shopee_escrow` (uma linha por tarifa) → view `analytics.shopee_fatura` (papel da `ml_fatura`). Comissão = comissão + serviço + transação; Outras = cupom, campanha, processamento, devolução, proteção do frete, reembolso. Pedido pago **sem escrow**: tarifa estimada pela média % dos 90 dias anteriores, marcada (`estimados`; tela "Aguardando o pagamento da Shopee"). Cancelado depois de pago: as tarifas cobradas entram como custo. Pendentes (`mkt.shopee_pedidos_pendentes`) são relidos a cada execução. Conciliação de 26/11/2026: 327/327 pedidos fecharam (`analytics.shopee_conciliacao`).
- **Ads:** conta (`mkt.ads_campaign_daily`, `campaign_id 'conta'`) + por anúncio (`mkt.ads_metrics_daily`); a linha "Shopee Ads (sobra da conta)" (0034) é o que não está em campanha de produto. Ranking e sugestões por produto com os limites copiados do ML (0033). Ruído de centavos (< R$ 0,05 ou negativo) da sobra/"não atribuído" não aparece na Shopee e no consolidado. Visitas só acumuladas: **conversão da Shopee fica fora de qualquer comparação por período**.
- **Telas:** Visão Geral, Vendas, Rentabilidade, Ads e Comparativo aceitam `canal=shopee` quando há loja conectada com sincronização bem-sucedida (`dash.contextoShopee`). Período antes da 1ª venda da Shopee mostra "Sem dados da Shopee neste período" (nunca zero). Sem `custos`, tarifas, custo e margem da Shopee voltam nulos (no consolidado, a coluna de custos do Comparativo soma só as tarifas do ML). Foto e link dos anúncios da Shopee vêm de `mkt.items.thumbnail/permalink` (0035).
- **Sugestão por canal (aba Comparativo › Canais):** `analytics.crescimento_canal` (0022; uma chamada por tela) dá vendas brutas do período, do anterior e do mesmo período do ano passado e a margem depois do Ads; a regra fica em `apps/web/lib/crescimento.ts`: **Investir mais** (vendas +10% nos comparativos disponíveis e margem positiva sem cair), **Reduzir** (queda de 10% em algum comparativo ou margem negativa), **Manter**, **Sem histórico** (sem vendas no período anterior). Percentuais por canal com vigência em `core.parametros_crescimento` (Parâmetros, só admin). A sugestão e o motivo aparecem **só para quem tem `custos`**.
- **Migrations (ordem):** 0020 → 0030 → 0031 → 0032 → 0021 → 0033 → 0022 → 0034 → 0035 (todas reexecutáveis). A 0009/0019/0021 recriam funções sem partes da Shopee: reaplicou uma? Reaplique as seguintes da lista. Testes: `supabase/tests/shopee.test.mjs`, `apps/web/lib/crescimento.test.ts`, `canais.test.ts`.

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

## Visual da marca (ramo 003-visual-marca)
- Cores: os papéis ficam em pps/web/lib/tema-cores.ts (claro e escuro) e são repetidos como variáveis CSS em pps/web/app/globals.css. Mudou uma cor, mude nos dois. pps/web/lib/contraste.test.ts exige 4,5:1 nos pares de texto.
- Tema: data-theme em <html>, escolha salva em localStorage na chave db-tema (lib/tema.ts). Um script no <head> aplica antes de desenhar.
- Logotipos e favicon: pps/web/public/marca/ (SVG oficiais, sem editar o desenho), pp/icon.svg e pp/apple-icon.png. Use o componente components/logo.tsx; nunca redigite o nome da marca.
- Menu: lib/menu.ts (grupos, ícones, regras de permissão e item ativo). Cabeçalho, botão de tema e gaveta no celular ficam em components/shell-painel.tsx, cabecalho.tsx, otao-tema.tsx e sidebar.tsx.
- Cartões: iconeDoCartao(titulo) em lib/icones.ts escolhe o ícone pelo título; CartaoIndicador e CartaoDuplo o usam sem mudança nas telas.
- Gráficos usam --chart-1 … --chart-6. Botão primário usa --accent-strong (texto --on-accent-strong); a lima (--accent) é só fundo e detalhe.
- Pasta identidade-visual/ fica fora do git (arquivos de trabalho e fontes de terceiros).