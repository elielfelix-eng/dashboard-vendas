# Análise funcional do aplicativo Access de produtos (ERP → site)

Fonte analisada: `estrutura.txt` (tabelas vinculadas + 75 consultas) e `objetos/*.txt` (12 formulários com VBA + módulo `functions`).
Convenções: `dbo_*` = tabelas do site (banco `brindedobem`, DSN brindesvocacao); `NFORD_*` = ERP NewFord; `SERPZERADO_*` = ERP antigo; `temp*` = tabelas locais do Access.
Credenciais, usuários de banco e endereços de servidor/bucket foram omitidos (<credencial omitida>).

---

## 0. Resumo em 6 frases (para o dono)

1. Hoje o aplicativo **não sincroniza o site uma vez por dia**: não existe rotina automática (nenhum AutoExec, timer ou agendamento). Tudo acontece quando alguém abre uma tela e clica num botão.
2. Ele faz essencialmente **duas coisas**: (a) **cadastra produto novo** no site (um por vez, ou "em massa"); (b) **recalcula preços** de produtos já cadastrados, 25 por clique.
3. Para produtos **já existentes no site**, o app **não atualiza** nome, descrição, fotos, categorias, cores nem personalizações — só preço. Esses dados são gravados uma única vez, no cadastro.
4. "Tirar da coleção" marca o produto como fora **no ERP** (NewFord e SERPZERADO), mas **não esconde o produto no site** (`dbo_products.visible` não é alterado).
5. Fotos **não são enviadas** pelo app: ele só grava no site o *endereço* onde a foto deveria estar (padrão de nome no S3). Alguém precisa subir os arquivos à mão com o nome exato.
6. O preço de venda = custo do ERP (`FormaPrecoParceria`) ÷ (1 − margem), arredondado em 2 casas, por faixa de quantidade; mas há **duas fórmulas diferentes** (cadastro x atualização) — ver seção 3.

---

## 1. Visão geral — telas na ordem de uso

O app é um "backoffice de produtos" que lê o ERP NewFord e grava direto nas tabelas do site via ODBC. As telas:

| # | Formulário | Para que serve |
|---|---|---|
| 1 | **f_cadProd** (tela principal "Cadastro de produto") | Cadastrar **um** produto do ERP no site, com nome, descrição, categorias, quantidades sugeridas, caixas, cores, personalizações, fotos e preços. Também tem o botão **"Tirar da Coleção"** e permite mudar o status de cada cor. |
| 1a | └ f_categories (subform "Categorias") | Lista as categorias do site (`dbo_categories`) com caixa "Sel" e filtro por texto (`filCategoria`). Grava em `tempProductsCategories.select`. |
| 1b | └ f_productAttributesValues (subform "Personalização") | Grade para escolher atributos (`dbo_attributes`) e valores de personalização (`dbo_values` **sem** `supplierId`, filtrados pelo texto `filValue`). Grava em `tempAttributes`. |
| 1c | └ f_qtdSugestao (subform "Sugestões Qtd") | Lista fixa de quantidades (`tempqtySugestTabela`) com caixa "Sel" → vira `dbo_productsQuantities`. |
| 1d | └ f_productsBoxes (subform "Cubagem") | Escolher caixa (`dbo_boxes`) e quantidade por caixa → `tempProductsBoxes`. |
| 1e | └ fs_corProduto (subform "Cores") | Mostra as cores do produto no ERP (`NFORD_FornecedorProdutosPorCor`) e permite trocar o status da cor (combo `NFORD_StatusProduto`). **Escreve no ERP.** |
| 2 | **f_cadMassa** (+ subform fs_CadMassa_Prod) | "Cadastrar" em massa: pega produtos do ERP que ainda não existem no site e cadastra todos com valores padrão (categoria GERAL, sem caixas, sem escolha manual). |
| 3 | **f_atualizaPreco** (+ subform fs_productsPricesParaAtualizar) | Tela de revisão de preços: lista até 25 produtos cujo preço no site difere do calculado; botão "Atualiza" apaga e regrava as faixas de preço deles. |
| 4 | **f_manutencao_home** (+ subform fs_destaque) | Escolher uma "sessão" da home (`dbo_viewSession`) e ver/editar quais produtos estão nela (campo `dbo_products.sessionId`, editado direto na grade). |

Fora das telas, há ~40 consultas que o usuário roda à mão no painel do Access (Bling, personalização, diagnósticos) — ver seções 2, 4 e 6.

