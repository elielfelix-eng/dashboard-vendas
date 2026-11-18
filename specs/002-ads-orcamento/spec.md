# Feature Specification: Ads e Orçamento (Bloco B)

**Feature Branch**: `002-ads-orcamento`

**Created**: 2026-11-18

**Status**: Draft

**Input**: User description: "Ads e Orçamento (Bloco B): tela Ads no painel (Consolidado | Mercado Livre | Shopee) com KPIs (investimento, vendas por Ads, ROAS, ACOS, TACOS, % vendas via Ads, ACOS de equilíbrio, lucro depois do Ads), tabela por modelo e por campanha, sugestões automáticas (Pausar, Reduzir, Revisar anúncio, Escalar, Testar Ads, Manter) com motivo, orçamento mensal de R$ 5.000 por conta com acompanhamento do ritmo e distribuição sugerida por campanha (ML) ou anúncio (Shopee), e chave Manual/Automático por modelo/campanha preparada sem aplicar nada nas contas. Primeiro com dados do Mercado Livre; a Shopee entra no projeto seguinte. Fonte completa e decisões do dono: docs/superpowers/specs/2026-11-18-ads-orcamento-design.md (aprovado em 2026-11-18)."

> Documento de origem com o detalhamento e o histórico das decisões: `docs/superpowers/specs/2026-11-18-ads-orcamento-design.md`. Esta especificação descreve **o quê** e **por quê**; o **como** fica para o plano.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ver se o Ads está dando lucro (Priority: P1)

O dono abre a tela **Ads**, escolhe o canal (Consolidado, Mercado Livre ou Shopee) e o período. Vê quanto investiu, quanto vendeu por meio dos anúncios patrocinados, o retorno de cada real investido e quanto da venda total depende de Ads. Abaixo, uma tabela por modelo mostra, para cada produto, gasto, cliques, conversão, ACOS, o ACOS de equilíbrio (o limite a partir do qual o anúncio dá prejuízo) e o lucro depois do Ads.

**Why this priority**: Hoje o dono olha quase só "quanto estou gastando". Sem saber onde o Ads dá lucro, qualquer decisão de orçamento é no escuro. Tudo o mais (sugestões, orçamento) depende desses números.

**Independent Test**: Escolher outubro/2026 no Mercado Livre. O investimento do cartão bate com o painel do Mercado Ads (diferença de até 1%) e com o Product Ads da Visão Geral; a soma da tabela por modelo mais a linha "não atribuído a anúncio" é igual ao cartão.

**Acceptance Scenarios**:

1. **Given** dados de Ads de outubro sincronizados, **When** o dono escolhe Mercado Livre e outubro, **Then** vê investimento, vendas por Ads, ROAS, ACOS, TACOS e % de vendas via Ads, cada um com a variação contra o período anterior.
2. **Given** um modelo com margem de 30% antes do Ads e ACOS de 35%, **When** a tabela é exibida, **Then** o ACOS de equilíbrio do modelo é 30% e o lucro depois do Ads é negativo.
3. **Given** um usuário sem a permissão de ver custos, **When** abre a tela, **Then** vê gasto, vendas, ROAS, ACOS, TACOS, CTR e CPC, mas não vê ACOS de equilíbrio, lucro nem sugestões que dependem de margem, e não consegue obtê-los consultando os dados diretamente.
4. **Given** o canal Shopee ainda não conectado, **When** o dono escolhe Shopee, **Then** a tela informa que o canal ainda não tem dados, sem erro.

---

### User Story 2 - Receber sugestões do que fazer em cada produto (Priority: P1)

Na mesma tabela, cada modelo traz uma sugestão — **Pausar**, **Reduzir**, **Revisar anúncio**, **Escalar**, **Testar Ads** ou **Manter** — com o motivo em uma frase. Um filtro rápido mostra quantos modelos há em cada sugestão.

**Why this priority**: O dono pediu explicitamente "KPIs e sugestões". As sugestões transformam os números em ação em poucos minutos.

**Independent Test**: Com dados de teste conhecidos, cada regra produz a sugestão esperada; os limites alterados em Parâmetros mudam o resultado.

**Acceptance Scenarios**:

