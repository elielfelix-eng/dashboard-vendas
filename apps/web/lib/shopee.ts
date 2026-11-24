import type { ShopeeAppCredentials } from '@dash/connectors';

export const SHOPEE_OAUTH_COOKIE = 'shopee_oauth';

/** State do OAuth: só caracteres seguros em URL (createState gera base64url de 32). */
export function isShopeeState(state: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}$/.test(state);
}

/**
 * URL de retorno com o state no CAMINHO: a Shopee acrescenta "?code=..&shop_id=.."
 * ao redirect, e um "?state=" já existente poderia ser lido errado.
 */
export function shopeeRedirectUrl(base: string | URL, state: string): string {
  return new URL(`/api/oauth/shopee/callback/${state}`, base).toString();
}

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
