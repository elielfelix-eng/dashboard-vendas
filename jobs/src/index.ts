/**
 * Ponto de entrada da sincronização.
 * Uso:  npm run sync -- --source=all | mercadolivre | bitrix24 | shopee
 * Executado automaticamente pelo GitHub Actions às 08h, 13h e 17h (Brasília).
 */
import { connect } from './db.ts';
import { FONTES_PERMITIDAS, rodarFontes } from './fontes.ts';
import { syncBitrix24 } from './sync-bitrix24.ts';
import { syncMercadoLivre } from './sync-mercadolivre.ts';
import { syncShopee } from './sync-shopee.ts';

const arg = process.argv.find((a) => a.startsWith('--source='));
const source = arg?.split('=')[1] ?? 'all';

async function ping(suffix = '') {
  const url = process.env.HEALTHCHECK_URL;
  if (!url) return;
  try { await fetch(url + suffix, { signal: AbortSignal.timeout(10_000) }); } catch { /* monitoramento é opcional */ }
}

async function main() {
  if (!FONTES_PERMITIDAS.includes(source)) throw new Error(`--source inválido: ${source}. Use: ${FONTES_PERMITIDAS.join(', ')}`);
  await ping('/start');
  const sql = connect();
  let failures = 0;
  try {
    // Cada fonte tem o próprio contador: a falha de uma não impede a outra
    failures = await rodarFontes(source, [
      { fonte: 'mercadolivre', rotulo: 'ML', rodar: () => syncMercadoLivre(sql) },
      { fonte: 'bitrix24', rotulo: 'Bitrix', rodar: () => syncBitrix24(sql) },
      { fonte: 'shopee', rotulo: 'Shopee', rodar: () => syncShopee(sql) },
    ]);
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
