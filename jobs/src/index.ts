/**
 * Ponto de entrada da sincronização.
 * Uso:  npm run sync -- --source=all | mercadolivre | bitrix24
 * Executado automaticamente pelo GitHub Actions às 08h, 13h e 17h (Brasília).
 */
import { connect } from './db.ts';
import { syncBitrix24 } from './sync-bitrix24.ts';
import { syncMercadoLivre } from './sync-mercadolivre.ts';

const arg = process.argv.find((a) => a.startsWith('--source='));
const source = arg?.split('=')[1] ?? 'all';
const ALLOWED = ['all', 'mercadolivre', 'bitrix24'];

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
    // Cada fonte tem o próprio contador: a falha de uma não impede a outra
    if (source === 'all' || source === 'mercadolivre') {
      try { failures += await syncMercadoLivre(sql); } catch (err) {
        failures++;
        console.error('[ML] Falha geral:', (err as Error).message);
      }
    }
    if (source === 'all' || source === 'bitrix24') {
      try { failures += await syncBitrix24(sql); } catch (err) {
        failures++;
        console.error('[Bitrix] Falha geral:', (err as Error).message);
      }
    }
    // Próximas fases: shopee e atualização das views de KPI
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
