import { test, afterEach } from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import {
  MAX_PAGINAS,
  SHOPEE_API,
  SHOPEE_AUTH_EXPIRED,
  ShopeeAuthError,
  ShopeeConnector,
  camposNumericos,
  mapShopeeStatus,
  shopeeSign,
  tarifasDoEscrow,
  toShopeeOrder,
} from './connector.ts';

// Chave, tokens e loja FICTÍCIOS — nenhum valor real.
const app = { partnerId: 2001887, partnerKey: 'chave-ficticia-de-teste' };
const SHOP_ID = 123456;
const DAY = 86_400;

const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Chamada { url: URL; method: string; body: unknown }

/** Servidor falso da Shopee: responde por caminho e registra as chamadas. */
function servidor(rotas: Record<string, (u: URL, body: unknown) => Response>): Chamada[] {
  const chamadas: Chamada[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(url);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    chamadas.push({ url: u, method: init?.method ?? 'GET', body });
    const rota = rotas[u.pathname];
    if (!rota) return json({ error: 'error_not_found', message: 'x' }, 404);
    return rota(u, body);
  }) as typeof fetch;
  return chamadas;
}

/** Provedor de token falso: conta as chamadas e as renovações forçadas. */
function tokens() {
  const pedidos: boolean[] = [];
  const provider = async (force = false) => { pedidos.push(force); return force ? 'acc-novo' : 'acc-1'; };
  return { provider, pedidos };
}

function detalhe(sn: string, create: number, extra: Record<string, unknown> = {}) {
  return {
    order_sn: sn,
    order_status: 'COMPLETED',
    create_time: create,
    update_time: create + 100,
    pay_time: create + 10,
    currency: 'BRL',
    total_amount: 59.9,
    buyer_user_id: 999,
    buyer_username: 'comprador-ficticio',
    message_to_seller: 'recado do comprador',
    recipient_address: { name: 'Fulano', phone: '11999999999', full_address: 'Rua X' },
    item_list: [{
      item_id: 111, item_name: 'Caneca', item_sku: 'BLA68', model_id: 222, model_name: 'Azul',
      model_sku: 'BLA68-AZU-K0010', model_quantity_purchased: 2, model_original_price: 35, model_discounted_price: 29.95,
      cancelled_qty: 0, returned_qty: 0,
    }],
    ...extra,
  };
}

// ------------------------------------------------------------------------
// Step 1 — status e pedidos estranhos (Review Focus 1)
// ------------------------------------------------------------------------

test('status: só os pagos viram "paid"; cancelados viram "cancelled"; UNPAID e desconhecidos não são venda', () => {
  for (const s of ['READY_TO_SHIP', 'PROCESSED', 'SHIPPED', 'TO_CONFIRM_RECEIVE', 'COMPLETED', 'RETRY_SHIP', 'TO_RETURN']) {
    assert.equal(mapShopeeStatus(s), 'paid', s);
  }
  assert.equal(mapShopeeStatus('CANCELLED'), 'cancelled');
  assert.equal(mapShopeeStatus('IN_CANCEL'), 'cancelled');
  assert.equal(mapShopeeStatus('UNPAID'), 'unpaid');
  assert.equal(mapShopeeStatus('INVOICE_PENDING_X'), 'unknown');
  assert.equal(mapShopeeStatus(undefined), 'unknown');
});

test('pedido sem itens não quebra e mantém o total', () => {
  const o = toShopeeOrder({ order_sn: 'SEMITENS', order_status: 'COMPLETED', create_time: 1_780_000_000, total_amount: 10 });
  assert.equal(o.orderId, 'SEMITENS');
  assert.equal(o.status, 'paid');
  assert.deepEqual(o.items, []);
  assert.equal(o.totalAmount, 10);
});

