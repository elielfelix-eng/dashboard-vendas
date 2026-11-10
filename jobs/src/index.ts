/**
 * Ponto de entrada da sincronização.
 * Uso:  npm run sync -- --source=all | mercadolivre
 * Executado automaticamente pelo GitHub Actions às 08h, 13h e 17h (Brasília).
 */
import { connect } from './db.ts';
import { syncMercadoLivre } from './sync-mercadolivre.ts';

const arg = process.argv.find((a) => a.startsWith('--source='));
const source = arg?.split('=')[1] ?? 'all';
const ALLOWED = ['all', 'mercadolivre'];

async function ping(suffix = '') {
  const url = process.env.HEALTHCHECK_URL;
  if (!url) return;
  try { await fetch(url + suffix, { signal: AbortSignal.timeout(10_000) }); } catch { /* monitoramento é opcional */ }
}

async function main() {
  if (!ALLOWED.includes(source)) throw new Error(`--source inválido: ${source}. Use: ${ALLOWED.join(', ')}`);
  await ping('/start');
  const sql = connect();
  let failures = 0;
  try {
    if (source === 'all' || source === 'mercadolivre') failures += await syncMercadoLivre(sql);
    // Próximas fases: shopee, bitrix24, e atualização das views de KPI
  } finally {
    await sql.end();
  }
  await ping(failures ? '/fail' : '');
  if (failures) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error('Falha geral na sincronização:', (err as Error).message);
  await ping('/fail');
  process.exit(1);
});