1. **Given** um modelo que gastou R$ 60 em 30 dias sem nenhuma venda por Ads e tem 10 dias com dados, **When** a sugestão é calculada, **Then** é "Pausar" com o motivo "gastou R$ 60 em 30 dias sem venda".
2. **Given** um modelo com ACOS acima do equilíbrio, **Then** a sugestão é "Reduzir".
3. **Given** um modelo com 150 cliques e conversão de 0,5%, **Then** a sugestão é "Revisar anúncio" (problema no anúncio, não no Ads).
4. **Given** um modelo com ACOS 12 pontos abaixo do equilíbrio e 5 unidades vendidas por Ads, **Then** a sugestão é "Escalar".
5. **Given** um modelo sem gasto em Ads, margem de 25% e 4 unidades vendidas sem Ads em 30 dias, **Then** ele aparece na tabela com a sugestão "Testar Ads".
6. **Given** um modelo que se encaixa em Pausar e Revisar, **Then** prevalece Pausar (ordem: Pausar > Reduzir > Revisar > Escalar > Testar > Manter).
7. **Given** um anúncio pausado ou em campanha pausada, **Then** ele não recebe sugestão e aparece com o selo "pausado".

---

### User Story 3 - Controlar o orçamento de R$ 5.000 do mês (Priority: P1)

Na seção **Orçamento**, o dono vê, para cada conta, o gasto do mês até agora contra o orçamento, quanto do mês já passou, a projeção de fechamento no ritmo atual e quanto pode gastar por dia até o fim do mês. Um alerta avisa se o mês vai estourar o orçamento ou se vai sobrar verba.

**Why this priority**: O orçamento é a restrição real do dono; estourar ou deixar sobrar é a primeira coisa a corrigir.

**Independent Test**: No dia 18 de um mês de 30 dias, com R$ 3.000 gastos até o dia 17 e orçamento de R$ 5.000, a tela mostra projeção de R$ 5.294,12 (R$ 3.000 ÷ 17 dias × 30), alerta de estouro e valor diário de R$ 153,85 (R$ 2.000 ÷ 13 dias, contando hoje).

**Acceptance Scenarios**:

1. **Given** orçamento de R$ 5.000 e gasto projetado acima dele, **Then** aparece o alerta de estouro com o valor excedente.
2. **Given** gasto projetado abaixo de 80% do orçamento, **Then** aparece o alerta de verba sobrando.
3. **Given** um usuário com "Editar Ads" altera, na aba Orçamento, o orçamento do ML para R$ 6.000 a partir de 01/12, **Then** novembro continua com R$ 5.000 e dezembro usa R$ 6.000; um usuário sem essa permissão não vê o botão e não consegue gravar acessando os dados diretamente.
4. **Given** o Consolidado, **Then** o orçamento somado considera só as contas conectadas.
5. **Given** qualquer período escolhido na tela, **Then** o acompanhamento do orçamento é sempre do mês corrente.

---

### User Story 4 - Saber como distribuir o orçamento (Priority: P2)

Abaixo do acompanhamento, o painel sugere quanto colocar por dia em cada campanha (Mercado Livre) ou anúncio (Shopee) até o fim do mês: uma reserva para testar produtos novos, nada para quem deve ser pausado, menos para quem deve ser reduzido, e o restante para quem dá lucro, proporcional ao lucro. Modelos que ainda não estão em nenhuma campanha aparecem numa linha "Nova campanha de teste". Também indica modelos que deveriam mudar de campanha.

**Why this priority**: É o que o dono pediu ("me ajudar a administrar distribuindo esse valor"), mas depende das sugestões e do orçamento estarem certos.

**Independent Test**: Com dados de teste conhecidos, a soma da distribuição é igual ao valor diário disponível (menos a parte "sem destino", quando houver) e cada passo da regra produz o valor esperado.

**Acceptance Scenarios**:

1. **Given** valor diário disponível de R$ 150 e 2 modelos "Testar Ads", **Then** R$ 15 vão para teste (R$ 7,50 cada) e o resto é dividido entre Escalar e Manter na proporção do lucro.
2. **Given** um modelo "Reduzir" que gastava em média R$ 20/dia, **Then** recebe R$ 14/dia.
3. **Given** um modelo "Revisar anúncio" que gastava R$ 10/dia, **Then** continua com R$ 10/dia.
4. **Given** um modelo lucrativo que gastava R$ 10/dia e cuja parte proporcional seria R$ 50/dia, **Then** recebe no máximo R$ 20/dia, e o excedente vai para os outros ou para "sem destino".
5. **Given** um usuário sem permissão de custos, **Then** a distribuição não é exibida.

---

### User Story 5 - Marcar o que poderá ser automático no futuro (Priority: P3)