test('pedido com item_list nulo ou item incompleto não quebra', () => {
  const o = toShopeeOrder({ order_sn: 'A', order_status: 'SHIPPED', create_time: 1_780_000_000, item_list: null, total_amount: null });
  assert.deepEqual(o.items, []);
  assert.equal(o.totalAmount, 0);
  const o2 = toShopeeOrder({ order_sn: 'B', order_status: 'SHIPPED', create_time: 1_780_000_000, item_list: [{}] });
  assert.equal(o2.items.length, 1);
  assert.equal(o2.items[0].quantity, 0);
  assert.equal(o2.items[0].unitPrice, 0);
  assert.equal(o2.items[0].sku, null);
});

test('cancelado e status desconhecido não entram como venda paga; o status da Shopee fica nas tags', () => {
  const c = toShopeeOrder(detalhe('C1', 1_780_000_000, { order_status: 'CANCELLED', pay_time: null }));
  assert.equal(c.status, 'cancelled');
  assert.equal(c.paidAmount, null);
  assert.ok(c.tags.includes('shopee:CANCELLED'));
  assert.ok(c.tags.includes('shopee:sem_pagamento'));
  const u = toShopeeOrder(detalhe('U1', 1_780_000_000, { order_status: 'STATUS_NOVO' }));
  assert.equal(u.status, 'unknown');
  assert.equal(u.paidAmount, null);
  assert.ok(u.tags.includes('shopee:STATUS_NOVO'));
});

test('pedido pago: itens, variação, SKU da variação, preço com desconto, datas e moeda', () => {
  const o = toShopeeOrder(detalhe('P1', 1_780_000_000));
  assert.equal(o.channel, 'shopee');
  assert.equal(o.status, 'paid');
  assert.equal(o.paidAmount, 59.9);
  assert.equal(o.dateCreated, new Date(1_780_000_000_000).toISOString());
  assert.equal(o.dateClosed, new Date(1_780_000_010_000).toISOString());
  assert.equal(o.currency, 'BRL');
  assert.deepEqual(o.items, [{
    lineNo: 1, itemId: '111', variationId: '222', sku: 'BLA68-AZU-K0010', title: 'Caneca',
    quantity: 2, unitPrice: 29.95, saleFee: null, listingType: null,
  }]);
});

test('variação 0 vira nula e sem SKU da variação usa o SKU do anúncio', () => {
  const o = toShopeeOrder(detalhe('P2', 1_780_000_000, {
    item_list: [{ item_id: 5, item_name: 'X', item_sku: 'BLA68-AZU', model_id: 0, model_sku: '', model_quantity_purchased: 1, model_original_price: 10 }],
  }));
  assert.equal(o.items[0].variationId, null);
  assert.equal(o.items[0].sku, 'BLA68-AZU');
  assert.equal(o.items[0].unitPrice, 10); // sem preço com desconto: usa o original
});

test('privacidade: o raw não guarda comprador, endereço nem recado', () => {
  const o = toShopeeOrder(detalhe('P3', 1_780_000_000));
  const raw = JSON.stringify(o.raw);
  for (const proibido of ['buyer_user_id', 'buyer_username', 'recipient_address', 'message_to_seller', 'comprador-ficticio', '11999999999', 'Fulano']) {
    assert.ok(!raw.includes(proibido), proibido);
  }
  assert.equal(o.buyerId, null);
  assert.ok(raw.includes('item_list'));
});

// ------------------------------------------------------------------------
// Step 2 — escrow (pagamento): sem escrow não grava tarifa zero (Review Focus 3)
// ------------------------------------------------------------------------

test('escrow ausente ou sem valor líquido devolve null (nenhuma linha; o pedido volta a ser buscado)', () => {
  assert.equal(tarifasDoEscrow(undefined), null);
  assert.equal(tarifasDoEscrow({ orderSn: 'X', income: {} }), null);
  assert.equal(tarifasDoEscrow({ orderSn: 'X', income: { escrow_amount: null, commission_fee: 0 } }), null);
});

test('tarifas zeradas ou ausentes não geram linha', () => {
  assert.deepEqual(tarifasDoEscrow({ orderSn: 'X', income: { escrow_amount: 0, commission_fee: 0, service_fee: 0 } }), []);
});

