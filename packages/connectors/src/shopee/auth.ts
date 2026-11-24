import { fetchJson, HttpError } from '../http.ts';
import type { OAuthTokens } from '../types.ts';
import { SHOPEE_API, shopeeSign, type ShopeeAppCredentials } from './connector.ts';

/**
 * Autorização da loja na Shopee Open Platform v2 (somente leitura).
 * Access token vale 4h; refresh token vale 30 dias e é de USO ÚNICO:
 * cada renovação devolve um novo, que precisa ser gravado na hora.
 * Nenhum texto de erro ou log daqui leva token, código ou partner key.
 */

export const SHOPEE_AUTH_EXPIRED = 'Autorização da Shopee vencida: reconecte em Configurações › Conexões';

/** Autorização vencida ou recusada: o admin precisa reconectar a loja. */
export class ShopeeAuthError extends Error {
  constructor() {
    super(SHOPEE_AUTH_EXPIRED);
    this.name = 'ShopeeAuthError';
  }
}

const AUTH_ERRORS = new Set(['error_auth', 'invalid_acceess_token', 'invalid_access_token']);

interface ShopeeTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expire_in?: number;
  error?: string;
  message?: string;
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

/** URL para o admin autorizar a loja. A Shopee volta no `redirectUrl` com `code` e `shop_id`. */
export function shopeeAuthUrl(app: ShopeeAppCredentials, redirectUrl: string, timestamp: number): string {
  const path = '/api/v2/shop/auth_partner';
  const u = new URL(SHOPEE_API + path);
  u.searchParams.set('partner_id', String(app.partnerId));
  u.searchParams.set('timestamp', String(timestamp));
  u.searchParams.set('sign', shopeeSign(app, path, timestamp));
  u.searchParams.set('redirect', redirectUrl);
  return u.toString();
}

/** Só o código de erro da Shopee (ex.: error_param), nunca a mensagem, que pode repetir parâmetros. */
function errorCode(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[^a-z0-9_]/gi, '').slice(0, 60) : '';
}

async function tokenRequest(
  app: ShopeeAppCredentials,
  path: string,
  shopId: number,
  body: Record<string, unknown>,
): Promise<OAuthTokens> {
  const label = `Shopee ${path}`;
  const timestamp = nowSeconds();
  const u = new URL(SHOPEE_API + path);
  u.searchParams.set('partner_id', String(app.partnerId));
  u.searchParams.set('timestamp', String(timestamp));
  u.searchParams.set('sign', shopeeSign(app, path, timestamp));

  let data: ShopeeTokenResponse;
  try {
    data = await fetchJson<ShopeeTokenResponse>(
      u,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      },
      // Sem nova tentativa: código e refresh token são de uso único; repetir pode queimar o novo token.
      { label, retries: 0 },
    );
  } catch (err) {
    if (!(err instanceof HttpError)) throw err; // falha de rede: a mensagem já usa só o label
    let code = '';
    try {
      code = errorCode((JSON.parse(err.body) as ShopeeTokenResponse).error);
    } catch { /* corpo não-JSON */ }
    if (err.status === 401 || err.status === 403 || AUTH_ERRORS.has(code)) throw new ShopeeAuthError();
    throw new Error(`HTTP ${err.status} em ${label}${code ? `: ${code}` : ''}`);
  }

  const code = errorCode(data.error);
  if (AUTH_ERRORS.has(code)) throw new ShopeeAuthError();
  if (code) throw new Error(`Erro da Shopee em ${label}: ${code}`);
  if (!data.access_token || !data.refresh_token || !data.expire_in) {
    throw new Error(`Resposta incompleta da Shopee em ${label} (sem token ou validade).`);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expire_in * 1000),
    externalUserId: String(shopId),
  };
}

/** Troca o código de autorização (retorno do auth_partner) pelos tokens da loja. */
export function exchangeShopeeCode(app: ShopeeAppCredentials, code: string, shopId: number): Promise<OAuthTokens> {
  return tokenRequest(app, '/api/v2/auth/token/get', shopId, { code, shop_id: shopId, partner_id: app.partnerId });
}

/** Renova o access token. Devolve um NOVO refresh token, que precisa ser gravado antes de usar o access token. */
export function refreshShopeeTokens(app: ShopeeAppCredentials, shopId: number, refreshToken: string): Promise<OAuthTokens> {
  return tokenRequest(app, '/api/v2/auth/access_token/get', shopId, {
    refresh_token: refreshToken,
    shop_id: shopId,
    partner_id: app.partnerId,
  });
}
