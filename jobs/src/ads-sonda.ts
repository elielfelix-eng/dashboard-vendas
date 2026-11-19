// Sondagem SOMENTE LEITURA: descobre se a campanha de seguidores aparece na API de Ads do Mercado Livre
// e qual endpoint a devolve. Só faz GET. Não grava nada no banco e não imprime tokens, nomes de campanhas
// nem valores: só status HTTP, nomes de campos e valores de tipo/estratégia (categorias, não dados pessoais).
import { MercadoLivreClient, refreshTokens, HttpError, type MlAppCredentials } from '@dash/connectors';
import { connect, requireEnv } from './db.ts';
import { createTokenProvider } from './token-store.ts';

const CHAVES_TIPO = ['type', 'campaign_type', 'strategy', 'product', 'product_id', 'objective'];

function resumoResposta(r: unknown): string {
  const obj = (r ?? {}) as Record<string, unknown>;
  const topo = Object.keys(obj).join(', ');
  const lista = (Array.isArray(obj.results) ? obj.results : Array.isArray(obj.campaigns) ? obj.campaigns : []) as Record<string, unknown>[];
  const campos = lista[0] ? Object.keys(lista[0]).join(', ') : '(sem itens)';
  const tipos = new Set<string>();
  for (const item of lista) {
    for (const k of CHAVES_TIPO) {
      const v = item[k];
      if (typeof v === 'string' || typeof v === 'number') tipos.add(`${k}=${v}`);
    }
  }
  return `itens=${lista.length}; campos topo=[${topo}]; campos item=[${campos}]; tipos=[${[...tipos].slice(0, 12).join(' | ')}]`;
}

async function main() {
  const app: MlAppCredentials = { clientId: requireEnv('ML_CLIENT_ID'), clientSecret: requireEnv('ML_CLIENT_SECRET') };
  const sql = connect();
  try {
    const [acc] = await sql<{ id: string; external_id: string }[]>`
      select id, external_id from core.accounts where channel = 'mercadolivre' and active limit 1`;
    if (!acc) { console.log('Nenhuma conta do Mercado Livre conectada.'); return; }
    const getToken = createTokenProvider(sql, acc.id, (rt) => refreshTokens(app, rt));
    const api = new MercadoLivreClient(getToken);

    // Mesmo passo do conector: descobre o anunciante de PADS.
    const adv = await api.get<{ advertisers?: { advertiser_id: number; site_id: string }[] }>(
      '/advertising/advertisers', { product_id: 'PADS' }, { 'Api-Version': '1' });
    const a = adv.advertisers?.[0];
    if (!a) { console.log('Anunciante de Product Ads não encontrado.'); return; }
    console.log(`Anunciante encontrado: site=${a.site_id}`);
    const base = `/advertising/${a.site_id}/advertisers/${a.advertiser_id}`;

    const candidatos = [
      `${base}/product_ads/campaigns/search`,   // controle: campanhas de Product Ads (já sabemos que funciona)
      `${base}/campaigns/search`,
      `${base}/campaigns`,
      `${base}/display/campaigns/search`,
      `${base}/followers/campaigns/search`,
      `${base}/follower/campaigns/search`,
      `${base}/seguidores/campaigns/search`,
      `/advertising/advertisers/${a.advertiser_id}/campaigns`,
      `/advertising/advertisers/${a.advertiser_id}/display/campaigns`,
    ];
    for (const path of candidatos) {
      try {
        const r = await api.get(path, { limit: 50 }, { 'api-version': '2' });
        console.log(`OK  ${path.replace(String(a.advertiser_id), '{anunciante}')} -> ${resumoResposta(r)}`);
      } catch (err) {
        const st = err instanceof HttpError ? err.status : 'rede';
        const corpo = err instanceof HttpError ? err.body.replace(/\s+/g, ' ').slice(0, 160) : '';
        console.log(`ERR ${path.replace(String(a.advertiser_id), '{anunciante}')} -> HTTP ${st} ${corpo}`);
      }
    }
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error('Sondagem falhou:', (err as Error).message);
  process.exitCode = 1;
});