test('mapeamento das tarifas (exemplo da revisão): frete líquido do subsídio e do frete pago pelo comprador; fecha com o líquido', () => {
  const linhas = tarifasDoEscrow({
    orderSn: 'X',
    income: {
      escrow_amount: 41.7,
      commission_fee: 8.5,
      service_fee: 3.2,
      seller_transaction_fee: 1.5,
      actual_shipping_fee: 20,
      shopee_shipping_rebate: 15,
      buyer_paid_shipping_fee: 5,
      voucher_from_seller: 5,
    },
  })!;
  assert.deepEqual(linhas, [
    { categoria: 'comissao', valor: 8.5 },
    { categoria: 'taxa_servico', valor: 3.2 },
    { categoria: 'taxa_transacao', valor: 1.5 },
    { categoria: 'cupom_vendedor', valor: 5 },
    { categoria: 'liquido', valor: 41.7 },
  ]);
  // itens 59,90 - tarifas - líquido = 0 (frete 0 não vira linha)
  const tarifas = linhas.filter((l) => l.categoria !== 'liquido').reduce((s, l) => s + l.valor, 0);
  assert.equal(Math.round((59.9 - tarifas - 41.7) * 100) / 100, 0);
});

test('demais categorias: campanha, processamento, devolução; taxa de cartão, seller_discount e cupom da Shopee ficam fora', () => {
  const linhas = tarifasDoEscrow({
    orderSn: 'X',
    income: {
      escrow_amount: 40.12, credit_card_transaction_fee: 0.4, seller_transaction_fee: 1.1,
      actual_shipping_fee: 20, shopee_shipping_rebate: 10, buyer_paid_shipping_fee: 4,
      seller_discount: 7, shopee_voucher: 9, campaign_fee: 2, seller_order_processing_fee: 1,
      return_handling_fee: 0.5, reverse_shipping_fee: 4,
    },
  });
  assert.deepEqual(linhas, [
    { categoria: 'taxa_transacao', valor: 1.1 }, // credit_card_transaction_fee NÃO é descontada (rodada 3)
    { categoria: 'frete', valor: 6 },
    { categoria: 'campanha', valor: 2 },
    { categoria: 'processamento', valor: 1 },
    { categoria: 'devolucao', valor: 4.5 },
    { categoria: 'liquido', valor: 40.12 },
  ]);
});

test('sinal da Shopee preservado: ajuste negativo de comissão fica crédito; subsídio maior que o frete vira crédito', () => {
  const linhas = tarifasDoEscrow({
    orderSn: 'X',
    income: { escrow_amount: 10, commission_fee: -8.5, actual_shipping_fee: 10, shopee_shipping_rebate: 12 },
  });
  assert.deepEqual(linhas, [
    { categoria: 'comissao', valor: -8.5 },
    { categoria: 'frete', valor: -2 },
    { categoria: 'liquido', valor: 10 },
  ]);
});

test('cupom do vendedor: aceita seller_voucher quando voucher_from_seller não vem', () => {
  const linhas = tarifasDoEscrow({ orderSn: 'X', income: { escrow_amount: 10, seller_voucher: 3 } });
  assert.deepEqual(linhas, [{ categoria: 'cupom_vendedor', valor: 3 }, { categoria: 'liquido', valor: 10 }]);
});

