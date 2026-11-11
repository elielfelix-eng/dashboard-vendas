---
name: dashboard-mercado-livre-brinde-do-bem
description: Contexto e procedimentos do Painel de Vendas da Brinde do Bem (Mercado Livre, Shopee, ERP SQL Server via gateway, Bitrix24) publicado com Supabase + Vercel + GitHub Actions. Use ao trabalhar neste repositório - novas fases, sincronização, validação de dados, deploy, conexões OAuth, diagnóstico de erros ou dúvidas do usuário sobre o painel.
---

# Painel de Vendas — Brinde do Bem

## Como falar com o usuário
- Sempre em **português**, linguagem simples: o usuário é leigo em programação.
- Passo a passo numerado, com o nome exato dos botões/menus. Telas de Supabase, Vercel, GitHub e ML mudam com frequência: se o usuário não achar algo, ofereça caminhos alternativos e peça print.
- **Nunca peça** senhas, `DATABASE_URL`, `ML_CLIENT_SECRET` ou tokens no chat. URL do Supabase e chave publishable/anon podem aparecer.

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
Comparar pedidos pagos e faturamento do mês passado com o relatório de vendas do ML:
```sql
select count(*) pedidos, sum(total_amount) faturamento from mkt.orders
 where status = 'paid'
   and date_created >= date_trunc('month', now() - interval '1 month')
   and date_created <  date_trunc('month', now());
```
Status das execuções: `select * from core.sync_runs order by started_at desc limit 10;`

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
- [ ] Validar números da 1ª carga contra o relatório do ML e confirmar dados de Ads
- [ ] Fase 3 — Gateway ERP (ver seção abaixo)
- [ ] Fase 4 — Páginas de KPI (Vendas, Rentabilidade, Ads com ACOS de equilíbrio, Novos Produtos/simulador)
- [ ] Fase 5 — Bitrix24 (webhook somente leitura, usuário técnico)
- [ ] Fase 6 — Shopee (aguarda aprovação no Open Platform)
- [ ] Fase 7 — Healthchecks.io, backup semanal criptografado

## ERP (SQL Server) — a preencher
O ERP é próprio (SQL Server), ligado 24h. O gateway roda em **outra máquina da rede** (estilo Power BI Gateway): Python + pyodbc, serviço do Windows, usuário SQL somente leitura sobre views criadas para o painel, envio só de saída para o schema `erp` com o papel restrito `gateway_writer`. Horários de envio: 07:45, 12:45 e 16:45.

Pendente do usuário:
- Driver/DSN, servidor e banco (sem senha)
- Tabelas/colunas de produtos, custos, estoque, notas fiscais e financeiro
- Exemplos de código ML (MLB/SKU) × código ERP para o de-para
- % de imposto por canal e custo de embalagem
- Bitrix24: campo que liga o negócio ao ERP (nº pedido/NF ou CNPJ/CPF)
