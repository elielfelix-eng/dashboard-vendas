# Catálogo de produtos — ERP → site e Bling (fase 1)

Data: 16/11/2026 · Status: aguardando revisão do dono
Material de apoio (no repositório): `docs/catalogo/analise-access.md` (o que o Access faz hoje, regra a regra) e `docs/catalogo/esquema-origem.md` (colunas das tabelas do site, do NewFord, do SERPZERADO e do bdb_pricing).

## 1. Por que e para quê

O cadastro e a atualização dos produtos do site são feitos hoje por um aplicativo **MS Access** que roda no computador do dono. Ele é **lento** (junta, no PC, dados do ERP na rede local, do banco do site na AWS e de planilhas Excel), **manual** (nada roda sozinho; o preço é atualizado 25 produtos por clique) e **incompleto**:
- produto já publicado só tem o preço atualizado;
- "Tirar da Coleção" não oculta o produto no site;
- as fotos são enviadas à mão para o S3;
- o Bling é alimentado por planilhas.

A nova aplicação substitui o Access e faz **site, Bling e ERP mostrarem as mesmas informações de produto**:
- **1 vez por dia** ela lê o ERP;
- mostra numa **tela de revisão** o que mudou;
- depois da aprovação de uma pessoa, **publica** no site (banco + fotos no S3) e no Bling.

Fases:
- **Fase 1 (esta spec):** consumir o ERP e atualizar o site e o Bling, com tela de revisão e envio de fotos.
- **Fase 2 (depois):** módulo de **precificação**.
- **Fase 3 (depois):** **cadastro do produto no ERP** pela aplicação. Exige gravar no ERP, com usuário e segurança próprios.

### Decisões do dono (16/11/2026)
- O site é proprietário, com banco na AWS. Existe um **ambiente de teste**, espelho da produção: começar por ele e só depois apontar para a produção. Já existe um usuário de leitura e gravação no banco do site.
- Atualizar **todos os dados do produto**: preço, nome, descrição, fotos, categorias, produtos novos, desativação e personalização. **Nada é editado só no site**.
- Frequência: **1x ao dia**.
- Preço de venda = **ValProd ÷ (1 − Margem)** por faixa de quantidade da tabela `FormaPrecoParceria` do ERP.
- **Caminho A:** a aplicação guarda os dados "do site" que não existem no ERP (nome comercial, descrição revisada, categorias, caixas, quantidades sugeridas, fotos, destaques). O ERP continua dono dos dados dele.
- A publicação roda no **computador do gateway**, na rede da empresa.
- **SERPZERADO** e **bdb_pricing** continuam em uso.
- A tela de revisão é usada por **outras pessoas**. Uma permissão única, "Catálogo", **edita e publica**. Várias pessoas podem tê-la ao mesmo tempo (força-tarefa de cadastro).
- **Fotos enviadas pela tela**, com várias por produto, no padrão do S3 (seção 6).
- O **Bling entra no projeto**. Ele é usado para notas fiscais, pedidos do site e dos marketplaces e, em breve, compras. Os produtos de marketplace são **diferentes** dos do site e usam os SKUs do site como **componentes (composição)**. Quando o SKU é o mesmo, as informações também são iguais. Não há risco de conflito.
- Regras de status (seção 5).

### Não-objetivos (fase 1)
- Gravar no ERP. O Access grava `StatusColecao`, status de cor e `S1_INDVENDA` no ERP; isso fica para a fase 3, e até lá é feito no próprio ERP.
- Mexer em produtos de marketplace ou em composições no Bling.
- Carrinho, orçamentos, pedidos, usuários e pagamentos do site. O Access vincula essas tabelas sem precisar; a nova aplicação **não lê nem grava** nelas.
- Criar categorias, caixas, atributos ou valores de personalização no site. Eles continuam sendo mantidos no site; a aplicação só os **usa**.
- Planilhas de importação do Bling (substituídas pela API).

### Anti-objetivos (seria fracasso mesmo funcionando)
- Um produto ficar **sem preço** ou pela metade no site por causa de uma publicação interrompida.
- Publicar no site ou no Bling **sem a revisão** de uma pessoa.
- Tocar em produto de marketplace no Bling, ou apagar dado do site que a aplicação não gerencia.
- Senha ou chave em código, log, chat ou planilha.

## 2. Arquitetura (o caminho escolhido)