test('getEscrowBatch: POST assinado, 50 por chamada, sem comprador; pedido sem escrow fica de fora', async () => {
  const sns = Array.from({ length: 51 }, (_, i) => `SN${i}`);
  const chamadas = servidor({
    '/api/v2/payment/get_escrow_detail_batch': (_u, body) => {
      const lista = (body as { order_sn_list: string[] }).order_sn_list;
      return json({
        error: '', message: '',
        response: lista.filter((sn) => sn !== 'SN7').map((sn) => ({
          escrow_detail: {
            order_sn: sn,
            buyer_user_name: 'comprador-ficticio',
            buyer_payment_info: { buyer_payment_method: 'pix', buyer_total_amount: 50 },
            order_income: { escrow_amount: 40, commission_fee: 5, buyer_paid_shipping_fee: 3, buyer_user_name: 'comprador-ficticio', buyer_total_amount: 50 },
          },
        })),
      });
    },
  });
  const { provider } = tokens();
  const shopee = new ShopeeConnector(app, SHOP_ID, provider);
  const res = await shopee.getEscrowBatch(sns);

  assert.equal(chamadas.length, 2);
  assert.ok(chamadas.every((c) => c.method === 'POST'));
  assert.deepEqual(chamadas.map((c) => (c.body as { order_sn_list: string[] }).order_sn_list.length), [50, 1]);
  assert.equal(res.length, 50);
  assert.ok(!res.some((e) => e.orderSn === 'SN7'));
  assert.ok(!JSON.stringify(res).includes('comprador-ficticio'));
  assert.ok(!JSON.stringify(res).includes('buyer_payment_info'));
  assert.ok(!JSON.stringify(res).includes('buyer_total_amount'));
  assert.deepEqual(res[0].income, { escrow_amount: 40, commission_fee: 5, buyer_paid_shipping_fee: 3 });
  assert.deepEqual(res[0].campos, { escrow_amount: 40, commission_fee: 5, buyer_paid_shipping_fee: 3 });
  const u = chamadas[0].url;
  const ts = Number(u.searchParams.get('timestamp'));
  assert.equal(u.searchParams.get('sign'), shopeeSign(app, '/api/v2/payment/get_escrow_detail_batch', ts, 'acc-1', SHOP_ID));
});

test('getEscrowBatch com lista vazia não chama a API', async () => {
  const chamadas = servidor({});
  const { provider } = tokens();
  assert.deepEqual(await new ShopeeConnector(app, SHOP_ID, provider).getEscrowBatch([]), []);
  assert.equal(chamadas.length, 0);
});

// ------------------------------------------------------------------------
// Step 3 — paginação em janelas de 15 dias, sem perder nem repetir nas bordas
// ------------------------------------------------------------------------

test('listOrders: janelas de até 15 dias, cursor, sem perder nem repetir pedidos nas bordas', async () => {
  const from = new Date(1_780_000_000_000);
  const to = new Date(from.getTime() + 40 * DAY * 1000 + 12_345);
  const ini = Math.floor(from.getTime() / 1000);
  const fim = Math.floor(to.getTime() / 1000);
  // Pedidos em todo segundo crítico: início, fim, bordas das janelas de 15 dias e vizinhos
  const tempos = new Set<number>([ini, fim]);
  for (let k = 1; k <= 3; k++) for (const d of [-1, 0, 1]) {
    const t = ini + k * 15 * DAY + d;
    if (t >= ini && t <= fim) tempos.add(t);
  }
  for (let i = 0; i < 230; i++) tempos.add(ini + Math.floor((i * (fim - ini)) / 230)); // > 100 numa janela: força cursor
  const pedidos = [...tempos].map((t) => ({ sn: `SN${t}`, t }));

  const janelas: [number, number][] = [];
  const chamadas = servidor({
    '/api/v2/order/get_order_list': (u) => {
      const a = Number(u.searchParams.get('time_from'));
      const b = Number(u.searchParams.get('time_to'));
      assert.equal(u.searchParams.get('time_range_field'), 'create_time');
      assert.equal(u.searchParams.get('page_size'), '100');
      const cursor = Number(u.searchParams.get('cursor') || 0);
      if (cursor === 0) janelas.push([a, b]);
      if (b - a > 15 * DAY) return json({ error: 'order.order_list_invalid_time', message: 'x' });
      const dentro = pedidos.filter((p) => p.t >= a && p.t <= b);
      const pagina = dentro.slice(cursor, cursor + 100);
      const more = cursor + 100 < dentro.length;
      return json({ error: '', message: '', response: { more, next_cursor: more ? String(cursor + 100) : '', order_list: pagina.map((p) => ({ order_sn: p.sn })) } });
    },
    '/api/v2/order/get_order_detail': (u) => {
      const sns = (u.searchParams.get('order_sn_list') ?? '').split(',');
      assert.ok(sns.length <= 50);
      return json({ error: '', message: '', response: { order_list: sns.map((sn) => detalhe(sn, Number(sn.slice(2)))) } });
    },
  });
  const { provider } = tokens();
  const shopee = new ShopeeConnector(app, SHOP_ID, provider);
  const vistos: string[] = [];
  for await (const lote of shopee.listOrders(from, to)) vistos.push(...lote.map((o) => o.orderId));

  assert.equal(vistos.length, pedidos.length, 'nenhum pedido perdido ou repetido');
  assert.equal(new Set(vistos).size, pedidos.length);
  assert.deepEqual(new Set(vistos), new Set(pedidos.map((p) => p.sn)));
  // Janelas encadeadas sem buraco, com 1 segundo de sobreposição, cada uma com no máximo 15 dias
  assert.equal(janelas[0][0], ini);
  assert.equal(janelas.at(-1)![1], fim);
  for (let i = 0; i < janelas.length; i++) {
    assert.ok(janelas[i][1] - janelas[i][0] < 15 * DAY);
    if (i) assert.equal(janelas[i][0], janelas[i - 1][1], 'sobreposição de 1 segundo');
  }
  assert.equal(janelas.length, 3);
  // O detalhe não pede dados do comprador nem do endereço
  const det = chamadas.find((c) => c.url.pathname.endsWith('get_order_detail'))!;
  const campos = det.url.searchParams.get('response_optional_fields') ?? '';
  assert.ok(/item_list/.test(campos) && /pay_time/.test(campos) && /total_amount/.test(campos));
  assert.ok(!/buyer|recipient/.test(campos));
});

