# Data Model — Catálogo de produtos (fase 1)

Convenções: `erp.cat_*` = retrato do ERP e do site gravado pelo gateway (substituído por inteiro a cada leitura); `catalogo.*` = dados do Catálogo (editados no painel) e controle de publicação. Todas as datas em `timestamptz`; o dia de referência é Brasília.

## 1. Retrato do ERP (gravado pelo gateway, `replace_source`)

### erp.cat_produtos — 1 linha por modelo
| Campo | Tipo | Regra / origem |
|---|---|---|
| ref | text PK | `upper(trim(Produtos.Referencia))` |
| id_produto_erp | uuid | `Produtos.IdProduto` |
| status | text | `colecao` \| `standby` \| `fora` (de `StatusColecao`) |
| descricao_erp | text | `Produtos.Descricao` |
| qtd_minima | int | `QtdMinima` |
| peso_kg | numeric(10,3) | `Peso` (sem arredondar) |
| largura, altura, comprimento, diametro | numeric | medidas |
| fornecedor_nome | text | fornecedor padrão |
| supplier_id_site | text null | `Fornecedores.supplierId` (casamento já gravado no ERP) |
| cod_fornecedor | text | `FornecedorProdutos.CodFornecedor` |
| ncm | text null | último NCM de entrada (`EstoquItemMov`) |
| nome_padrao | text null | `bdb_pricing.nomeReduzProd.nomeprod` |

### erp.cat_cores — 1 linha por SKU de cor (fornecedor padrão)
| Campo | Tipo | Regra |
|---|---|---|
| sku | text PK | `trim(FornecedorProdutosPorCor.s1_Cod)` |
| ref | text FK→cat_produtos | |
| status | text | `colecao` \| `standby` \| `fora` (de `IdStatus`: 1/2/3 *(confirmar mapeamento)*) |
| cor_nome, cor_abrev, cor_hex | text | `Cores` |
| cod_no_fornecedor | text | `CodNoFornecedor` |

### erp.cat_faixas — faixas de preço
| Campo | Tipo | Regra |
|---|---|---|
| ref | text | |
| qtd_ini, qtd_fin | int | `QtdeIni`, `QtdeFin` |
| custo | numeric(14,4) | `ValProd` |
| margem | numeric(8,6) | `Margem` (fração) |
| data_alt | timestamptz | `DataAlt` (para escolher o conjunto mais recente) |

### erp.cat_personalizacoes — personalizações permitidas por produto (NewFord)
`ref`, `value_id` (`PersonalizacaosProduto.s1_Cod`), `personalizacao`, `grupo`, `n_cores`.

### erp.cat_pers_precos — preço das personalizações (fornecedor 0)
`value_id`, `qtd_ini`, `qtd_fin`, `preco_venda` (`PersonalizacaosFormaPreco.ValVds`).

### erp.cat_site_* — referências do site (lidas do site, só leitura)
`cat_site_categorias(id, nome)`, `cat_site_caixas(id, nome, medidas)`, `cat_site_atributos(id, nome)`, `cat_site_values(id, attribute_type, nome)`, `cat_site_sessoes(id, nome)`. Na carga inicial (R9) também `cat_site_produtos`, `cat_site_*` dos vínculos atuais.

## 2. Catálogo (editado no painel)

### catalogo.produtos — dados do site por modelo
| Campo | Tipo | Regra |
|---|---|---|
| ref | text PK | = `erp.cat_produtos.ref` |
| nome | text not null | sugestão: `nome_padrao || ' ' || ref` |
| descricao | text not null | |
| slug | text null | definido na 1ª publicação; imutável depois (FR-008) |
| qtd_maxima | int default 20000 | |
| qtd_sugerida | int default 50 | |
| prazo_producao_dias | int | |
| sessao_home | text null | `viewSession.id` |
| versao | int not null default 1 | +1 a cada gravação (R7) |
| editando_por, editando_ate | uuid, timestamptz | presença (R7) |
| atualizado_por, atualizado_em | uuid, timestamptz | |

Listas ligadas (substituídas por inteiro ao salvar, dentro da mesma versão):
- `catalogo.produto_categorias(ref, categoria_id)`
- `catalogo.produto_quantidades(ref, qtd)`
- `catalogo.produto_caixas(ref, caixa_id, qtd_por_caixa)`
- `catalogo.produto_pers_excluidas(ref, value_id)`: personalizações do ERP desmarcadas (FR-012)

