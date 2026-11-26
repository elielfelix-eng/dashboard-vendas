/**
 * Sonda (só leitura) da cobertura da API da Shopee: o que cada endpoint de leitura devolve e quanto
 * custa carregar 12 meses de pedidos. Removida ao fim da Tarefa 2.
 *
 * Regras: só GET (exceção: payment/get_escrow_detail_batch, que a Shopee define como POST mas só lê,
 * e a renovação do token). Não grava nada na Shopee. No banco, só a renovação do token.
 * Imprime apenas: endpoint, HTTP, código de erro, NOMES de campos, contagens, datas e tempos.
 * Nunca imprime token, partner key, comprador, endereço, telefone, e-mail nem corpo bruto.
 * Uso: npm run shopee:sonda -w jobs   (precisa de DATABASE_URL, SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY)
 */
import { refreshShopeeTokens, ShopeeAuthError, type ShopeeAppCredentials } from '@dash/connectors';
import { connect, requireEnv } from './db.ts';
import { createTokenProvider } from './token-store.ts';
import { caminhosDeCampos, dataAds, janelasPorMes, urlDaLoja } from './shopee-sonda-util.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PAUSA_MS = 300; // folga entre chamadas, por causa do limite de taxa
const DIA = 86400;

interface Resultado {
  http: number;
  /** código de erro da Shopee ('' se não houve), só [a-z0-9_] */
  erro: string;
  corpo: Obj | null;
  ms: number;
}

const codigo = (v: unknown) => (typeof v === 'string' ? v.replace(/[^a-z0-9_.\-]/gi, '').slice(0, 60) : '');

const latencias = new Map<string, number[]>();
function medir(rotulo: string, ms: number) {
  const a = latencias.get(rotulo) ?? [];
  a.push(ms);
  latencias.set(rotulo, a);
}
const media = (rotulo: string) => {
  const a = latencias.get(rotulo) ?? [];
  return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
};