test('listOrders: lista vazia não chama o detalhe', async () => {
  const chamadas = servidor({
    '/api/v2/order/get_order_list': () => json({ error: '', response: { more: false, next_cursor: '', order_list: [] } }),
  });
  const { provider } = tokens();
  const shopee = new ShopeeConnector(app, SHOP_ID, provider);
  const lotes = [];
  for await (const l of shopee.listOrders(new Date(1_780_000_000_000), new Date(1_780_000_000_000 + DAY * 1000))) lotes.push(l);
  assert.equal(lotes.flat().length, 0);
  assert.ok(chamadas.every((c) => c.url.pathname.endsWith('get_order_list')));
});

test('getOrders: busca o detalhe de pedidos já conhecidos, em lotes de 50', async () => {
  const chamadas = servidor({
    '/api/v2/order/get_order_detail': (u) => {
      const sns = (u.searchParams.get('order_sn_list') ?? '').split(',');
      return json({ error: '', response: { order_list: sns.map((sn) => detalhe(sn, 1_780_000_000)) } });
    },
  });
  const { provider } = tokens();
  const res = await new ShopeeConnector(app, SHOP_ID, provider).getOrders(Array.from({ length: 60 }, (_, i) => `P${i}`));
  assert.equal(res.length, 60);
  assert.equal(chamadas.length, 2);
});

// ------------------------------------------------------------------------
// Assinatura, autorização e erros sem segredo
// ------------------------------------------------------------------------

test('chamada da loja leva partner_id, timestamp, access_token, shop_id e sign corretos', async () => {
  const chamadas = servidor({
    '/api/v2/order/get_order_list': () => json({ error: '', response: { more: false, next_cursor: '', order_list: [] } }),
  });
  const { provider } = tokens();
  for await (const _ of new ShopeeConnector(app, SHOP_ID, provider).listOrders(new Date(1_780_000_000_000), new Date(1_780_000_000_000 + 1000))) { /* nada */ }
  const u = chamadas[0].url;
  assert.equal(u.origin, SHOPEE_API);
  assert.equal(u.searchParams.get('partner_id'), '2001887');
  assert.equal(u.searchParams.get('shop_id'), String(SHOP_ID));
  assert.equal(u.searchParams.get('access_token'), 'acc-1');
  const ts = Number(u.searchParams.get('timestamp'));
  assert.equal(u.searchParams.get('sign'), shopeeSign(app, '/api/v2/order/get_order_list', ts, 'acc-1', SHOP_ID));
  assert.ok(!u.toString().includes(app.partnerKey));
});

