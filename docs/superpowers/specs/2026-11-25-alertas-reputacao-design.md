# Alertas de atraso e monitoramento da reputação (Mercado Livre)

Data: 25/11/2026. Status: rascunho para aprovação do dono. Ramo: `004-alertas-reputacao` (a partir do `main` e07e50a).

## Intenção
O dono precisa saber **com antecedência quais vendas correm risco de atrasar**, para ter tempo de produzir, personalizar e despachar. Atraso de despacho piora a reputação no Mercado Livre e pode custar a cor do termômetro. Também quer **acompanhar a reputação** (cor, reclamações, cancelamentos e despachos atrasados) para agir antes de perder o nível atual.

A antecedência não é a mesma para todos os anúncios: cada anúncio tem prazo e especificações próprias, e a personalização pesa na decisão. Por isso, a antecedência é definida **por grupo de anúncios**, e os grupos são criados pelo dono.

## Metas
- **Alerta de despacho:** venda ainda não postada cujo **prazo de despacho** do Mercado Livre vence dentro da antecedência do grupo do anúncio. Vendas com o prazo já vencido também aparecem, marcadas como "atrasada".
- **Alerta de entrega:** venda ainda não entregue cuja **data de entrega prometida ao comprador** vence dentro da antecedência do grupo. Primeiro aparecem as que ainda não foram despachadas.
- **Grupos de anúncios:** tela onde se cria um grupo (nome e antecedência em dias) e se coloca cada anúncio em um único grupo. O anúncio sem grupo usa o padrão de **4 dias**.
- **Reputação:** cor atual do termômetro e os três índices do Mercado Livre (reclamações, cancelamentos e despachos atrasados), cada um com o limite para não perder a cor atual. O índice fica destacado quando chega perto do limite. Um gráfico mostra a evolução.
- Um número em vermelho no menu lateral mostra quantos alertas estão abertos.
- Tudo é atualizado na sincronização que já existe, às 08h, 13h e 17h (horário de Brasília).

## Não-metas
- Envio por e-mail ou WhatsApp. O dono escolheu "só no painel" (opção A). Pode ser um projeto futuro.
- Shopee. Entra quando a integração da Shopee for liberada, com o mesmo desenho.
- Vendas Full. O dono não usa Full, então não há tratamento especial para elas.
- Alterar qualquer coisa no Mercado Livre, como prazo, status ou mensagem ao comprador. A conexão continua somente leitura.
- Grupo por variação do anúncio. O dono confirmou que a personalização não muda dentro do mesmo anúncio, então o grupo vale para o anúncio inteiro.

## Antiobjetivos (o que tornaria isto um fracasso)
- Uma lista que alerta tudo o tempo todo e passa a ser ignorada.
- Uma venda que atrasou sem nunca ter aparecido no alerta.
- Exibir alerta com um prazo errado: um prazo desconhecido não pode virar "sem risco" em silêncio.

## Restrições
- Segredos nunca são expostos (princípio I da constituição). Nada de token no navegador, nos logs ou nos arquivos.
- Conexão com o Mercado Livre somente leitura. ERP somente leitura.
- Os dados de pedidos ficam no banco. Exportações de diagnóstico vão para `diagnostico/`, que é ignorado pelo git.
- Plano gratuito. Nenhum serviço novo.
- Todo envio ao GitHub e todo merge no `main` exigem autorização do dono, a cada vez.

## Abordagens consideradas
1. **Escolhida: dentro da sincronização que já existe.**
   - Às 08h, 13h e 17h, a sincronização busca no Mercado Livre os prazos das vendas abertas e guarda uma foto da reputação.
   - O painel cruza cada venda com o grupo do anúncio e calcula o alerta.
   - Não exige nenhum serviço novo e segue o padrão do projeto.
2. **Avisos instantâneos do Mercado Livre (notificações de envio).** Mais rápido, mas exige um endereço público para receber os avisos, tratamento de repetição e mais pontos de falha. Com dias de folga, três atualizações por dia bastam. Descartada.
3. **Consulta direta ao Mercado Livre na hora de abrir a tela.** Lenta, presa ao limite de chamadas da API, e exigiria o token fora do servidor de sincronização. Descartada.

## Decisões do dono
- Os dois prazos, de despacho e de entrega, com o Mercado Livre como prioridade.
- Alertas só no painel (opção A).
- Antecedência por grupo de anúncios, com grupos criados pelo dono (opção 3).
- Padrão de 4 dias.
- O dono não usa Full.
- A personalização não varia dentro do mesmo anúncio, então o grupo é definido por anúncio.
- **A antecedência é contada em dias úteis** (segunda a sexta, sem feriados). Exemplo: prazo na segunda e antecedência de 4 dias úteis, o alerta aparece na terça anterior. Os feriados nacionais vêm cadastrados numa tabela, e o administrador pode acrescentar feriados locais em Parâmetros. A comparação é feita pela data no horário de Brasília.

