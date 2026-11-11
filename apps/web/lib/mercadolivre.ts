import type { MlAppCredentials } from '@dash/connectors';

export const ML_OAUTH_COOKIE = 'ml_oauth';

/** Nomes das variáveis do ML ausentes ou inválidas (nunca os valores). */
export function mlConfigProblems(): string[] {
  const problems: string[] = [];
  for (const name of ['ML_CLIENT_ID', 'ML_CLIENT_SECRET', 'ML_REDIRECT_URI'] as const) {
    if (!process.env[name]?.trim()) problems.push(name);
  }
  const uri = process.env.ML_REDIRECT_URI?.trim();
  if (uri && !/^https:\/\/[^/]+\/api\/oauth\/mercadolivre\/callback$/.test(uri)) problems.push('ML_REDIRECT_URI (formato)');
  return problems;
}

export function mlApp(): MlAppCredentials {
  const clientId = process.env.ML_CLIENT_ID?.trim();
  const clientSecret = process.env.ML_CLIENT_SECRET?.trim();
  const redirectUri = process.env.ML_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Variáveis ML_CLIENT_ID, ML_CLIENT_SECRET e ML_REDIRECT_URI precisam estar configuradas');
  }
  return { clientId, clientSecret, redirectUri };
}