```
ERP NewFord ─┐
SERPZERADO ──┼─(leitura, 1x/dia)─► Gateway (PC da rede) ─► Supabase (schema catalogo)
bdb_pricing ─┘                                            │
                                                          ▼
                                   Painel (Next.js/Vercel): Catálogo → editar, fotos, revisar, Publicar
                                                          │ (pedido de publicação na fila)
                                                          ▼
                    Gateway (confere a fila a cada ~5 min) ─► banco do site (teste → produção)
                                                          ├─► S3 (fotos)
                                                          └─► Bling API v3
```

**Alternativas consideradas:**
- **Painel grava direto no banco da AWS:** descartada, porque exigiria abrir o banco do site para a internet, e o dono preferiu o computador do gateway.
- **Painel manda uma ordem ao gateway:** descartada, porque exigiria abrir uma porta de entrada na rede da empresa.

**Escolhida:** o gateway **busca** os pedidos de publicação. Usa só conexões de saída, como já faz hoje. Custo: a publicação leva até ~5 min e depende do computador do gateway estar ligado.

Reaproveita o que já existe: o gateway (`gateway/`, Python, cofre de segredos DPAPI, **tarefa agendada** do Windows — hoje 3x/dia; para a fila de publicação passa a rodar também a cada ~5 min, só conferindo se há pedido —, usuário de leitura no ERP), o painel (login, perfis, `core.role_permissions`, RLS) e o padrão OAuth do Mercado Livre (para o Bling).

## 3. Quem é dono de cada dado

| Dado | Dono | Observação |
|---|---|---|
| Referência/modelo (`Produtos.Referencia`), SKUs das cores (`FornecedorProdutosPorCor.s1_Cod`), cor e código hex (`Cores`) | ERP | chave de tudo: `products.id` = referência em maiúsculas sem espaços |
| Status do produto (`StatusColecao`) e da cor (`IdStatus`) | ERP | define ativo/inativo (seção 5) |
| Faixas de preço: `QtdeIni`, `QtdeFin`, `ValProd`, `Margem` (`FormaPrecoParceria`) | ERP | preço = `ValProd/(1−Margem)` |
| Quantidade mínima, peso, medidas, fornecedor padrão, código no fornecedor | ERP | |
| Personalizações permitidas e seus preços (`PersonalizacaosProduto`, `PersonalizacaosFormaPreco.ValVds`; estrutura no SERPZERADO) | ERP | |
| NCM (último NCM de entrada em `EstoquItemMov`) | ERP | obrigatório para o Bling |
| Nome padronizado sugerido (`bdb_pricing.nomeReduzProd`) | bdb_pricing | sugestão inicial do nome |
| Nome comercial, descrição revisada, categorias, quantidades sugeridas, caixas/cubagem, prazo de produção, fotos, destaque na home, qtd. máxima | **Aplicação (Catálogo)** | editado na tela; carga inicial vinda do site atual |

A tela mostra os campos do ERP **somente para leitura**, com a indicação "vem do ERP".

## 4. Leitura diária (gateway → Supabase)

- O gateway ganha datasets novos, todos lidos por **views em schemas de leitura**, no mesmo padrão de `painel.faixas_custo`. O usuário de leitura só enxerga essas views.
  - NewFord: produtos em **Coleção, Standby e FORA** (o FORA é lido para poder ocultar; "sumiu da leitura" não é tratado como FORA), com as cores e o status de cada uma; faixas de `FormaPrecoParceria`; personalizações e seus preços; NCM; fornecedores.
  - SERPZERADO: estrutura de personalização por produto.
  - bdb_pricing: `nomeReduzProd`.
- Horário: **1x por dia, de madrugada (05:00)**, sem mexer nos envios de custo que já existem (07:45/12:45/16:45). Proposta.
- Destino: tabelas de "foto do ERP" no schema `catalogo` do Supabase, substituídas por inteiro a cada leitura (modo `replace_source` do gateway).
- Ao terminar a leitura, o banco calcula as **diferenças** entre o que está publicado e o que deveria estar (seção 7) e a tela de revisão se atualiza.

## 5. Regras de status (definidas pelo dono)

| Situação no ERP | Site | Bling |
|---|---|---|
| **Produto FORA** | `products.visible = 0` (o produto inteiro fica inativo) | produto e variações → **Excluído** |
| **Produto STANDBY** | `products.visible = 0` | produto e variações → **Inativo** |
| **Cor FORA** | `productsAttributesValues.active = 0` (só essa cor) | variação (SKU da cor) → **Excluído** |
| **Cor STANDBY** | `productsAttributesValues.available = 0` (só essa cor) | variação → **Inativo** |
| Volta para **Coleção** (produto ou cor) | `visible`/`active`/`available` = 1 | → **Ativo** (proposta; ver seção 12) |

