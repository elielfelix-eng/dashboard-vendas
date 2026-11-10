export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    label: string,
  ) {
    super(`HTTP ${status} em ${label}: ${body.slice(0, 300)}`);
    this.name = 'HttpError';
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch com nova tentativa automática em limite de requisições (429) e
 * erros temporários (5xx). `label` aparece nas mensagens de erro no lugar
 * da URL, para nunca registrar segredos nos logs.
 */
export async function fetchJson<T>(
  url: string | URL,
  init: RequestInit = {},
  opts: { label?: string; retries?: number } = {},
): Promise<T> {
  const retries = opts.retries ?? 4;
  const label = opts.label ?? safeLabel(url);
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
    } catch (err) {
      if (attempt >= retries) throw new Error(`Falha de rede em ${label}: ${(err as Error).message}`);
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (res.ok) return (await res.json()) as T;
    const body = await res.text();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= retries) throw new HttpError(res.status, body, label);
    const retryAfter = Number(res.headers.get('retry-after'));
    await sleep(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
  }
}

/** Só origem + caminho (sem query string, onde poderiam estar segredos). */
function safeLabel(url: string | URL): string {
  const u = new URL(url);
  return u.origin + u.pathname;
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
