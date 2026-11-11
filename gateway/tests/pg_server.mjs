// Servidor PGlite em socket para os testes do gateway: node pg_server.mjs <porta>
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const port = Number(process.argv[2]);
const sql = (f) => readFileSync(`${repo}/supabase/${f}`, 'utf8');

const db = new PGlite();
for (const f of ['tests/stubs.sql', 'migrations/0002_marketplaces.sql', 'migrations/0003_regras_v1.sql', 'migrations/0005_gateway.sql']) {
  await db.exec(sql(f));
}
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
await server.start();
console.log('pronto');
process.on('SIGTERM', async () => {
  await server.stop();
  process.exit(0);
});
