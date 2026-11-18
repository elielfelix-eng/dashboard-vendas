# Ads e Orçamento — design

Data: 2026-11-18 · Status: aguardando aprovação do dono · Projeto seguinte: Shopee completa (documento próprio)

## 1. Intenção

O dono investe em publicidade no Mercado Livre e na Shopee e hoje decide olhando quase só "quanto estou gastando", sem um padrão. Ele tem **R$ 5.000 por mês para cada conta** e quer:

- KPIs que mostrem onde o Ads dá lucro e onde dá prejuízo;
- **sugestões** concretas (escalar, reduzir, pausar, revisar, testar);
- ajuda para **distribuir o orçamento** entre campanhas e produtos;
- tudo preparado para que, no futuro, **alguns** produtos e campanhas sejam ajustados automaticamente e outros não.

Sucesso é: o dono abre uma tela, vê se o mês vai fechar dentro dos R$ 5.000 e sabe em poucos minutos o que mudar no Mercado Ads e na Shopee.

## 2. Objetivos, não objetivos, anti-objetivos

**Objetivos**
- Tela **Ads** com seletor Consolidado | Mercado Livre | Shopee e o período padrão do painel.
- Seção **Orçamento**: meta mensal por conta, ritmo do mês, distribuição sugerida.
- Chave **Manual / Automático** por modelo e por campanha, gravada, mas sem efeito nesta versão.
- Modelo de dados e funções neutros por canal: a Shopee (próximo projeto) entra sem retrabalho.

**Não objetivos (nesta versão)**
- Aplicar mudanças nas contas de Ads (nenhuma chamada de gravação nas APIs).
- Conector da Shopee (projeto seguinte). Até lá, a Shopee aparece no seletor sem dados.
- Previsão estatística sofisticada; as regras são simples e explicáveis.

**Anti-objetivos (falha mesmo que "funcione")**
- O painel gastar dinheiro ou mudar campanha sem o dono saber.
- Números de gasto que não batem com o painel do Mercado Ads.
- Sugestão que o dono não entende por quê (toda sugestão mostra o motivo em uma frase).
- Expor custo/margem a quem não tem a permissão `custos`.

## 3. O que já existe (base do trabalho)

- `mkt.ads_metrics_daily` (por anúncio e dia): impressões, cliques, custo, vendas diretas e indiretas (R$ e unidades), unidades orgânicas, `campaign_id`. Preenchida por `syncAds` (`listAdsMetrics`, endpoint `product_ads/ads/search`, api-version 2). **Nunca conferida com o painel do Mercado Ads.**
- `mkt.ads_campaign_daily` (por campanha e dia, só custo): validada contra o painel; usada na margem (`analytics.ml_meses`, `dash_custos_periodo`).
- `mkt.ads_campaigns` (nome, status, orçamento, ACOS alvo): tabela existe, **não é preenchida**.
- `analytics.dash_modelos(p_canal, p_de, p_ate)`: receita, custo, tarifas, custos rateados, imposto/embalagem e contribuição por modelo. Os **custos rateados incluem o Product Ads** (custos sem pedido, rateados pela receita).
- Permissões por perfil (`core.role_permissions`, `core.has_perm`), parâmetros com vigência (`core.parametros_custo`), tela Parâmetros (`/configuracoes/parametros`).
- A API de Ads do ML guarda 90 dias.

## 4. Abordagens consideradas

| | Abordagem | Troca |
|---|---|---|
| **A (escolhida)** | Ads e Orçamento com dados do ML primeiro, tudo neutro por canal; Shopee completa em seguida, alimentando a mesma tela | Entrega rápida com dados que já chegam; regras validadas com números reais antes da Shopee. A tela fica algumas semanas só com o ML |
| B | Shopee primeiro, Ads dos dois canais de uma vez | Atrasa a tela; regras testadas só no fim com dois canais |
| C | Tudo num único projeto | Entrega e revisão grandes; um bloqueio na Shopee trava o ML |

O dono escolheu **A**.

## 5. Decisões do dono

1. Começar **só sugerindo**; nada é aplicado nas contas.
2. Preparar o **automático por item**: cada modelo e cada campanha tem Manual/Automático; por padrão, Manual.
3. Orçamento de **R$ 5.000/mês por conta** (ML e Shopee), editável em Parâmetros, com vigência.
4. O dono não tem padrão de análise; os KPIs e as sugestões são propostos por nós (seções 6 e 7) e foram aceitos.

## 6. Tela Ads

Rota `/ads`, nova permissão `ads` (seed: admin e gestor = true; comercial = true; visualizador = false). Seletor de canal e período iguais às outras telas.

**Cartões** (com variação contra o período anterior):
- Investimento (gasto)
- Vendas por Ads (diretas + indiretas)
- ROAS = vendas por Ads ÷ gasto
- ACOS = gasto ÷ vendas por Ads
- TACOS = gasto ÷ vendas brutas totais do canal (todas as vendas)
- % das vendas via Ads = vendas por Ads ÷ vendas brutas totais

