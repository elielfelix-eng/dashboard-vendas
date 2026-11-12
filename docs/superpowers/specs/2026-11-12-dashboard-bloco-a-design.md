# Dashboard — Bloco A: Visão Geral, Vendas, Rentabilidade, Metas e Projeção

Data: 12/11/2026 · Status: aguardando revisão do dono · Fase 4 do plano geral (`C:\Users\el_sa\.claude\plans\preciso-criar-um-projeto-cheeky-wreath.md`)

## 1. Objetivo

Colocar o painel em uso para decidir **quais produtos anunciar e onde investir em Mercado Ads**, mostrando faturamento, margem real e metas. Bloco A cobre só telas cujos dados já existem e foram validados contra a V1 (Mercado Livre). Ficam para blocos seguintes: Anúncios e Ads por anúncio (B), Novos Produtos/simulador (C), Estoque e Financeiro (D), Shopee, vendas do Brinde do Bem (ERP) e CRM.

### Decisões do dono (12/11/2026)
- Imposto (%) e embalagem (R$) configuráveis numa tela de administração, começando em zero, com vigência por data.
- Análise de produtos **por modelo** (referência do ERP), com detalhe por SKU ao abrir o modelo.
- Período padrão: **mês atual até hoje × mesmo trecho do mês anterior**.
- Arquitetura: **o banco calcula (funções SQL), a tela só mostra**.
- Permissões **configuráveis por perfil** numa tela de administração (sem exceções por pessoa).
- Ads por modelo: **rateio pela receita** até o bloco B trazer Ads por anúncio.
- Metas: comparar com a **receita (pedidos pagos)**. Editar metas e premissas: **admin e gestor**.
- Canal "Brinde do Bem" = vendas fora dos marketplaces, faturadas no ERP; entra depois, com SQL do dono.

## 2. Estrutura comum

**Barra do topo** (todas as telas de dados):
- Canal: Consolidado | Mercado Livre | Shopee (Shopee desativada, "em breve"; hoje Consolidado = Mercado Livre).
- Período: Hoje, 7 dias, 30 dias, Mês atual (padrão), Mês anterior, Ano, Personalizado. Comparação sempre com o trecho anterior de mesmo tamanho; "Mês atual" compara com o mesmo trecho de dias do mês anterior (ex.: 01–12/11 × 01–12/10).
- Selo "Atualizado às HH:MM" (última `core.sync_runs` com sucesso do canal) e aviso no topo se a última execução falhou.
- Canal e período ficam na URL (`?canal=mercadolivre&periodo=mes&de=…&ate=…`) para compartilhar o recorte.
- Datas sempre em horário de Brasília; a data da venda é a de `analytics.ml_pedidos.data_venda`.

**Menu lateral** mostra só o que o perfil pode ver (tabela de permissões, seção 7).

**Estados:** sem vendas no período → mensagem "Sem vendas no período", não zeros. Erro ao consultar → mensagem amigável e o restante da página continua.

**Variação (▲▼):** verde quando melhora, vermelha quando piora (para custos, subir é piorar). Base zero no período anterior → "novo".

## 3. Visão Geral (`/`)

Cartões (período × anterior):
- Vendas brutas, Pedidos (vendas_qtd), Unidades, Ticket médio (vendas brutas ÷ pedidos) — mesma regra do painel do ML (pago + cancelado + devolvido, sem divididos).
- Margem bruta (R$ e %) = receita − custo do produto. *Requer permissão de custo.*
- Margem de contribuição (R$ e %) = receita − (comissão + frete + parcelamento + Product Ads + Seguidores + estornos + DIFAL + outras) − imposto − embalagem − custo do produto. *Requer permissão de custo.*
- Ads: investimento no período e TACOS (Ads ÷ vendas brutas).
- Cancelados + devolvidos: quantidade e % dos pedidos.
- **Mês atual: realizado × meta** (receita do mês até hoje ÷ meta do mês do canal), quando houver meta.

Gráfico: vendas brutas por dia, período atual × anterior.
Top 5 modelos por vendas brutas (com margem % se tiver permissão).
Quadro "Atenção": pedidos sem custo (link para a lista de modelos), status das sincronizações (ML, ERP).

## 4. Vendas (`/vendas`)

