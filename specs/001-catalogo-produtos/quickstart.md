# Quickstart — validação de ponta a ponta (fase 1)

Ordem de validação depois da implementação. Detalhes: [data-model.md](data-model.md) e [contracts/](contracts/).

## Pré-requisitos (dono, com guia — nenhuma senha no chat)
1. **Migrations aplicadas no Supabase**: `catalogo` + datasets `erp.cat_*`.
2. **Views criadas nos bancos do ERP** (`painel.cat_*`) e permissão de leitura para o usuário do gateway (`contracts/gateway-datasets.md`).
3. **Cofre do gateway**: `set-secret site` (usuário de leitura e gravação do site de **teste**), `set-secret s3` (chave só com gravação nas 3 pastas) e `set-secret bling` (Client ID e Secret).
4. **Tarefas agendadas**: leitura às 05:00 e `publish` a cada 5 min.
5. **Bling**: app criado no Bling, botão "Conectar Bling" acionado no painel.
6. **Permissão `catalogo`** ligada para quem vai usar.

## Testes automáticos
```
npm run test:sql      # inclui supabase/tests/catalogo.test.mjs
npm run test:web
cd gateway && python -m pytest -q
```
Esperado: tudo passa (preço, status, documento desejado, diff, alertas, RLS, versão, transação por produto, fotos, Bling com HTTP falso).

## Fumaça das integrações (1º contato, ambiente de teste)
1. `BrindeGateway.exe test` → conecta no ERP, no Supabase, no **site de teste** e no S3 (só lista a pasta) sem erro.
2. `BrindeGateway.exe run --only cat_*` → `erp.cat_produtos` tem a mesma contagem de produtos em Coleção, Standby e FORA que o ERP (conferir com uma consulta no ERP).
3. `BrindeGateway.exe import-site --from producao --readonly` → 20 produtos sorteados aparecem no Catálogo com os mesmos dados do site.
4. Bling: `GET /produtos?codigo=<um SKU conhecido>` pelo comando `BrindeGateway.exe bling-check <SKU>` → mostra o id e o formato **simples**.

## Cenários de aceite (site de teste + Bling)
| # | Preparação | Ação | Resultado esperado |
|---|---|---|---|
| 1 | Produto novo em Coleção, 3 cores | Completar dados, enviar capa + 3 cores + 2 extras, publicar | No site de teste: visível, preços por faixa (1ª a partir de 1), 3 cores, fotos `X-capa`, `<sku>`, `X-a`, `X-b`; no Bling: 3 SKUs simples com NCM |
| 2 | Margem alterada no ERP | Leitura do dia → revisão | Aparece em "Preços" com antes/depois faixa a faixa; após publicar, preço = custo/(1−margem) (±R$ 0,01) |
| 3 | Produto FORA | Publicar | Site: `visible=0`; Bling: SKUs `E` (ou `I` + alerta se em kit) |
| 4 | Produto STANDBY | Publicar | Site: `visible=0`; Bling: `I` |
| 5 | Cor FORA / cor STANDBY | Publicar | Site: só a cor `active=0` / `available=0`; Bling: `E` / `I` |
| 6 | Produto sem capa | Publicar tudo | Esse produto bloqueado com motivo; demais publicados |
| 7 | Falha provocada no meio de um produto (ex.: categoria inexistente) | Publicar | Produto inteiro como antes no site; item `site=erro`; demais ok |
| 8 | Bling indisponível (token inválido) | Publicar | Site ok; item `bling=pendente`; reenviado na publicação seguinte |
| 9 | Dois usuários no mesmo produto | Salvar nos dois | 2º recebe aviso de conflito; auditoria mostra os dois |
| 10 | Usuário sem permissão `catalogo` | Abrir tela / chamar RPC direto | Negado nos dois |
| 11 | Leitura do ERP com 30% menos produtos | `run` | Alerta "leitura do ERP suspeita"; revisão anterior mantida; nada desativado |

## Virada para produção
1. `import-site --from producao` de novo → revisar diferenças surgidas desde a carga.
2. Trocar o destino para `site_producao` (configuração do gateway + registro no painel).
3. Publicar 5 produtos de teste controlado; conferir no site.
4. Período em paralelo com o Access (só a aplicação publica).