async function main() {
  const sql = connect();
  try {
    const app: ShopeeAppCredentials = {
      partnerId: Number(requireEnv('SHOPEE_PARTNER_ID')),
      partnerKey: requireEnv('SHOPEE_PARTNER_KEY'),
    };
    const [acc] = await sql<{ id: string; external_id: string }[]>`
      select id, external_id from core.accounts where channel = 'shopee' and active limit 1`;
    if (!acc) {
      console.log('Nenhuma conta da Shopee conectada.');
      return;
    }
    const shopId = Number(acc.external_id);
    const getToken = createTokenProvider(sql, acc.id, (rt) => refreshShopeeTokens(app, shopId, rt));

    /** Uma chamada assinada. Nunca lança por erro de endpoint; devolve http/erro. Renova o token 1 vez se for erro de autorização. */
    async function chamar(
      rotulo: string,
      path: string,
      params: Record<string, string | number> = {},
      post?: Obj,
    ): Promise<Resultado> {
      for (let tentativa = 0; tentativa < 3; tentativa++) {
        let token: string;
        try {
          token = await getToken(tentativa === 1);
        } catch (err) {
          const c = err instanceof ShopeeAuthError ? `auth:${err.codigo}` : 'token_falhou';
          return { http: 0, erro: c, corpo: null, ms: 0 };
        }
        const u = urlDaLoja(app, path, Math.floor(Date.now() / 1000), token, shopId, params);
        const t0 = Date.now();
        let http = 0;
        let corpo: Obj | null = null;
        try {
          const res = await fetch(u, {
            method: post ? 'POST' : 'GET',
            headers: { accept: 'application/json', ...(post ? { 'content-type': 'application/json' } : {}) },
            body: post ? JSON.stringify(post) : undefined,
            signal: AbortSignal.timeout(30_000),
          });
          http = res.status;
          const txt = await res.text();
          try {
            const j: unknown = JSON.parse(txt);
            corpo = isObj(j) ? j : null;
          } catch { /* não é JSON */ }
        } catch {
          return { http: 0, erro: 'rede', corpo: null, ms: Date.now() - t0 };
        }
        const ms = Date.now() - t0;
        medir(rotulo, ms);
        const erro = codigo(corpo?.error);
        if (tentativa === 0 && (erro === 'error_auth' || erro.startsWith('invalid_acc'))) continue; // renova e tenta de novo
        if (http === 429 || erro === 'error_rate_limit') {
          await dormir(2000 * (tentativa + 1));
          continue;
        }
        return { http, erro, corpo, ms };
      }
      return { http: 0, erro: 'esgotou_tentativas', corpo: null, ms: 0 };
    }

    const cabecalho = (rotulo: string, path: string, r: Resultado) =>
      console.log(`\n# ${rotulo} ${path}\n  HTTP ${r.http} | erro Shopee: ${r.erro || '(nenhum)'} | ${r.ms} ms`);
    const campos = (r: Resultado) => {
      if (!r.corpo || r.erro) return;
      const c = caminhosDeCampos(r.corpo.response ?? r.corpo);
      console.log(`  campos (${c.length}): ${c.join(', ') || '(vazio)'}`);
    };
    const resp = (r: Resultado): Obj => (isObj(r.corpo?.response) ? (r.corpo!.response as Obj) : {});

    const agora = Math.floor(Date.now() / 1000);
    console.log(`=== SONDA SHOPEE (shop ${shopId}) ===`);

    // ---------- Pedidos ----------
    console.log('\n=== PEDIDOS ===');
    const P = '/api/v2/order/get_order_list';
    // Limite de janela: 15 dias deve passar e 16 dias deve falhar (observa o código).
    for (const dias of [15, 16]) {
      const r = await chamar('order_list', P, {
        time_range_field: 'create_time', time_from: agora - dias * DIA, time_to: agora, page_size: 100,
      });
      cabecalho(`janela de ${dias} dias`, P, r);
      await dormir(PAUSA_MS);
    }
    const rLista = await chamar('order_list', P, {
      time_range_field: 'create_time', time_from: agora - 15 * DIA, time_to: agora, page_size: 100,
    });
    cabecalho('lista (15 dias, page_size 100)', P, rLista);
    campos(rLista);
    const listaOrders = Array.isArray(resp(rLista).order_list) ? (resp(rLista).order_list as Obj[]) : [];
    console.log(`  pedidos na página: ${listaOrders.length} | more=${String(resp(rLista).more)}`);
    const sns = listaOrders.map((o) => String(o.order_sn)).filter(Boolean);
    await dormir(PAUSA_MS);

    const PD = '/api/v2/order/get_order_detail';
    if (sns.length) {
      const opcionais = 'item_list,pay_time,package_list,shipping_carrier,payment_method,total_amount,estimated_shipping_fee,actual_shipping_fee,checkout_shipping_carrier,reverse_shipping_fee,edt';
      const r = await chamar('order_detail', PD, { order_sn_list: sns.slice(0, 10).join(','), response_optional_fields: opcionais });
      cabecalho('detalhe (até 10 pedidos)', PD, r);
      campos(r);
      await dormir(PAUSA_MS);

      // ---------- Pagamento ----------
      console.log('\n=== PAGAMENTO (escrow) ===');
      const PE = '/api/v2/payment/get_escrow_detail';
      const re = await chamar('escrow', PE, { order_sn: sns[0]! });
      cabecalho('escrow de 1 pedido', PE, re);
      campos(re);
      await dormir(PAUSA_MS);

      const PB = '/api/v2/payment/get_escrow_detail_batch';
      const rb = await chamar('escrow_batch', PB, {}, { order_sn_list: sns.slice(0, 50) });
      cabecalho(`escrow em lote (${Math.min(sns.length, 50)} pedidos, POST somente leitura)`, PB, rb);
      campos(rb);
      const lote = Array.isArray(rb.corpo?.response) ? (rb.corpo!.response as unknown[]) : [];
      console.log(`  itens devolvidos no lote: ${lote.length}`);
      await dormir(PAUSA_MS);
    } else {
      console.log('  sem pedidos nos últimos 15 dias: detalhe e escrow não testados.');
    }

    // ---------- Itens ----------
    console.log('\n=== ITENS ===');
    const PI = '/api/v2/product/get_item_list';
    const ri = await chamar('item_list', PI, { offset: 0, page_size: 100, item_status: 'NORMAL' });
    cabecalho('lista de itens (NORMAL)', PI, ri);
    campos(ri);
    const itens = Array.isArray(resp(ri).item) ? (resp(ri).item as Obj[]) : [];
    console.log(`  itens na página: ${itens.length} | total_count=${String(resp(ri).total_count)} | has_next_page=${String(resp(ri).has_next_page)}`);
    const ids = itens.map((i) => Number(i.item_id)).filter(Number.isFinite);
    await dormir(PAUSA_MS);
    if (ids.length) {
      const PBI = '/api/v2/product/get_item_base_info';
      const rbi = await chamar('item_base', PBI, { item_id_list: ids.slice(0, 50).join(',') });
      cabecalho('dados básicos (até 50 itens)', PBI, rbi);
      campos(rbi);
      await dormir(PAUSA_MS);
      const PM = '/api/v2/product/get_model_list';
      const rm = await chamar('model_list', PM, { item_id: ids[0]! });
      cabecalho('variações do 1º item', PM, rm);
      campos(rm);
      await dormir(PAUSA_MS);
    }

    // ---------- Ads ----------
    console.log('\n=== ADS ===');
    const ini = dataAds((agora - 7 * DIA) * 1000);
    const fim = dataAds((agora - 1 * DIA) * 1000);
    for (const [rotulo, path, params] of [
      ['desempenho diário (conta)', '/api/v2/ads/get_all_cpc_ads_daily_performance', { start_date: ini, end_date: fim }],
      ['desempenho diário (por produto)', '/api/v2/ads/get_product_level_cpc_ads_daily_performance', { start_date: ini, end_date: fim }],
      ['saldo total', '/api/v2/ads/get_total_balance', {}],
    ] as [string, string, Record<string, string>][]) {
      const r = await chamar('ads', path, params);
      cabecalho(rotulo, path, r);
      campos(r);
      await dormir(PAUSA_MS);
    }

    // ---------- Avaliações e reclamações ----------
    console.log('\n=== AVALIAÇÕES E RECLAMAÇÕES ===');
    if (ids.length) {
      const PC = '/api/v2/product/get_comment';
      const rc = await chamar('comment', PC, { item_id: ids[0]!, cursor: '', page_size: 10 });
      cabecalho('avaliações do 1º item', PC, rc);
      campos(rc);
      await dormir(PAUSA_MS);
    }
    const PR = '/api/v2/returns/get_return_list';
    const rr = await chamar('returns', PR, { page_no: 0, page_size: 10, create_time_from: agora - 15 * DIA, create_time_to: agora });
    cabecalho('devoluções/reclamações (15 dias)', PR, rr);
    campos(rr);
    await dormir(PAUSA_MS);

    // ---------- Histórico: 12 meses ----------
    console.log('\n=== HISTÓRICO: PEDIDOS DOS ÚLTIMOS 12 MESES (janelas de até 15 dias, sem virar o mês) ===');
    const janelas = janelasPorMes(Date.UTC(new Date().getUTCFullYear() - 1, new Date().getUTCMonth(), new Date().getUTCDate()), agora * 1000);
    const porMes = new Map<string, number>();
    const porStatus = new Map<string, number>();
    let total = 0;
    let chamadasLista = 0;
    let falhas = 0;
    for (const j of janelas) {
      let cursor = '';
      for (;;) {
        const r = await chamar('hist_lista', P, {
          time_range_field: 'create_time', time_from: j.de, time_to: j.ate, page_size: 100, ...(cursor ? { cursor } : {}),
        });
        chamadasLista++;
        if (r.erro || r.http !== 200) {
          falhas++;
          console.log(`  janela ${j.mes} (${new Date(j.de * 1000).toISOString().slice(0, 10)}): falhou HTTP ${r.http} erro ${r.erro || '-'}`);
          break;
        }
        const lista = Array.isArray(resp(r).order_list) ? (resp(r).order_list as Obj[]) : [];
        total += lista.length;
        porMes.set(j.mes, (porMes.get(j.mes) ?? 0) + lista.length);
        for (const o of lista) {
          const s = codigo(o.order_status) || '(sem status)';
          porStatus.set(s, (porStatus.get(s) ?? 0) + 1);
        }
        await dormir(PAUSA_MS);
        if (resp(r).more === true && typeof resp(r).next_cursor === 'string') cursor = resp(r).next_cursor as string;
        else break;
      }
    }
    console.log(`  janelas: ${janelas.length} | chamadas de lista: ${chamadasLista} | janelas com falha: ${falhas}`);
    console.log('  pedidos por mês:');
    for (const [m, n] of [...porMes.entries()].sort()) console.log(`    ${m}: ${n}`);
    console.log(`  TOTAL: ${total}`);
    console.log(`  por status: ${[...porStatus.entries()].map(([s, n]) => `${s}=${n}`).join(', ')}`);

    // Estimativa da carga inicial: lista (medida) + detalhe (50/chamada) + escrow em lote (50/chamada).
    const lotes = Math.ceil(total / 50);
    const msLista = media('hist_lista') || media('order_list') || 1000;
    const msDet = media('order_detail') || 1000;
    const msEsc = media('escrow_batch') || media('escrow') * 3 || 3000;
    const segundos = (chamadasLista * (msLista + PAUSA_MS) + lotes * (msDet + PAUSA_MS) + lotes * (msEsc + PAUSA_MS)) / 1000;
    console.log('\n=== ESTIMATIVA DA CARGA INICIAL ===');
    console.log(`  latência média por chamada (ms): lista=${msLista.toFixed(0)} detalhe=${msDet.toFixed(0)} escrow_lote=${msEsc.toFixed(0)}`);
    console.log(`  chamadas: lista=${chamadasLista} detalhe=${lotes} escrow_lote=${lotes} (50 pedidos por chamada)`);
    console.log(`  tempo estimado: ${(segundos / 60).toFixed(1)} min (${(segundos / 3600).toFixed(2)} h) | ${segundos / 3600 > 5 ? 'PASSA de 5 h: propor carga em partes' : 'cabe em 5 h'}`);

    console.log('\n=== LATÊNCIA MÉDIA POR ENDPOINT (ms) ===');
    for (const [k, a] of latencias) console.log(`  ${k}: ${media(k).toFixed(0)} (${a.length} chamadas)`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('ERRO:', err instanceof Error ? err.name : 'desconhecido');
  process.exit(1);
});
