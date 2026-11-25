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

const CHAVE_RE = /manufactur|produc|terminar|handl|limit|prazo|deadline|promise|estimat|expect|ready|tag/i;
const SENSIVEL_RE = /buyer|receiver|address|phone|email|name|document|nickname/i;
const ISO_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const ENUM_RE = /^[A-Za-z0-9_.\-]{1,40}$/;

/** Imprime só o caminho das folhas cujo nome casa com CHAVE_RE; valor só se for data ISO ou enum curto. */
function imprimirCampos(rotulo: string, raiz: unknown): void {
  const linhas: string[] = [];
  const andar = (v: unknown, caminho: string, chave: string, sensivel: boolean) => {
    const sens = sensivel || SENSIVEL_RE.test(chave);
    if (Array.isArray(v)) {
      v.forEach((x, i) => andar(x, `${caminho}[${i}]`, chave, sens));
    } else if (isObj(v)) {
      for (const [k, x] of Object.entries(v)) andar(x, caminho ? `${caminho}.${k}` : k, k, sens);
    } else if (CHAVE_RE.test(chave)) {
      if (!sens && typeof v === 'string' && (ISO_RE.test(v) || ENUM_RE.test(v))) linhas.push(`    ${caminho} = ${v}`);
      else linhas.push(`    ${caminho}`);
    }
  };
  andar(raiz, '', '', false);
  console.log(`  ${rotulo} campos candidatos (${linhas.length}):`);
  for (const l of linhas) console.log(l);
}

const nomesTopo = (v: unknown) => (isObj(v) ? Object.keys(v).join(', ') : '(vazio)');

async function levantarPrazoProducao(sql: ReturnType<typeof connect>, api: MercadoLivreClient) {
  console.log('\n=== PRAZO DE PRODUÇÃO (pedidos em "Aguardando disponibilidade de estoque") ===');
  const FORCADOS = ['48617609826', '48598060391', '48584195979'];
  const forcados = await sql<{ order_id: string; shipment_id: string }[]>`
    select order_id, shipment_id from mkt.orders
     where channel = 'mercadolivre' and shipment_id = any(${FORCADOS})`;
  const candidatos = await sql<{ order_id: string; shipment_id: string }[]>`
    select order_id, shipment_id from mkt.orders
     where channel = 'mercadolivre' and status = 'paid' and shipment_id is not null
       and date_created >= now() - interval '45 days'
     order by date_created desc
     limit 200`;
  console.log(`  forçados encontrados no banco: ${forcados.length}/${FORCADOS.length} | candidatos: ${candidatos.length}`);

  const fila = [...forcados, ...candidatos.filter((c) => !forcados.some((f) => f.shipment_id === c.shipment_id))];
  let achados = 0;
  const vistos = new Set<string>();
  for (const { order_id, shipment_id } of fila) {
    const forcado = FORCADOS.includes(shipment_id);
    if (!forcado && achados >= 40) break;
    if (vistos.has(shipment_id)) continue;
    vistos.add(shipment_id);
    const s = await tentar('shipment', () => api.get<Obj>(`/shipments/${shipment_id}`, {}, { 'x-format-new': 'true' }));
    if (!s) continue;
    const emProducao = s.status === 'pending' && s.substatus === 'manufacturing';
    if (!forcado && !emProducao) continue;
    achados++;
    console.log(`\n# envio ${shipment_id} (pedido ${order_id})${forcado ? ' [forçado]' : ''} status=${texto(s.status)}/${texto(s.substatus)}`);
    console.log(`  shipment chaves de topo: ${nomesTopo(s)}`);
    imprimirCampos('shipment', s);
    const sla = await tentar('sla', () => api.get<Obj>(`/shipments/${shipment_id}/sla`));
    if (sla) imprimirCampos('sla', sla);
    const o = await tentar('order', () => api.get<Obj>(`/orders/${order_id}`));
    if (o) {
      console.log(`  order chaves de topo: ${nomesTopo(o)}`);
      imprimirCampos('order', o);
    }
  }
  console.log(`\n  envios em produção examinados: ${achados}`);
}

/** Procura recursivamente uma chave pelo nome e devolve o valor se for string/número curto. */
function acharChave(v: unknown, chave: string): string | null {
  if (Array.isArray(v)) {
    for (const x of v) {
      const r = acharChave(x, chave);
      if (r !== null) return r;
    }
  } else if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) {
      if (k === chave && (typeof x === 'string' || typeof x === 'number')) return String(x);
      const r = acharChave(x, chave);
      if (r !== null) return r;
    }
  }
  return null;
}

/** Imprime folhas (caminho = valor) cujo valor é data ISO, número ou enum curto. */
function imprimirFolhas(raiz: unknown, prefixo: string): number {
  let n = 0;
  const andar = (v: unknown, caminho: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => andar(x, `${caminho}[${i}]`));
    else if (isObj(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (SENSIVEL_RE.test(k)) continue;
        andar(x, `${caminho}.${k}`);
      }
    } else if (typeof v === 'number' || (typeof v === 'string' && (ISO_RE.test(v) || ENUM_RE.test(v)))) {
      console.log(`    ${caminho} = ${v}`);
      n++;
    }
  };
  andar(raiz, prefixo);
  return n;
}

async function levantarDataEntregaAtual(sql: ReturnType<typeof connect>, api: MercadoLivreClient) {
  console.log('\n=== DATA DE ENTREGA ATUAL ===');
  const FORCADOS = ['48542334057', '48598060391', '48617609826', '48584195979'];
  const linhas = await sql<{ order_id: string; shipment_id: string; raw: unknown }[]>`
    select order_id, shipment_id, raw from mkt.orders
     where channel = 'mercadolivre' and shipment_id = any(${FORCADOS})`;
  const recentes = await sql<{ order_id: string; shipment_id: string; raw: unknown }[]>`
    select order_id, shipment_id, raw from mkt.orders
     where channel = 'mercadolivre' and status = 'paid' and shipment_id is not null
     order by date_created desc
     limit 30`;
  const vistos = new Set<string>();
  const fila = [...linhas, ...recentes].filter((r) => (vistos.has(r.shipment_id) ? false : (vistos.add(r.shipment_id), true)));
  console.log(`  envios: ${fila.length} (forçados no banco: ${linhas.length}/${FORCADOS.length})`);
  const SUB = ['estimated_delivery_time', 'estimated_delivery_extended', 'estimated_delivery_final', 'estimated_delivery_limit', 'estimated_schedule_limit', 'delivery_promise'];
  for (const { order_id, shipment_id, raw } of fila) {
    console.log(`\n# envio ${shipment_id} (pedido ${order_id})${FORCADOS.includes(shipment_id) ? ' [forçado]' : ''}`);
    console.log(`  manufacturing_ending_date (pedido): ${texto(acharChave(raw, 'manufacturing_ending_date'))}`);
    const s = await tentar('shipment', () => api.get<Obj>(`/shipments/${shipment_id}`, {}, { 'x-format-new': 'true' }));
    if (!s) continue;
    console.log(`  status: ${texto(s.status)} | substatus: ${texto(s.substatus)}`);
    const lt = isObj(s.lead_time) ? s.lead_time : {};
    for (const k of SUB) {
      if (!(k in lt)) {
        console.log(`  lead_time.${k}: (ausente)`);
        continue;
      }
      console.log(`  lead_time.${k}:`);
      if (imprimirFolhas(lt[k], `lead_time.${k}`) === 0) console.log('    (sem folhas imprimíveis)');
    }
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

    await levantarPrazoProducao(sql, api);
    await levantarDataEntregaAtual(sql, api);

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
