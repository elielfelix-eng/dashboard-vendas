import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerPrazosEnvio, lerReputacao } from './prazos.ts';

test('despacho vem de sla.expected_date', () => {
  const r = lerPrazosEnvio({ status: 'ready_to_ship', substatus: 'ready_to_print' }, { expected_date: '2026-11-30T23:59:59.000-03:00' });
  assert.equal(r.prazoDespacho, '2026-11-30');
  assert.equal(r.status, 'ready_to_ship');
  assert.equal(r.substatus, 'ready_to_print');
});

test('converte para o horário de Brasília', () => {
  const r = lerPrazosEnvio({}, { expected_date: '2026-12-01T01:00:00.000Z' });
  assert.equal(r.prazoDespacho, '2026-11-30');
});

test('sem sla usa lead_time.estimated_handling_limit.date', () => {
  const r = lerPrazosEnvio({ lead_time: { estimated_handling_limit: { date: '2026-12-02T23:59:59.000-03:00' } } }, null);
  assert.equal(r.prazoDespacho, '2026-12-02');
});

test('entrega vem de lead_time.estimated_delivery_time.date, com fallback', () => {
  const a = lerPrazosEnvio({ lead_time: { estimated_delivery_time: { date: '2026-12-05T10:00:00.000-03:00' } } }, null);
  assert.equal(a.prazoEntrega, '2026-12-05');
  const b = lerPrazosEnvio({ lead_time: { estimated_delivery_final: { date: '2026-12-07T10:00:00.000-03:00' } } }, null);
  assert.equal(b.prazoEntrega, '2026-12-07');
});

test('sem lead_time nenhum: prazos null, sem exceção', () => {
  const r = lerPrazosEnvio({ status: 'pending' }, undefined);
  assert.equal(r.prazoDespacho, null);
  assert.equal(r.prazoEntrega, null);
});

test('envio null: tudo null', () => {
  assert.deepEqual(lerPrazosEnvio(null, null), {
    status: null, substatus: null, prazoDespacho: null, prazoEntrega: null, despachadoEm: null, entregueEm: null,
  });
});

test('data inválida vira null', () => {
  assert.equal(lerPrazosEnvio({}, { expected_date: 'lixo' }).prazoDespacho, null);
});

test('lerReputacao converte frações em percentual', () => {
  const r = lerReputacao({
    level_id: '5_green',
    power_seller_status: 'gold',
    metrics: {
      claims: { rate: 0.009 }, cancellations: { rate: 0 }, delayed_handling_time: { rate: 0.03 },
      sales: { period: '60 days', completed: 120 },
    },
  });
  assert.equal(r.levelId, '5_green');
  assert.equal(r.powerSellerStatus, 'gold');
  assert.equal(r.reclamacoesPct, 0.9);
  assert.equal(r.cancelamentosPct, 0);
  assert.equal(r.atrasosPct, 3);
  assert.equal(r.vendasPeriodo, 120);
  assert.equal(r.periodo, '60 days');
});

test('lerReputacao: rate é sempre fração (x100)', () => {
  const pct = (rate: number) => lerReputacao({ metrics: { claims: { rate } } }).reclamacoesPct;
  assert.equal(pct(0.005), 0.5);
  assert.equal(pct(0.01), 1);
  assert.equal(pct(0.03), 3);
  assert.equal(pct(1), 100);
});

test('lerReputacao(undefined): tudo null', () => {
  assert.deepEqual(lerReputacao(undefined), {
    levelId: null, powerSellerStatus: null, reclamacoesPct: null, cancelamentosPct: null,
    atrasosPct: null, vendasPeriodo: null, periodo: null,
  });
});
