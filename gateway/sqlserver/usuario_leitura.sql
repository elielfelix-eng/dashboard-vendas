-- Modelo para o DBA do SQL Server do ERP. Cria um usuario que SO consegue ler as views do painel.
-- Troque NOME_DO_BANCO e <SENHA_FORTE> antes de executar. Nao guarde a senha real neste arquivo.

USE [master];
GO
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'gateway_leitura')
    CREATE LOGIN [gateway_leitura] WITH PASSWORD = N'<SENHA_FORTE>', CHECK_POLICY = ON;
GO

USE [NOME_DO_BANCO];   -- TROCAR: banco do ERP
GO
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'gateway_leitura')
    CREATE USER [gateway_leitura] FOR LOGIN [gateway_leitura];
GO

-- Schema onde ficam as views criadas para o painel.
IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'painel')
    EXEC (N'CREATE SCHEMA [painel]');
GO

-- Somente leitura, somente nesse schema (nenhuma outra tabela do ERP fica visivel).
GRANT SELECT ON SCHEMA::[painel] TO [gateway_leitura];
GO

-- Crie aqui as views do painel, por exemplo:
-- CREATE VIEW painel.faixas_custo AS SELECT ... FROM <tabelas reais do ERP>;
