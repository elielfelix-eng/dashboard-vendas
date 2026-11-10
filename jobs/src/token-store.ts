import type { OAuthTokens, TokenProvider } from '@dash/connectors';
import type { Sql } from './db.ts';

const SAFETY_MARGIN_MS = 10 * 60 * 1000; // renova 10 min antes de vencer

/**
 * Entrega um access token válido para a conta, renovando quando preciso.
 * A renovação acontece dentro de uma transação com "SELECT ... FOR UPDATE":
 * se dois processos tentarem renovar ao mesmo tempo, o segundo espera e
 * reaproveita o token novo — essencial porque o refresh token do ML é de uso único.
 */
export function createTokenProvider(
  sql: Sql,
  accountId: string,
  refresh: (refreshToken: string) => Promise<OAuthTokens>,
): TokenProvider {
  let cached: { token: string; expiresAt: Date } | null = null;

  return async (force = false) => {
    if (!force && cached && cached.expiresAt.getTime() - Date.now() > SAFETY_MARGIN_MS) return cached.token;

    const token = await sql.begin(async (tx) => {
      await tx`select 1 from core.oauth_tokens where account_id = ${accountId} for update`;
      const [row] = await tx<{ access_token: string; refresh_token: string; expires_at: Date }[]>`
        select access_token, refresh_token, expires_at from core.read_oauth_tokens(${accountId})`;
      if (!row) throw new Error('Conta sem token. Conecte a conta pela tela Configurações > Conexões.');

      const stillValid = row.expires_at.getTime() - Date.now() > SAFETY_MARGIN_MS;
      const changedByOtherProcess = force && cached && row.access_token !== cached.token;
      if ((stillValid && !force) || changedByOtherProcess) {
        cached = { token: row.access_token, expiresAt: row.expires_at };
        return row.access_token;
      }

      const fresh = await refresh(row.refresh_token);
      await tx`select core.save_oauth_tokens(${accountId}, ${fresh.accessToken}, ${fresh.refreshToken}, ${fresh.expiresAt}, ${fresh.scope ?? null})`;
      cached = { token: fresh.accessToken, expiresAt: fresh.expiresAt };
      return fresh.accessToken;
    });
    return token as string;
  };
}
