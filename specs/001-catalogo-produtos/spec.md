# Feature Specification: Catálogo de produtos — ERP → site e Bling (fase 1)

**Feature Branch**: `001-catalogo-produtos`

**Created**: 2026-11-17

**Status**: Draft

**Input**: User description: "Catálogo de produtos (fase 1): aplicação que substitui o app MS Access e mantém site proprietário (banco SQL Server na AWS + fotos no S3), Bling e ERP NewFord com as mesmas informações de produto. Leitura diária do ERP (NewFord, SERPZERADO, bdb_pricing) pelo gateway, tela de revisão no painel com permissão "catalogo", envio de fotos pela tela, publicação pelo gateway (fila) no site (ambiente de teste primeiro) e no Bling via API v3. Fonte completa e decisões do dono: docs/superpowers/specs/2026-11-16-catalogo-produtos-design.md (com apoio em docs/catalogo/analise-access.md e docs/catalogo/esquema-origem.md). Pendentes do dono: formato atual dos SKUs no Bling (variação x produto simples) e SKU componente de kit; origem e preço das personalizações; se o site tem cache/API."

> Documento de origem com o detalhamento técnico e o histórico das decisões: `docs/superpowers/specs/2026-11-16-catalogo-produtos-design.md`. Esta especificação descreve **o quê** e **por quê**; o **como** fica para o plano.

## Clarifications

### Session 2026-11-17

- Q: Formato dos SKUs no Bling e SKU componente de kit → A: São produtos simples (manter assim, atualizando o mesmo cadastro). SKU FORA que é componente de kit de marketplace fica só Inativo e gera alerta.
- Q: Origem e preço das personalizações → A: Lista de personalizações do produto no NewFord; preço = preço de venda do ERP da linha do fornecedor 0 (como o Access faz hoje).
- Q: O site tem cache/API a acionar? → A: Não; a gravação no banco aparece na hora.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Revisar e publicar as mudanças diárias do ERP no site (Priority: P1)

Todo dia o sistema lê o ERP e prepara a lista do que mudou desde a última publicação: preços alterados, produtos e cores que saíram ou voltaram para a coleção, produtos novos e personalizações alteradas. A pessoa com permissão "Catálogo" abre a tela de revisão, confere o "antes e depois" de cada item e clica em **Publicar**. O site é atualizado em poucos minutos e a tela confirma o resultado.

**Why this priority**: É o problema central. Hoje nada roda sozinho: o preço é atualizado 25 produtos por clique, num programa lento instalado no computador do dono, e produtos fora da coleção continuam visíveis no site.

**Independent Test**: Alterar a margem de um produto no ERP. No dia seguinte o produto aparece em "Preços alterados" com o antes e depois de cada faixa. Depois de publicar, o site de teste mostra os preços novos.

**Acceptance Scenarios**:

1. **Given** um produto publicado cuja margem mudou no ERP, **When** a leitura diária termina, **Then** ele aparece em "Preços alterados" com o preço antigo e o novo de cada faixa de quantidade.
2. **Given** um produto que passou para FORA no ERP, **When** a mudança é publicada, **Then** o produto deixa de aparecer no site.
3. **Given** um produto em STANDBY no ERP, **When** a mudança é publicada, **Then** o produto deixa de aparecer no site.
4. **Given** uma cor que passou para FORA, **When** publicada, **Then** só essa cor fica indisponível no site e as outras cores do produto continuam.
5. **Given** uma cor em STANDBY, **When** publicada, **Then** só essa cor fica indisponível para compra no site.
6. **Given** uma publicação em andamento, **When** ocorre uma falha no meio de um produto, **Then** esse produto continua exatamente como estava antes (nunca fica sem preço), é marcado com erro e os demais produtos são publicados.
7. **Given** uma pessoa sem a permissão "Catálogo", **When** tenta abrir a tela ou publicar, **Then** o acesso é negado.

---

### User Story 2 - Cadastrar no site um produto novo do ERP, com fotos enviadas pela tela (Priority: P1)

Um produto entra na coleção no ERP. Ele aparece na lista "Novos no ERP" já com referência, cores, preços, personalizações, medidas e nome sugerido. A pessoa completa o que só existe para o site (nome comercial, descrição, categorias, quantidades sugeridas, caixas, prazo de produção), arrasta as fotos (principal, uma por cor e extras) e publica. O botão "Copiar de outro produto" preenche categorias, caixas, quantidades e personalizações a partir de um produto parecido.

