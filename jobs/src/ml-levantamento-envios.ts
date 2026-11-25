/**
 * Levantamento (só leitura) dos prazos de envio e da reputação no Mercado Livre.
 * Mostra de onde vêm o prazo de despacho, o prazo de entrega e os níveis de reputação.
 * Só faz GET. Não grava no banco. Não imprime token, comprador, endereço nem o JSON bruto.
 * Uso: npm run ml:levantamento -w jobs   (precisa de DATABASE_URL, ML_CLIENT_ID e ML_CLIENT_SECRET)
 */
import { MercadoLivreClient, refreshTokens, HttpError, type MlAppCredentials } from '@dash/connectors';
import { connect, requireEnv } from './db.ts';
import { createTokenProvider } from './token-store.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const texto = (v: unknown) => (v === undefined || v === null ? '-' : String(v));

/** Data de um campo do lead_time: pode vir como objeto { date, ... } ou como valor simples. */
function dataDe(v: unknown): string {
  if (isObj(v)) return texto(v.date ?? v.shipping ?? '(sem date)');
  return texto(v);
}

async function tentar<T>(rotulo: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    const status = err instanceof HttpError ? ` (HTTP ${err.status})` : '';
    console.log(`  ${rotulo}: falhou${status}`);
    return null;
  }
}

async function main() {
  const sql = connect();
  try {
    const app: MlAppCredentials = { clientId: requireEnv('ML_CLIENT_ID'), clientSecret: requireEnv('ML_CLIENT_SECRET') };
    const [acc] = await sql<{ id: string; nickname: string }[]>`
      select id, nickname from core.accounts where channel = 'mercadolivre' and active limit 1`;
    if (!acc) {
      console.log('Nenhuma conta do Mercado Livre conectada.');
      return;
    }
    const getToken = createTokenProvider(sql, acc.id, (rt) => refreshTokens(app, rt));
    const api = new MercadoLivreClient(getToken);

    const envios = await sql<{ shipment_id: string }[]>`
      select distinct shipment_id from mkt.orders
       where channel = 'mercadolivre' and status = 'paid' and shipment_id is not null
         and date_created >= now() - interval '20 days'
       limit 30`;
    console.log(`=== ENVIOS (${envios.length}) ===`);

    for (const { shipment_id: id } of envios) {
      console.log(`\n# envio ${id}`);
      const s = await tentar('shipment', () => api.get<Obj>(`/shipments/${id}`, {}, { 'x-format-new': 'true' }));
      if (s) {
        const logistic = isObj(s.logistic) ? s.logistic : {};
        console.log(`  status: ${texto(s.status)} | substatus: ${texto(s.substatus)}`);
        console.log(`  logistic.mode: ${texto(logistic.mode)} | logistic.type: ${texto(logistic.type)}`);
        const lt = isObj(s.lead_time) ? s.lead_time : {};
        console.log(`  lead_time chaves: ${Object.keys(lt).join(', ') || '(vazio)'}`);
        for (const k of ['estimated_handling_limit', 'estimated_delivery_time', 'estimated_delivery_limit', 'estimated_delivery_final', 'buffering']) {
          if (k in lt) console.log(`    ${k}: ${dataDe(lt[k])}`);
        }
        const hist = isObj(s.status_history) ? s.status_history : {};
        console.log(`  status_history: date_shipped=${texto(hist.date_shipped)} | date_delivered=${texto(hist.date_delivered)}`);
      }
      const sla = await tentar('sla', () => api.get<Obj>(`/shipments/${id}/sla`));
      if (sla) console.log(`  sla: status=${texto(sla.status)} | expected_date=${texto(sla.expected_date)}`);
    }

    console.log('\n=== REPUTAÇÃO (seller_reputation) ===');
    const me = await tentar('users/me', () => api.get<Obj>('/users/me'));
    if (me) console.log(JSON.stringify(me.seller_reputation ?? null, null, 2));
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('ERRO:', (err as Error).message);
  process.exit(1);
});
