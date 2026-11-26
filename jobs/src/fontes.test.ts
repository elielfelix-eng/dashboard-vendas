import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FONTES_PERMITIDAS, rodarFontes } from './fontes.ts';
import { inicioShopee } from './sync-shopee.ts';

const DAY = 86_400_000;

test('shopee é uma fonte aceita', () => {
  assert.ok(FONTES_PERMITIDAS.includes('shopee'));
  assert.ok(FONTES_PERMITIDAS.includes('all'));
});

test('falha geral da Shopee conta só para a Shopee, e o Mercado Livre roda na mesma execução (Review Focus 2)', async () => {
  const rodou: string[] = [];
  const erros: string[] = [];
  const falhas = await rodarFontes('all', [
    { fonte: 'shopee', rotulo: 'Shopee', rodar: async () => { rodou.push('shopee'); throw new Error('Autorização da Shopee vencida'); } },
    { fonte: 'mercadolivre', rotulo: 'ML', rodar: async () => { rodou.push('ml'); return 0; } },
    { fonte: 'bitrix24', rotulo: 'Bitrix', rodar: async () => { rodou.push('bitrix'); return 0; } },
  ], (m) => erros.push(m));
  assert.deepEqual(rodou, ['shopee', 'ml', 'bitrix']);
  assert.equal(falhas, 1);
  assert.equal(erros.length, 1);
  assert.match(erros[0], /^\[Shopee\] Falha geral: Autorização da Shopee vencida/);
});

test('falha devolvida pela Shopee soma ao total, e o ML continua', async () => {
  const rodou: string[] = [];
  const falhas = await rodarFontes('all', [
    { fonte: 'mercadolivre', rotulo: 'ML', rodar: async () => { rodou.push('ml'); return 0; } },
    { fonte: 'shopee', rotulo: 'Shopee', rodar: async () => { rodou.push('shopee'); return 1; } },
  ], () => {});
  assert.deepEqual(rodou, ['ml', 'shopee']);
  assert.equal(falhas, 1);
});

test('--source=shopee roda só a Shopee', async () => {
  const rodou: string[] = [];
  await rodarFontes('shopee', [
    { fonte: 'mercadolivre', rotulo: 'ML', rodar: async () => { rodou.push('ml'); return 0; } },
    { fonte: 'shopee', rotulo: 'Shopee', rodar: async () => { rodou.push('shopee'); return 0; } },
  ], () => {});
  assert.deepEqual(rodou, ['shopee']);
});

test('janela da Shopee: 1ª carga de 12 meses; depois, sempre os últimos 30 dias (escrow sai depois da entrega)', () => {
  const agora = new Date('2026-11-26T12:00:00Z');
  assert.equal(inicioShopee(null, agora).getTime(), agora.getTime() - 365 * DAY);
  // Última sincronização ontem: ainda assim relê 30 dias
  assert.equal(inicioShopee(new Date(agora.getTime() - DAY), agora).getTime(), agora.getTime() - 30 * DAY);
  // Última sincronização há 40 dias: volta até 1 dia antes dela
  assert.equal(inicioShopee(new Date(agora.getTime() - 40 * DAY), agora).getTime(), agora.getTime() - 41 * DAY);
  // Nunca passa de 12 meses
  assert.equal(inicioShopee(new Date(agora.getTime() - 900 * DAY), agora).getTime(), agora.getTime() - 365 * DAY);
});
