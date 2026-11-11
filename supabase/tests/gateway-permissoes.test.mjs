import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Testa o papel gateway_writer (migration 0005) num Postgres em memória.
const repo = fileURLToPath(new URL('../..', import.meta.url));
const db = new PGlite();
let fails = 0;
const eq = (label, got, exp) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  if (!ok) fails++;
  console.log(`${ok ? 'OK  ' : 'FALHA'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` (esperado ${JSON.stringify(exp)})`}`);
};
// Executa como gateway_writer; devolve a mensagem de erro (ou null se deu certo) e volta a superusuário
const asGateway = async (sql) => {
  await db.exec('set role gateway_writer');
  try {
    await db.exec(sql);
    return null;
  } catch (e) {
    return e.message;
  } finally {
    await db.exec('reset role');
  }
};
const rejects = (label, msg, re) => eq(label, msg !== null && re.test(msg), true);

const sql = (f) => readFileSync(`${repo}/supabase/${f}`, 'utf8');
await db.exec(sql('tests/stubs.sql'));
await db.exec(sql('migrations/0002_marketplaces.sql'));
await db.exec(sql('migrations/0003_regras_v1.sql'));
await db.exec(sql('migrations/0005_gateway.sql'));
await db.exec(sql('migrations/0005_gateway.sql')); // idempotência
console.log('Migrations 0002 + 0003 + 0005 (x2) aplicadas');

const tier = (src) => `insert into erp.cost_tiers (product_id, qty_start, price, created_at, source) values ('T1', 1, 1.00, '2026-01-01', '${src}')`;

// ---------------- erp.cost_tiers ----------------
eq('insere cost_tiers source=erp', await asGateway(tier('erp')), null);
rejects('não insere cost_tiers source=manual', await asGateway(tier('manual')), /row-level security/i);

await db.exec(tier('manual'));
eq('delete como gateway não falha', await asGateway('delete from erp.cost_tiers'), null);
eq('delete apagou só source=erp', (await db.query(`select source from erp.cost_tiers order by source`)).rows.map((r) => r.source), ['manual']);

// ---------------- core.sync_runs ----------------
eq('insere sync_runs source=erp', await asGateway(`insert into core.sync_runs (source) values ('erp')`), null);
eq('atualiza sync_runs source=erp', await asGateway(`update core.sync_runs set status='success', finished_at=now() where source='erp'`), null);
eq('update efetivo', (await db.query(`select status from core.sync_runs where source='erp'`)).rows, [{ status: 'success' }]);
rejects('não insere sync_runs source=mercadolivre', await asGateway(`insert into core.sync_runs (source) values ('mercadolivre')`), /row-level security/i);

// ---------------- sem acesso a mkt ----------------
rejects('não lê mkt.orders', await asGateway('select * from mkt.orders'), /permission denied/i);

// ---------------- default privileges ----------------
await db.exec('create table erp.teste (x int)');
eq('grava em tabela criada depois em erp', await asGateway('insert into erp.teste values (1)'), null);
eq('lê tabela criada depois em erp', await asGateway('select * from erp.teste'), null);

if (fails) {
  console.error(`\n${fails} verificação(ões) falharam`);
  process.exit(1);
}
console.log('\nTodas as verificações passaram');
