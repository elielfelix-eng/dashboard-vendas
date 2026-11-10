import type { MlAppCredentials } from '@dash/connectors';

export const ML_OAUTH_COOKIE = 'ml_oauth';

export function mlApp(): MlAppCredentials {
  const clientId = process.env.ML_CLIENT_ID;
  const clientSecret = process.env.ML_CLIENT_SECRET;
  const redirectUri = process.env.ML_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Variáveis ML_CLIENT_ID, ML_CLIENT_SECRET e ML_REDIRECT_URI precisam estar configuradas');
  }
  return { clientId, clientSecret, redirectUri };
}