Interpretação a confirmar: nas linhas de **cor**, o texto do dono dizia "inativa todo produto". Entendi que só **aquela cor** fica inativa. O segundo "STANDBY Produto" do texto foi lido como "STANDBY cor".

## 6. Fotos

| Pasta no S3 | Conteúdo | Nome do arquivo | Quantidade |
|---|---|---|---|
| `img_produto` | foto principal | `MODELO-capa.jpg` | 1 por produto, substituível |
| `cores` | foto da cor | `<SKU da cor>.jpg` | 1 por cor |
| `extras` | fotos adicionais | `MODELO-a.jpg`, `MODELO-b.jpg`, … | várias, em ordem |

- Na tela do produto há três áreas: *Principal*, *Cores* (um espaço por SKU vindo do ERP) e *Extras*. Elas aceitam arrastar e soltar; as Extras permitem reordenar e excluir.
- **O nome é gerado pela aplicação.** Ninguém renomeia arquivo. Nas extras, ao reordenar ou excluir, as letras são renumeradas (a, b, c…) na próxima publicação.
- O arquivo fica guardado no painel (Supabase Storage) até a publicação. **Quem grava no S3 é o gateway**, porque a chave do S3 fica só lá.
- PNG/WEBP são convertidos para JPG. Tamanho máximo de envio: 10 MB por arquivo (proposta).
- No site, cada foto vira uma linha em `productsImages` (capa ordem 1, cores ordem 2, extras ordem 3…). A capa também vai em `products.urlImage`, e a foto da cor em `values.urlImage` e `productsAttributesValues.urlImage`/`productImagesIdentify`, como o Access faz hoje. Detalhe em `analise-access.md`, seções 2.3 e 2.5.
- Na carga inicial, as fotos que já estão no S3 são **referenciadas** pelos endereços atuais, sem novo envio.

## 7. Revisão e publicação

### Tela "Catálogo" (permissão nova `catalogo`)
- **Lista de produtos** com busca e filtros:
  - todos;
  - "Novos no ERP": produtos em Coleção ainda não publicados;
  - "Com alterações";
  - "Com alertas";
  - "Inativos".
- **Tela do produto:**
  - os dados do ERP, somente para leitura;
  - os campos da aplicação: nome (sugestão: nome do bdb_pricing + " " + referência, como hoje), descrição, categorias, quantidades sugeridas, caixas e quantidade por caixa, prazo de produção, quantidade máxima, destaque na home;
  - as personalizações vindas do ERP, com a possibilidade de **desmarcar** alguma;
  - as fotos;
  - o botão **"Copiar de outro produto"**, que copia categorias, caixas, quantidades e personalizações.
- **Revisão:** um resumo do que a próxima publicação vai fazer, agrupado. Cada item pode ser aberto para ver o **antes e depois**:
  - produtos novos;
  - preços alterados, comparados **faixa a faixa** e não pela soma, como no Access;
  - textos e fotos alterados;
  - produtos e cores desativados ou reativados;
  - personalizações alteradas.
- **Alertas que bloqueiam a publicação daquele produto** (os outros seguem):
  - sem foto principal;
  - cor ativa sem foto;
  - sem nenhuma faixa de preço válida (`ValProd` ≤ 0 ou `Margem` ≥ 1 ou nula);
  - nome vazio;
  - sem categoria;
  - **sem NCM**: bloqueia só o envio ao Bling.
- **Publicar:** escolhe tudo ou produtos selecionados e cria um **pedido de publicação** na fila. A tela mostra "Na fila", "Publicando…" e, ao final, "Publicado às 14:32 — site ✓ fotos ✓ Bling ✓".
- **Várias pessoas ao mesmo tempo:**
  - aviso "Fulano está editando este produto";
  - o segundo a salvar é avisado antes de sobrescrever (controle de versão por produto);
  - **uma publicação por vez**, e as demais esperam na fila;
  - registro de quem alterou o quê e quando.

### Preço (regra fixa da fase 1)
- Para cada faixa da `FormaPrecoParceria` do produto: `price = arredonda(ValProd / (1 − Margem), 2)`, `qtyStart = QtdeIni`, `qtyEnd = QtdeFin`.
- A **primeira faixa** de cada produto começa em **1 unidade** (`qtyStart = 1`). O Access fazia isso com uma consulta manual. Proposta, a confirmar.
- Arredondamento: meio para cima (comercial), em 2 casas. O Access usava o arredondamento bancário do VBA, e a diferença máxima é R$ 0,01 em alguns casos.
- Personalizações permitidas: lista de `PersonalizacaosProduto` no **NewFord**, e não a estrutura do SERPZERADO (resposta do dono em 17/11).
- Preço de personalização (`valuesPrices`) = `PersonalizacaosFormaPreco.ValVds` por faixa, da linha do **fornecedor 0** (como o Access faz hoje), **atualizado** sempre que mudar. O Access só gravava uma vez.
- O site **não tem cache** a limpar: a gravação no banco aparece na hora (resposta do dono em 17/11; confirmar no 1º teste).

