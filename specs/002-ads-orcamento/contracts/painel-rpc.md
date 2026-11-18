# Contrato: funções chamadas pela tela Ads

Todas ficam no schema `analytics` (exposto na Data API), são `security invoker` e têm `set search_path = ''`. Valem a RLS das tabelas `mkt.*`, `core.can_see_channel`, `core.has_perm('ads')` e `core.has_perm('custos')`.
- Sem `ads`: todas devolvem zero linhas. Exceção: `ads_resumo`, que devolve uma linha zerada, como `dash_resumo`.
- `p_canal`: `consolidado` | `mercadolivre` | `shopee`.

| Função | Retorno | Regras |
|---|---|---|
| `ads_resumo(p_canal, p_de, p_ate)` | 1 linha: `investimento, vendas_ads, roas, acos, tacos, pct_vendas_ads, vendas_brutas_canal, nao_atribuido, tem_detalhe` | `investimento` = mesmo critério de `dash_ads_periodo`; `vendas_brutas_canal` = de `dash_resumo`; `tem_detalhe` = há dados por anúncio no período. A tela chama de novo para o período anterior |
| `ads_serie(p_canal, p_de, p_ate)` | `dia, investimento, vendas_ads` | investimento por dia da fonte conferida |
| `ads_modelos(p_canal, p_de, p_ate)` | `modelo, produto, foto, investimento, impressoes, cliques, ctr, cpc, conversao, vendas_ads, unidades_ads, acos, acos_equilibrio*, lucro_pos_ads*, contribuicao_pct*, sugestao, motivo, pausado, campanha_id, modo` | métricas do período; sugestão sobre 30 dias até `p_ate`; linha final `modelo = null` = "não atribuído a anúncio". (*) nulos sem `custos` |
| `ads_campanhas(p_canal, p_de, p_ate)` | `campanha_id, nome, status, orcamento_diario, investimento, vendas_ads, acos, roas, modelos, modo` | |
| `ads_orcamento(p_canal, p_hoje date default null)` | 1 linha por canal conectado + `consolidado` quando `p_canal='consolidado'`: campos do data-model §3 "Orçamento do mês" | `p_hoje` nulo = hoje em Brasília |
| `ads_distribuicao(p_canal, p_hoje date default null)` | `canal, nivel ('campanha'\|'modelo'\|'anuncio'\|'nova_campanha_teste'\|'sem_destino'), chave, nome, sugestao, valor_diario, gasto_medio_30d, mudar_campanha, modo` | zero linhas sem `custos` |

## Escrita

| Função | Schema | Regras |
|---|---|---|
| `ads_definir_modo(p_channel, p_tipo, p_chave, p_modo)` | `core` (definer) | exige `editar_ads` e canal visível; `modo='manual'` apaga a linha; registra `alterado_por/em`; erro com mensagem simples se não tiver permissão |
| `orcamento_ads`, `parametros_ads` | `core` (tabelas) | insert/update pelo admin via RLS (tela Parâmetros) |

## Erros
Mensagens ao usuário nunca expõem SQL nem segredos. As chamadas tipadas em `apps/web/lib/ads.ts` repetem o padrão de `lib/dash.ts`: registram o erro no log e mostram "Não foi possível carregar os dados agora".
