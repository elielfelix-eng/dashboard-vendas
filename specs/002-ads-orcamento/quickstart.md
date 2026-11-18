# Quickstart — conferir Ads e Orçamento

Pré-requisitos:
- migrations 0018 e 0019 aplicadas no Supabase, coladas em ordem no SQL Editor;
- ação "Sincronizacao de dados" rodada pelo menos uma vez depois do deploy;
- um usuário de cada perfil para os testes de permissão.

Testes automáticos: `npm run test:sql`, `npm run test:web` e `npm run typecheck`.

## Cenário 1 — Coleta por anúncio bate com a fonte (FR-024, SC-001) — fazer até 31/01/2027
No SQL Editor:
```sql
select 'campanha' fonte, sum(cost) from mkt.ads_campaign_daily
 where channel='mercadolivre' and day between '2026-10-01' and '2026-10-31'
union all
select 'anuncio', sum(cost) from mkt.ads_metrics_daily
 where channel='mercadolivre' and day between '2026-10-01' and '2026-10-31';
```
**Esperado:** as duas linhas ficam a até 1% uma da outra e do total de outubro no painel do Mercado Ads (Publicidade → Product Ads → período 01–31/10).

Referência anotada em 18/11 (prints do dono): investimento **R$ 8.224**, receita **R$ 40.531**, vendas atribuídas **75**, outras vendas **19**, cliques **2.955**, ACOS **20,29%**. Seguidores: **R$ 539** (fora desta consulta; entra no orçamento, FR-015a).
- Conferir também cliques e vendas no painel.
- Se não bater, seguir research R8 antes de liberar as sugestões.

## Cenário 2 — Campanhas e status chegaram (FR-023)
```sql
select campaign_id, name, status, budget from mkt.ads_campaigns where channel='mercadolivre';
select status, count(*) from mkt.ads_anuncios where channel='mercadolivre' group by 1;
```
**Esperado:** as campanhas aparecem com os mesmos nomes do Mercado Ads, e a contagem de anúncios ativos e pausados bate com o painel.

## Cenário 3 — Cartões iguais à Visão Geral (FR-003)
Na tela Ads, com Mercado Livre e outubro/2026, o **Investimento** é igual ao Product Ads da Visão Geral no mesmo período. A soma da tabela por modelo mais a linha "não atribuído" é igual ao Investimento.

## Cenário 4 — ACOS de equilíbrio confere com a Rentabilidade (FR-006)
Escolher um modelo. Na Rentabilidade, anotar a contribuição, a receita e os custos rateados.
**Esperado:** ACOS de equilíbrio ≈ (contribuição + parte do Ads rateada + Ads de fatura do modelo) ÷ receita. O roteiro detalhado fica em "Como calculamos", na própria tela.

## Cenário 5 — Sugestões (FR-011)
Em 5 modelos com sugestões diferentes, conferir que o motivo mostra números que batem com as colunas da linha.

## Cenário 6 — Orçamento do mês (FR-016, FR-017)
Comparar o gasto do mês até ontem com o painel do Mercado Ads (mês corrente).
**Esperado:** a projeção é igual a gasto até ontem ÷ dias completos × dias do mês, e os alertas aparecem conforme as regras.

## Cenário 7 — Distribuição (FR-018, SC-004)
**Esperado:** soma dos valores diários + "sem destino" = valor diário disponível. Modelos em Pausar recebem 0, e modelos de teste aparecem em "Nova campanha de teste".

## Cenário 8 — Permissões (FR-009, SC-005)
Entrar como **comercial**.
**Esperado:**
- vê os cartões e o ACOS;
- ACOS de equilíbrio, lucro e distribuição aparecem vazios;
- a chave Manual/Automático aparece, mas não pode ser alterada;
- como **visualizador**, a tela Ads não aparece no menu.

## Cenário 9 — Manual/Automático não altera nada (FR-022, SC-006)
Como gestor, marcar uma campanha como Automático.
**Esperado:** aparece "aguardando liberação"; nada muda no Mercado Ads (conferir o orçamento da campanha no painel antes e depois).

## Cenário 10 — Desempenho (SC-007)
Com 90 dias, Consolidado, a tela abre em até 8 s logada como gestor.