### Fluxo do botão "Cadastrar" em f_cadProd (`bt_cadastrar_Click`)
1. Usuário digita a referência (`filProduto`, ex. `BMM240`). `filProduto_AfterUpdate` valida: precisa existir em `NEWFORD_Produtos` (só produtos com `StatusColecao="Coleção"`) e **não** existir em `dbo_products`. Preenche: código no fornecedor, `minQty` (QtdMinima do ERP), `maxQty`=20000, `suggestionQty`=50, descrição (Descricao do ERP), `supplierId` (do site), peso, `U1_IDITE_FORD` (IdProduto do ERP). Mostra foto local `C:\SisProduto\img\<ref>.jpg`.
2. Usuário escolhe o "Nome do Produto" num combo vindo de **bdb_pricing.nomeReduzProd** (nome padronizado), edita a "Nova Descrição", marca categorias, quantidades, caixas, personalizações (ou copia de outro produto com "Copiar"/`filCopy`), informa prazo de produção (`deadline`).
3. Ao clicar: pergunta "vai ativar?" (→ `ativo`/`visible`), pede **quantidade de imagens extras** (InputBox; vazio/cancelar aborta tudo), pergunta "fez os ajustes na descrição?", valida campos obrigatórios e executa em sequência as consultas `01_` a `12_` (detalhadas na seção 2). Depois limpa as tabelas temp e o formulário.

### Fluxo do cadastro em massa (`f_cadMassa.bt_cadastrar_Click`)
`00_insertProductNew` → `01_intertProductsTodos` → `02_insertCategoryProdutoTodos` → `03_insertQtySugestTabelaTodos` → (`04` caixas **comentado**) → `05_base_productsImageTodos` → `order_tempProductImages` → `06_productsImage` → `07_productsImageIdenfy` → `08_base_ProdutoCorTodos` → `09_insertValuesTodos` → `10_insertAttributesTodos` → `order_tempProductAttributesValues` → `11_insertAttributeProductsValuesPers` → `12_insertProductsPricesTodos`.
**Atenção:** a lista de "produtos novos" (`CONS_ProdutoNovo`) está **fixa no código para um único produto (`BMM240`)** — na prática o cadastro em massa hoje só cadastra esse item (resto de teste).

---

## 2. Fluxo ERP → site, por entidade

### Chave de ligação ERP ↔ site (vale para tudo)
- **Produto:** `dbo_products.id` = `Trim(UCase(NFORD_Produtos.Referencia))` (ex. `BMM240`). Não há outro ID de ligação; `dbo_products.externalId` recebe o código do produto **no fornecedor**, não o ID do ERP. O GUID do ERP (`IdProduto`) não é gravado no site.
- **Cor (variação):** `dbo_values.id` = `Trim(FornecedorProdutosPorCor.s1_Cod)` (SKU da cor, ex. `BMM240-AZU ...`). A abreviação da cor é extraída do texto do SKU (após o "-").
- **Personalização:** `dbo_values.id` = código `s1_Cod` do ERP (`PersonalizacaosProduto.s1_Cod`) — os valores de personalização precisam **já existir** em `dbo_values` (o app não os cria).
- **Fornecedor:** `dbo_suppliers.id` obtido casando **por nome**: `NFORD_Fornecedores.Nome = dbo_suppliers.name` (consulta `NEWFORD_Produtos`). A consulta manual `ATUALIZA_suppliersId_Fornecedor` grava esse id de volta no ERP (`NFORD_Fornecedores.supplierId`).
- **Categoria, caixa, sessão da home:** IDs do próprio site; não vêm do ERP.

Consulta base do ERP: **`NEWFORD_Produtos`** = `Produtos` (só `StatusColecao="Coleção"`) ⨝ `FornecedorProdutos` (fornecedor padrão `Id_FornecedorPadrao`) ⨝ `Fornecedores` ⟕ `dbo_suppliers` (por nome). Expõe: id=Referencia, description=Descricao, minQty=QtdMinima, weight=Peso, width/height/length/diameter, idProdFornecedor=CodFornecedor, U1_IDITE_FORD=IdProduto, STPROD, Seque, etc.