### Publicação no site (gateway)
- Cada pedido é aplicado no banco do site **numa transação por produto**: se algo falha, aquele produto volta ao estado anterior e é marcado com erro, e os demais seguem.
- Tabelas gravadas (insert/update/delete **só das linhas que a aplicação gerencia**):
  - `products`: id, name, slug, description, urlImage, minQty, maxQty, suggestionQty, supplierId, visible, externalId, weight, sessionId e demais colunas fixas como no Access;
  - `productsPrices`;
  - `productsQuantities`;
  - `productsImages`;
  - `productsCategories`;
  - `productsBoxes`;
  - `values` das cores, com `typeId` color/image e `color` hex;
  - `productsAttributesValues`, nos atributos `CORPRODUTO` e de personalização;
  - `valuesPrices` das personalizações.
- **O que a aplicação gerencia no site** (decisão do construtor, marcada como tal): só produtos cujo `id` é uma referência do ERP. Produtos do site sem referência no ERP (antigos, SPOTGIFTS etc.) **não são tocados**.
- **Nunca apagar de verdade** linhas que pedidos/orçamentos possam referenciar (`products`, `values`, `productsAttributesValues`, `productsImages`): usar os campos de inativação (`visible`, `active`/`available`, `productsImages.active`/`deletedAt`). Apagar e regravar só listas sem histórico (`productsPrices`, `productsQuantities`, `productsCategories`, `productsBoxes`, `valuesPrices`), dentro da transação do produto. (Decisão do construtor.)
- **Slug:** gerado só na criação do produto e depois **mantido**, mesmo que o nome mude, para não quebrar links e posição no Google. (Decisão do construtor.)
- **`FormaPrecoParceria` com várias versões:** antes do plano, conferir nos dados se um produto pode ter mais de um conjunto de faixas (`Tipo`, `DataAlt`, `IdPrecificacaoItem`); se puder, usar o conjunto mais recente e registrar a regra. (Para o construtor.)
- Correções de falhas do Access: o `externalId` passa a ser o código no fornecedor de verdade; o peso não é mais arredondado para inteiro; números são gravados como números e não como texto formatado.
- **Ambientes:** a conexão de destino (teste ou produção) fica na configuração do gateway. A fase 1 começa **só no teste**. A troca para produção é um passo explícito e documentado.

### Publicação no Bling (API v3, OAuth)
- Conexão única, pelo botão **"Conectar Bling"** no painel (mesmo padrão do Mercado Livre). Os tokens ficam guardados criptografados.
- Cada **SKU de cor** é um **produto simples** no Bling, que é o formato em que já existem hoje (resposta do dono em 17/11). A aplicação atualiza sempre o mesmo cadastro, sem recriar nem transformar em variação, porque os kits de marketplace apontam para esses IDs. SKUs novos também são criados como produto simples. Um SKU FORA que é componente de um kit fica só **Inativo**, nunca Excluído, e gera alerta na revisão. Os dados vêm do Access (`analise-access.md` seção 4 e a consulta `BASE_Import_BLING`):
  - nome "Produto Cor: Azul" (sem "Cor:" quando a cor é PDR);
  - unidade "un", NCM, origem 2;
  - peso líquido e bruto, medidas;
  - fornecedor e código no fornecedor;
  - descrição curta e complementar;
  - foto da cor por URL;
  - tag "Marca: BRINDE DO BEM";
  - tipo "Mercadoria para Revenda", produção "Própria";
  - vínculo com a loja **"Brinde do Bem - Comercial"**;
  - preço 1 e estoque 0 (como hoje; ver seção 12).
- **Preço de custo:** enviado a partir do custo do ERP, como preparação para o uso do Bling em compras (proposta).
- O casamento com produtos já existentes no Bling é **pelo código (SKU)**. A aplicação guarda o ID do Bling de cada SKU.
- Nunca altera produto cujo código não seja um modelo ou SKU de cor gerenciado pela aplicação. Nunca altera composições.
- Se o Bling falhar, o site **não é desfeito**. O produto fica "Bling pendente" e é reenviado na próxima publicação.

