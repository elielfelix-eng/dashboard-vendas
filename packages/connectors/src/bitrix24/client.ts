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

/** Referência de resultado de outro comando do batch (o Bitrix troca pelo valor). */
const REF_RESULT = /^\$result\[[^\]]+\](\[[^\]]+\])*$/;

/**
 * Codifica no formato PHP http_build_query (filter[>ID]=5&select[0]=ID), com
 * encodeURIComponent nos valores. Referências `$result[...]` ficam literais, para o
 * Bitrix conseguir substituí-las dentro do comando do batch.
 */
export function paraQuery(params: Record<string, unknown>): string {
  const partes: string[] = [];
  const add = (chave: string, v: unknown): void => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) { v.forEach((x, i) => add(`${chave}[${i}]`, x)); return; }
    if (typeof v === 'object') {
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) add(`${chave}[${k}]`, x);
      return;
    }
    const txt = String(v);
    partes.push(`${encodeURIComponent(chave)}=${REF_RESULT.test(txt) ? txt : encodeURIComponent(txt)}`);
  };
  for (const [k, v] of Object.entries(params)) add(k, v);
  return partes.join('&');
}

/** Itens por página do Bitrix e máximo de comandos por batch. */
const PAGINA = 50;

/**
 * Cliente da REST do Bitrix24 via webhook de entrada.
 * A URL do webhook contém a chave secreta: ela NUNCA aparece em mensagens de
 * erro nem em logs (o rótulo usado é só "bitrix:<método>").
 */
export class BitrixClient {
  private readonly base: string;
  /** Intervalo mínimo entre chamadas (limite do Bitrix: ~2 req/s). */
  private readonly intervaloMs: number;
  /** Espera base antes de repetir um batch com comando falho (2 s, 4 s, 8 s). */
  private readonly retentativaMs: number;
  private ultima = 0;

  constructor(webhookUrl: string, opts: { intervaloMs?: number; retentativaMs?: number } = {}) {
    this.base = normalizarWebhook(webhookUrl);
    this.intervaloMs = opts.intervaloMs ?? 550;
    this.retentativaMs = opts.retentativaMs ?? 2000;
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

  /** Executa até 50 comandos numa chamada só (halt: 0, um erro não derruba os outros). */
  async batch<T>(
    cmds: Record<string, [string, Record<string, unknown>]>,
  ): Promise<{ result: Record<string, T>; erros: Record<string, unknown> }> {
    const chaves = Object.keys(cmds);
    if (chaves.length > PAGINA) throw new Error(`Bitrix batch: no máximo ${PAGINA} comandos por chamada (recebeu ${chaves.length})`);
    const cmd: Record<string, string> = {};
    for (const k of chaves) cmd[k] = `${cmds[k][0]}?${paraQuery(cmds[k][1])}`;
    const r = await this.call<{ result?: Record<string, T>; result_error?: Record<string, unknown> | unknown[] }>(
      'batch', { halt: 0, cmd });
    const res = r.result?.result;
    const err = r.result?.result_error;
    return {
      result: res && !Array.isArray(res) ? res : {},
      erros: err && !Array.isArray(err) ? err : {},
    };
  }

  /**
   * Modo rápido: pagina por ID (order ID ASC, start -1) em lotes de 50 comandos
   * encadeados por `$result[c{i-1}][49][ID]`. Entrega UM array por comando, em ordem
   * crescente de ID, e para no primeiro comando com menos de 50 itens (os seguintes
   * são ignorados, mesmo com erro). Se todos vierem cheios, começa outro lote a
   * partir do maior ID recebido. Parâmetros extras (ex.: entityTypeId) vão em todo comando.
   * Se um comando alcançado vier sem resultado (erro dentro do batch), repete o batch a
   * partir do último ID bom até 3 vezes (espera 2 s, 4 s, 8 s) antes de desistir; o
   * contador zera quando há progresso.
   */
  async *listarPorId<T extends { ID: string }>(
    method: string,
    params: { filter?: Record<string, unknown>; select: string[]; [extra: string]: unknown },
    opts: { itens?: (r: unknown) => T[]; idCampo?: string } = {},
  ): AsyncGenerator<T[]> {
    const idCampo = opts.idCampo ?? 'ID';
    const itens = opts.itens ?? ((r: unknown) => (Array.isArray(r) ? (r as T[]) : []));
    const caminho = opts.itens ? '[items]' : '';
    let ultimoId: string | undefined;
    let tentativas = 0;
    for (;;) {
      const cmds: Record<string, [string, Record<string, unknown>]> = {};
      for (let i = 0; i < PAGINA; i++) {
        const ref = i === 0 ? ultimoId : `$result[c${i - 1}]${caminho}[${PAGINA - 1}][${idCampo}]`;
        const filter = { ...(params.filter ?? {}), ...(ref !== undefined ? { [`>${idCampo}`]: ref } : {}) };
        cmds[`c${i}`] = [method, { ...params, filter, order: { [idCampo]: 'ASC' }, start: -1 }];
      }
      const { result, erros } = await this.batch<unknown>(cmds);
      for (let i = 0; i < PAGINA; i++) {
        const k = `c${i}`;
        if (!(k in result)) {
          if (tentativas >= 3) {
            throw new Error(`Bitrix ${method}: comando ${k} do batch falhou ${JSON.stringify(erros[k] ?? 'sem resposta')}`.slice(0, 300));
          }
          tentativas++;
          await sleep(this.retentativaMs * 2 ** (tentativas - 1));
          break; // recomeça o batch a partir de ultimoId
        }
        const lista = itens(result[k]);
        tentativas = 0;
        if (lista.length) yield lista;
        if (lista.length < PAGINA) return;
        ultimoId = String((lista[lista.length - 1] as unknown as Record<string, unknown>)[idCampo]);
      }
    }
  }
}