**Why this priority**: Junto com a História 1, substitui o uso diário do Access. Hoje as fotos são renomeadas e enviadas à mão, e o cadastro em massa não funciona.

**Independent Test**: Cadastrar um produto novo com 3 cores, 1 foto principal, 3 fotos de cor e 2 extras. Após publicar, o produto aparece no site de teste com fotos, preços, cores e categorias corretos, e as fotos estão com os nomes do padrão.

**Acceptance Scenarios**:

1. **Given** um produto em Coleção no ERP que não está no site, **When** a leitura diária termina, **Then** ele aparece em "Novos no ERP" com os dados do ERP preenchidos e o nome sugerido (nome padronizado + referência).
2. **Given** a tela do produto, **When** a pessoa solta uma foto na área "Principal", **Then** ela é guardada com o nome `MODELO-capa`; uma nova foto principal substitui a anterior.
3. **Given** a área "Cores", **When** a pessoa solta uma foto no espaço de uma cor, **Then** ela é guardada com o SKU da cor como nome (uma foto por cor).
4. **Given** várias fotos na área "Extras", **When** a pessoa reordena ou exclui uma, **Then** os nomes `MODELO-a`, `MODELO-b`… são renumerados na ordem final.
5. **Given** um produto sem foto principal, sem nome, sem categoria, sem preço válido ou com uma cor ativa sem foto, **When** se tenta publicar, **Then** esse produto não é publicado e a tela mostra o motivo; os outros seguem.
6. **Given** a escolha de um produto parecido em "Copiar de outro produto", **When** confirmada, **Then** categorias, caixas, quantidades sugeridas e personalizações são preenchidas e continuam editáveis.

---

### User Story 3 - Manter o Bling igual ao site (Priority: P2)

Cada publicação também cadastra ou atualiza no Bling os SKUs do site (um por cor), com os dados fiscais e cadastrais, e aplica as mesmas regras de status: produto ou cor FORA vai para "Excluído", STANDBY vai para "Inativo". Produtos de marketplace e composições do Bling nunca são alterados.

**Why this priority**: O Bling emite as notas fiscais dos pedidos do site e dos marketplaces e será usado para compras. Hoje ele é alimentado por planilhas, com campos fiscais faltando ("NCM: colocar depois").

**Independent Test**: Publicar um produto novo com 2 cores. No Bling aparecem os 2 SKUs com nome, NCM, peso, medidas, fornecedor e foto. Depois de marcar uma cor como STANDBY no ERP e publicar, esse SKU fica Inativo no Bling.

**Acceptance Scenarios**:

1. **Given** um produto publicado com NCM, **When** a publicação chega ao Bling, **Then** cada SKU de cor existe no Bling com os dados do produto e o vínculo com a loja "Brinde do Bem - Comercial".
2. **Given** um produto sem NCM, **When** publicado, **Then** o site é atualizado e o envio ao Bling desse produto fica bloqueado com o alerta "sem NCM".
3. **Given** o Bling fora do ar, **When** a publicação roda, **Then** o site não é desfeito e os produtos ficam como "Bling pendente", reenviados na publicação seguinte.
4. **Given** um produto de marketplace ou uma composição no Bling que usa um SKU do site, **When** qualquer publicação roda, **Then** esse produto e essa composição não são alterados.
5. **Given** um produto ou cor FORA, **When** publicado, **Then** o SKU vai para "Excluído" no Bling. Se for STANDBY, vai para "Inativo".
6. **Given** um SKU FORA que é componente de um kit de marketplace, **When** publicado, **Then** ele fica apenas "Inativo" (não é excluído) e a revisão mostra um alerta para o dono decidir.
7. **Given** um SKU de cor que já existe no Bling como produto simples, **When** publicado, **Then** é atualizado no mesmo cadastro (mesmo identificador), sem virar variação nem ser recriado.

---

### User Story 4 - Trabalhar em equipe numa força-tarefa de cadastro (Priority: P3)

Em momentos de força-tarefa, várias pessoas com a permissão "Catálogo" editam produtos ao mesmo tempo, sem sobrescrever o trabalho uma da outra, e cada alteração fica registrada.

**Why this priority**: No uso normal uma pessoa só faz tudo. A força-tarefa acontece de vez em quando.

