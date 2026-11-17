# Research — Catálogo de produtos (fase 1)

Cada item: **Decisão**, **Racional**, **Alternativas**. Itens marcados *(verificar no 1º contato)* dependem de confirmação em ambiente real e têm um teste de fumaça no quickstart.

## R1. Onde o "estado desejado" de cada produto é montado
- **Decisão:** o banco (Supabase) monta, por produto, um **documento JSON canônico** com tudo o que deve estar no site e no Bling. Ele vem de uma função SQL que junta o retrato do ERP com os dados do Catálogo (`catalogo.produto_desejado(ref)`). A revisão compara esse documento com o **último documento publicado** (`catalogo.publicado`). O pedido de publicação congela os documentos aprovados, e o gateway só **aplica** o documento.
- **Racional:** segue o princípio III (regra no banco), e o diff vira uma comparação de JSON. O gateway fica sem regra de negócio, o que facilita o teste. O que foi revisado é exatamente o que é publicado, porque o documento é congelado no clique.
- **Alternativas:** o gateway calcular o diff lendo o site (duplicaria as regras em Python e leria o site a cada revisão); a tela calcular (viola o princípio III).

## R2. Leitura das três fontes do ERP
- **Decisão:** views no schema `painel` de cada banco, lidas pelo usuário de leitura do gateway, em datasets novos com `mode = replace_source`, gravando em tabelas `erp.cat_*`. O gateway já tem permissão nesse schema. Se SERPZERADO e bdb_pricing estiverem na **mesma instância** do NewFord, as views ficam no NewFord com nomes de três partes (`SERPZERADO.dbo.ITEM`) e o gateway continua com uma conexão só *(verificar no 1º contato)*. Se estiverem em outra instância, cada dataset passa a ter `source = "serpzerado" | "pricing"`, com a conexão e o segredo próprios.
- **Proteção contra leitura vazia (FR-003):** o `allow_empty = false` do gateway já recusa um resultado vazio. Além disso, a montagem da revisão é **suspensa** se o número de produtos lidos cair mais de 20% em relação à leitura anterior. Nesse caso aparece o alerta "leitura do ERP suspeita".
- **Alternativas:** o gateway ler as tabelas cruas (dá acesso amplo demais ao usuário de leitura).

## R3. Fotos: envio, conversão e entrega ao S3
- **Decisão:**
  1. O navegador envia o arquivo original (até 10 MB, JPG/PNG/WEBP) **direto** para um bucket privado do Supabase Storage (`catalogo-fotos`), usando uma URL de envio assinada gerada por uma rota de servidor que exige a permissão `catalogo`. Isso evita o limite de 4,5 MB do corpo das funções da Vercel.
  2. Ao publicar, a rota de servidor cria **URLs de download assinadas (24 h)** e as grava no pedido. O gateway baixa por HTTPS comum.
  3. O gateway converte para JPG (Pillow, qualidade 85, sem redimensionar) e envia ao S3 (boto3) com a chave final (`img_produto/MODELO-capa.jpg`, `cores/<SKU>.jpg`, `extras/MODELO-a.jpg`).
  4. Depois que a publicação dá certo, a cópia no Storage é apagada e a pré-visualização passa a usar a URL pública do S3. Assim o Storage gratuito (1 GB) não enche.
- **Racional:** a chave do S3 fica só no gateway (princípio I). O gateway não precisa de chave do Supabase, porque as URLs assinadas chegam pelo Postgres.
- **Alternativas:** envio direto do navegador ao S3 (exigiria a chave do S3 na Vercel); guardar as fotos em `bytea` no Postgres (gasta o limite de 500 MB).

## R4. Fila de publicação e execução no gateway
- **Decisão:**
  - **Fila:** tabela `catalogo.publicacoes`. O gateway ganha o comando `publish`, executado por uma **tarefa agendada a cada 5 minutos**. Ele pega um pedido com `select … for update skip locked` (uma publicação por vez, FR-018) e marca `publicando`.
  - **Ordem por produto:**
    1. baixar, converter e enviar as fotos ao S3 (chaves determinísticas, então sobrescrever é idempotente);
    2. **uma transação SQL Server por produto** no site (FR-017);
    3. Bling.
  - **Resultado:** gravado por produto e por destino em `catalogo.publicacao_itens`. Pedidos parados em `publicando` há mais de 2 h voltam para a fila, no mesmo padrão de limpeza de órfãos do gateway.
- **Racional:** usa só conexões de saída e a infraestrutura de tarefas que já existe. A atomicidade por produto vem da transação.
- **Alternativas:** um serviço residente com conexão permanente (mais complexo de instalar e manter); disparo pelo painel (exigiria porta de entrada).