Cada modelo e cada campanha (e, na Shopee, cada anúncio) tem uma chave **Manual / Automático**. Nesta versão, marcar Automático só registra a escolha e mostra "aguardando liberação"; nada é alterado nas contas de Ads.

**Why this priority**: O dono quer deixar pronto para automatizar parte dos itens no futuro, mas começar só com sugestões.

**Independent Test**: Marcar um modelo como Automático, recarregar a tela e ver o selo "aguardando liberação"; conferir que nenhuma chamada de alteração foi feita a nenhum canal.

**Acceptance Scenarios**:

1. **Given** um usuário com a permissão de editar Ads, **When** marca uma campanha como Automático, **Then** a escolha fica gravada com quem e quando alterou.
2. **Given** um usuário sem essa permissão, **Then** vê a chave, mas não consegue alterá-la (nem pela tela nem acessando os dados diretamente).
3. **Given** qualquer item em Automático, **Then** o painel não altera nada nas contas de Ads.

---

### Edge Cases

- Um anúncio vende mais de um modelo (variações, kits): o gasto e as vendas por Ads são divididos entre os modelos na proporção das unidades vendidas; sem venda, pelo SKU cadastrado do anúncio; sem nenhum dos dois, "sem modelo".
- Modelo sem custo cadastrado: ACOS de equilíbrio e lucro aparecem como "sem custo", e o modelo não recebe Escalar, Reduzir nem Testar (só Pausar, Revisar ou Manter).
- Dia em que a sincronização de Ads falhou: os cartões mostram o aviso de dados incompletos, como nas outras telas.
- Primeiro dia do mês (nenhum dia completo): a projeção não é calculada; mostra só o gasto e o orçamento.
- Último dia do mês: o saldo diário é o saldo inteiro.
- Gasto do mês já passou do orçamento: saldo diário é zero e a distribuição mostra tudo em zero com o aviso "orçamento do mês esgotado".
- Nenhum modelo lucrativo: toda a verba fora de teste e reduções fica em "sem destino".
- Dados de Ads da API têm só 90 dias: períodos mais antigos mostram os cartões com o gasto (fonte conferida), mas a tabela por modelo informa que não há detalhe por anúncio.

## Requirements *(mandatory)*

### Functional Requirements

**Tela e indicadores**

- **FR-001**: O painel MUST ter a tela **Ads**, com seletor de canal (Consolidado, Mercado Livre, Shopee) e o mesmo seletor de período das outras telas, acessível só a quem tem a nova permissão `ads` (inicialmente admin, gestor e comercial).
- **FR-002**: A tela MUST mostrar, com variação contra o período anterior de mesma duração: investimento; vendas por Ads (diretas + indiretas); ROAS (vendas por Ads ÷ investimento); ACOS (investimento ÷ vendas por Ads); TACOS (investimento ÷ vendas brutas totais do canal); % das vendas via Ads.
- **FR-003**: O investimento dos cartões, do gráfico e do orçamento MUST vir da mesma fonte já conferida usada na Visão Geral; a tabela por modelo MUST somar o mesmo valor, com a diferença numa linha "não atribuído a anúncio".
- **FR-004**: A tela MUST ter um gráfico diário de investimento × vendas por Ads.
- **FR-005**: A tela MUST ter uma tabela por modelo com: investimento, impressões, cliques, CTR, CPC, conversão (unidades por Ads ÷ cliques), vendas por Ads, ACOS, ACOS de equilíbrio, lucro depois do Ads, sugestão com motivo, selo "pausado" quando for o caso, e a chave Manual/Automático.
- **FR-006**: ACOS de equilíbrio de um modelo MUST ser a contribuição antes do Ads ÷ receita; contribuição antes do Ads = contribuição do modelo (como na Rentabilidade) somada de volta à parte do Ads rateada a ele. Lucro depois do Ads MUST ser a contribuição antes do Ads menos o gasto em Ads atribuído ao próprio modelo.
- **FR-007**: Gasto e vendas por Ads de um anúncio MUST ser atribuídos aos modelos conforme o caso de borda "anúncio com mais de um modelo".
- **FR-008**: A tela MUST ter a aba **Por campanha**: nome, status, se é automática (gerida pelo ML), orçamento diário atual e ROAS objetivo (quando disponíveis, com o ACOS equivalente = 1 ÷ ROAS objetivo), investimento, vendas por Ads, ACOS, ROAS, número de modelos e chave Manual/Automático.
- **FR-009**: Sem a permissão `custos`, ACOS de equilíbrio, lucro depois do Ads, as sugestões Escalar/Reduzir/Testar Ads e a distribuição do orçamento MUST vir vazios dos próprios dados (não só escondidos na tela); Pausar e Revisar anúncio continuam disponíveis.
- **FR-010**: O Consolidado MUST somar só os canais de marketplace (Mercado Livre e Shopee); o TACOS consolidado não inclui o canal Brinde do Bem.