## Chamadas minhas (a conferir pelo dono)
- **Mesma antecedência para os dois alertas.** O número do grupo vale tanto para despacho quanto para entrega.
- **Permissão nova `operacao`** para ver a tela "Alertas e Reputação".
  - Liberada por padrão para admin, gestor e comercial. O visualizador não vê.
  - Ajustável na tela de Permissões.
- **Edição dos grupos** pelos perfis admin e gestor, como as metas, por meio de uma permissão nova `editar_grupos`.
- **Quando um alerta sai da lista:** ao ser despachado (para o alerta de despacho), ao ser entregue (para o de entrega), ou quando a venda é cancelada. Não há botão "dispensar" nesta fase.
- **"Perto do limite"** quer dizer que o índice já chegou a **80%** do limite da cor atual. Esse percentual pode ser editado em Parâmetros pelo administrador.
- **Limites de reputação** ficam numa tabela de parâmetros, preenchida com os valores publicados pelo Mercado Livre, porque a API não informa os limites.
- **Histórico da reputação:** uma foto por sincronização, guardada para sempre (é pouco dado).
- **Layout da tela:**
  ```
  Alertas e Reputação                       Atualizado às 13:02
  [ Reputação: ● Verde   Reclamações 0,8% / 1%  ⚠  Cancel. 0,2% / 2%  Atrasos 3% / 10% ]
  Despacho em risco (5)   Entrega em risco (3)
  Venda | Anúncio | Grupo | Prazo | Faltam | Status do envio
  ```
  O gráfico da evolução da reputação fica abaixo da tabela.

- **Lista de entrega:** mostra todas as vendas não entregues que estão dentro da antecedência, despachadas ou não. A ordem é: primeiro as não despachadas, depois as com o prazo mais próximo.
- **Número no menu:** conta vendas distintas, sem repetir uma venda que esteja nas duas listas. Inclui as atrasadas e as de "prazo desconhecido".
- **Pedido com anúncios de grupos diferentes** (carrinho/pacote): vale a **maior** antecedência entre os itens, para nenhuma venda escapar do alerta. O alerta é por venda (envio), não por item.
- **Venda sem prazo do Mercado Envios** (por exemplo, "combinar com o comprador"): aparece como "prazo desconhecido", numa faixa separada no fim da lista.
- **"Despachada"** segue o mesmo critério da página "Para despachar" do Mercado Livre. Se o levantamento mostrar diferença, vale o critério do Mercado Livre.
- **Uma conta do Mercado Livre** (situação atual). A reputação e os grupos ficam ligados à conta, para não travar uma segunda conta no futuro.
- **Anúncios sem grupo** aparecem destacados na tela de grupos, com o aviso "usando o padrão de 4 dias". Um anúncio novo, ou um anúncio republicado com outro código, entra nessa lista.

## Deixado para quem constrói
- Quais campos do envio no Mercado Livre trazem cada prazo. A primeira tarefa do plano é confirmar isso com um levantamento em vendas reais e registrar o resultado. Se algum prazo não vier, a venda aparece como "prazo desconhecido", nunca como "sem risco".
- Quais vendas consultar a cada execução: as que ainda não foram entregues nem canceladas, com um limite de idade para não repetir consultas de vendas antigas.
- Nomes das tabelas e funções e numeração das migrations. As migrations 0020 a 0022 estão reservadas para a Shopee, então este projeto usa a partir da 0023. As migrations são reexecutáveis e os testes SQL usam PGlite, como no projeto de Ads.
- Testes do cálculo do alerta com casos de limite: exatamente no dia da antecedência, prazo já vencido, prazo desconhecido e anúncio sem grupo.

## Como fica a validação
- Comparar a lista de despacho em risco com a página "Vendas › Para despachar" do Mercado Livre em um dia real: as vendas e os prazos têm de bater.
- Comparar a cor e os três índices com a página de reputação do Mercado Livre no mesmo dia.
- O dono cria dois grupos com antecedências diferentes e confere que uma venda de cada grupo entra no alerta no dia certo.

## Adendo (26/11/2026): pedidos em produção
Confirmado pelo dono. A tela de vendas do Mercado Livre mostra, para pedidos em "Aguardando disponibilidade de estoque", a data "Você tem até o dia X para terminar o produto". Esse prazo é o que importa para os personalizados.

- **Prazo para terminar o produto:** se a API informar essa data, ela é usada. Caso não informe, a regra provisória é **2 dias antes da data de entrega prometida**, marcada como estimada. Hipótese levantada com dois pedidos (2 dias de diferença); a confirmação (dias corridos ou úteis) depende do levantamento com o terceiro pedido.
- **Alerta dos pedidos em produção:** dispara **4 dias úteis antes do prazo para terminar** (ou da antecedência do grupo do anúncio, quando houver).
- **Data de entrega ao comprador:** a data prometida que a API já devolve (`estimated_delivery_time`), exibida na tela.
- **Demais pedidos:** seguem com os alertas de despacho e de entrega já aprovados.
- **Pedidos em produção sem o prazo da API:** saem da regra "prazo desconhecido" e passam a usar a estimativa acima, com o rótulo "estimado".
