/**
 * Funções puras da sonda da Shopee (somente leitura). Removidas junto com a sonda ao fim da Tarefa 2.
 * A assinatura de chamadas no nível da loja usa shopeeSign (packages/connectors), que já aceita
 * access_token e shop_id: base = partner_id + path + timestamp + access_token + shop_id.
 */
import { shopeeSign, SHOPEE_API, type ShopeeAppCredentials } from '@dash/connectors';

/** URL de uma chamada no nível da loja, assinada, com os parâmetros comuns na query. */
export function urlDaLoja(
  app: ShopeeAppCredentials,
  path: string,
  timestamp: number,
  accessToken: string,
  shopId: number,
  params: Record<string, string | number> = {},
): URL {
  const u = new URL(SHOPEE_API + path);
  u.searchParams.set('partner_id', String(app.partnerId));
  u.searchParams.set('timestamp', String(timestamp));
  u.searchParams.set('access_token', accessToken);
  u.searchParams.set('shop_id', String(shopId));
  u.searchParams.set('sign', shopeeSign(app, path, timestamp, accessToken, shopId));
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Só NOMES de campos (arrays viram "[]"), sem valores. Limita a `max` caminhos. */
export function caminhosDeCampos(raiz: unknown, max = 150): string[] {
  const achados = new Set<string>();
  const andar = (v: unknown, caminho: string) => {
    if (achados.size >= max) return;
    if (Array.isArray(v)) {
      for (const x of v) andar(x, `${caminho}[]`);
    } else if (isObj(v)) {
      for (const [k, x] of Object.entries(v)) andar(x, caminho ? `${caminho}.${k}` : k);
    } else if (caminho) {
      achados.add(caminho);
    }
  };
  andar(raiz, '');
  return [...achados].sort();
}

export interface Janela {
  /** timestamps em segundos (UTC) */
  de: number;
  ate: number;
  /** mês de São Paulo (UTC-3) em que a janela cai, "AAAA-MM" */
  mes: string;
}

const OFFSET_SP_MS = 3 * 3600 * 1000;
const mesSp = (ms: number) => {
  const d = new Date(ms - OFFSET_SP_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
/** Meia-noite de São Paulo do primeiro dia do mês seguinte ao de `ms`, em ms UTC. */
const proximoMesSp = (ms: number) => {
  const d = new Date(ms - OFFSET_SP_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) + OFFSET_SP_MS;
};

/**
 * Janelas de no máximo `dias` dias entre `inicioMs` e `fimMs`, sem atravessar a virada do mês,
 * para somar os pedidos por mês. `ate` é inclusivo em segundos (fim da janela - 1 s).
 */
export function janelasPorMes(inicioMs: number, fimMs: number, dias = 15): Janela[] {
  const passo = dias * 86400 * 1000;
  const out: Janela[] = [];
  let cur = inicioMs;
  while (cur < fimMs) {
    const fim = Math.min(cur + passo, proximoMesSp(cur), fimMs);
    out.push({ de: Math.floor(cur / 1000), ate: Math.floor(fim / 1000) - 1, mes: mesSp(cur) });
    cur = fim;
  }
  return out;
}

/** dd-mm-yyyy (formato das datas de Ads da Shopee), em São Paulo. */
export function dataAds(ms: number): string {
  const d = new Date(ms - OFFSET_SP_MS);
  return `${String(d.getUTCDate()).padStart(2, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${d.getUTCFullYear()}`;
}