## R5. Escrita no banco do site (SQL Server na AWS)
- **Decisão:**
  - **Conexão e transação:** pyodbc, com segredo `site` no cofre e `target` configurável (`site_teste` / `site_producao`, FR-019). Cada produto roda em `BEGIN TRAN … COMMIT`, com `SET XACT_ABORT ON`.
  - **Tabelas gravadas:** listas sem histórico (`productsPrices`, `productsQuantities`, `productsCategories`, `productsBoxes` e `valuesPrices` das personalizações do produto) são apagadas e regravadas. Entidades com histórico (`products`, `values`, `productsAttributesValues`, `productsImages`) recebem **upsert** e são inativadas, nunca apagadas (FR-007).
  - **`identify` das imagens:** é gerado pelo banco. Ele é lido de volta dentro da mesma transação (`OUTPUT inserted.identify`) e ligado à cor.
  - **Colunas de produto:** a lista completa é a das consultas `01_`–`12_` do Access (`docs/catalogo/analise-access.md`, seção 2), com estas correções:
    - `externalId` = código no fornecedor;
    - peso sem arredondar;
    - números gravados como número;
    - `slug` só na criação (FR-008).
  - **Cache:** o dono confirmou que não há cache (FR-028); isso é verificado no 1º teste.
- **Alternativas:** API do site (não existe).

## R6. Bling API v3 *(verificar no 1º contato)*
- **Decisão:**
  - **Conexão:** OAuth 2.0 (authorization code). O botão "Conectar Bling" fica no painel e a rota de callback na Vercel, no mesmo padrão do ML. Os tokens são guardados no Vault (`core.oauth_tokens`, `channel = 'bling'`).
  - **Renovação do token:** feita pelo **gateway** no início de cada publicação, com o Client Secret no cofre do gateway. A gravação do token novo usa uma função definer com trava, já que o refresh token é rotativo.
  - **Produtos:** produto **simples** por SKU de cor (FR-023a). Busca por código (`GET /produtos?codigo=`), depois `POST /produtos` ou `PUT /produtos/{id}`. Situação via `PATCH /produtos/{id}/situacoes`: `A` (ativo), `I` (inativo), `E` (excluído).
  - **Limite:** cerca de 3 requisições/s, com espera e nova tentativa em `429`.
  - **Componentes de kit (FR-023):** antes de levar um SKU para `E`, o gateway consulta o cache `catalogo.bling_componentes`. Esse cache é montado a cada publicação que tenha alguma exclusão, listando os produtos com formato de composição e lendo os componentes de cada um. Se o SKU for componente, ele vai só para `I` e gera o alerta "SKU em kit".
  - **Campos:** os do `BASE_Import_BLING` do Access (spec, FR-022), com o preço de custo = `ValProd` da 1ª faixa.
- **Racional:** um só executor (o gateway) para site, S3 e Bling deixa a ordem e os resultados num lugar só.
- **Alternativas:** o Bling publicado pela nuvem (GitHub Actions/Vercel) separaria resultado e fila. Refresh só na Vercel exigiria que o gateway chamasse a Vercel.

## R7. Edição concorrente e auditoria
- **Decisão:**
  - **Versão:** `catalogo.produtos.versao` é incrementada a cada gravação. A gravação exige a versão lida; se for diferente, o usuário vê "alterado por Fulano às HH:MM — recarregar ou sobrescrever" (FR-021).
  - **Presença:** `catalogo.produtos.editando_por` + `editando_ate` (5 min, renovado enquanto a tela está aberta) para o aviso "Fulano está editando".
  - **Auditoria:** `catalogo.alteracoes`, com quem, quando, produto, campo, antes e depois. A tabela é alimentada por gatilho.
- **Alternativas:** Supabase Realtime para presença (mais peças, pouco ganho para o uso esporádico).

## R8. Permissão
- **Decisão:** a permissão nova `catalogo` em `core.role_permissions`, com valor inicial **só admin = true**; o dono liga para quem precisar. As RPCs e as rotas de servidor checam `core.has_perm('catalogo')`, e as tabelas `catalogo.*` têm RLS com a mesma condição (princípio III).

## R9. Carga inicial
- **Decisão:** um comando do gateway, `import-site`, lê **da produção, só leitura**, os produtos do site cujo `id` é uma referência do ERP. Ele grava em tabelas `erp.cat_site_*` (mesmo mecanismo dos datasets), e uma função SQL `catalogo.importar_do_site()` popula o Catálogo e o `catalogo.publicado`. Os IDs do Bling são buscados por código numa varredura única. Antes de virar para produção, o mesmo comando roda de novo e a função mostra o que mudou na produção desde a carga (FR-026).

## R10. Testes
- **Decisão:**
  - **SQL (PGlite):** `supabase/tests/catalogo.test.mjs` cobre preço (FR-004), status (FR-005), documento desejado, diff, alertas (FR-011), RLS e permissão, versão e auditoria.
  - **Gateway (pytest):** montagem do SQL do site por produto com conexão falsa, ordem e rollback em falha (FR-017), nomes e conversão de fotos, cliente Bling com HTTP falso (kit → `I`, `429`, refresh).
  - **Web:** testes `node --test` das funções puras (nomes de fotos, ordenação de extras).