### 2.1 Produto (`dbo_products`) — só INSERT
| Campo site | Cadastro unitário (`01_intertProducts`) | Cadastro em massa (`01_intertProductsTodos`) |
|---|---|---|
| id | `Trim(UCase(filProduto))` | `tempProductsNew.id` (Referencia) |
| name | nome escolhido (bdb_pricing) + " " + id → ex. "Caneca Térmica BMM240" | **Nome vindo da planilha `productsImages.xlsx`** (export do site antigo, `CONS_SITE_BdbUrlImages`) |
| description | texto "Nova Descrição" (editado à mão; inicia com `Produtos.Descricao`), `PlainText()` | `Produtos.Descricao` |
| urlImage | `<S3>/img_produto/<ref>-capa.jpg` | `<S3>/img_temp/<ref>-capa.jpg` |
| minQty / maxQty | QtdMinima do ERP (editável) / 20000 (editável) | QtdMinima / 20000 |
| suggestionQty | 50 (editável) | = minQty |
| supplierId | id do site via casamento por nome | idem |
| visible | resposta "vai ativar?" (0/1) | 0 (oculto) |
| slug | `lcase(replace(TiraAcento(nome) & " - " & id, " ", "_"))` | `lcase(replace(TiraAcento(nome), " ", "_"))` (sem id) |
| externalId | `[filRefForn]` — **controle inexistente** (o campo chama `filCodForn`), ver riscos | `FornecedorProdutos.CodFornecedor` |
| weight | `FormatNumber(Peso,0)` (arredonda para inteiro) | Peso |
| fixos | createdAt=Now, createdBy = nome de pessoa fixo no código, ordination=1, sessionId=Null, spotStockQty=0, stockMultiplier=10, detail=Null | idem |

Nenhuma consulta faz UPDATE de nome/descrição/foto de produto já existente.

### 2.2 Preço por faixa de quantidade (`dbo_productsPrices`)
- **Cadastro:** `12_insertProductsPrices` / `12_insertProductsPricesTodos` — uma linha por linha de `NFORD_FormaPrecoParceria` do produto: `qtyStart=QtdeIni`, `qtyEnd=QtdeFin`, `price=Round(ValProd/(1-Margem),2)`. Casamento por `Produtos.IdProduto = FormaPrecoParceria.IdProduto` e `Referencia`.
- **Atualização (tela f_atualizaPreco, `btAtualizar_Click`):**
  1. `producstPriceParaAtualizar` (TOP 25): compara, por produto, a **soma** dos preços no site (`productsPriceSum`) com a soma dos preços calculados (`formaprecoParceriaSum`). Se a soma diferir → precisa atualizar. Mostra também preço máximo e `Max(DataAlt)`.
  2. `ACRES_tempProductsPricesAtualizar` copia esses ≤25 ids para `tempProductsPricesAtualizar`.
  3. `LIMPA_productsPricesItem` **DELETA todas** as faixas desses produtos no site.
  4. `ACRES_productsPricesAtualizado` **reinsere** com a fórmula completa (seção 3).
- **Ajuste "a partir de 1 unidade" (manual):** `ACRES_productsPricesMin` (grava menor `qtyStart` de cada produto em `tempProductsPricesMin`) + `ATUALIZA_productsPricesMin` (muda essa primeira faixa para `qtyStart=1`). Não é chamado por nenhum botão; após "Atualiza", a 1ª faixa volta ao `QtdeIni` do ERP até alguém rodar isso à mão.
- Diagnóstico: `productsPriceNull` (produtos do site sem preço), `CONS_productsPrices` (preços calculados para produtos do site, só leitura).

### 2.3 Imagens (`dbo_productsImages` e `dbo_products.urlImage`) — só INSERT, só URL
Montadas por convenção de nome no bucket S3 do backoffice (endereço omitido):
| Tipo | Pasta/arquivo | Title | Order | Consulta |
|---|---|---|---|---|
| Capa | `img_produto/<ref>-capa.jpg` (massa: `img_temp/`) | `<REF>-CAPA` | 1 | `base_productsImageCapa(Todos)` |
| Uma por cor | `cores/<s1_cod>.jpg` (massa: `img_temp/<s1_cod>.jpg`) | `s1_Cod` | 2 | `base_productsImageProd(Todos)` — unitário só cores com `IdStatus=1`; massa todas |
| Extras | `extras/<ref>-a.jpg`, `-b.jpg`… (qtd. pedida no InputBox; `GerarLetras` cria a,b,c… em `tempImagesExtras`) | `<REF>-A`… | 3 | `base_productsImageExtras` (só unitário) |

