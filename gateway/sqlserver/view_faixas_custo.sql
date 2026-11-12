-- View com o historico de cotacoes de compra para o painel (custo do produto).
-- Rodar no banco do ERP (NewFord), como administrador, DEPOIS do usuario_leitura.sql.
-- Compativel com SQL Server 2008. Pode ser executado de novo (recria a view).
--
-- A Cotacoes tem dois tipos de linha e as duas entram:
--   * tabela do fornecedor: faixas Qtd..Qtd_Fin cotadas no mesmo dia;
--   * cotacao pontual: uma quantidade so (Qtd = Qtd_Fin).
-- Linhas antigas sem Qtd_Fin viram faixa de uma quantidade so.
-- So o fornecedor padrao do produto; so preco maior que zero; sem personalizacao.
-- O painel escolhe, para N pecas vendidas na data D, a cotacao mais recente ate D cuja
-- faixa contem N (migration 0006 do Supabase).

USE [NewFord];
GO
IF OBJECT_ID(N'painel.faixas_custo', N'V') IS NOT NULL
    DROP VIEW painel.faixas_custo;
GO
CREATE VIEW painel.faixas_custo AS
SELECT
    UPPER(LTRIM(RTRIM(CAST(p.Referencia AS varchar(60))))) AS product_id,
    c.Qtd                                                  AS qty_start,
    CASE WHEN c.Qtd_Fin >= c.Qtd THEN c.Qtd_Fin ELSE c.Qtd END AS qty_end,
    c.Valor                                                AS price,
    c.Data                                                 AS created_at
FROM dbo.Cotacoes AS c
JOIN dbo.Produtos AS p ON p.IdProduto = c.IdProduto
WHERE c.Data >= '2019-01-01'
  AND c.Qtd > 0
  AND c.Valor > 0
  AND c.IdFornecedor = p.Id_FornecedorPadrao
  AND ISNULL(c.Personalizado, 0) = 0;
GO