### catalogo.fotos
| Campo | Tipo | Regra |
|---|---|---|
| id | uuid PK | |
| ref | text | |
| tipo | text | `capa` \| `cor` \| `extra` |
| sku | text null | obrigatório se `tipo='cor'` |
| ordem | int | extras: 1..n (define a letra a, b, c…) |
| storage_path | text null | arquivo no Supabase Storage enquanto não publicado |
| s3_key | text null | chave publicada (ex. `extras/BMM240-b.jpg`) |
| situacao | text | `pendente` \| `publicada` \| `remover` |

Restrições: 1 `capa` por ref; 1 `cor` por sku; nome final derivado (FR-015): capa `img_produto/{REF}-capa.jpg`, cor `cores/{SKU}.jpg`, extra `extras/{REF}-{letra(ordem)}.jpg`.

## 3. Estado desejado e publicado

### catalogo.produto_desejado(ref) → jsonb (função)
Documento canônico: `{ ref, visivel, nome, slug, descricao, minQty, maxQty, suggestionQty, supplierId, externalId, peso, medidas, sessao, categorias[], quantidades[], caixas[], faixas[{qtyStart, qtyEnd, price}], cores[{sku, nome, hex, typeId, active, available, foto}], personalizacoes[{valueId, precos[]}], fotos{capa, extras[]}, bling{...} , alertas[] }`.
Regras aplicadas aqui:
- **Preço (FR-004)**: conjunto de faixas com maior `data_alt`; `price = round(custo/(1-margem), 2)` (meio para cima); 1ª faixa `qtyStart = 1`; faixa com `custo ≤ 0` ou `margem` nula ou `≥ 1` → alerta `preco_invalido`.
- **Status (FR-005)**: produto `fora|standby` → `visivel=false`; cor `fora` → `active=false`; cor `standby` → `available=false`; `colecao` → tudo `true`.
- **Bling (FR-023)**: produto/cor `fora` → `E`; `standby` → `I`; `colecao` → `A` (troca de `E` por `I` para SKU em kit acontece no gateway, R6).
- **Alertas (FR-011)**: `sem_capa`, `cor_sem_foto` (cor ativa), `sem_nome`, `sem_categoria`, `preco_invalido` (bloqueiam o produto); `sem_ncm` (bloqueia só Bling); `pers_inexistente_no_site` (informativo).

### catalogo.publicado
`ref` PK, `documento jsonb` (último documento aplicado com sucesso no site), `bling jsonb` (`{sku: {id_bling, situacao}}`), `publicado_em`, `publicado_por`.

### catalogo.revisao (view)
Por `ref`: `grupo` (`novo` \| `preco` \| `texto_foto` \| `desativado` \| `reativado` \| `personalizacao`), `antes jsonb`, `depois jsonb`, `alertas text[]`, `bloqueado bool`.

## 4. Publicação

### catalogo.publicacoes
| Campo | Tipo | Regra |
|---|---|---|
| id | bigserial PK | |
| destino | text | `site_teste` \| `site_producao` (configuração ativa) |
| situacao | text | `na_fila` → `publicando` → `concluida` \| `concluida_com_erros` \| `falhou` |
| pedido_por, pedido_em, inicio, fim | | |

Transições: só o gateway muda de `na_fila` para `publicando` (com `skip locked`); `publicando` há mais de 2 h volta a `na_fila`.

### catalogo.publicacao_itens
`publicacao_id`, `ref`, `documento jsonb` (congelado no clique), `fotos jsonb` (`[{s3_key, url_assinada}]`), `site` (`ok|erro|pulado`), `fotos_status`, `bling` (`ok|erro|pendente|bloqueado`), `erro text` (sem segredos), `concluido_em`.
Ao concluir com `site=ok`: `catalogo.publicado` ← documento; fotos `pendente` → `publicada` (storage apagado).

### catalogo.bling_componentes
`sku` PK, `kits text[]`, `atualizado_em` — cache de SKUs que são componentes de kits (R6).

### catalogo.alteracoes (auditoria, FR-020)
`id`, `ref`, `usuario`, `quando`, `campo`, `antes jsonb`, `depois jsonb`.

## Relações
`erp.cat_produtos 1—N erp.cat_cores / cat_faixas / cat_personalizacoes`; `catalogo.produtos 1—1 erp.cat_produtos` (por `ref`); `catalogo.produtos 1—N fotos, listas`; `publicacoes 1—N publicacao_itens`; `catalogo.publicado 1—1 produto`.
