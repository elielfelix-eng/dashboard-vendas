-- =====================================================================
-- 0026 - Grupos de anuncios vinculados a conta do Mercado Livre
-- Pode ser reexecutada. Aplicar depois da 0023.
-- =====================================================================

-- Grupos antigos sem conta passam para a conta ativa do Mercado Livre (se existir).
update core.grupos_anuncio
   set account_id = (select id from core.accounts where channel = 'mercadolivre' and active order by id limit 1)
 where account_id is null;

-- Nome unico por conta, sem diferenciar maiusculas de minusculas (o unique (account_id, nome) continua).
create unique index if not exists grupos_anuncio_conta_nome_uq on core.grupos_anuncio (account_id, lower(nome));
