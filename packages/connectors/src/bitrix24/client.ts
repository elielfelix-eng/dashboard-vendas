import { fetchJson, sleep } from '../http.ts';

/** Resposta padrão da REST do Bitrix24. */
export interface BitrixResponse<T> {
  result: T;
  next?: number;
  total?: number;
  error?: string;
  error_description?: string;
}

/**
 * Deixa só "https://portal/rest/<usuario>/<chave>/": tira espaços e aspas e corta
 * o que vier depois da chave (ex.: o exemplo "profile/" que o Bitrix mostra).
 * Nunca inclui a URL nas mensagens de erro.
 */
export function normalizarWebhook(bruta: string): string {
  const s = (bruta ?? '').trim().replace(/^["']+|["']+$/g, '').trim();
  if (!s) throw new Error('BITRIX_WEBHOOK_URL não configurada');
  let u: URL;
  try { u = new URL(s); } catch { throw new Error('BITRIX_WEBHOOK_URL inválida: não é um endereço (deve começar com https://)'); }
  const m = u.pathname.match(/^\/rest\/(\d+)\/([^/]+)/);
  if (!m) throw new Error('BITRIX_WEBHOOK_URL inválida: esperado https://<portal>/rest/<número>/<chave>/');
  if (/\.(json|xml)$/.test(m[2]) || m[2] === 'profile') {
    throw new Error('BITRIX_WEBHOOK_URL inválida: falta a chave depois do número do usuário');
  }
  return `${u.origin}/rest/${m[1]}/${m[2]}/`;
}

/**
 * Cliente da REST do Bitrix24 via webhook de entrada.
 * A URL do webhook contém a chave secreta: ela NUNCA aparece em mensagens de
 * erro nem em logs (o rótulo usado é só "bitrix:<método>").
 */
export class BitrixClient {
  private readonly base: string;
  /** Intervalo mínimo entre chamadas (limite do Bitrix: ~2 req/s). */
  private readonly intervaloMs: number;
  private ultima = 0;

  constructor(webhookUrl: string, opts: { intervaloMs?: number } = {}) {
    this.base = normalizarWebhook(webhookUrl);
    this.intervaloMs = opts.intervaloMs ?? 550;
  }

  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<BitrixResponse<T>> {
    const espera = this.ultima + this.intervaloMs - Date.now();
    if (espera > 0) await sleep(espera);
    this.ultima = Date.now();
    const r = await fetchJson<BitrixResponse<T>>(
      this.base + method,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) },
      { label: `bitrix:${method}`, rateLimitDelay: (a) => 2000 * 2 ** a },
    );
    if (r.error) throw new Error(`Bitrix ${method}: ${r.error} ${r.error_description ?? ''}`.trim());
    return r;
  }

  /** Percorre todas as páginas de um método *.list (50 por página). */
  async *paginas<T>(method: string, params: Record<string, unknown> = {}): AsyncGenerator<T[]> {
    let start: number | undefined = 0;
    while (start !== undefined) {
      const r: BitrixResponse<T[]> = await this.call<T[]>(method, { ...params, start });
      yield r.result ?? [];
      start = r.next;
    }
  }

  async listarTudo<T>(method: string, params: Record<string, unknown> = {}): Promise<T[]> {
    const out: T[] = [];
    for await (const p of this.paginas<T>(method, params)) out.push(...p);
    return out;
  }
}
