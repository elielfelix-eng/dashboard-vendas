# Contrato: Bling API v3 (por SKU de cor) — *verificar endpoints no 1º contato*

Autenticação: `Authorization: Bearer <access_token>`. O token é renovado no início de cada `publish` com o refresh token (rotativo), sob trava.

| Passo | Chamada | Observação |
|---|---|---|
| Localizar | `GET /produtos?codigo={sku}` | usa o id já guardado em `catalogo.publicado.bling` quando existir |
| Criar | `POST /produtos` | só quando não existe; **formato simples** (FR-023a) |
| Atualizar | `PUT /produtos/{id}` | o mesmo id sempre |
| Situação | `PATCH /produtos/{id}/situacoes` `{ "situacao": "A" \| "I" \| "E" }` | `E` vira `I` se o SKU estiver em `catalogo.bling_componentes` |
| Kits | `GET /produtos?…` (formato composição) + `GET /produtos/{id}` (estrutura) | monta `bling_componentes` quando a publicação tem algum `E` |

Corpo (de `BASE_Import_BLING`):
- `codigo` = sku
- `nome` = `"{nome} Cor: {cor}"`, ou só `nome` quando a cor é PDR
- `tipo` = produto; `formato` = simples; `unidade` = "un"
- `preco` = 1; `precoCusto` = `ValProd` da 1ª faixa
- `pesoLiquido` e `pesoBruto` = peso; `dimensoes` = largura, altura, profundidade
- `tributacao`: `ncm`, `origem` = 2
- `fornecedor` + `codigoNoFornecedor`
- `descricaoCurta` = `<p>{nome}</p>`; `descricaoComplementar` = descrição
- `midia.imagens.externas` = [URL da foto da cor]
- `tipoProducao` = própria; tipo do item "Mercadoria para Revenda"
- marca/tag "BRINDE DO BEM"
- vínculo com a loja "Brinde do Bem - Comercial"

Limites: no máximo ~3 requisições/s. Em `429`, espera e tenta de novo (até 4 tentativas, com espera crescente). Nunca chamar endpoints de exclusão definitiva. Nunca alterar um produto cujo `codigo` não seja um SKU gerenciado.
