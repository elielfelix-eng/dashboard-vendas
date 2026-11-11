-- =====================================================================
-- 0005 - Papel do gateway (programa Windows que envia dados do ERP)
-- Idempotente. NAO contem senha: o admin define no SQL Editor com
--   alter role gateway_writer with password '...';
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'gateway_writer') then
    create role gateway_writer with login;
  end if;
end $$;

grant usage on schema erp, core to gateway_writer;

-- erp: leitura e escrita em tudo (atual e futuro)
grant select, insert, update, delete on all tables in schema erp to gateway_writer;
grant usage, select on all sequences in schema erp to gateway_writer;
alter default privileges in schema erp grant select, insert, update, delete on tables to gateway_writer;
alter default privileges in schema erp grant usage, select on sequences to gateway_writer;

-- erp.cost_tiers: so mexe nas linhas vindas do ERP
drop policy if exists "custos: gateway so source erp" on erp.cost_tiers;
create policy "custos: gateway so source erp" on erp.cost_tiers for all to gateway_writer
  using (source = 'erp') with check (source = 'erp');

-- core.sync_runs: registra execucoes do ERP
grant select, insert, update on core.sync_runs to gateway_writer;
grant usage on sequence core.sync_runs_id_seq to gateway_writer;
drop policy if exists "sync_runs: gateway so source erp" on core.sync_runs;
create policy "sync_runs: gateway so source erp" on core.sync_runs for all to gateway_writer
  using (source = 'erp') with check (source = 'erp');

-- Sem acesso a mkt, auth, vault nem core.oauth_tokens.
