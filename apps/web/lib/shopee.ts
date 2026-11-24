import type { ShopeeAppCredentials } from '@dash/connectors';

export const SHOPEE_OAUTH_COOKIE = 'shopee_oauth';

/** Nomes das variáveis da Shopee ausentes ou inválidas (nunca os valores). */
export function shopeeConfigProblems(): string[] {
  const problems: string[] = [];
  const id = process.env.SHOPEE_PARTNER_ID?.trim();
  if (!id) problems.push('SHOPEE_PARTNER_ID');
  else if (!/^\d+$/.test(id)) problems.push('SHOPEE_PARTNER_ID (formato)');
  if (!process.env.SHOPEE_PARTNER_KEY?.trim()) problems.push('SHOPEE_PARTNER_KEY');
  return problems;
}

export function shopeeApp(): ShopeeAppCredentials {
  const id = process.env.SHOPEE_PARTNER_ID?.trim();
  const partnerKey = process.env.SHOPEE_PARTNER_KEY?.trim();
  if (!id || !/^\d+$/.test(id) || !partnerKey) {
    throw new Error('Variáveis SHOPEE_PARTNER_ID e SHOPEE_PARTNER_KEY precisam estar configuradas');
  }
  return { partnerId: Number(id), partnerKey };
}
