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
supabase/migrations    0001_core.sql, 0002_marketplaces.sql (aplicar colando o CONTEÚDO no SQL Editor)
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
Enquanto a classificação pago/dividido/devolvido/cancelado não estiver implementada, só "pagos" é comparável. Status das execuções: `select * from core.sync_runs order by started_at desc limit 10;`

## Lacunas da implementação atual em relação à V1 (backlog da Fase 2)
1. **Fatura (billing)** não é sincronizada → faltam comissão, frete real, parcelamento, Seguidores, estornos, DIFAL e outras. Criar `mkt.billing_details` e o sync com re-leitura de períodos incompletos.
2. **Classificação do pedido**: buscar `/shipments/{id}` dos cancelados (status/substatus) e `cancel_detail`; gravar a classe (pago/dividido/devolvido/cancelado).
3. **Data da venda**: KPIs devem usar `coalesce(date_closed, date_created)` em America/Sao_Paulo.
4. **SKU**: extrair modelo, cor, kit e versão (`MODELO-COR-Knnnn-Vn`) para `mkt.order_items`.
5. **Ads**: o conector usa `product_ads/ads/search` (por anúncio, não validado). A V1 validou `product_ads/campaigns/search` com `aggregation_type=DAILY` — usar este para o total diário e manter o por-anúncio só se a API responder.
6. **429**: `fetchJson` usa espera exponencial curta; o ML pede 10 s × tentativa.
7. **Custos por faixa** (`erp.cost_tiers` por modelo + regras de faixa) e alertas `sem_custo` / `faixa_atual`.
8. Comissão isenta desde 10/2026 (`sale_fee` = 0) — não tratar como erro.

A V1 está em `Dash_V1/` (só a skill/plugin, sem os scripts). As regras foram copiadas para regras-de-negocio.md.

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
- [ ] Fase 2b — fechar as lacunas da V1 (lista acima)
- [ ] Fase 3 — Gateway ERP (ver seção abaixo)
- [ ] Fase 4 — Páginas de KPI (Vendas, Rentabilidade, Ads com ACOS de equilíbrio, Novos Produtos/simulador)
- [ ] Fase 5 — Bitrix24 (webhook somente leitura, usuário técnico)
- [ ] Fase 6 — Shopee (aguarda aprovação no Open Platform)
- [ ] Fase 7 — Healthchecks.io, backup semanal criptografado

## ERP (SQL Server) — a preencher
O ERP é próprio (SQL Server), ligado 24h. O gateway roda em **outra máquina da rede** (estilo Power BI Gateway): Python + pyodbc, serviço do Windows, usuário SQL somente leitura sobre views criadas para o painel, envio só de saída para o schema `erp` com o papel restrito `gateway_writer`. Horários de envio: 07:45, 12:45 e 16:45.

De-para ML × ERP: o **modelo** do SKU (ex.: `BLA68` em `BLA68-AMA-K0010-V1`) é o `productId` da tabela de custos. Custos são **por faixa de quantidade com vigência** (`qtyStart`, `qtyEnd`, `price`, `createdAt`, `expiredAt`) — a view do ERP precisa entregar esse formato.

Pendente do usuário:
- Driver/DSN, servidor e banco (sem senha)
- Tabela/consulta do ERP que gera as faixas de custo (equivalente ao `custos.csv` da V1), além de estoque, notas fiscais e financeiro
- Confirmar se o código do modelo no ERP é igual ao modelo do SKU do ML
- % de imposto por canal e custo de embalagem
- Bitrix24: campo que liga o negócio ao ERP (nº pedido/NF ou CNPJ/CPF)