**Independent Test**: Duas pessoas abrem o mesmo produto. A segunda vê "Fulano está editando este produto" e, ao salvar depois da primeira, é avisada antes de sobrescrever. Duas publicações seguidas rodam uma após a outra.

**Acceptance Scenarios**:

1. **Given** um produto aberto por uma pessoa, **When** outra pessoa o abre, **Then** vê quem está editando.
2. **Given** duas pessoas que salvam o mesmo produto, **When** a segunda salva, **Then** é avisada de que houve mudança desde que abriu e escolhe recarregar ou sobrescrever.
3. **Given** uma publicação em andamento, **When** outra pessoa clica em Publicar, **Then** o novo pedido espera na fila e roda em seguida.
4. **Given** qualquer alteração ou publicação, **When** consultada depois, **Then** mostra quem fez, quando e o que mudou.

---

### User Story 5 - Ponto de partida sem redigitar nada (Priority: P1, pré-requisito)

Antes do primeiro uso, o sistema importa os produtos que já estão publicados no site (nomes, descrições, categorias, quantidades, caixas, fotos, cores, personalizações e destaques) e os IDs dos SKUs que já existem no Bling. A primeira revisão mostra as diferenças entre o que está no site e as regras novas (por exemplo, produtos FORA ainda visíveis), para serem corrigidas com revisão.

**Why this priority**: Sem isso a equipe teria que recadastrar centenas de produtos.

**Independent Test**: Depois da importação, 20 produtos escolhidos ao acaso mostram no Catálogo os mesmos dados que estão no site, e as fotos já existentes aparecem sem novo envio.

**Acceptance Scenarios**:

1. **Given** o site com produtos publicados, **When** a importação inicial roda, **Then** cada produto do site com referência no ERP aparece no Catálogo com seus dados atuais.
2. **Given** a importação concluída, **When** a primeira revisão é aberta, **Then** ela lista as diferenças em relação às regras novas sem aplicar nada automaticamente.

---

### Edge Cases

- **Produto que volta para Coleção** (estava FORA/STANDBY): reaparece na revisão como "reativação" e, ao publicar, volta a ficar visível no site e ativo no Bling.
- **Produto do site sem referência no ERP** (itens antigos): nunca é alterado.
- **Faixa de preço inválida** (custo zero ou negativo, margem nula ou maior ou igual a 100%): o produto é bloqueado com alerta e não é publicado.
- **Produto com mais de um conjunto de faixas no ERP**: vale o conjunto mais recente.
- **Personalização listada no ERP que não existe no site**: aparece como alerta e fica de fora até ser criada no site.
- **Nome alterado depois da publicação**: o endereço (link) do produto no site não muda.
- **Computador de publicação desligado**: o pedido de publicação fica na fila e roda quando ele voltar; a tela mostra "aguardando o computador de publicação".
- **Foto em formato diferente** (PNG/WEBP) ou muito grande: é convertida para o padrão do site; arquivos acima do limite são recusados com mensagem.
- **Leitura do ERP incompleta ou vazia**: não gera "desativação em massa"; a revisão do dia não é montada e o problema é avisado.
- **Registros referenciados por pedidos e orçamentos antigos** (produto, cor, personalização, foto): nunca são apagados, só inativados.

## Requirements *(mandatory)*

### Functional Requirements

**Leitura do ERP**
- **FR-001**: O sistema MUST ler do ERP uma vez por dia os produtos em Coleção, Standby e FORA, com cores e status, faixas de preço (custo e margem), quantidade mínima, peso, medidas, fornecedor, código no fornecedor, personalizações e seus preços, NCM e nome padronizado.
- **FR-002**: O sistema MUST acessar o ERP somente para leitura nesta fase.
- **FR-003**: Se a leitura do dia falhar ou vier incompleta, o sistema MUST manter a revisão anterior e avisar, sem interpretar a falta de dados como desativação.