- Cartões de vendas (sem margem).
- Gráfico por dia | semana | mês, barras = atual, linha = anterior.
- Tabela por modelo: Pedidos, Unidades, Vendas brutas, Variação vs anterior, Participação %, Ticket médio, % cancelados+devolvidos. Ordenável por qualquer coluna, busca por modelo, exportação Excel (.xlsx) do que está na tela.
- Clique no modelo → detalhe por SKU (SKU, kit, pedidos, unidades, vendas brutas) → "ver pedidos" (data, nº da venda, SKU, qtd, valor, situação).
- Modelo/SKU exibidos pela referência do ERP (de-para da migration 0007); `sku_anuncio` aparece só na lista de pedidos.
- Sem custo nem margem nesta tela.

## 5. Rentabilidade (`/rentabilidade`, requer permissão de custo)

- Cartões: Receita, Margem bruta, Margem de contribuição (R$, %, variação em pontos percentuais), Pedidos sem custo (link).
- "Para onde vai o dinheiro": receita e cada custo do período até a contribuição (barras horizontais).
- Tabela por modelo: Curva ABC, Receita, Custo do produto, Tarifas+frete (comissão, frete, parcelamento do pedido), Custos rateados (Product Ads, Seguidores, estornos, DIFAL, outras), Imposto+embalagem, Contribuição R$ e %. Modelos com contribuição negativa marcados "prejuízo". Detalhe por SKU como em Vendas. Exportação Excel.
- **Rateio:** custos da fatura sem pedido (`ml_fatura.order_id is null`, pela `data_ref`) e Product Ads da API (`mkt.ads_campaign_daily`, nos dias cobertos pela API — mesma regra de `ml_meses`) são distribuídos entre os modelos proporcionalmente à receita de cada um no período. O total do período bate com a soma dos custos; a coluna é rotulada "(rateio)".
- **Curva ABC por lucro:** modelos com contribuição positiva ordenados de forma decrescente; A = até 80% do lucro acumulado, B = até 95%, C = restante; contribuição ≤ 0 → "prejuízo" (fora da curva).

## 6. Metas e Projeção (`/metas`)

Inspirado nas páginas "Projeção E-commerce Brinde do Bem" e "Projeção Vendas Brinde do Bem 2027" (`.claude/skills/dashboard-mercado-livre-brinde-do-bem/`).

- Seletor de canal (Mercado Livre agora; Shopee e Brinde do Bem mostram só a meta até terem realizado; "Total" soma os canais com realizado e compara com a meta total).
- Gráfico mensal: realizado (barras), projeção (tracejado), meta (linha), de 12 meses atrás até dez do ano da meta.
- Tabela mês a mês: Realizado, Cresc. %, Projeção, Meta, Projeção − meta, % da meta; total do ano.
- **Realizado** = receita (pedidos pagos) por mês.
- **Projeção:** parte do último mês fechado; o mês em andamento aparece só como referência. Mês projetado = mês anterior (realizado ou projetado) × (1 + crescimento do mês). Crescimento do mês = valor digitado naquele mês ou, se vazio, o crescimento padrão do canal; botão ↺ volta ao padrão.
- **Premissas salvas no banco** (valem para todos); só quem tem "Editar metas e premissas" altera.
- Brinde do Bem (histórico de 5 anos e sazonalidade) fica para quando o realizado do ERP existir.

### Upload de metas (`/configuracoes/metas`, permissão "Editar metas e premissas")
- Arquivo .xlsx com colunas **Canal | Ano | Mês | Meta** (cabeçalho na linha 1; mês por nome abreviado Jan…Dez ou número 1–12; canal: "Mercado livre"/"Mercado Livre", "Shopee", "Brinde do Bem", sem diferenciar maiúsculas).
- Leitura no navegador; **prévia** com totais por canal e lista de linhas inválidas (sem ano, mês inválido, canal desconhecido, meta não numérica ou negativa, linha duplicada). Com linhas inválidas, não grava.
- Gravar substitui todas as metas dos anos presentes no arquivo (numa transação).

## 7. Administração

### Permissões (`/configuracoes/permissoes`, admin)
Matriz perfil × permissão, com caixas de marcar. Permissões: `visao_geral`, `vendas`, `rentabilidade`, `metas`, `custos` (vê custo/margem), `editar_metas`, `configuracoes`. Valores iniciais:

| Perfil | visao_geral | vendas | rentabilidade | metas | custos | editar_metas | configuracoes |
|---|---|---|---|---|---|---|---|
| admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| gestor | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | |
| comercial | ✓ | ✓ | | ✓ | | | |
| visualizador | ✓ | | | | | | |
| vendedor | | | | | | | |

