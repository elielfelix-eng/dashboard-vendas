# Contrato: gravação de um produto no banco do site

Entrada: o documento congelado (data-model §3). Uma transação (`SET XACT_ABORT ON; BEGIN TRAN … COMMIT`) por produto. Nomes das colunas: `docs/catalogo/esquema-origem.md`. Origem da regra antiga: `docs/catalogo/analise-access.md`, seção 2.

| Tabela | Operação | Chave | Campos |
|---|---|---|---|
| `products` | upsert | `id = ref` | name, description, urlImage (capa), minQty, maxQty, suggestionQty, supplierId, visible, externalId (código no fornecedor), weight (sem arredondar), sessionId. **slug só no insert**. Colunas fixas do Access no insert: createdAt, createdBy = usuário que publicou, ordination 1, spotStockQty 0, stockMultiplier 10. updatedAt e updatedBy no update |
| `productsPrices` | apaga e insere | productId | qtyStart, qtyEnd, price |
| `productsQuantities` | apaga e insere | productId | qty |
| `productsCategories` | apaga e insere | productId | categoryId |
| `productsBoxes` | apaga e insere | productId | boxId, qty |
| `productsImages` | upsert por (productId, url); as que saíram ficam `active = 0` / `deletedAt` | productId, url | title, order (capa 1, cores 2, extras 3…). `identify` é lido com `OUTPUT inserted.identify` |
| `values` (cores) | upsert | `id = sku` | name, description = sku, urlImage, supplierId, externalSupplierId, color (hex), typeId (`image` se o hex começa com `url`, senão `color`) |
| `productsAttributesValues` | upsert por (productId, attributeId, valueId) | | cor: `attributeId = 'CORPRODUTO'`, active, available, urlImage, productImagesIdentify, order, default (1ª cor ativa), deadline. Personalização: `attributeId` = o do `values` existente, active/available = 1; as excluídas ficam active = 0 |
| `valuesPrices` | apaga e insere, só dos value_ids de personalização do produto | valueId | startQty, endQty, price |

Regras:
- Produtos **sem referência no ERP** nunca são tocados. A transação começa com a checagem `products.id = ref` ou insert (FR-007).
- Nunca há DELETE em `products`, `values`, `productsAttributesValues` ou `productsImages`.
- Se o `value_id` de uma personalização não existe no site, ele é pulado. A pendência é registrada como o alerta `pers_inexistente_no_site`.