**Gráfico diário**: gasto (barras) × vendas por Ads (linha).

**Tabela por modelo**: gasto, impressões, cliques, CTR, CPC, conversão (unidades por Ads ÷ cliques), vendas por Ads, ACOS, **ACOS de equilíbrio**, **lucro depois do Ads**, sugestão + motivo, chave Manual/Automático.

**Aba Por campanha**: nome, status, orçamento diário atual (se a API trouxer), gasto, vendas, ACOS, ROAS, quantos modelos, chave Manual/Automático.

**Definições:**
- **ACOS de equilíbrio** do modelo = contribuição **antes do Ads** ÷ receita. Contribuição antes do Ads = contribuição de `dash_modelos` + a parte do Product Ads que foi rateada para o modelo. Assim não se conta o Ads duas vezes.
- **Lucro depois do Ads** = contribuição antes do Ads − gasto em Ads **do próprio modelo** (atribuído pelo anúncio), e não o rateio.
- Ligação anúncio → modelo *(nossa decisão)*: o gasto e as vendas por Ads de um anúncio são **divididos entre os modelos na proporção das unidades vendidas** de cada modelo naquele anúncio, na mesma janela. Um anúncio sem venda na janela usa o modelo do SKU cadastrado do anúncio (`mkt.items`); se houver mais de um, divide igualmente. Sem nenhum dos dois, aparece como "sem modelo".
- **Fonte do gasto** *(nossa decisão)*: os cartões, o gráfico e o acompanhamento do orçamento usam `ads_campaign_daily` (a fonte conferida, a mesma do cartão da Visão Geral). A tabela por modelo usa `ads_metrics_daily`; a diferença entre as duas aparece numa linha "não atribuído a anúncio", para que a tabela sempre some o mesmo que o cartão.
- **Anúncios pausados** *(nossa decisão)*: a sincronização passa a guardar o status de cada anúncio (o `ads/search` devolve). Anúncio pausado, ou em campanha pausada, não recebe sugestão nem verba; aparece na tabela com o selo "pausado".

**Permissões:** sem `custos`, a tela mostra o gasto, as vendas, ROAS, ACOS, TACOS e CTR/CPC. Ficam nulos o ACOS de equilíbrio, o lucro e as sugestões que dependem de margem (Escalar, Reduzir, Testar Ads). Pausar e Revisar anúncio continuam visíveis. Vale no banco (funções devolvem nulo), como no restante do painel.

## 7. Sugestões

Calculadas no banco, por modelo, sobre uma **janela de 30 dias** até a data final do período (independente do período da tela, para não oscilar com filtros curtos). Cada uma vem com o motivo em uma frase. Os limites ficam em uma tabela de parâmetros (`core.parametros_ads`, por canal, com vigência), editável por admin em Parâmetros.

| Sugestão | Regra (valores iniciais) |
|---|---|
| **Pausar** | gasto ≥ R$ 50 **ou** cliques ≥ 100 em 30 dias, com 0 venda por Ads; e ≥ 7 dias com dados |
| **Reduzir** | ACOS > ACOS de equilíbrio |
| **Revisar anúncio** | cliques ≥ 100 e conversão < 1% (o problema é preço, foto ou título, não o Ads) |
| **Escalar** | ACOS ≤ equilíbrio − 10 pontos e ≥ 3 vendas por Ads em 30 dias |
| **Testar Ads** | sem gasto em Ads em 30 dias, contribuição % ≥ 20% e ≥ 3 vendas orgânicas |
| **Manter** | nenhuma das anteriores |

Ordem de prioridade quando mais de uma vale: Pausar > Reduzir > Revisar > Escalar > Testar > Manter.

## 8. Orçamento

**Cadastro:** `core.orcamento_ads (channel, valor_mensal, vigente_desde)`, seed ML = 5.000 e Shopee = 5.000 a partir de 2026-11-01; editável por admin em Parâmetros.

**Acompanhamento do mês** (mês corrente, Brasília):
- gasto até hoje × orçamento (R$ e %), % do mês decorrido;
- projeção de fechamento = gasto até ontem ÷ dias completos × dias do mês;
- alerta se a projeção passar do orçamento (ou ficar abaixo de 80%: verba sobrando);
- saldo e **valor diário** para o resto do mês.

**Distribuição sugerida** para o restante do mês (valor diário disponível = saldo ÷ dias restantes):
1. **Teste**: 10% do valor diário, dividido igualmente entre os modelos "Testar Ads" (até 5 modelos, os de maior contribuição %). Sem candidatos, os 10% voltam para o restante. O teto do passo 4 não vale para o Teste.
2. **Pausar**, **Reduzir** e **Revisar anúncio** *(nossa decisão para Revisar)*: Pausar recebe 0. Reduzir recebe o gasto diário médio dos últimos 30 dias × 0,7. Revisar mantém o gasto diário médio atual (×1), até o anúncio ser revisto.
3. **Escalar** e **Manter** dividem o restante proporcionalmente ao **lucro depois do Ads** dos últimos 30 dias (só lucro positivo).
4. **Teto por modelo**: um modelo não recebe mais que 2× o seu gasto diário médio dos últimos 30 dias. O excedente é redistribuído entre os demais; o que sobrar fica como "sem destino" (sinal de que faltam produtos lucrativos para anunciar).