**Regras de negócio**
- **FR-004**: O preço de cada faixa MUST ser `custo ÷ (1 − margem)` do ERP, arredondado em 2 casas, e a primeira faixa de cada produto MUST começar em 1 unidade.
- **FR-005**: Produto FORA ou STANDBY MUST ficar invisível no site. Cor FORA MUST ficar inativa e cor STANDBY indisponível, só aquela cor. Produto ou cor que volta para Coleção MUST voltar a ficar disponível.
- **FR-006**: As personalizações permitidas de cada produto MUST vir da lista de personalizações do produto no NewFord. O preço de cada personalização no site (único, por faixa de quantidade) MUST ser o preço de venda do ERP da linha do **fornecedor 0**, atualizado quando ele mudar.
- **FR-007**: O sistema MUST alterar somente produtos do site cuja referência existe no ERP e MUST NOT apagar produtos, cores, personalizações ou fotos referenciados por pedidos e orçamentos (só inativar).
- **FR-008**: O endereço do produto no site MUST ser definido no primeiro cadastro e não mudar depois.

**Catálogo e revisão**
- **FR-009**: O sistema MUST guardar os dados que só existem para o site: nome comercial, descrição, categorias, quantidades sugeridas, caixas e quantidade por caixa, prazo de produção, quantidade máxima, fotos e destaque na home. Os dados que vêm do ERP aparecem somente para leitura.
- **FR-010**: O sistema MUST mostrar uma revisão agrupada do que a próxima publicação fará, com "antes e depois" por item e preços comparados faixa a faixa. Grupos: novos, preços, textos e fotos, desativados e reativados, personalizações.
- **FR-011**: O sistema MUST bloquear a publicação de um produto, mostrando o motivo, quando faltar foto principal, foto de cor ativa, nome, categoria ou preço válido. A falta de NCM bloqueia só o envio ao Bling.
- **FR-012**: Os usuários MUST poder copiar categorias, caixas, quantidades e personalizações de outro produto e desmarcar personalizações vindas do ERP.
- **FR-013**: O acesso ao Catálogo, à revisão e à publicação MUST exigir a permissão "Catálogo", que pode ser dada a várias pessoas.

**Fotos**
- **FR-014**: Os usuários MUST poder enviar pela tela a foto principal (1 por produto, substituível), uma foto por cor e várias fotos extras, com reordenação e exclusão.
- **FR-015**: O sistema MUST nomear as fotos automaticamente: principal `MODELO-capa`, cor `SKU-da-cor`, extras `MODELO-a`, `MODELO-b`… na ordem definida. As fotos MUST ir para as pastas do site já existentes: principal, cores e extras.

**Publicação**
- **FR-016**: A publicação MUST acontecer só depois que uma pessoa com permissão clicar em Publicar (tudo ou produtos selecionados), e o resultado MUST aparecer na tela em até 10 minutos.
- **FR-017**: Cada produto MUST ser publicado de forma completa ou não ser alterado; uma falha num produto não impede os demais.
- **FR-018**: As publicações MUST rodar uma de cada vez, em fila.
- **FR-019**: A publicação MUST começar no ambiente de teste do site; a troca para produção MUST ser um passo explícito, feito depois de validada.
- **FR-020**: O sistema MUST registrar quem alterou e quem publicou o quê, e quando.
- **FR-021**: O sistema MUST avisar quando um produto é editado por outra pessoa e impedir que uma edição sobrescreva outra sem confirmação.

**Bling**
- **FR-022**: A publicação MUST cadastrar ou atualizar no Bling cada SKU de cor dos produtos publicados, com nome, unidade, NCM, origem, peso, medidas, fornecedor, código no fornecedor, descrições, foto, marca e loja "Brinde do Bem - Comercial".
- **FR-023**: No Bling, produto ou cor FORA MUST ir para "Excluído" e STANDBY MUST ir para "Inativo". Exceção: um SKU que é componente de um kit de marketplace MUST ficar só "Inativo", nunca "Excluído", e gerar um alerta na revisão.
- **FR-023a**: Os SKUs de cor MUST ser mantidos no Bling no formato em que já existem hoje (produtos simples), sempre atualizando o mesmo cadastro, sem recriar nem mudar o identificador. SKUs novos MUST ser criados também como produtos simples.
- **FR-024**: O sistema MUST NOT alterar produtos de marketplace nem composições no Bling.
- **FR-025**: Uma falha no Bling MUST NOT desfazer o site. O produto fica "Bling pendente" e é reenviado na próxima publicação.
- **FR-025a**: Enquanto o destino da publicação for o ambiente de teste do site, o envio ao Bling MUST ficar em modo **simulação**: nada é gravado no Bling; a tela mostra, por SKU, o que seria enviado (criar, atualizar, situação). O envio real ao Bling MUST ser ligado junto com a virada do site para produção.