Sequência: `05_base_productsImage` (union → `tempProductsImages`) → `order_tempProductImages` (VBA numera `order` 1..n linha a linha) → `06_productsImage` (INSERT no site) → `07_productsImageIdenfy` (lê de volta o `identify` que o site gerou, casando por productId+url+title) — esse `identify` é usado para ligar cada cor à sua foto (2.5).
O app **não verifica se o arquivo existe** no S3 nem faz upload. Foto local de referência: `C:\SisProduto\img\`.
`CONS_SITE_BdbUrlImages` lê URLs de imagem do site antigo (planilha), mas a URL calculada **não é usada** em nenhuma gravação (só o nome).

### 2.4 Categorias (`dbo_productsCategories`) — só INSERT
- Unitário: `02_insertCategoryProduto` grava as categorias marcadas (`tempProductsCategories.select=Yes`); `02_insertCategoryProduto_Clear` desmarca.
- Massa: `02_insertCategoryProdutoTodos` grava **só a categoria "GERAL"**.
- `ACRES_CatNova` (manual) acrescenta à lista local as categorias novas criadas no site. As categorias em si (`dbo_categories`) são mantidas fora do app.
- `CONS_categoryProducts` + `Consulta1` (função `ConcatenaAtributos`): relatório "produto → categorias concatenadas por >>".

### 2.5 Cores / atributos (`dbo_values` + `dbo_productsAttributesValues`, atributo `CORPRODUTO`) — só INSERT
- **Valores de cor** (`09_insertValues` / `09_insertValuesTodos`): uma linha por `FornecedorProdutosPorCor` do **fornecedor padrão**, com `CodNoFornecedor` preenchido, produto em "Coleção" e (unitário) `IdStatus=1`:
  `id=description=Trim(s1_Cod)`, `name = Cores.Cor` (DLookUp por `AbrevCor` extraída do SKU), `urlImage=<S3>/cores/<s1_cod>.jpg`, `supplierId` do site, `externalSupplierId=CodNoFornecedor`, `color = Cores.codhex`, `typeId = "image"` se codhex começa com "url", senão `"color"`.
- **Ligação produto↔cor** (`08_base_ProdutoCor(Todos)` → `tempProductsAttributesValues` → `11_insertAttributeProductsValuesPers`): `attributeId="CORPRODUTO"`, `valueId=s1_Cod`, `urlImage` da cor, `stock=0`, `deadline` = prazo digitado (massa: 10), `default = Sim só se o produto tem 1 cor` (contagem `CONS_ProdutoQtdCores`, que conta cores de **todos** os fornecedores/status), `available=active = (IdStatus=1)` (massa: sempre 1), `productImagesIdentify` = identify da foto da cor. `order` numerado pelo VBA `order_tempProductAttributesValues`.
- **Status da cor** (subform fs_corProduto): trocar o combo grava direto em `NFORD_FornecedorProdutosPorCor.IdStatus` (ERP) e roda `ATUALIZA_AtualizaStatusCor` → `SERPZERADO.ITEM.S1_INDVENDA` = 1 (status 1) ou 0 (status 2/3) para itens `S1_CODTDC='ORD'`. **O site não é atualizado** (`available/active` da cor ficam como no cadastro).

### 2.6 Personalização (atributos de gravação + preços de gravação)
- **Ligação produto↔personalização** (`dbo_productsAttributesValues` com atributos ≠ CORPRODUTO):
  - Unitário: escolha manual na grade (`tempAttributes`) ou cópia de outro produto (`ACRES_ProdCopyAttributes`: copia todos os atributos não-cor do produto `filCopy`). `10_insertAttributes`: `default=1` só para a 1ª linha, `available=active=1`. Depois `11_...` grava no site.
  - Massa: `10_insertAttributesTodos` deduz as personalizações da **estrutura de produto do SERPZERADO** (`CONS_EstruturaProd`: ITEM acabado → PRODTECNICO → PRODCOMP → PRODINSUMO → item/grupo de personalização), só as que já existem em `dbo_values`, com `attributeId = "PERSNALIZACAO"` (grafia com erro — confirmar se é o id real no site).
- **Preço da gravação** (`dbo_valuesPrices`) — manual, só INSERT: `CONS_newPers` → `ACRES_newPers_producsPrices`. Para cada `dbo_values.id` que **ainda não tem nenhum preço**, junta `NFORD_PersonalizacaosProduto` (s1_Cod = valueId) com `NFORD_PersonalizacaosFormaPreco` por (fornecedor [nulo→0], personalização, grupo, nº de cores) e grava `startQty=QtdIni`, `endQty=QtdFin`, `price=FormatNumber(ValVds,2)`. Valores que já têm preço **nunca são atualizados**. `CONS_persPreco` e `valuesPrices_PERS` (só fornecedor 0) são visualizações.
- O app não cria atributos (`dbo_attributes`) nem valores de personalização em `dbo_values`; isso é feito fora.

### 2.7 Caixas / cubagem (`dbo_productsBoxes`) — só INSERT, unitário
`04_insertProductsBoxes`: grava (productId, boxId, qty) das linhas digitadas em f_productsBoxes. Massa: comentado (produto fica sem caixa). As caixas (`dbo_boxes`) são mantidas fora. A planilha `Cubagens de Produtos.xlsx` só aparece em `Consulta2` (lista produtos SPOTGIFTS da planilha que não estão no site) — auxiliar.

### 2.8 Destaque / home (`dbo_products.sessionId`)
f_manutencao_home: combo `sessionFil` (`dbo_viewSession`), subform fs_destaque lista `dbo_products` com aquele `sessionId` e permite editar o `sessionId` na própria grade (gravação direta no site). `a_produto_home` (sessionId=4 para a linha atual) existe mas não está ligada a botão. Não há vínculo com o ERP. Não há como **incluir** um produto numa sessão pela tela (a grade só mostra os que já estão na sessão) — só mover/retirar.

### 2.9 Quantidade sugerida (`dbo_productsQuantities` e `dbo_products.suggestionQty`) — só INSERT
- Unitário: `03_insertQtySugestTabela` grava as quantidades marcadas em `tempqtySugestTabela` (lista local).
- Massa: `03_insertQtySugestTabelaTodos` grava sempre **50, 100, 200, 300, 500, 1000**.
- `suggestionQty`: 50 (unitário, editável) ou `minQty` (massa). Diagnóstico: `CONS_productsQuantitiesNull`.

### 2.10 Desativação
- "Tirar da Coleção" (`Bt_tirarColecao_Click`): `ATUALIZA_AtualizaStatusProd` → `SERPZERADO.ITEM.S1_INDVENDA="0"` para todos os itens do modelo (`S2_MODELO=ref`, `ORD`); `ATUALIZA_AtualizaStatusProdFORD` → `NFORD_Produtos.StatusColecao="FORA"`.
- **Nada é feito no site**: `dbo_products.visible` continua 1, preços/cores continuam. A única forma de ocultar é editar o site por fora. O app também nunca apaga produtos, imagens, categorias ou cores do site.
- Status de cor: ver 2.5 (só ERP).

### 2.11 Resumo INSERT / UPDATE / DELETE no site
| Tabela do site | Insert | Update | Delete |
|---|---|---|---|
| products | cadastro | só `sessionId` (home) | — |
| productsPrices | cadastro + atualização | `qtyStart=1` (manual) | sim, antes de reinserir (≤25 produtos/clique) |
| productsImages, productsCategories, productsQuantities, productsBoxes, productsAttributesValues, values | cadastro | — | — |
| valuesPrices | manual (só valores sem preço) | — | — |

Escritas no **ERP** a partir do app: `NFORD_FornecedorProdutosPorCor.IdStatus`, `NFORD_Produtos.StatusColecao`, `NFORD_Fornecedores.supplierId`, `SERPZERADO.ITEM.S1_INDVENDA`.

---

## 3. Regra de preço

Origem do custo: **`NewFord.dbo.FormaPrecoParceria`** (uma linha por produto × faixa de quantidade). Colunas usadas: `IdProduto`, `QtdeIni`, `QtdeFin`, `ValProd`, `ValSN`, `FatorPSN`, `Margem`, `DataAlt`. O app **não lê `Cotacoes`** diretamente; `IdCotacao`/`IdCotaPers`/`ValPers`/`ValorVenda`/`AtuPreco`/`Tipo`/`DiferencaMargem`/`IdPrecificacaoItem` são ignorados. Ou seja, o custo por faixa e a margem **já vêm prontos do ERP**; o Access só aplica a divisão.

**Fórmula A — cadastro** (`12_insertProductsPrices`, `12_insertProductsPricesTodos`, `CONS_productsPrices`):
```
preço = Round( ValProd / (1 − Margem), 2 )
```

**Fórmula B — atualização e comparação** (`ACRES_productsPricesAtualizado`, `formaprecoParceriaSum`):
```
SN = ValSN / FatorPSN
base = se ValProd > 0:
          se SN > 0: menor entre ValProd e SN
          senão:     ValProd
       senão: SN
