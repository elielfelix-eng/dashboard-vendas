# Implementation Plan: Ads e Orçamento (Bloco B)

**Branch**: `002-ads-orcamento` | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-ads-orcamento/spec.md`

## Summary

Criar a tela **Ads**, que mostra onde a publicidade dá lucro e o que fazer com cada produto, e acompanha o orçamento de R$ 5.000 por conta.

**O banco calcula tudo** em funções `analytics.ads_*`:
- indicadores e ACOS de equilíbrio sem contar o Ads duas vezes;
- atribuição do gasto de cada anúncio aos modelos;
- sugestões com motivo;
- orçamento do mês;
- distribuição diária da verba.

A tela só mostra os resultados.

**A sincronização do ML passa a trazer** nome, status e orçamento das campanhas e o status de cada anúncio, sempre só leitura.

**A chave Manual/Automático** fica gravada, mas não aplica nada.

**Tudo é neutro por canal**, para que a Shopee (projeto seguinte) entre sem retrabalho.

## Technical Context

**Language/Version**: TypeScript (Node 22/24, Next.js 15), SQL (Postgres 15 / Supabase).

**Primary Dependencies**:
- Supabase (Postgres, RLS);
- Next.js + Tailwind (`apps/web`), com os componentes existentes (`FiltroTopo`, `CartaoIndicador`, `GraficoSerie`, `TabelaDados`, `ComoCalculamos`);
- conector ML existente (`packages/connectors/src/mercadolivre`);
- job `jobs/src/sync-mercadolivre.ts`.

Nenhuma dependência nova.

**Storage**: Supabase Postgres:
- `mkt`: `ads_*` (tabelas existentes, mais `ads_anuncios`);
- `core`: `orcamento_ads`, `parametros_ads`, `ads_modo`;
- `analytics`: funções.

**Testing**:
- PGlite: `supabase/tests/ads.test.mjs`, dentro de `npm run test:sql`;
- `node --test`: `apps/web/lib/ads-regras.test.ts` e testes do conector com fetch falso;
- `npm run typecheck`.

**Target Platform**: Vercel (painel), GitHub Actions (sincronização 3x/dia), Supabase cloud.

**Project Type**: web application (monorepo existente).

**Performance Goals**: tela Ads em até 8 s para 90 dias, com o papel `authenticated` (SC-007).

**Constraints**:
- ML só leitura;
- plano gratuito;
- API de Ads com 90 dias de histórico;
- funções seguindo o padrão de desempenho da 0011: CTEs `as materialized`, período filtrado primeiro e `(select core.fn())`.

**Scale/Scope**: dezenas a poucas centenas de anúncios patrocinados, poucas campanhas, 90 dias de métricas e de 1 a 10 usuários com `ads`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Como o plano cumpre | Status |
|---|---|---|
| I. Segredos nunca expostos | Nenhum segredo novo. Erros de sincronização são registrados por rótulo, sem token | ✅ |
| II. Sistemas de origem protegidos | Só GET no Mercado Livre. O Automático não grava nada (FR-022), e um teste de guarda impede métodos de escrita no conector | ✅ |
| III. Segurança e regras no banco | Cálculos em `analytics.ads_*`. Permissões `ads`/`editar_ads`/`custos` aplicadas no banco (funções devolvem nulo ou nada). Migrations reexecutáveis | ✅ |
| IV. Números conferidos com a fonte | Quickstart cenários 1–4: comparação de outubro/2026 com o painel do Mercado Ads (≤1%) e com a Visão Geral. Prazo de 31/01/2027 por causa dos 90 dias | ✅ |
| V. Testes primeiro | Testes PGlite por regra, incluindo RLS como `authenticated`; fetch falso nas falhas da sincronização | ✅ |
| VI. Simples e explicado ao dono | Reaproveita telas e componentes, sem serviço novo. "Como calculamos" na tela. Decisões em nome do dono listadas no documento de projeto | ✅ |

Re-check pós-design (Fase 1): ✅. O desenho não acrescentou serviço nem dependência. O ponto "a verificar" (campos de campanha e status na API, R7) tem plano B e teste de fumaça (quickstart cenário 2).

## Project Structure

### Documentation (this feature)

```text
specs/002-ads-orcamento/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── painel-rpc.md
│   └── sync-ml-ads.md
├── checklists/requirements.md
└── tasks.md             # gerado por /speckit-tasks
```

### Source Code (repository root)

```text
supabase/
├── migrations/
│   ├── 0018_ads_tabelas.sql     # mkt.ads_anuncios, ads_campaigns.atualizado_em, core.orcamento_ads,
│   │                            # core.parametros_ads, core.ads_modo, permissões ads/editar_ads, RLS, seeds
│   └── 0019_ads_funcoes.sql     # analytics.ads_* (resumo, serie, modelos, campanhas, orcamento, distribuicao),
│                                # core.ads_definir_modo
└── tests/
    └── ads.test.mjs

packages/connectors/src/mercadolivre/
├── connector.ts                 # + listAdsCampaigns(), status em listAdsMetrics
└── connector.test.ts            # testes existentes do conector (+ campanhas, status, guarda só-leitura)

jobs/src/sync-mercadolivre.ts    # + syncAdsCampanhas, gravação de ads_anuncios (não fatais)

apps/web/
├── app/(app)/ads/
│   ├── page.tsx                 # abas modelos | campanhas | orcamento
│   └── actions.ts               # definir modo (core.ads_definir_modo)
├── app/(app)/configuracoes/parametros/   # + bloco Orçamento e limites de Ads
├── components/ads/              # tabela-sugestoes, cartao-orcamento, chave-modo
├── lib/ads.ts                   # chamadas tipadas
├── lib/ads-regras.ts (+ .test.ts)  # rótulos, selos, cores das sugestões
├── lib/permissoes.ts            # + 'ads', 'editar_ads', ordem das telas
└── components/sidebar.tsx       # + item Ads

.claude/skills/dashboard-mercado-livre-brinde-do-bem/SKILL.md   # seção Ads e Orçamento
```

**Structure Decision**: estende o monorepo existente, nos mesmos padrões do Bloco A e do CRM: migrations numeradas (0018–0019, pulando as do Catálogo), funções `analytics.*` chamadas por `lib/*.ts`, páginas em `app/(app)` com `exigirPermissao`. Não há projeto nem serviço novo.

**Ordem de aplicação das migrations**: 0018 → 0019 (reexecutáveis). Elas independem de 0014–0017 (Catálogo), que podem ser aplicadas antes ou depois.

## Complexity Tracking

Sem violações dos princípios.