**Data de referência** *(nossa decisão)*: a distribuição e o acompanhamento do mês usam sempre **hoje** (mês corrente, últimos 30 dias até ontem), independentemente do período escolhido na tela. O período da tela vale para os cartões, o gráfico e as tabelas; a sugestão por modelo na tabela usa os 30 dias até a data final do período, como na seção 7.

**Consolidado** *(nossa decisão)*: o orçamento consolidado soma só as contas **conectadas** (hoje, só o ML), para não mostrar metade da verba como "sobrando". O TACOS consolidado considera só os canais de marketplace (ML e Shopee), sem o canal Brinde do Bem.

**Mercado Livre** (orçamento é por campanha): a sugestão é somada por campanha. O modelo fica na campanha em que mais gastou nos últimos 30 dias. Os modelos "Testar Ads" (sem campanha) aparecem numa linha **"Nova campanha de teste"**, com o valor sugerido. Também aparece a sugestão de **mudar de campanha** quando a sugestão do modelo (Escalar/Manter/Reduzir) difere da maioria da campanha. *(Decisão do construtor: o texto da sugestão de mudança é informativo; não há estrutura de campanhas obrigatória.)*

**Shopee**: o orçamento é por anúncio, então a sugestão fica por anúncio. Só passa a ter dados no projeto da Shopee.

Sem a permissão `custos`, a distribuição não é exibida (depende do lucro); o acompanhamento do mês, sim.

## 9. Manual / Automático (preparação)

- `core.ads_modo (channel, tipo 'modelo'|'campanha', chave, modo 'manual'|'automatico', alterado_por, alterado_em)`. Padrão: manual (ausência de linha = manual).
- Alterar exige permissão nova `editar_ads` (seed: admin e gestor).
- Nesta versão, Automático mostra o selo "aguardando liberação" e **nada é aplicado**.
- Ficam registradas, para o futuro, as travas do automático: nunca passar do orçamento do mês; mudar um orçamento de campanha no máximo ±20% por dia; não pausar com menos de 7 dias de dados; registrar cada mudança (o quê, de quanto para quanto, quando, por quê) com desfazer. No ML o automático age por campanha (e move modelos marcados entre campanhas); na Shopee, por anúncio.

## 10. Dados a completar no ML

- Preencher `mkt.ads_campaigns` (nome, status, orçamento diário, ACOS alvo) a partir do endpoint de campanhas do Product Ads (o mesmo `campaigns/search` já usado, pedindo os atributos da campanha). Falha aqui não derruba a sincronização.
- Guardar `raw` em `ads_metrics_daily` não é necessário.
- **Conferência obrigatória antes de liberar a tela**: gasto, cliques e vendas por Ads de outubro/2026 em `ads_metrics_daily` contra o painel do Mercado Ads, e soma por anúncio contra `ads_campaign_daily` (referência: Product Ads R$ 8.224 em out/2026). **Tolerância** *(nossa decisão)*: até 1% no gasto do mês. Acima disso, investigar antes de liberar as sugestões. O conector hoje descarta linhas sem impressão e sem custo e guarda uma campanha por anúncio/dia; rever isso faz parte da investigação. Como a API guarda só 90 dias, a conferência de outubro precisa acontecer **até o fim de janeiro/2027**.
- `core.ads_modo.tipo` aceita também `'anuncio'` (Shopee).

## 11. Restrições

- Princípios da constituição do projeto (`.specify/memory/constitution.md`): regra no banco, RLS, segredos fora do código, números conferidos com a fonte, testes primeiro.
- Conexão com o ML continua **só leitura**.
- Telas dentro de ~8 s com o papel `authenticated`: as funções seguem o padrão de `dash_pedidos_base` (CTEs materializadas, período filtrado cedo) e as políticas com `(select core....())`.
- Plano gratuito do Supabase: sem tabelas grandes novas (o volume de Ads é pequeno: dezenas de anúncios × 90 dias).

## 12. Deixado ao construtor

- Nomes exatos das funções (`analytics.ads_*`), número da migration (a próxima livre no main é a 0014; o ramo do Catálogo usa 0014–0017 e ainda não foi juntado: **usar 0018+** para evitar colisão).
- Forma do gráfico e da tabela, seguindo os componentes das telas existentes.
- Como mostrar o motivo da sugestão (texto curto na linha).
- Testes: PGlite para regras de sugestão, distribuição e permissões; `node --test` para formatações novas.
