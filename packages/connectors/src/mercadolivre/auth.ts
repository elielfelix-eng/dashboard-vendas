import { createHash, randomBytes } from 'node:crypto';
import { fetchJson } from '../http.ts';
import type { OAuthTokens } from '../types.ts';

export const ML_AUTH_URL = 'https://auth.mercadolivre.com.br/authorization';
export const ML_API = 'https://api.mercadolibre.com';

export interface MlAppCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri?: string;
}

interface MlTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  user_id: number;
  refresh_token: string;
}

/** Par PKCE (verifier fica guardado em cookie; challenge vai na URL). */
export function createPkcePair() {
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function createState() {
  return randomBytes(24).toString('base64url');
}

export function buildAuthorizeUrl(app: MlAppCredentials, state: string, codeChallenge: string): string {
  if (!app.redirectUri) throw new Error('ML_REDIRECT_URI não configurado');
  const u = new URL(ML_AUTH_URL);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', app.clientId);
  u.searchParams.set('redirect_uri', app.redirectUri);
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

async function tokenRequest(params: Record<string, string>): Promise<OAuthTokens> {
  const data = await fetchJson<MlTokenResponse>(
    `${ML_API}/oauth/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams(params),
    },
    { label: 'ML /oauth/token', retries: 2 },
  );
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    externalUserId: String(data.user_id),
    scope: data.scope,
  };
}

export function exchangeCode(app: MlAppCredentials, code: string, codeVerifier: string) {
  if (!app.redirectUri) throw new Error('ML_REDIRECT_URI não configurado');
  return tokenRequest({
    grant_type: 'authorization_code',
    client_id: app.clientId,
    client_secret: app.clientSecret,
    code,
    redirect_uri: app.redirectUri,
    code_verifier: codeVerifier,
  });
}

/**
 * Atenção: o refresh token do ML é de USO ÚNICO. Cada renovação devolve um
 * novo refresh token, que precisa ser salvo imediatamente.
 */
export function refreshTokens(app: MlAppCredentials, refreshToken: string) {
  return tokenRequest({
    grant_type: 'refresh_token',
    client_id: app.clientId,
    client_secret: app.clientSecret,
    refresh_token: refreshToken,
  });
}
