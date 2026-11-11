import { HttpError, fetchJson } from '../http.ts';
import type { TokenProvider } from '../types.ts';
import { ML_API } from './auth.ts';

type Params = Record<string, string | number | undefined>;

/** Cliente HTTP do ML: injeta o token e renova uma vez em caso de 401. */
export class MercadoLivreClient {
  constructor(private readonly getToken: TokenProvider) {}

  async get<T>(path: string, params: Params = {}, headers: Record<string, string> = {}): Promise<T> {
    const url = new URL(ML_API + path);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));

    const call = async (force: boolean) => {
      const token = await this.getToken(force);
      return fetchJson<T>(
        url,
        { headers: { Authorization: `Bearer ${token}`, accept: 'application/json', ...headers } },
        // O ML pede espera crescente de 10 s × tentativa no 429 (local_rate_limited)
        { retries: 5, rateLimitDelay: (attempt) => 10_000 * (attempt + 1) },
      );
    };

    try {
      return await call(false);
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) return call(true);
      throw err;
    }
  }
}
