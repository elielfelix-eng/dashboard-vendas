# Projeto Shopee — integração completa e comparação com o Mercado Livre

Data: 24/11/2026. Status: rascunho para aprovação do dono.

## Intenção
Trazer para o painel os mesmos dados do Mercado Livre, quando a Shopee oferecer informação equivalente, e permitir três leituras: **Geral** (os dois canais somados), **Individual** (cada canal) e **Comparativa** (um ao lado do outro). O objetivo é ajudar a decidir **onde investir** em Ads, com base em **crescimento**, avaliado por canal antes da comparação.

## Metas
- Pedidos, vendas, tarifas, frete e custos da Shopee no painel, com as mesmas regras de margem e de custo do ERP que já valem para o Mercado Livre.
- Anúncios e Ads da Shopee (investimento, vendas por Ads, ACOS, ROAS, TACOS, orçamento mensal).
- Visões Geral, Individual e Comparativa, com os mesmos cards e tabelas do Mercado Livre.
- Sugestão por canal ("investir mais", "manter", "reduzir") com a regra visível.
- Percentuais da sugestão editáveis na tela de Parâmetros (só administrador).

## Não-metas
- Escrever na Shopee (preço, estoque, anúncio). O painel só lê.
- Automação de Ads na Shopee (o modo Manual/Automático continua sendo tarefa futura, como no Mercado Livre).

## Restrições
- Credenciais da Shopee só no GitHub Secrets e no servidor. Nunca no código, no chat ou nos logs.
- Conexão somente leitura, como a do Mercado Livre.
- ERP somente leitura.

## Abordagem escolhida
Reaproveitar a estrutura existente, com as mesmas tabelas e o canal `shopee`. Nada de sistema paralelo. As funções que hoje são só do Mercado Livre passam a aceitar o canal Shopee. (Escolha minha; o dono não pediu outra.)

## Dados
- **Antes de construir, levantar a cobertura real da API da Shopee.** Cada dado que o Mercado Livre traz é conferido: se a Shopee oferecer, entra; se não oferecer, sai, e o levantamento é registrado no documento. O dono pediu para eliminar no caminho o que não for possível.
- Histórico inicial: 12 meses, igual ao Mercado Livre.

## Visões
- **Geral:** soma dos canais que estiverem conectados.
- **Individual:** um canal por vez, com as mesmas abas do Mercado Livre.
- **Comparativa:** os dois canais lado a lado, em cards e em tabela, numa aba "Canais" da tela Comparativo que já existe (a comparação anual atual vira a aba "Anual"). Escolha do dono.

## Crescimento
Cada canal é calculado com os próprios números. A comparação é feita contra:
1. o **período anterior** de mesmo tamanho;
2. o **mesmo período do ano passado**.
Os dois aparecem lado a lado.

## Sugestão por canal (regra aprovada)
- **Investir mais:** vendas crescem **10% ou mais** nos dois comparativos **e** margem depois do Ads é positiva e não está caindo.
- **Reduzir:** vendas caem **10% ou mais** em qualquer comparativo, **ou** margem depois do Ads é negativa.
- **Manter:** qualquer outro caso.
- Percentuais (10%) editáveis em Parâmetros, por canal, com vigência, como os limites de Ads.
- A regra e os números que a dispararam aparecem junto da sugestão.
- A sugestão aparece só para quem tem acesso a custos, porque a regra usa a margem. Os demais veem o crescimento sem a sugestão. Escolha do dono.

## Permissões
As mesmas do Mercado Livre: visualização com `vendas`, `rentabilidade` e `ads`; custos só com `custos`; edição de parâmetros só pelo administrador.

## Itens de decisão do construtor (escolhas minhas, a conferir)
- Mapeamento do anúncio da Shopee para o modelo do ERP: pelo SKU, como no Mercado Livre, se a Shopee tiver SKU equivalente; se não tiver, o item aparece como "sem modelo".
- Tarifas e frete reais: pelo detalhe de pagamento (escrow) da Shopee, quando disponível; senão, estimativa, marcada como estimada.
- Shopee Ads (CPC): o formato de métrica é diferente do Mercado Livre; a conversão para investimento, cliques e vendas por anúncio segue o levantamento da API.

## Fora de escopo nesta fase
Modo Manual/Automático da Shopee, distribuição de orçamento entre produtos e campanhas (tarefa US4 do Ads, aplicada depois aos dois canais).

## Como fica a validação
Antes de liberar, o painel precisa bater com o painel da Shopee para um mês fechado (faturamento, pedidos e investimento em Ads), como foi feito com o Mercado Livre em outubro.
