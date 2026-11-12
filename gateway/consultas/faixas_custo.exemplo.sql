-- Consulta de custos do gateway. Copie para faixas_custo.sql (na pasta "consultas",
-- ao lado do config.toml). Le a view criada por sqlserver\view_faixas_custo.sql.
-- Os nomes das colunas sao obrigatorios e devem ficar exatamente assim.
-- O gateway acrescenta sozinho a coluna "source" = 'erp'.
--
-- product_id = modelo do SKU do Mercado Livre (ex.: BLA68), em maiusculas e sem espacos
-- qty_start / qty_end = faixa de pecas da cotacao; price = custo por peca;
-- created_at = data da cotacao (o painel usa a mais recente ate a data da venda).
SELECT product_id, qty_start, qty_end, price, created_at
FROM painel.faixas_custo
