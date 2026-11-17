# Contrato: fila de publicação (painel ↔ gateway)

## Painel → fila
`catalogo.pedir_publicacao(p_refs text[] default null) returns bigint`. É **security definer** e exige `core.has_perm('catalogo')`. Passos:
1. Monta `catalogo.produto_desejado(ref)` para cada ref pedida, ou para todas as da revisão quando `null`. Ignora as refs bloqueadas por alerta e devolve a lista delas.
2. Cria a `catalogo.publicacoes` (`na_fila`, `destino` = configuração ativa) e os `publicacao_itens` com o documento congelado.
3. A rota de servidor da Vercel completa `publicacao_itens.fotos` com as URLs assinadas (24 h) das fotos `pendente`.

## Gateway ← fila (comando `publish`, a cada 5 min)
Funções definer acessíveis ao `gateway_writer`:
- `catalogo.pegar_publicacao() returns setof catalogo.publicacao_itens`: faz `update … set situacao='publicando' … where id = (select id … where situacao='na_fila' order by id limit 1 for update skip locked)` e devolve os itens. Também reabre pedidos em `publicando` há mais de 2 h.
- `catalogo.registrar_item(p_pub bigint, p_ref text, p_site text, p_fotos text, p_bling text, p_bling_ids jsonb, p_erro text)`.
- `catalogo.concluir_publicacao(p_pub bigint)`: calcula a situação final, atualiza o `catalogo.publicado` e as fotos, e libera a fila.
- `catalogo.bling_token()` e `catalogo.bling_salvar_token(...)`: leitura e gravação dos tokens no Vault, com trava (`pg_advisory_xact_lock`).
- `catalogo.bling_componentes_substituir(p jsonb)`.

## Ordem por item (gateway)
1. **Fotos:** baixa cada `url_assinada`, converte para JPG e envia ao S3 com a `s3_key`. Uma falha impede o passo 2 do item (`site = pulado`, `fotos = erro`).
2. **Site:** uma transação, conforme `contracts/site-escrita.md`. Uma falha faz rollback e o item fica com `site = erro`.
3. **Bling:** só se `site = ok` e o item não tiver o alerta `sem_ncm`, conforme `contracts/bling.md`. Uma falha deixa o item como `bling = pendente`, e ele é reenviado na próxima publicação daquele ref.

As mensagens de erro passam pelo `mask()` do gateway antes de serem gravadas (princípio I).