test('token recusado: renova uma vez e repete; recusado de novo vira o aviso de reconexão, sem token no texto', async () => {
  const chamadas = servidor({
    '/api/v2/order/get_order_list': () => json({ error: 'invalid_acceess_token', message: 'token acc-1 invalido', request_id: 'r' }, 403),
  });
  const { provider, pedidos } = tokens();
  const shopee = new ShopeeConnector(app, SHOP_ID, provider);
  await assert.rejects(
    async () => { for await (const _ of shopee.listOrders(new Date(1_780_000_000_000), new Date(1_780_000_000_000 + 1000))) { /* nada */ } },
    (e: unknown) => e instanceof ShopeeAuthError && (e as Error).message === SHOPEE_AUTH_EXPIRED
      && !`${(e as Error).message}${(e as Error).stack}`.includes('acc-'),
  );
  assert.equal(chamadas.length, 2);
  assert.deepEqual(pedidos, [false, true]);
});

test('token renovado resolve: a segunda tentativa segue normalmente', async () => {
  let n = 0;
  servidor({
    '/api/v2/order/get_order_list': () => (n++ === 0
      ? json({ error: 'error_auth', message: 'x' }, 401)
      : json({ error: '', response: { more: false, next_cursor: '', order_list: [] } })),
  });
  const { provider, pedidos } = tokens();
  for await (const _ of new ShopeeConnector(app, SHOP_ID, provider).listOrders(new Date(1_780_000_000_000), new Date(1_780_000_000_000 + 1000))) { /* nada */ }
  assert.deepEqual(pedidos, [false, true]);
});

test('outro erro da Shopee vira erro com o código, sem o corpo, o token ou a chave', async () => {
  servidor({
    '/api/v2/order/get_order_detail': () => json({ error: 'error_param', message: 'acc-1 chave-ficticia-de-teste comprador' }, 400),
  });
  const { provider } = tokens();
  await assert.rejects(
    () => new ShopeeConnector(app, SHOP_ID, provider).getOrders(['A']),
    (e: unknown) => {
      const t = `${(e as Error).message} ${(e as Error).stack}`;
      return !(e instanceof ShopeeAuthError) && /error_param/.test(t) && !t.includes('acc-1') && !t.includes(app.partnerKey) && !t.includes('comprador');
    },
  );
});

test('erro da Shopee com HTTP 200 (campo error preenchido) também falha, sem segredo', async () => {
  servidor({
    '/api/v2/order/get_order_list': () => json({ error: 'order.order_list_invalid_time', message: 'acc-1' }),
  });
  const { provider } = tokens();
  await assert.rejects(
    async () => { for await (const _ of new ShopeeConnector(app, SHOP_ID, provider).listOrders(new Date(1_780_000_000_000), new Date(1_780_000_000_000 + 1000))) { /* nada */ } },
    (e: unknown) => /order\.order_list_invalid_time/.test((e as Error).message) && !(e as Error).message.includes('acc-1'),
  );
});

// ------------------------------------------------------------------------
// Revisão: permissão, renovação única e cursor
// ------------------------------------------------------------------------

const varrer = async (shopee: ShopeeConnector) => {
  const out: string[] = [];
  for await (const l of shopee.listOrders(new Date(1_780_000_000_000), new Date(1_780_000_000_000 + 1000))) out.push(...l.map((o) => o.orderId));
  return out;
};

