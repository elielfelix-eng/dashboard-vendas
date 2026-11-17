# Contrato: chamadas da tela (Next.js → Supabase)

Todas exigem `core.has_perm('catalogo')`, checada no banco (princípio III).

| Função | Retorno | Uso |
|---|---|---|
| `catalogo.lista(p_filtro text, p_busca text)` | ref, nome, status, foto_capa, alertas[], tem_alteracao, editando_por | lista com os filtros todos / novos / alterados / alertas / inativos |
| `catalogo.produto(p_ref)` | json: dados do ERP (somente leitura) + Catálogo + fotos + versão + opções do site | tela do produto |
| `catalogo.salvar(p_ref, p_versao int, p_dados jsonb, p_forcar bool)` | nova versão, ou erro `conflito_versao` com quem e quando | FR-021 |
| `catalogo.marcar_edicao(p_ref)` | editando_por atual | presença, chamada a cada 2 min |
| `catalogo.copiar_de(p_ref_destino, p_ref_origem)` | dados preenchidos (sem salvar) | FR-012 |
| `catalogo.fotos_ordenar(p_ref, p_ids uuid[])`, `catalogo.foto_remover(p_id)` | ok | FR-014 |
| `catalogo.revisao_resumo()` | contagem por grupo + alertas | topo da revisão |
| `catalogo.revisao()` | linhas da view `catalogo.revisao` | antes e depois |
| `catalogo.pedir_publicacao(p_refs)` | id do pedido + refs bloqueadas | FR-016 |
| `catalogo.publicacoes_recentes()` | situação e resultado por item | acompanhamento |

Rotas de servidor (Next.js), também com a permissão:
- `POST /api/catalogo/fotos/upload-url`: recebe `{ref, tipo, sku?}` e devolve uma URL de envio assinada para o Storage. Valida o tipo e o tamanho (≤ 10 MB).
- `POST /api/catalogo/publicar`: chama `pedir_publicacao` e preenche as URLs assinadas de download.
- `GET /api/bling/conectar` e `GET /api/bling/callback`: OAuth do Bling (só admin).