## 8. Carga inicial (antes do 1º uso)

1. O gateway lê, **uma vez**, do banco do site de **produção, só leitura** (é a versão mais atual; o teste pode estar defasado), os produtos publicados com todos os seus dados (nome, descrição, categorias, quantidades, caixas, imagens, cores, personalizações, destaque) e os grava no Catálogo como ponto de partida. Ninguém redigita nada.
2. O mesmo para o Bling: busca os IDs dos SKUs existentes pelo código.
3. Antes de virar para a produção, uma nova comparação com a produção mostra o que mudou nela desde a carga (para não sobrescrever edições feitas lá no meio tempo).
4. A primeira revisão mostra as diferenças entre o site atual e as regras novas, como os preços da fórmula oficial e os produtos FORA ainda visíveis. Assim, a correção do que o Access deixou para trás é **revisada**, não aplicada às cegas.

## 9. Segurança

- **ERP (NewFord, SERPZERADO, bdb_pricing):** só leitura, por views, com o usuário de leitura do gateway. O usuário administrador que o Access usa **não** é usado.
- **Banco do site:** o usuário de leitura e gravação existente. A senha vai **só no cofre do gateway** (`set-secret`). O ideal é que esse usuário só tenha acesso às tabelas de produto (recomendação ao dono).
- **S3:** chave com permissão de gravação **só** nas pastas `img_produto/`, `cores/` e `extras/` (recomendação), guardada no cofre do gateway.
- **Bling:** Client ID e Secret nas variáveis de ambiente da Vercel e no cofre do gateway. Tokens guardados criptografados no Supabase.
- Nenhuma senha, chave ou URL com chave em código, log, chat ou planilha.
- O papel do gateway no Supabase ganha só o necessário:
  - gravar as fotos do ERP em `catalogo`;
  - ler os pedidos de publicação, os dados aprovados e os arquivos de foto;
  - gravar o resultado da publicação.

## 10. Verificação

1. **Testes automáticos:**
   - fórmula de preço (inclusive primeira faixa = 1 e margem inválida);
   - regras de status (as 5 linhas da seção 5);
   - nomes de fotos (capa, cor, extras com renumeração);
   - cálculo de diferenças;
   - montagem do produto do Bling;
   - transação por produto (falha no meio deixa o produto como estava);
   - permissão (quem não tem `catalogo` não vê nem publica).
2. **Ambiente de teste do site:** publicar 5 produtos (1 novo, 1 com preço alterado, 1 FORA, 1 STANDBY, 1 com cor FORA) e conferir no site de teste e no Bling.
3. **Comparação com o Access:** para 20 produtos, o preço calculado pela aplicação deve ser igual ao do Access (fórmula A), com diferença máxima de R$ 0,01 por arredondamento.
4. **Período em paralelo:** por algumas semanas, Access e aplicação convivem, e só a aplicação publica. Depois o Access é desligado.

## 11. Fases 2 e 3 (registro, fora desta spec)

- **Precificação (fase 2):** calcular e propor margem e preço, e gravar `FormaPrecoParceria` no ERP. Exige escrita no ERP.
- **Cadastro no ERP (fase 3):** criar produto, cores e personalizações no NewFord (e no SERPZERADO, enquanto existir), e também as mudanças de status que o Access faz hoje.

## 12. Pendências do dono (não bloqueiam o começo)

1. **Volta para Coleção:** o produto ou a cor que estava FORA (Excluído no Bling) e volta deve ser reativado no site e no Bling? (Proposta: sim, automaticamente, passando pela revisão.)
2. **Primeira faixa a partir de 1 unidade:** confirmar.
3. **Preço no Bling:** manter 1 (como hoje) ou enviar o preço de venda da 1ª faixa? Preço de custo: proposta = `ValProd` da 1ª faixa da `FormaPrecoParceria` (mesma fonte do preço).
4. **Acessos para a configuração** (a fazer com guia, sem enviar senhas pelo chat):
   - endereço do banco do site de **teste**;
   - bucket e região do S3, e se o ambiente de teste usa outro bucket ou pasta;
   - criar o aplicativo no **Bling** (Client ID/Secret);
   - onde ficam os bancos **SERPZERADO** e **bdb_pricing** (mesmo servidor do NewFord?) e a permissão de leitura neles.
5. O id do atributo de personalização no site (o Access usa `PERSNALIZACAO` no cadastro em massa): confirmar o id real.
6. **Destaques da home** (`products.sessionId`): manter na aplicação (proposta: sim, com a possibilidade de **incluir** produto numa sessão, que o Access não permitia).