**Sugestões**

- **FR-011**: Cada modelo do universo (modelos com dados de Ads ou com venda paga no canal nos últimos 30 dias) MUST receber exatamente uma sugestão — **exceto** os pausados (FR-014), que ficam sem sugestão, e as sugestões que o FR-009 esconde de quem não vê custos —, calculada sobre os 30 dias até a data final do período escolhido, na ordem de prioridade Pausar > Reduzir > Revisar anúncio > Escalar > Testar Ads > Manter, com as regras:
  - **Pausar**: investimento ≥ R$ 50 ou cliques ≥ 100 em 30 dias, sem venda por Ads, e ao menos 7 dias com dados;
  - **Reduzir**: ACOS > ACOS de equilíbrio;
  - **Revisar anúncio**: cliques ≥ 100 e conversão < 1%;
  - **Escalar**: ACOS ≤ equilíbrio − 10 pontos e ≥ 3 unidades vendidas por Ads (diretas + indiretas);
  - **Testar Ads**: sem investimento em 30 dias, margem de contribuição ≥ 20% e ≥ 3 unidades vendidas (pedidos pagos) no canal, sem Ads;
  - **Manter**: nenhuma das anteriores.
- **FR-012**: Cada sugestão MUST vir com um motivo de uma frase, com os números que a justificam.
- **FR-013**: Os limites do FR-011 MUST ser editáveis por canal, com data de vigência, pelo admin em Parâmetros.
- **FR-014**: Anúncios pausados, ou em campanha pausada, MUST ficar fora das sugestões e da distribuição e aparecer com o selo "pausado".

**Orçamento**

- **FR-015**: O orçamento mensal de Ads MUST ser cadastrado por conta (canal), com vigência ("vale a partir de", com histórico visível), editável **na própria tela Ads (aba Orçamento)** por quem tem a permissão `editar_ads`; valor inicial R$ 5.000 para Mercado Livre e para Shopee a partir de 01/11/2026. É uma **meta de redução** (em out/2026 o ML gastou R$ 8.763) e, no Mercado Livre, cobre **Product Ads + campanha de Seguidores**.
- **FR-015a**: No Mercado Livre, o gasto do orçamento MUST somar Product Ads (fonte conferida) e Seguidores (fatura do ML, com a regra de data já usada no painel: cobrança na madrugada seguinte ao consumo). Seguidores aparece como linha própria no acompanhamento e na distribuição; os indicadores de desempenho (ROAS, ACOS, TACOS) continuam só com Product Ads.
- **FR-016**: O acompanhamento MUST mostrar, para o mês corrente (Brasília) e independentemente do período da tela: investimento até agora, orçamento, % gasto, % do mês decorrido, projeção de fechamento (investimento até ontem ÷ dias completos × dias do mês), saldo e valor diário disponível (saldo ÷ dias restantes, incluindo hoje).
- **FR-017**: MUST haver alerta quando a projeção passar do orçamento e quando ficar abaixo de 80% dele.
- **FR-018**: A distribuição sugerida MUST seguir, sobre o valor diário disponível: (0) a campanha de Seguidores recebe o seu gasto diário médio de 30 dias, limitado ao valor diário disponível, e o restante segue os passos abaixo; (1) 10% para até 5 modelos "Testar Ads" (os de maior margem), em partes iguais, sem teto; sem candidatos, os 10% voltam ao restante; (2) Pausar = 0, Reduzir = gasto diário médio de 30 dias × 0,7, Revisar anúncio = gasto diário médio de 30 dias; (3) Escalar e Manter dividem o restante na proporção do lucro depois do Ads positivo de 30 dias; (4) nenhum modelo de (3) recebe mais de 2× o seu gasto diário médio de 30 dias; o excedente é redistribuído e o que não couber fica como "sem destino".
- **FR-019**: No Mercado Livre a distribuição MUST ser somada por campanha (o modelo pertence à campanha em que mais gastou em 30 dias), com a linha "Nova campanha de teste" para os modelos de teste e a indicação de "mudar de campanha" quando a sugestão do modelo difere da sugestão predominante da campanha (a do modelo de maior investimento nela em 30 dias). Na Shopee, por anúncio.
- **FR-020**: Os percentuais e multiplicadores do FR-018 (10%, 5 modelos, 0,7, 2×) MUST ser editáveis junto com os limites do FR-013.