**Carga inicial e segurança**
- **FR-026**: Antes do primeiro uso, o sistema MUST importar do site os dados atuais dos produtos e, do Bling, a identificação dos SKUs existentes (busca somente leitura por código, sem alterar nada). Antes de virar para produção, MUST comparar de novo com o site de produção.
- **FR-027**: Senhas e chaves de acesso ao banco do site, ao armazenamento de fotos e ao Bling MUST ficar guardadas de forma protegida, nunca em telas, registros ou documentos.
- **FR-028**: As atualizações MUST aparecer no site para os visitantes sem ação manual adicional. Segundo o dono, a gravação no banco do site aparece na hora (sem cache a limpar); isso é confirmado no primeiro teste no ambiente de teste.

### Key Entities

- **Produto do ERP (retrato diário)**: o que o ERP diz hoje sobre um modelo. Referência, status (Coleção, Standby ou FORA), quantidade mínima, peso, medidas, fornecedor, NCM e nome padronizado sugerido.
- **Cor/SKU**: variação de um produto. SKU, nome e código de cor, status, código no fornecedor e foto.
- **Faixa de preço**: quantidade inicial e final, custo, margem e preço de venda calculado.
- **Personalização**: tipo de gravação permitida para o produto, com seus preços por faixa.
- **Produto do Catálogo**: os dados que só existem para o site (nome comercial, descrição, categorias, quantidades sugeridas, caixas, prazo, quantidade máxima, destaque), ligados ao Produto do ERP pela referência.
- **Foto**: arquivo da foto principal, de cor ou extra, com nome padronizado e ordem.
- **Pedido de publicação**: quem pediu, quando, quais produtos, situação (na fila, publicando, concluído, com erro) e resultado por produto e destino (site, fotos, Bling).
- **Registro de alteração**: quem mudou o quê e quando.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: As mudanças do ERP aparecem na revisão todos os dias até às 07:00, sem ninguém iniciar nada.
- **SC-002**: Revisar e publicar as mudanças de um dia comum (até 50 produtos alterados) leva menos de 10 minutos de trabalho de uma pessoa. Hoje são muitos cliques de 25 em 25.
- **SC-003**: Cadastrar um produto novo com 3 cores e fotos, do ERP até o site, leva menos de 10 minutos.
- **SC-004**: 100% dos produtos FORA ou STANDBY no ERP ficam invisíveis no site depois da primeira publicação que os inclui.
- **SC-005**: Para 20 produtos conferidos, o preço de cada faixa no site é igual ao calculado a partir do ERP, com diferença máxima de R$ 0,01.
- **SC-006**: Nenhum produto fica sem preço ou pela metade no site por causa de uma publicação interrompida, inclusive em testes de falha provocada.
- **SC-007**: 100% dos SKUs publicados com NCM existem no Bling com os mesmos dados do site após a publicação.
- **SC-008**: Depois de um período em paralelo com o Access, o Access deixa de ser usado para produtos.

## Assumptions

- O site tem um ambiente de teste que espelha a produção e um usuário de banco com leitura e gravação. A publicação começa no teste.
- "Computador de publicação" = o gateway instalado na rede da empresa (mesmo programa que já envia os custos do ERP).
- A publicação é executada por um computador da rede da empresa que fica ligado. Se ele estiver desligado, a publicação espera.
- O ERP continua sendo o dono de referência, cores, status, custos, margens, medidas, fornecedores e personalizações. O Catálogo é o dono dos dados exclusivos do site.
- Categorias, caixas, atributos e valores de personalização continuam sendo criados no próprio site. O Catálogo apenas os utiliza.
- Nada é editado só no site: o Catálogo passa a ser a fonte para tudo o que é publicado.
- O campo que controla Standby no site é o informado pelo dono: `visible` para produto e `available`/`active` para cor.
- No Bling, o preço de venda continua sendo enviado como hoje (valor simbólico) até decisão do dono. O preço de custo usado é o custo da primeira faixa do ERP.
- Fora do escopo desta fase: gravar no ERP (precificação, cadastro, mudança de status, previstos para as fases 2 e 3), carrinho, pedidos e usuários do site, e as planilhas antigas do Bling (substituídas pela integração).
- O arquivo de princípios do projeto (`.specify/memory/constitution.md`) ainda é o modelo vazio. Não há princípios formais a validar.