- Trava: o perfil admin mantém sempre `configuracoes` (o banco recusa remover).
- `core.can_see_costs()` passa a ler a permissão `custos` (preserva o comportamento atual de RLS em `erp.cost_tiers`).
- Novas telas de blocos futuros entram como novas permissões.

### Parâmetros de custo (`/configuracoes/parametros`, admin)
Por canal e vigência: imposto % sobre a receita, embalagem R$ por pedido, embalagem R$ por peça, "vale a partir de". Linha inicial: Mercado Livre, tudo zero, desde 01/01/2019. Cada venda usa a vigência mais recente com data ≤ data da venda. Só pedidos pagos recebem imposto e embalagem.

## 8. Arquitetura

### Banco (migration 0008, reexecutável; ordem 0003 → 0006 → 0007 → 0008)
Tabelas em `core` (schema já exposto na API):
- `core.role_permissions (role core.app_role, permission text, allowed boolean, pk(role, permission))` + `core.has_perm(text)`.
- `core.parametros_custo (id, channel, imposto_pct, embalagem_pedido, embalagem_peca, vigente_desde date, unique(channel, vigente_desde))`.
- `core.metas (channel, ano, mes, valor, carregado_em, pk(channel, ano, mes))`, channel ∈ {mercadolivre, shopee, brindedobem}.
- `core.premissas_projecao (channel, ano, mes null = padrão do canal, crescimento_pct)`.
RLS: leitura conforme permissão; escrita de permissões/parâmetros só admin; metas/premissas com `editar_metas`.

Funções em `analytics` (security invoker, `stable`), todas com parâmetros `(p_canal text, p_de date, p_ate date)` e respeitando `core.can_see_channel`:
- `dash_resumo` → indicadores do período (cartões); campos de custo/margem `null` sem `custos`.
- `dash_serie(…, p_grao text)` → série por dia/semana/mês.
- `dash_modelos` → linhas por modelo (vendas + rentabilidade com rateio + ABC; colunas de custo `null` sem `custos`).
- `dash_skus(…, p_modelo text)`, `dash_pedidos(…, p_modelo text)`.
- `dash_metas(p_canal text, p_ano int)` → realizado mensal, meta, premissas (projeção calculada no SQL com a regra da seção 6).
Período anterior calculado pela aplicação e passado como segunda chamada (mesmas funções).
A base é `analytics.ml_pedidos` + imposto/embalagem de `core.parametros_custo`; o canal "consolidado" = união dos canais com dados (hoje só ML).

### Site (`apps/web`)
- Páginas: `/`, `/vendas`, `/rentabilidade`, `/metas`, `/configuracoes/permissoes`, `/configuracoes/parametros`, `/configuracoes/metas`. Server Components chamam as funções via `supabase.schema('analytics').rpc(...)` com a sessão do usuário.
- Componentes: `FiltroTopo`, `CartaoIndicador`, `GraficoSerie`, `GraficoMetas`, `TabelaDados` (ordenar, buscar, exportar .xlsx), `PainelAtencao`.
- Gráficos com Recharts (client components); exportação e leitura do upload com uma biblioteca .xlsx no navegador (escolha no plano, sem vulnerabilidade conhecida).
- `sidebar.tsx` passa a ler as permissões do perfil.

## 9. Testes e aceite
- Testes SQL (PGlite, padrão de `supabase/tests`): indicadores e período anterior; margens com imposto/embalagem por vigência; rateio (soma igual ao total do período); curva ABC; permissões (comercial recebe custo `null` mesmo chamando a função direto; admin não perde `configuracoes`); metas (substituição por ano) e projeção (padrão, mês digitado, parte do último mês fechado).
- `npm run typecheck` e `npm run test:sql` verdes; CI igual.
- Aceite com dados reais: outubro/2026 no painel = números validados da V1 (vendas brutas R$ 54.341,55; 93 vendas; 106 unidades; cancelados 8 / R$ 4.054,95; devolvidos 2 / R$ 1.529,06). O dono confere antes de liberar para outros usuários.

## 10. Fora do escopo
Anúncios, Ads por anúncio (ACOS/ROAS por anúncio, escalar/pausar), Novos Produtos, Estoque, Financeiro, Shopee (realizado), vendas do Brinde do Bem (ERP), CRM, exceções de permissão por pessoa, tabela materializada.