preço = Round( base / (1 − Margem), 2 )
```
- `Margem` é fração (ex. 0,35 = 35% sobre o preço de venda — markup "por dentro").
- Faixas: exatamente `QtdeIni`–`QtdeFin` do ERP; opcionalmente a 1ª faixa vira `qtyStart=1` (`ATUALIZA_productsPricesMin`, manual).
- Arredondamento: `Round(...,2)` do Access (arredondamento bancário).
- **Não há preço mínimo**, piso, arredondamento comercial (ex. ,90), frete ou imposto adicional no Access.
- Detecção de mudança: compara **somas** de preços por produto (não faixa a faixa); limita a 25 produtos por vez.

**Preço de personalização** (`CONS_newPers` / `ACRES_newPers_producsPrices`): usa `PersonalizacaosFormaPreco.ValVds` direto (preço de venda já calculado no ERP; `CustoPer` e `Margem` dessa tabela não são usados), por faixa `QtdIni`–`QtdFin`, chave (fornecedor, personalização, grupo, nº de cores).

---

## 4. Dependências fora do ERP NewFord

| Fonte | O que é usado | Para quê | Classificação |
|---|---|---|---|
| **bdb_pricing.nomeReduzProd** (DSN bdb_pricing) | `nomeprod`, `txtRef`, `prodModelo` | Combo "Nome do Produto" (nome padronizado que vira `dbo_products.name`/slug) e nome do arquivo da foto de referência local | **Essencial** no cadastro unitário (nome do site) |
| **SERPZERADO** (outro ERP) | `ITEM`, `PRODTECNICO`, `PRODCOMP`, `PRODINSUMO` | Estrutura do produto → personalizações no cadastro em massa (`CONS_EstruturaProd`); flag de venda `S1_INDVENDA` ao desativar produto/cor | Importante (massa + desativação). `AGEMP`/`FORNECEDOR` só em `CONS_Fornecedor` (consulta solta) → não usado |
| **productsImages.xlsx** (`SITE_BdbProducts`) | Código, Nome, Imagens | Nome do produto no cadastro em massa (`CONS_SITE_BdbUrlImages`) | Essencial **só** para cadastro em massa; parece export do site antigo → legado |
| productsImages.csv (`SITE_BdbProducts1`) | — | nenhum uso | Morto |
| **produtosBling.xlsx** (`Base_Bling`, `ProdutoBling`), **ESTRUTURA_ML.xlsx** (`BLING_ESTRUTURA_ML`), tabela local `tblProdutosBling` | Export de produtos do Bling | Gerar planilhas de importação no Bling (um SKU por cor, NCM do ERP): `BASE_Import_BLING`, `Cons_ExportBling`, `CONS_AtualizaProdBlingTotal`, `CONS_BlingAtualizaNCM`, `CONS_blingCores`, `CONS_BlingEstrutura`, `CONS_BlingId(_Componente)`. NCM vem de `NEWFORD_NCM` (último NCM de entrada em `EstoquItemMov`) | Processo **paralelo** site→Bling, manual, com filtros fixos (BLA142, BMS130, bla114). `tblProdutosBling` sem uso |
| **Cubagens de Produtos.xlsx** | Produto | Só `Consulta2` (lista de pendências SPOTGIFTS) | Auxiliar/legado |
| Pasta local `C:\SisProduto\img\` | fotos `.jpg` | Pré-visualização na tela | Conveniência |
| Bucket S3 do backoffice | pastas `img_produto/`, `cores/`, `extras/`, `img_temp/` | Destino das fotos (upload manual) | Essencial |
| Tabelas do site de carrinho/orçamento/pagamento/usuários (`cart*`, `budgetCart*`, `payment*`, `users`, `salesMan`, `negotiationArea`, `productsViewSessionHistory`) | — | Só `Consulta4` (depuração de um orçamento) | Não usadas; vínculo desnecessário (e expõe dados sensíveis) |

Tabelas do NewFord vinculadas mas **não usadas**: `CorProdutos`, `Personalizacaos`, `PersonalizacaosAgrupamento`, `PersonalizacaosGrupo`. Usadas: `Produtos`, `FornecedorProdutos`, `FornecedorProdutosPorCor`, `Fornecedores`, `Cores`, `StatusProduto`, `FormaPrecoParceria`, `PersonalizacaosProduto`, `PersonalizacaosFormaPreco`, `EstoquItemMov` (só NCM p/ Bling).

---

## 5. Etapas manuais hoje

1. **Decidir quais produtos entram no site** e digitar a referência um a um (a consulta `Produtos não cadastrado` ajuda a ver pendências, mas é aberta à mão).
2. **Escolher o nome padronizado** (lista do bdb_pricing) e **reescrever a descrição** ("Nova Descrição"); o app pergunta se a descrição foi ajustada.
3. **Marcar categorias** (lista do site), **quantidades sugeridas**, **caixas e qtd por caixa**, **prazo de produção**, **personalizações** (ou escolher produto-modelo para copiar).
4. Decidir se o produto já entra **ativo/visível**.
5. **Fotos:** tratar e **subir manualmente no S3** com os nomes exatos `<ref>-capa.jpg`, `<sku-cor>.jpg`, `<ref>-a.jpg`…; informar quantas fotos extras existem. Nada confere se subiram.
6. **Preços:** abrir f_atualizaPreco, revisar a lista (máx. 25) e clicar "Atualiza" repetidas vezes até zerar; depois rodar à mão `ACRES_productsPricesMin` + `ATUALIZA_productsPricesMin` (faixa a partir de 1) — se alguém lembrar.
7. **Preços de personalização novos:** rodar à mão `ACRES_newPers_producsPrices`. Criar valores/atributos de personalização no site é feito fora do app.
8. **Categorias novas no site:** rodar `ACRES_CatNova` para aparecerem na lista.
9. **Fornecedor novo:** cadastrar com o **mesmo nome** no site e no ERP e rodar `ATUALIZA_suppliersId_Fornecedor`.
10. **Destaques da home:** editar `sessionId` na grade.
11. **Desativar no site:** feito fora do app (o botão só mexe no ERP).
12. **Bling:** exportar planilha do Bling, salvar no caminho fixo, rodar a consulta certa e importar o resultado no Bling.

---

## 6. Problemas e riscos observados

### Desempenho (por que é lento)
- **Junções entre bancos diferentes feitas no PC**: quase toda consulta mistura tabelas do ERP (NewFord, rede local), do site (AWS) e tabelas locais/Excel. O Access não consegue mandar isso para o servidor → baixa tabelas inteiras pela rede e junta localmente. Ex.: `producstPriceParaAtualizar` soma **todos** os `productsPrices` do site e **toda** a `FormaPrecoParceria` a cada abertura da tela; `BASE_Import_BLING` junta 6 fontes; `NEWFORD_Produtos` junta ERP com `dbo_suppliers` do site.
- **Funções do Access dentro de consultas** (`Trim`, `UCase`, `PlainText`, `DLookUp`, `IIf`, `Replace`) em colunas de junção/filtro impedem uso de índice e forçam processamento local. `09_insertValues` faz **3 DLookUp por linha** em `NFORD_Cores`.
- **Laços linha a linha** sobre tabelas (`order_tempProductImages`, `order_tempProductAttributesValues`, `ConcatenaAtributos` chamado por produto em `Consulta1`, `GerarLetras`).
- `07_productsImageIdenfy` faz UPDATE de tabela local juntando com a tabela remota de imagens do site (lê a tabela inteira).
- Cada `DoCmd.OpenQuery` de ação abre confirmações e roda isolado; ~15 ida-e-volta por cadastro.

### Lógica frágil / bugs
- **Desativar não desativa o site** (2.10) e mudar status de cor não reflete no site (2.5).
- **Duas fórmulas de preço** (3): um produto recém-cadastrado pela fórmula A aparece como "a atualizar" sempre que `ValSN/FatorPSN < ValProd`. `FatorPSN = 0` causa divisão por zero.
- Detecção de preço alterado **por soma**: mudanças que se compensam passam despercebidas; mudança só na faixa (QtdeIni/Fin) não é detectada.
- **Atualização de preço sem transação**: apaga tudo e reinsere; se o insert falhar, o produto fica **sem preço** no site. A 1ª faixa volta a não começar em 1.
- `TOP 25` na tela de preços: precisa clicar várias vezes; sem ordenação definida.
- `CONS_ProdutoNovo` com **filtro fixo `id="BMM240"`** → cadastro em massa só processa esse item.
- `01_intertProducts` usa `[Formulários]![f_cadProd]![filRefForn]`, **controle que não existe** (o real é `filCodForn`) → Access pede parâmetro ou grava nulo em `externalId`.
- Cadastro em massa: nome vem de planilha do site antigo; imagens apontam para `img_temp/`; categoria só GERAL; sem caixas; produto oculto; `attributeId="PERSNALIZACAO"` (provável erro de grafia).
- Extração da cor do SKU com `Mid/InStr` (posição do "-" e do primeiro espaço) — quebra se o padrão do código mudar; `typeId` decidido por "codhex começa com 'url'".
- `default` da cor só quando o produto tem exatamente 1 cor (contando todos os fornecedores/status) → produtos com várias cores ficam sem cor padrão.
- **Fornecedor casado por nome** (`Fornecedores.Nome = suppliers.name`): qualquer diferença de grafia → `supplierId` nulo.
- `FormatNumber(...)` usado para gravar números (minQty, maxQty, weight, preço de personalização): gera **texto com separador de milhar** dependente do Windows (pt-BR); `weight` arredondado para inteiro (0,25 kg vira 0?).
- INSERTs sem checar existência: reexecutar (ou cor/valor já existente) gera erro de chave e o Access descarta linhas silenciosamente após aviso.
- Se o usuário cancela/deixa vazio o InputBox de "imagens extras", **o cadastro inteiro é abortado** sem aviso (tem que digitar 0).
- `ProximoID` não usa o prefixo; `numerarSQL` com variável estática.
- Caminhos fixos: `D:\BRINDE DO BEM\...xlsx`, `C:\SisProduto\img\` → só funciona no PC do dono.
- `createdBy` fixo com o nome de uma pessoa.

### Segurança
- ERP vinculado com **conta administrativa** do SQL Server <credencial omitida>; o app tem poder de escrita total no ERP.
- Site vinculado com usuário pessoal <credencial omitida>, inclusive tabelas `users` (com coluna de senha), `payment` e carrinhos que o app não precisa.

### Código/consultas mortas ou de depuração
`Consulta1`, `Consulta2`, `Consulta4`, `Corrige_ValueId`, `Corrige_Values`, `CONS_Fornecedor`, `CONS_persPreco`, `valuesPrices_PERS`, `CONS_productsPrices`, `a_produto_home`, `SITE_BdbProducts1`, `tblProdutosBling`, botão `bt_teste`, função `order_tempProductAttributesValuesPers` (em f_productAttributesValues), funções `VerificaPalavra`, `ProximoID`, `numerarSQL`, subrotina `Imgfil_1` usa coluna de imagem do bdb_pricing. Tabelas vinculadas sem uso listadas na seção 4.

---

## 7. Perguntas em aberto para o dono (mais importantes primeiro)

1. **Atualização diária:** o app hoje só cadastra novos e atualiza preço. Quais campos de produtos **já publicados** devem ser sobrescritos diariamente a partir do ERP (nome, descrição, fotos, categorias, cores, personalização, peso, qtd mínima)? E quais são "editoriais" (ajustados à mão no site) e **não podem** ser sobrescritos?
2. **Desativação:** quando um produto sai da coleção (ou uma cor muda de status) no ERP, o site deve ocultar (`visible=0` / `available=0`) automaticamente? E se o produto voltar?
3. **Qual a fórmula de preço correta** — A (só `ValProd`) ou B (menor entre `ValProd` e `ValSN/FatorPSN`)? O que significam `ValSN` e `FatorPSN`? Existe preço mínimo ou arredondamento comercial? A 1ª faixa deve sempre começar em 1 unidade?
4. **Fonte da verdade do custo:** `FormaPrecoParceria` é sempre recalculada a partir de `Cotacoes` pelo ERP? Com que frequência? A coluna `AtuPreco`/`ValorVenda` deveria ser usada?
5. **SERPZERADO** ainda é usado em produção (estrutura de personalização e flag de venda) ou foi substituído pelo NewFord? Se sim, onde fica no NewFord a estrutura "produto → personalizações permitidas"?
6. **Nome do produto:** o nome padronizado do `bdb_pricing.nomeReduzProd` deve continuar sendo a fonte? Ou o ERP passará a ter esse campo (`DescricaoCatalogo`?) — e a "Nova Descrição" editada à mão deve ficar guardada em algum lugar?
7. **Fotos:** quem sobe as fotos no S3 e com qual padrão? O novo sistema deve fazer o upload e conferir se a foto existe antes de publicar?
8. **Categorias e caixas:** há regra automática possível (por grupo/prefixo do ERP, por dimensões) ou continuam escolha manual na tela de revisão?
9. **Personalização:** os valores/atributos de personalização (`dbo_values` sem fornecedor, `dbo_attributes`) e seus preços devem ser **atualizados** quando o ERP muda `ValVds`? O id correto do atributo é `PERSNALIZACAO` ou outro?
10. **Bling:** a geração de planilhas para o Bling ainda é necessária? Faz parte do novo sistema ou será descartada?