for (const [nome, resp] of [
  ['error_permission', () => json({ error: 'error_permission', message: 'acc-1' })],
  ['HTTP 403 sem código', () => new Response('forbidden', { status: 403 })],
  ['error_permission com HTTP 403', () => json({ error: 'error_permission', message: 'x' }, 403)],
] as [string, () => Response][]) {
  test(`sem permissão (${nome}): não renova token nem pede reconexão`, async () => {
    const chamadas = servidor({ '/api/v2/order/get_order_list': resp });
    const { provider, pedidos } = tokens();
    await assert.rejects(
      () => varrer(new ShopeeConnector(app, SHOP_ID, provider)),
      (e: unknown) => !(e instanceof ShopeeAuthError) && /^Sem permissão na API da Shopee \((error_permission|http_403)\)/.test((e as Error).message)
        && !(e as Error).message.includes('acc-1') && !/reconect/i.test((e as Error).message),
    );
    assert.equal(chamadas.length, 1);
    assert.deepEqual(pedidos, [false]);
  });
}

test('renovação forçada no máximo uma vez por execução', async () => {
  let n = 0;
  servidor({
    // 1ª recusada, 2ª ok (após renovar), 3ª recusada de novo: não renova outra vez
    '/api/v2/order/get_order_list': () => (++n === 1 || n === 3
      ? json({ error: 'error_auth', message: 'x' })
      : json({ error: '', response: { more: false, next_cursor: '', order_list: [] } })),
  });
  const { provider, pedidos } = tokens();
  const shopee = new ShopeeConnector(app, SHOP_ID, provider);
  await varrer(shopee);
  await assert.rejects(() => varrer(shopee), (e: unknown) => e instanceof ShopeeAuthError);
  assert.deepEqual(pedidos, [false, true, false]);
  assert.equal(n, 3);
});

test('cursor repetido interrompe a paginação (sem laço infinito)', async () => {
  let n = 0;
  servidor({
    '/api/v2/order/get_order_list': () => { n++; return json({ error: '', response: { more: true, next_cursor: 'C1', order_list: [] } }); },
  });
  const { provider } = tokens();
  await varrer(new ShopeeConnector(app, SHOP_ID, provider));
  assert.equal(n, 2); // '' -> C1 -> C1 (repetido): para
});

test(`cursor que nunca termina para em ${MAX_PAGINAS} páginas`, async () => {
  let n = 0;
  servidor({
    '/api/v2/order/get_order_list': () => { n++; return json({ error: '', response: { more: true, next_cursor: `C${n}`, order_list: [] } }); },
  });
  const { provider } = tokens();
  await varrer(new ShopeeConnector(app, SHOP_ID, provider));
  assert.equal(n, MAX_PAGINAS);
});

// ------------------------------------------------------------------------
// Rodada 2: todos os campos em dinheiro do pagamento (conferência)
// ------------------------------------------------------------------------

test('campos numéricos: guarda todo número do order_income; nunca textos, comprador, listas, zeros ou ids', () => {
  const campos = camposNumericos({
    escrow_amount: 41.21,
    commission_fee: 8.5,
    taxa_fixa_nova: 0.49,              // campo ainda não mapeado: entra
    seller_return_refund: -12.3,       // negativo: entra com o sinal
    buyer_paid_shipping_fee: 5,        // dinheiro: entra
    buyer_user_name: 'comprador-ficticio',
    buyer_total_amount: 64.9,          // buyer_*: fica fora
    buyer_transaction_fee: 1,
    seller_voucher_code: ['CUPOM10'],
    order_sn: '2611ABC',
    some_text: '12.5',                 // número em texto: fica fora
    shopee_discount: 0,                // zero: fica fora
    infinito: Infinity,
    nan: NaN,
    seller_id: 999,
    id: 1,
    items: [{ item_id: 1, discounted_price: 10 }],
    detalhe: { valor: 3 },
    flag: true,
  });
  assert.deepEqual(campos, {
    escrow_amount: 41.21, commission_fee: 8.5, taxa_fixa_nova: 0.49, seller_return_refund: -12.3, buyer_paid_shipping_fee: 5,
  });
  assert.ok(!JSON.stringify(campos).includes('comprador'));
});

