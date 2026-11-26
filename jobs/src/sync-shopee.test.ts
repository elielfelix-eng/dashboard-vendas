import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toShopeeOrder } from '@dash/connectors';
import { dataRefTarifas, precisaEscrow } from './sync-shopee.ts';

const seg = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const pedido = (status: string, pago: boolean) =>
  toShopeeOrder({ order_sn: 'X', order_status: status, create_time: seg('2026-11-20T12:00:00Z'), pay_time: pago ? seg('2026-11-20T12:05:00Z') : null });

test('escrow: pede dos pagos e dos cancelados depois de pagos', () => {
  assert.equal(precisaEscrow(pedido('COMPLETED', true)), true);
  assert.equal(precisaEscrow(pedido('TO_RETURN', true)), true);
  assert.equal(precisaEscrow(pedido('CANCELLED', true)), true);
  assert.equal(precisaEscrow(pedido('IN_CANCEL', true)), true);
});

test('escrow: não pede de não pagos, desconhecidos nem cancelados sem pagamento (shopee:sem_pagamento)', () => {
  assert.equal(precisaEscrow(pedido('UNPAID', false)), false);
  assert.equal(precisaEscrow(pedido('CANCELLED', false)), false);
  assert.equal(precisaEscrow(pedido('IN_CANCEL', false)), false);
  assert.equal(precisaEscrow(pedido('STATUS_NOVO', true)), false);
});

test('data_ref: dia do pagamento em Brasília, inclusive na virada do mês', () => {
  // Pago 01/12 02:30 UTC = 30/11 23:30 em Brasília; criado em 30/11
  const o = toShopeeOrder({
    order_sn: 'V', order_status: 'COMPLETED', create_time: seg('2026-11-30T20:00:00Z'), pay_time: seg('2026-12-01T02:30:00Z'),
  });
  assert.equal(dataRefTarifas(o), '2026-11-30');
  // Pago 01/12 03:30 UTC = 01/12 00:30 em Brasília, criado em 30/11: vale o pagamento (dezembro)
  const o2 = toShopeeOrder({
    order_sn: 'W', order_status: 'COMPLETED', create_time: seg('2026-11-30T20:00:00Z'), pay_time: seg('2026-12-01T03:30:00Z'),
  });
  assert.equal(dataRefTarifas(o2), '2026-12-01');
});

test('data_ref: sem pagamento usa a criação (Brasília)', () => {
  const o = toShopeeOrder({ order_sn: 'Z', order_status: 'CANCELLED', create_time: seg('2026-11-01T02:00:00Z'), pay_time: null });
  assert.equal(dataRefTarifas(o), '2026-10-31');
});
