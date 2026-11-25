import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { atualizarPrazos, enviosParaAtualizar, salvarPrazos, salvarReputacao } from './prazos-envio.ts';
import type { Sql } from './db.ts';

// Banco: PGlite real, com as tabelas mínimas (mesmas colunas da migration 0023 e de mkt.orders).
// O "sql" é um adaptador fino que faz o papel das tagged templates do postgres.js.
const db = new PGlite();
const sql = (async (strings: TemplateStringsArray, ...valores: unknown[]) => {
  const q = strings.reduce((acc, s, i) => acc + s + (i < valores.length ? `$${i + 1}` : ''), '');
  return (await db.query(q, valores as never[])).rows;
}) as unknown as Sql;

const dias = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
async function pedido(id: string, envio: string, status: string, diasAtras: number) {
  await db.query(
    `insert into mkt.orders (channel, order_id, status, date_created, shipment_id) values ('mercadolivre', $1, $2, $3, $4)`,
    [id, status, dias(diasAtras), envio],
  );
}

before(async () => {
  await db.exec(`
    create schema mkt;
    create table mkt.orders (channel text not null, order_id text not null, status text, date_created timestamptz,
      shipment_id text, primary key (channel, order_id));
    create table mkt.envios_prazos (channel text not null, shipment_id text not null, account_id uuid, status text,
      substatus text, prazo_despacho date, prazo_entrega date, despachado_em timestamptz, entregue_em timestamptz,
      atualizado_em timestamptz not null default now(), primary key (channel, shipment_id));
    create table mkt.reputacao_fotos (account_id uuid not null, capturado_em timestamptz not null default now(),
      level_id text, power_seller_status text, reclamacoes_taxa numeric, cancelamentos_taxa numeric, atrasos_taxa numeric,
      vendas_periodo integer, periodo text, primary key (account_id, capturado_em));`);
  await pedido('1', 'S-NOVO', 'paid', 10);
  await pedido('2', 'S-ENTREGUE', 'paid', 10);
  await pedido('3', 'S-ANTIGO', 'paid', 60);
  await pedido('4', 'S-CANCELADO', 'cancelled', 10);
  await pedido('5', 'S-ABERTO', 'paid', 20);
  await pedido('6', 'S-SEMENVIO', 'paid', 5);
  await db.query(`insert into mkt.envios_prazos (channel, shipment_id, status) values
    ('mercadolivre','S-ENTREGUE','delivered'), ('mercadolivre','S-ABERTO','shipped'), ('mercadolivre','S-SEMENVIO','sem_envio')`);
});

const CONTA = '11111111-1111-1111-1111-111111111111';
const prazos = {
  status: 'ready_to_ship', substatus: 'printed', prazoDespacho: '2026-11-27', prazoEntrega: '2026-12-02',
  despachadoEm: null, entregueEm: null,
};

test('seleciona envios sem prazo salvo ou com status não final, mais antigos primeiro', async () => {
  const r = await enviosParaAtualizar(sql);
  assert.deepEqual(r, ['S-ABERTO', 'S-NOVO']);
});

test('não seleciona entregue, pedido de 60 dias, cancelado nem sem_envio', async () => {
  const r = await enviosParaAtualizar(sql);
  for (const x of ['S-ENTREGUE', 'S-ANTIGO', 'S-CANCELADO', 'S-SEMENVIO']) assert.ok(!r.includes(x), x);
});

test('respeita o limite', async () => {
  assert.deepEqual(await enviosParaAtualizar(sql, 1), ['S-ABERTO']);
});

test('salvarPrazos duas vezes atualiza e não duplica', async () => {
  await salvarPrazos(sql, CONTA, 'S-NOVO', prazos);
  await salvarPrazos(sql, CONTA, 'S-NOVO', { ...prazos, status: 'shipped', despachadoEm: '2026-11-26T12:00:00.000Z' });
  const { rows } = await db.query<Record<string, unknown>>(
    `select status, substatus, prazo_despacho::text as pd, prazo_entrega::text as pe, despachado_em is not null as dsp
       from mkt.envios_prazos where shipment_id = 'S-NOVO'`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'shipped');
  assert.equal(rows[0].pd, '2026-11-27');
  assert.equal(rows[0].pe, '2026-12-02');
  assert.equal(rows[0].dsp, true);
});

test("salvarPrazos(..., null) grava 'sem_envio'", async () => {
  await salvarPrazos(sql, CONTA, 'S-NULO', null);
  const { rows } = await db.query<Record<string, unknown>>(`select status from mkt.envios_prazos where shipment_id = 'S-NULO'`);
  assert.equal(rows[0].status, 'sem_envio');
});

test('salvarReputacao grava as taxas em percentual', async () => {
  await salvarReputacao(sql, CONTA, {
    levelId: '5_green', powerSellerStatus: 'gold', reclamacoesPct: 1.5, cancelamentosPct: 0.5, atrasosPct: 2,
    vendasPeriodo: 120, periodo: '60 days',
  });
  const { rows } = await db.query<Record<string, unknown>>(
    `select level_id, reclamacoes_taxa::float8 as rec, cancelamentos_taxa::float8 as can, atrasos_taxa::float8 as atr, vendas_periodo
       from mkt.reputacao_fotos where account_id = $1`, [CONTA]);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].level_id, rows[0].rec, rows[0].can, rows[0].atr, rows[0].vendas_periodo], ['5_green', 1.5, 0.5, 2, 120]);
});

test('um envio que falha não impede os demais; a falha é contada; envio em 2 pedidos é buscado uma vez', async () => {
  await db.exec('delete from mkt.orders; delete from mkt.envios_prazos');
  await pedido('10', 'S-A', 'paid', 9);
  await pedido('11', 'S-A', 'paid', 8); // mesmo envio, 2 pedidos
  await pedido('12', 'S-RUIM', 'paid', 7);
  await pedido('13', 'S-B', 'paid', 6);
  const chamadas: string[] = [];
  const ml = {
    async getPrazosEnvio(id: string) {
      chamadas.push(id);
      if (id === 'S-RUIM') throw new Error('HTTP 429');
      return { ...prazos };
    },
  };
  const orig = console.warn;
  console.warn = () => {};
  let r;
  try { r = await atualizarPrazos(sql, ml, CONTA); } finally { console.warn = orig; }
  assert.deepEqual(r, { processados: 2, falhas: 1 });
  assert.deepEqual(chamadas, ['S-A', 'S-RUIM', 'S-B']);
  const { rows } = await db.query<{ shipment_id: string }>('select shipment_id from mkt.envios_prazos order by 1');
  assert.deepEqual(rows.map((x) => x.shipment_id), ['S-A', 'S-B']);
});