test('campos numéricos: entrada vazia ou inválida devolve objeto vazio', () => {
  assert.deepEqual(camposNumericos(undefined), {});
  assert.deepEqual(camposNumericos(null), {});
  assert.deepEqual(camposNumericos([1, 2]), {});
  assert.deepEqual(camposNumericos('x'), {});
});

test('campos numéricos não mudam o mapeamento das tarifas', () => {
  const income = { escrow_amount: 41.21, commission_fee: 8.5, taxa_fixa_nova: 0.49 };
  assert.deepEqual(tarifasDoEscrow({ orderSn: 'X', income, campos: camposNumericos(income) }), [
    { categoria: 'comissao', valor: 8.5 },
    { categoria: 'liquido', valor: 41.21 },
  ]);
});

// ------------------------------------------------------------------------
// Rodada 3: proteção do frete, reembolso e taxa de cartão fora (dados reais)
// ------------------------------------------------------------------------

interface Fixture { order_sn: string; itens: number; income: Record<string, number>; linhas: { categoria: string; valor: number }[] }
const reais = (JSON.parse(readFileSync(new URL('./fixtures/escrow-reais.json', import.meta.url), 'utf8')) as { pedidos: Fixture[] }).pedidos;

for (const f of reais) {
  test(`pedido ${f.order_sn}: categorias esperadas e conferência fecha em 0,00`, () => {
    const linhas = tarifasDoEscrow({ orderSn: f.order_sn, income: f.income })!;
    assert.deepEqual(linhas, f.linhas);
    const tarifas = linhas.filter((l) => l.categoria !== 'liquido').reduce((s, l) => s + l.valor, 0);
    const liquido = linhas.find((l) => l.categoria === 'liquido')?.valor ?? 0;
    assert.ok(Math.abs(f.itens - tarifas - liquido) < 0.005, `diferença ${f.itens - tarifas - liquido}`);
  });
}

test('comissão e serviço usam commission_fee e service_fee, nunca os campos net_*', () => {
  const linhas = tarifasDoEscrow({
    orderSn: 'X',
    income: { escrow_amount: 1, commission_fee: 37.72, net_commission_fee: 21.05, service_fee: 5, net_service_fee: 3 },
  });
  assert.deepEqual(linhas, [
    { categoria: 'comissao', valor: 37.72 },
    { categoria: 'taxa_servico', valor: 5 },
    { categoria: 'liquido', valor: 1 },
  ]);
});

test('taxa de cartão sozinha não vira tarifa', () => {
  assert.deepEqual(tarifasDoEscrow({ orderSn: 'X', income: { escrow_amount: 10, credit_card_transaction_fee: 30.54 } }),
    [{ categoria: 'liquido', valor: 10 }]);
});

test('reembolso: seller_return_refund negativo vira custo positivo; líquido negativo é mantido', () => {
  assert.deepEqual(tarifasDoEscrow({ orderSn: 'X', income: { escrow_amount: -0.49, seller_return_refund: -157.89 } }), [
    { categoria: 'reembolso', valor: 157.89 },
    { categoria: 'liquido', valor: -0.49 },
  ]);
});

test('getEscrowBatch leva os campos de proteção e de reembolso para o mapeamento', async () => {
  servidor({
    '/api/v2/payment/get_escrow_detail_batch': () => json({ error: '', response: [{ escrow_detail: { order_sn: 'A', order_income: {
      escrow_amount: -0.49, seller_return_refund: -157.89, shipping_seller_protection_fee_amount: 0.49,
      delivery_seller_protection_fee_premium_amount: 1,
    } } }] }),
  });
  const { provider } = tokens();
  const [e] = await new ShopeeConnector(app, SHOP_ID, provider).getEscrowBatch(['A']);
  assert.deepEqual(e.income, {
    escrow_amount: -0.49, shipping_seller_protection_fee_amount: 0.49, delivery_seller_protection_fee_premium_amount: 1, seller_return_refund: -157.89,
  });
});
