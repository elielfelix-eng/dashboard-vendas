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
    if (!webhookUrl) throw new Error('BITRIX_WEBHOOK_URL não configurada');
    this.base = webhookUrl.endsWith('/') ? webhookUrl : webhookUrl + '/';
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