**Manual / Automático**

- **FR-021**: Cada modelo, campanha e anúncio MUST poder ser marcado como Manual (padrão) ou Automático por quem tem a nova permissão `editar_ads` (inicialmente admin e gestor), registrando quem e quando.
- **FR-022**: Nesta versão, Automático MUST apenas exibir "aguardando liberação"; o painel MUST NOT fazer nenhuma alteração nas contas de Ads de nenhum canal. A conexão com o Mercado Livre continua somente leitura.

**Dados**

- **FR-023**: A sincronização MUST passar a trazer, para o Mercado Livre, os dados das campanhas (nome, status, orçamento diário, ROAS objetivo, se é automática) e o status de cada anúncio patrocinado; falha nesses dados não pode interromper a sincronização de vendas.
- **FR-024**: Antes de o ramo ser juntado ao `main`, o investimento, os cliques e as vendas por Ads de outubro/2026 MUST ser conferidos contra o painel do Mercado Ads, com diferença de até 1% no investimento do mês. A conferência MUST acontecer até 31/01/2027 (a fonte guarda 90 dias).

### Key Entities

- **Métrica diária de anúncio**: por canal, anúncio e dia — impressões, cliques, investimento, vendas e unidades diretas/indiretas, unidades orgânicas, campanha, status do anúncio.
- **Campanha**: por canal — nome, status, orçamento diário, ACOS alvo.
- **Investimento diário por campanha**: a fonte conferida do gasto (já existe).
- **Orçamento de Ads**: por canal — valor mensal e data de vigência.
- **Parâmetros de Ads**: por canal — limites das sugestões e da distribuição, com vigência.
- **Modo do item**: por canal, tipo (modelo, campanha, anúncio) e chave — Manual ou Automático, quem e quando alterou.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: O investimento de outubro/2026 na tela Ads difere no máximo 1% do painel do Mercado Ads e é igual ao Product Ads da Visão Geral.
- **SC-002**: Em até 5 minutos na tela, o dono consegue dizer se o mês vai fechar dentro do orçamento e listar os modelos a pausar, reduzir e escalar.
- **SC-003**: 100% das sugestões exibidas trazem um motivo com os números que a justificam.
- **SC-004**: A soma da distribuição sugerida mais "sem destino" é igual ao valor diário disponível (diferença de no máximo R$ 0,01).
- **SC-005**: Um usuário sem a permissão de custos não obtém ACOS de equilíbrio, lucro nem distribuição, nem pela tela nem consultando os dados diretamente.
- **SC-006**: Nenhuma alteração é feita em contas de Ads durante esta versão (zero chamadas de gravação).
- **SC-007**: A tela abre em até 8 segundos para um período de 90 dias.

## Assumptions

- A sincronização atual de Ads do Mercado Livre por anúncio funciona; se a conferência (FR-024) falhar, a correção da coleta entra neste projeto antes das sugestões.
- O Product Ads está incluído nos custos rateados da Rentabilidade; por isso o ACOS de equilíbrio soma de volta essa parte (FR-006).
- Referência de outubro/2026 no Mercado Ads (prints do dono, 18/11): Product Ads investimento R$ 8.224, receita R$ 40.531, 75 vendas atribuídas, 19 outras vendas, 2.955 cliques, ACOS 20,29%, TACOS 16,97%; Seguidores R$ 539; 9 campanhas, orçamento diário configurado R$ 251 + R$ 17.
- Em campanhas **automáticas** o ML distribui a verba entre os anúncios; para elas a sugestão é só de orçamento da campanha, sem mover modelos.
- A Shopee só terá dados depois do projeto "Shopee completa"; até lá aparece sem dados, e o orçamento consolidado considera só o Mercado Livre.
- Os valores iniciais das regras (FR-011, FR-018) são propostas aceitas pelo dono e serão ajustados com o uso.
- O "dia" é o dia de Brasília, como no resto do painel.
- Dependência: permissões por perfil, parâmetros com vigência e a função de rentabilidade por modelo já existem no painel.
