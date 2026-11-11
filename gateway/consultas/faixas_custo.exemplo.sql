-- Modelo da consulta de faixas de custo. Copie para faixas_custo.sql (na pasta "consultas",
-- ao lado do config.toml) e troque tudo o que estiver marcado com "-- TROCAR:".
-- Os nomes das colunas (aliases) sao obrigatorios e devem ficar exatamente assim.
-- O gateway acrescenta sozinho a coluna "source" = 'erp'.
SELECT
    CAST(p.codigo_modelo AS varchar(60)) AS product_id,   -- TROCAR: codigo do modelo (ex.: BLA68), igual ao modelo do SKU do Mercado Livre
    f.quantidade_inicial                 AS qty_start,    -- TROCAR: quantidade inicial da faixa
    f.quantidade_final                   AS qty_end,      -- TROCAR: quantidade final da faixa (pode ser NULL na ultima)
    f.preco_unitario                     AS price,        -- TROCAR: custo por unidade nessa faixa
    f.data_cadastro                      AS created_at,   -- TROCAR: data em que a faixa passou a valer
    f.data_expiracao                     AS expired_at    -- TROCAR: data em que deixou de valer (NULL se vigente)
FROM painel.faixas_custo AS f                              -- TROCAR: view/tabela do ERP com as faixas
JOIN painel.produtos AS p ON p.id = f.produto_id           -- TROCAR: tabela de produtos (ou remova o JOIN)
WHERE f.preco_unitario IS NOT NULL
