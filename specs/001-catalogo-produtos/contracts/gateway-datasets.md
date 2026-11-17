# Contrato: leitura diária (ERP/site → Supabase)

O gateway roda `run` às **05:00** (tarefa nova). Os datasets são de `mode = replace_source` e `allow_empty = false`. Cada view vive no schema `painel` do banco de origem e só fica visível ao usuário de leitura.

| Dataset | View de origem | Tabela destino | Colunas (ordem) |
|---|---|---|---|
| cat_produtos | `NewFord.painel.cat_produtos` | `erp.cat_produtos` | ref, id_produto_erp, status, descricao_erp, qtd_minima, peso_kg, largura, altura, comprimento, diametro, fornecedor_nome, supplier_id_site, cod_fornecedor, ncm, nome_padrao |
| cat_cores | `NewFord.painel.cat_cores` | `erp.cat_cores` | sku, ref, status, cor_nome, cor_abrev, cor_hex, cod_no_fornecedor |
| cat_faixas | `NewFord.painel.cat_faixas` | `erp.cat_faixas` | ref, qtd_ini, qtd_fin, custo, margem, data_alt |
| cat_personalizacoes | `NewFord.painel.cat_personalizacoes` | `erp.cat_personalizacoes` | ref, value_id, personalizacao, grupo, n_cores |
| cat_pers_precos | `NewFord.painel.cat_pers_precos` | `erp.cat_pers_precos` | value_id, qtd_ini, qtd_fin, preco_venda |
| cat_site_referencias | site, só leitura (`dbo.categories`, `boxes`, `attributes`, `values`, `viewSession`) | `erp.cat_site_*` | id, nome (+ medidas para caixas) |

Regras:
- `status`: o texto de `StatusColecao` (`Coleção`, `Standby`, `FORA`) é normalizado para `colecao`, `standby` e `fora`. Para as cores, o mapeamento de `IdStatus` (1, 2, 3) é confirmado com `NFORD_StatusProduto` na criação da view.
- `nome_padrao`: junta `bdb_pricing.dbo.nomeReduzProd` por `prodModelo = Referencia`. Se o banco estiver em outra instância, vira um dataset separado (research R2).
- `ncm`: o último NCM de entrada por modelo, com a mesma lógica da consulta `NEWFORD_NCM` do Access.
- Depois da gravação, o gateway chama `select catalogo.apos_leitura()`. A função confere se a quantidade de produtos lidos caiu mais de 20% em relação à leitura anterior. Se não caiu, atualiza o carimbo da revisão; se caiu, grava o alerta `leitura_suspeita` e mantém a revisão anterior (FR-003).
- O sync_run é registrado com `source = 'erp'` e o dataset correspondente nas estatísticas.
