import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Megaphone, Percent, Receipt, ShoppingBag, XCircle } from 'lucide-react';
import { iconeDoCartao } from './icones.ts';

test('Vendas brutas usa a sacola', () => {
  assert.equal(iconeDoCartao('Vendas brutas'), ShoppingBag);
});

test('Pedidos usa o recibo', () => {
  assert.equal(iconeDoCartao('Pedidos'), Receipt);
});

test('Margem de contribuição usa a porcentagem', () => {
  assert.equal(iconeDoCartao('Margem de contribuição'), Percent);
});

test('Ads e Investimento usam o megafone', () => {
  assert.equal(iconeDoCartao('Ads'), Megaphone);
  assert.equal(iconeDoCartao('Investimento'), Megaphone);
});

test('Cancelados e devolvidos usa o x-círculo, mesmo contendo a palavra venda', () => {
  assert.equal(iconeDoCartao('Cancelados e devolvidos'), XCircle);
  assert.equal(iconeDoCartao('Vendas canceladas'), XCircle);
});

test('Leads não é confundido com Ads', () => {
  assert.notEqual(iconeDoCartao('Leads novos'), Megaphone);
});

test('título desconhecido devolve o ícone de reserva, nunca undefined', () => {
  const reserva = iconeDoCartao('Título que não existe');
  assert.ok(reserva);
  assert.equal(iconeDoCartao('Outro título qualquer'), reserva);
});
