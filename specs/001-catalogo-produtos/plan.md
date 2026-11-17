# Implementation Plan: Catálogo de produtos — ERP → site e Bling (fase 1)

**Branch**: `001-catalogo-produtos` (a criar na implementação) | **Date**: 2026-11-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-catalogo-produtos/spec.md`

## Summary

Substituir o app Access por um **Catálogo** dentro do painel existente. O fluxo:
- O gateway da rede lê diariamente o ERP (NewFord, e também SERPZERADO e bdb_pricing quando forem necessários) e as referências do site.
- O banco monta, por produto, o **documento desejado** (regras de preço, status e alertas) e o compara com o último publicado. A tela de revisão mostra o "antes e depois".
- Um clique em **Publicar** congela os documentos numa fila.
- O mesmo gateway, a cada 5 min, aplica cada produto:
  1. envia as fotos ao S3;
  2. grava no SQL Server do site, numa transação por produto;
  3. atualiza o Bling pela API v3 (produtos simples por SKU; um SKU que é componente de kit nunca é excluído).
- A publicação começa no site de teste.

## Technical Context

**Language/Version**: TypeScript (Node 22/24, Next.js 15), SQL (Postgres 15 / Supabase), Python 3.12 (gateway), T-SQL (SQL Server 2008 do ERP; SQL Server do site na AWS).

**Primary Dependencies**: Supabase (Postgres, RLS, Vault, Storage), Next.js + Tailwind (apps/web), psycopg 3 + pyodbc (gateway), **novas no gateway: boto3 (S3), Pillow (conversão JPG)**, Bling API v3 (HTTP, `urllib`/`httpx`).

**Storage**: Supabase Postgres (schemas `erp` e `catalogo`); Supabase Storage (bucket privado `catalogo-fotos`, temporário); destino final: SQL Server do site + S3 do site + Bling.

**Testing**: PGlite (`supabase/tests/catalogo.test.mjs`), `node --test` (libs web), pytest (gateway, com conexões e HTTP falsos).

**Target Platform**: Vercel (painel), Windows da rede da empresa (gateway, tarefa agendada), Supabase cloud.

**Project Type**: web application + agente local (monorepo existente).

**Performance Goals**: revisão do dia disponível até 07:00 (SC-001); publicação de 50 produtos concluída em ≤ 10 min (FR-016); telas do Catálogo respondem dentro do limite de ~8 s do papel `authenticated`.

**Constraints**:
- Gateway só com conexões de saída.
- Supabase gratuito (500 MB de banco, 1 GB de Storage): as fotos são apagadas do Storage depois de publicadas.
- Bling com ~3 requisições/s.
- Corpo de função da Vercel ≤ 4,5 MB: o envio das fotos vai direto ao Storage.

**Scale/Scope**: algumas centenas a poucos milhares de modelos, ~3–10 cores por modelo, até ~10 fotos por modelo; 1–5 usuários com a permissão `catalogo`.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Princípio | Como o plano cumpre | Status |
|---|---|---|
| I. Segredos nunca expostos | Senhas do site, chave do S3 e Client Secret do Bling só no cofre DPAPI do gateway. Tokens do Bling no Vault. Nenhum segredo na Vercel além do Client ID/Secret do OAuth (variável de ambiente). Erros passam pelo `mask()` | ✅ |
| II. Sistemas de origem protegidos | ERP só leitura, por views. A escrita no site, no S3 e no Bling foi decidida pelo dono na spec, usa credenciais próprias, passa por revisão humana, é atômica por produto, começa no ambiente de teste e nunca apaga registros referenciados | ✅ |
| III. Segurança e regras no banco | Preço, status, alertas e diff ficam em funções SQL. RLS e `has_perm('catalogo')` no banco. Migrations reexecutáveis | ✅ |
| IV. Números conferidos com a fonte | Quickstart cenário 2 (preço = custo/(1−margem) ±R$ 0,01) e conferência de 20 produtos contra o Access (SC-005) | ✅ |
| V. Testes primeiro | Testes SQL, pytest e node listados por requisito (research R10). TDD por tarefa | ✅ |
| VI. Simples e explicado ao dono | Reaproveita o gateway, o painel e o OAuth existentes. Sem serviço novo. Passos do dono com guia (quickstart) | ✅ |

Re-check pós-design (Fase 1): ✅. O desenho não adicionou peças além das previstas. Os pontos "a verificar" (endpoints do Bling, instância do SERPZERADO/bdb_pricing, mapeamento de `IdStatus`) têm teste de fumaça antes do uso real e não violam princípios.

## Project Structure

### Documentation (this feature)

```text
specs/001-catalogo-produtos/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── gateway-datasets.md
│   ├── publicacao.md
│   ├── site-escrita.md
│   ├── bling.md
│   └── painel-rpc.md
└── tasks.md             # gerado por /speckit-tasks
```

### Source Code (repository root)

```text
supabase/
├── migrations/
│   ├── 0014_catalogo_tabelas.sql      # erp.cat_*, catalogo.*, permissão, RLS, Storage bucket, grants do gateway
│   └── 0015_catalogo_funcoes.sql      # produto_desejado, revisao, salvar, pedir/pegar/concluir publicação, importar_do_site
└── tests/
    └── catalogo.test.mjs

gateway/
├── sqlserver/
│   └── views_catalogo.sql             # painel.cat_* (NewFord + SERPZERADO/bdb_pricing)
├── consultas/                         # cat_*.sql dos datasets
├── src/brinde_gateway/
│   ├── config.py                      # + [site], [s3], [bling], destino ativo
│   ├── cli.py                         # + publish, import-site, bling-check
│   ├── publicar.py                    # laço da fila (ordem fotos → site → Bling)
│   ├── site_escrita.py                # transação por produto (contrato site-escrita)
│   ├── fotos.py                       # download assinado, Pillow → JPG, boto3 → S3
│   └── bling.py                       # cliente v3, refresh com trava, kits
└── tests/                             # test_publicar, test_site_escrita, test_fotos, test_bling

apps/web/
├── app/(app)/catalogo/
│   ├── page.tsx                       # lista + filtros
│   ├── [ref]/page.tsx                 # tela do produto (ERP somente leitura + campos do Catálogo + fotos)
│   ├── revisao/page.tsx               # antes/depois + Publicar + acompanhamento
│   └── actions.ts
├── app/api/catalogo/fotos/upload-url/route.ts
├── app/api/catalogo/publicar/route.ts
├── app/api/bling/{conectar,callback}/route.ts
├── components/catalogo/                # area-fotos, campos-produto, tabela-revisao, aviso-edicao
└── lib/catalogo.ts (+ catalogo.test.ts)  # chamadas tipadas + funções puras (nomes de fotos, letras)
```

**Structure Decision**: estende o monorepo existente. Os padrões seguidos são: migrations numeradas em `supabase/migrations`, páginas em `apps/web/app/(app)/` com `exigirPermissao`, gateway em `gateway/src/brinde_gateway`. Não há novo projeto nem novo serviço hospedado.

## Complexity Tracking

Sem violações dos princípios.
