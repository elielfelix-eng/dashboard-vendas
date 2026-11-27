/**
 * Sonda (só leitura): a API do Mercado Livre dá o gasto diário das campanhas de "Seguidores"?
 *
 * Hoje o painel usa as linhas CDLIT da fatura, pela data da cobrança (outubro/2026 = R$ 52,12),
 * enquanto o Mercado Ads mostra R$ 539 no mês pelo dia do gasto. Esta sonda procura uma fonte
 * com o gasto por dia (ou por consumo) e imprime o total de outubro que cada fonte dá.
 *
 * Só faz GET. Não grava no banco (fora a renovação do token feita pelo próprio createTokenProvider).
 * Não imprime token, segredo, comprador, endereço, documento nem o JSON bruto: só rótulos, status HTTP,
 * códigos de erro, nomes de campos, datas e valores. Limite de ~60 chamadas à API; erro = imprime e segue.
 * Uso: npm run ml:seguidores -w jobs   (precisa de DATABASE_URL, ML_CLIENT_ID e ML_CLIENT_SECRET)
 */
import { ML_API, refreshTokens, HttpError, type MlAppCredentials, type TokenProvider } from '@dash/connectors';
import { connect, requireEnv } from './db.ts';
import { createTokenProvider } from './token-store.ts';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

const DE = '2026-10-01';
const ATE = '2026-10-31';
const MES_ALVO = '2026-10';
const LIMITE_CHAMADAS = 60;
const RESERVA_ADS = 38; // chamadas que sobram para a publicidade depois da fatura

const SENSIVEL_RE = /buyer|receiver|address|phone|email|name|document|nickname|payer|user|identification|doc_|cpf|cnpj/i;
const DATA_CHAVE_RE = /date|time|day|^from$|^to$|_from$|_to$|period|reference|month/i;
const DATA_VALOR_RE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const CUSTO_RE = /cost|budget|spend|invest|consum|charge|amount|billed/i;
const ENUM_CHAVE_RE = /^(type|objective|goal|strategy|status|channel|product|product_id|campaign_type|format|kind|sub_type|subtype)$/i;
const ENUM_VALOR_RE = /^[A-Za-z0-9_.\-]{1,40}$/;

/* ----------------------------- chamadas GET ----------------------------- */
let chamadas = 0;
let getToken: TokenProvider;

type Resposta = { ok: true; status: number; data: unknown } | { ok: false; status: number | null; erro: string };

/** Lê só os campos de erro do corpo (error/code/status/message curto). Nunca o corpo inteiro. */
function resumoErro(body: string): string {
  try {
    const j = JSON.parse(body) as Obj;
    const partes: string[] = [];
    for (const k of ['error', 'code', 'cause', 'message']) {
      const v = j[k];
      if (typeof v === 'string' || typeof v === 'number') {
        let s = String(v).replace(/APP_USR-[\w-]+|TG-[\w-]+|Bearer\s+\S+/g, '[omitido]');
        if (s.length > 120) s = `${s.slice(0, 120)}...`;
        partes.push(`${k}=${s}`);
      } else if (Array.isArray(v) && v.length) {
        const c = v[0];
        if (isObj(c) && (typeof c.code === 'string' || typeof c.code === 'number')) partes.push(`${k}[0].code=${c.code}`);
      }
    }
    return partes.join(' | ') || '(corpo JSON sem campos de erro)';
  } catch {
    return '(corpo não é JSON)';
  }
}

async function get(rotulo: string, path: string, params: Record<string, string | number> = {}, headers: Record<string, string> = {}): Promise<Resposta> {
  const url = new URL(ML_API + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const mostra = `${path}${url.search}`;
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    if (chamadas >= LIMITE_CHAMADAS) {
      console.log(`  [limite] ${rotulo}: não chamado (limite de ${LIMITE_CHAMADAS} chamadas atingido)`);
      return { ok: false, status: null, erro: 'limite de chamadas' };
    }
    chamadas++;
    let token: string;
    try {
      token = await getToken(false);
    } catch (err) {
      const st = err instanceof HttpError ? ` (HTTP ${err.status})` : '';
      console.log(`  [${chamadas}] ${rotulo}: falha ao obter o token${st}`);
      return { ok: false, status: null, erro: 'token' };
    }
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, accept: 'application/json', ...headers },
        signal: AbortSignal.timeout(30_000),
      });
      const body = await res.text();
      if (res.status === 429 && tentativa === 0) {
        console.log(`  [${chamadas}] GET ${mostra} -> 429, espera 10 s e tenta 1 vez`);
        await new Promise((r) => setTimeout(r, 10_000));
        continue;
      }
      if (!res.ok) {
        const erro = resumoErro(body);
        console.log(`  [${chamadas}] GET ${mostra} -> HTTP ${res.status} | ${erro}`);
        return { ok: false, status: res.status, erro };
      }
      let data: unknown = null;
      try {
        data = JSON.parse(body);
      } catch {
        console.log(`  [${chamadas}] GET ${mostra} -> HTTP ${res.status} (corpo não é JSON)`);
        return { ok: false, status: res.status, erro: 'não JSON' };
      }
      console.log(`  [${chamadas}] GET ${mostra} -> HTTP ${res.status}`);
      return { ok: true, status: res.status, data };
    } catch (err) {
      console.log(`  [${chamadas}] GET ${mostra} -> falha de rede (${(err as Error).name})`);
      return { ok: false, status: null, erro: 'rede' };
    }
  }
  return { ok: false, status: 429, erro: '429 repetido' };
}

/* ------------------------------ utilidades ------------------------------ */
const fmtSP = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Dia (AAAA-MM-DD) no horário de Brasília. Sem fuso explícito: usa a data escrita. */
function diaSP(s: string): string | null {
  if (!DATA_VALOR_RE.test(s)) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s) || !/(Z|[+-]\d{2}:?\d{2})$/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s.slice(0, 10) : fmtSP.format(d);
}

const reais = (n: number) => n.toFixed(2);

/** Caminhos de todas as folhas (sem índices de lista), pulando ramos sensíveis. */
function caminhosDeCampos(raiz: unknown, prefixo = ''): Set<string> {
  const out = new Set<string>();
  const andar = (v: unknown, caminho: string) => {
    if (Array.isArray(v)) v.slice(0, 5).forEach((x) => andar(x, `${caminho}[]`));
    else if (isObj(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (SENSIVEL_RE.test(k)) {
          out.add(`${caminho ? `${caminho}.` : ''}${k} (omitido)`);
          continue;
        }
        andar(x, caminho ? `${caminho}.${k}` : k);
      }
    } else out.add(caminho || '(raiz)');
  };
  andar(raiz, prefixo);
  return out;
}

/** Folhas com data (por nome ou por valor), pulando ramos sensíveis. */
function folhasDeData(raiz: unknown): { caminho: string; valor: string }[] {
  const out: { caminho: string; valor: string }[] = [];
  const andar = (v: unknown, caminho: string, chave: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => andar(x, `${caminho}[${i}]`, chave));
    else if (isObj(v)) {
      for (const [k, x] of Object.entries(v)) if (!SENSIVEL_RE.test(k)) andar(x, caminho ? `${caminho}.${k}` : k, k);
    } else if (typeof v === 'string' && DATA_VALOR_RE.test(v)) out.push({ caminho, valor: v });
    else if (typeof v === 'string' && DATA_CHAVE_RE.test(chave) && ENUM_VALOR_RE.test(v)) out.push({ caminho, valor: v });
  };
  andar(raiz, '', '');
  return out;
}

/* ------------------------------ resumo final ----------------------------- */
interface Achado { fonte: string; porDia: boolean; totalOutubro: number | null; nota: string }
const achados: Achado[] = [];

/* -------------------------------- fatura -------------------------------- */
async function sondarFatura() {
  console.log('\n=== C. FATURA: linhas CDLIT (Seguidores) dos períodos de outubro e novembro/2026 ===');
  const per = await get('períodos da fatura', '/billing/integration/monthly/periods', { group: 'ML', document_type: 'BILL', limit: 12 });
  if (!per.ok) return;
  const lista = (isObj(per.data) && Array.isArray(per.data.results) ? per.data.results : []).filter(isObj);
  const periodos = lista.map((p) => {
    const pp = isObj(p.period) ? p.period : {};
    return { key: String(p.key ?? ''), from: String(pp.date_from ?? '-'), to: String(pp.date_to ?? '-') };
  }).filter((p) => p.key);
  console.log(`  períodos (${periodos.length}):`);
  for (const p of periodos) console.log(`    key=${p.key} | date_from=${p.from} | date_to=${p.to}`);
  const alvo = periodos
    .filter((p) => [p.key, p.from, p.to].some((s) => s.startsWith('2026-10') || s.startsWith('2026-11')))
    .sort((a, b) => a.key.localeCompare(b.key))
    .slice(0, 3);
  console.log(`  períodos escolhidos: ${alvo.map((p) => p.key).join(', ') || '(nenhum)'}`);

  const linhas: { periodo: string; raw: Obj }[] = [];
  let bdlit = 0;
  let bdlitN = 0;
  for (const p of alvo) {
    const LIMIT = 1000;
    for (let pagina = 0, offset = 0; pagina < 3; pagina++) {
      const r = await get(`detalhes ${p.key} pág ${pagina + 1}`,
        `/billing/integration/periods/key/${encodeURIComponent(p.key)}/group/ML/details`,
        { document_type: 'BILL', limit: LIMIT, offset });
      if (!r.ok || !isObj(r.data)) break;
      const page = (Array.isArray(r.data.results) ? r.data.results : []).filter(isObj);
      for (const x of page) {
        const ci = isObj(x.charge_info) ? x.charge_info : {};
        if (ci.detail_sub_type === 'CDLIT') linhas.push({ periodo: p.key, raw: x });
        if (ci.detail_sub_type === 'BDLIT') { bdlit += Number(ci.detail_amount ?? 0); bdlitN++; }
      }
      offset += page.length;
      const pg = isObj(r.data.paging) ? r.data.paging : {};
      const total = Number(r.data.total ?? pg.total ?? NaN);
      console.log(`    página com ${page.length} linhas (total informado: ${Number.isFinite(total) ? total : '-'})`);
      if (!page.length || (Number.isFinite(total) && offset >= total)) break;
    }
  }
  console.log(`\n  linhas CDLIT: ${linhas.length} | linhas BDLIT (estorno): ${bdlitN}, soma ${reais(bdlit)}`);
  if (!linhas.length) {
    achados.push({ fonte: 'fatura CDLIT', porDia: false, totalOutubro: null, nota: 'nenhuma linha CDLIT nos períodos lidos' });
    return;
  }

  const campos = new Set<string>();
  for (const l of linhas) for (const c of caminhosDeCampos(l.raw)) campos.add(c);
  console.log(`  nomes de campos das linhas CDLIT (${campos.size}):`);
  for (const c of [...campos].sort()) console.log(`    ${c}`);

  // Por linha: id do detalhe, valor, tipo/código e todas as folhas de data/período.
  const somas = new Map<string, Map<string, number>>(); // campo -> dia -> soma
  const somar = (campo: string, dia: string, v: number) => {
    const m = somas.get(campo) ?? new Map<string, number>();
    m.set(dia, (m.get(dia) ?? 0) + v);
    somas.set(campo, m);
  };
  console.log('\n  linhas CDLIT (id do detalhe | valor | tipo/código | datas):');
  for (const { periodo, raw } of linhas) {
    const ci = isObj(raw.charge_info) ? raw.charge_info : {};
    const valor = Number(ci.detail_amount ?? 0);
    const datas = folhasDeData(raw);
    console.log(`    [${periodo}] detail_id=${String(ci.detail_id ?? '-')} | amount=${reais(valor)} | ${String(ci.detail_type ?? '-')}/${String(ci.detail_sub_type ?? '-')}`);
    for (const d of datas) console.log(`        ${d.caminho} = ${d.valor}`);
    const vistos = new Set<string>();
    for (const d of datas) {
      const campo = d.caminho.replace(/\[\d+\]/g, '[]');
      if (vistos.has(campo)) continue; // mesmo campo repetido numa lista: conta só a 1ª ocorrência
      vistos.add(campo);
      const dia = diaSP(d.valor);
      if (dia) somar(campo, dia, valor);
    }
    const criado = typeof ci.creation_date_time === 'string' ? diaSP(ci.creation_date_time) : null;
    if (criado) {
      const ref = new Date(`${criado}T12:00:00Z`);
      ref.setUTCDate(ref.getUTCDate() - 1);
      somar('data_ref do painel (criação em Brasília - 1 dia)', ref.toISOString().slice(0, 10), valor);
    }
    somar('período da fatura (key)', periodo.slice(0, 10), valor);
  }

  console.log('\n  somas por campo de data (por mês; e por dia em outubro/2026):');
  for (const [campo, dias] of somas) {
    const porMes = new Map<string, number>();
    for (const [dia, v] of dias) porMes.set(dia.slice(0, 7), (porMes.get(dia.slice(0, 7)) ?? 0) + v);
    console.log(`    ${campo}: ${[...porMes].sort().map(([m, v]) => `${m}=${reais(v)}`).join(' | ')}`);
    const out = [...dias].filter(([d]) => d.startsWith(MES_ALVO)).sort();
    const distintos = new Set([...dias.keys()]).size;
    if (out.length && distintos > 2) console.log(`      outubro por dia: ${out.map(([d, v]) => `${d.slice(8)}=${reais(v)}`).join(' ')}`);
    const totOut = porMes.get(MES_ALVO) ?? 0;
    achados.push({
      fonte: `fatura CDLIT por "${campo}"`,
      porDia: distintos > 2,
      totalOutubro: totOut,
      nota: `${distintos} datas distintas`,
    });
  }
}

/* ------------------------------ publicidade ------------------------------ */
interface Anunciante { produto: string; site: string; id: string }

/** Imprime campos e, por dia, só a data e os números de custo. Devolve ids de campanha e o total de outubro. */
function analisarSucesso(rotulo: string, data: unknown): { campanhas: string[]; totalOutubro: number | null; porDia: boolean } {
  const topo = isObj(data) ? Object.keys(data) : Array.isArray(data) ? ['(lista)'] : [];
  console.log(`    chaves de topo: ${topo.join(', ') || '(nenhuma)'}`);
  const campos = [...caminhosDeCampos(data)].sort();
  console.log(`    campos (${campos.length}): ${campos.slice(0, 60).join(', ')}${campos.length > 60 ? ', ...' : ''}`);

  const campanhas = new Set<string>();
  const enums = new Map<string, Set<string>>();
  const dias: { data: string; custos: string }[] = [];
  const somaPorCampo = new Map<string, number>(); // campo de custo -> soma em outubro (linhas com data)
  const semData: string[] = [];

  const andar = (v: unknown, chavePai: string) => {
    if (Array.isArray(v)) {
      v.forEach((x) => andar(x, chavePai));
      return;
    }
    if (!isObj(v)) return;
    const id = v.campaign_id ?? (/(results|campaigns|data)$/i.test(chavePai) ? v.id : undefined);
    if (typeof id === 'string' || typeof id === 'number') campanhas.add(String(id));
    for (const [k, x] of Object.entries(v)) {
      if (ENUM_CHAVE_RE.test(k) && typeof x === 'string' && ENUM_VALOR_RE.test(x)) {
        const s = enums.get(k) ?? new Set<string>();
        s.add(x);
        enums.set(k, s);
      }
    }
    // custo direto ou dentro de "metrics"
    const custos: [string, number][] = [];
    const juntar = (o: Obj, pref: string) => {
      for (const [k, x] of Object.entries(o)) {
        if (CUSTO_RE.test(k) && typeof x === 'number') custos.push([`${pref}${k}`, x]);
        else if (CUSTO_RE.test(k) && isObj(x) && typeof x.amount === 'number') custos.push([`${pref}${k}.amount`, x.amount]);
      }
    };
    juntar(v, '');
    if (isObj(v.metrics)) juntar(v.metrics, 'metrics.');
    const dataCampo = Object.entries(v).find(([k, x]) => DATA_CHAVE_RE.test(k) && typeof x === 'string' && DATA_VALOR_RE.test(x));
    if (custos.length) {
      const txt = custos.map(([k, n]) => `${k}=${n}`).join(' ');
      if (dataCampo) {
        const dia = diaSP(dataCampo[1] as string) ?? String(dataCampo[1]);
        dias.push({ data: `${dataCampo[0]}=${dia}`, custos: txt });
        if (dia.startsWith(MES_ALVO)) for (const [k, n] of custos) somaPorCampo.set(k, (somaPorCampo.get(k) ?? 0) + n);
      } else semData.push(txt);
    }
    for (const [k, x] of Object.entries(v)) if (!SENSIVEL_RE.test(k) && k !== 'metrics') andar(x, k);
  };
  andar(data, '');

  for (const [k, s] of enums) console.log(`    valores de ${k}: ${[...s].slice(0, 15).join(', ')}`);
  if (campanhas.size) console.log(`    campanhas: ${campanhas.size}`);
  if (semData.length) {
    console.log(`    custos sem data (${semData.length}):`);
    for (const t of semData.slice(0, 10)) console.log(`      ${t}`);
  }
  if (dias.length) {
    console.log(`    custos por data (${dias.length}):`);
    for (const d of dias.slice(0, 45)) console.log(`      ${d.data} | ${d.custos}`);
    for (const [k, n] of somaPorCampo) console.log(`    soma de outubro de ${k}: ${reais(n)}`);
  }
  const distintos = new Set(dias.map((d) => d.data)).size;
  const principal = [...somaPorCampo].find(([k]) => /cost|consum|spend|invest/i.test(k));
  const totalOutubro = principal ? principal[1] : null;
  if (dias.length || semData.length) {
    achados.push({
      fonte: rotulo,
      porDia: distintos > 1,
      totalOutubro,
      nota: principal ? `campo ${principal[0]}` : semData.length ? `sem data; 1º: ${semData[0]}` : 'sem campo de custo',
    });
  }
  return { campanhas: [...campanhas], totalOutubro, porDia: distintos > 1 };
}

function lerAnunciantes(produto: string, data: unknown, outrosProdutos: Set<string>): Anunciante[] {
  const out: Anunciante[] = [];
  const lista = isObj(data) && Array.isArray(data.advertisers) ? data.advertisers : Array.isArray(data) ? data : [];
  for (const a of lista) {
    if (!isObj(a)) continue;
    const prod = String(a.product_id ?? produto);
    if (a.product_id && typeof a.product_id === 'string') outrosProdutos.add(a.product_id);
    out.push({ produto: prod, site: String(a.site_id ?? 'MLB'), id: String(a.advertiser_id ?? a.id ?? '') });
  }
  // qualquer outro product_id citado na resposta
  const andar = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(andar);
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) {
      if (/product/i.test(k) && typeof x === 'string' && ENUM_VALOR_RE.test(x)) outrosProdutos.add(x);
      else andar(x);
    }
  };
  andar(data);
  return out.filter((a) => a.id);
}

async function sondarPublicidade() {
  console.log('\n=== A. ANUNCIANTES (/advertising/advertisers) ===');
  const v1 = { 'Api-Version': '1' };
  const anunciantes: Anunciante[] = [];
  const outros = new Set<string>();
  const semFiltro = await get('anunciantes sem product_id', '/advertising/advertisers', {}, v1);
  if (semFiltro.ok) anunciantes.push(...lerAnunciantes('(sem filtro)', semFiltro.data, outros));
  const produtos = ['PADS', 'BADS', 'DISPLAY', 'DADS', 'DLIT', 'LITE', 'SADS', 'MADS'];
  const tentados = new Set<string>();
  for (let i = 0; i < produtos.length && i < 12; i++) {
    const p = produtos[i];
    if (tentados.has(p)) continue;
    tentados.add(p);
    const r = await get(`anunciantes ${p}`, '/advertising/advertisers', { product_id: p }, v1);
    if (r.ok) anunciantes.push(...lerAnunciantes(p, r.data, outros));
    for (const o of outros) if (!produtos.includes(o)) produtos.push(o);
  }
  const unicos = new Map<string, Anunciante>();
  for (const a of anunciantes) unicos.set(`${a.produto}|${a.id}`, a);
  console.log(`\n  anunciantes encontrados (${unicos.size}):`);
  for (const a of unicos.values()) console.log(`    product_id=${a.produto} | site=${a.site} | advertiser_id=${a.id}`);
  if (outros.size) console.log(`  product_ids citados nas respostas: ${[...outros].join(', ')}`);

  console.log('\n=== B. CAMPANHAS E MÉTRICAS FORA DE PADS ===');
  const pads = [...unicos.values()].find((a) => a.produto === 'PADS');
  let alvos = [...unicos.values()].filter((a) => a.produto !== 'PADS');
  // dedup por id (o mesmo anunciante pode aparecer sem filtro e com filtro)
  alvos = [...new Map(alvos.map((a) => [a.id, a])).values()].slice(0, 3);
  if (!alvos.length && pads) {
    console.log('  nenhum anunciante fora de PADS: tenta os mesmos endpoints com o anunciante de PADS');
    alvos = [pads];
  }
  const v2 = { 'api-version': '2' };
  const datas = { date_from: DE, date_to: ATE };
  const metricas = 'cost,consumed_budget,prints,clicks,followers,new_followers,visits';
  for (const a of alvos) {
    console.log(`\n  # anunciante ${a.produto} ${a.id} (${a.site})`);
    const v = `/advertising/advertisers/${a.id}`;
    const s = `/advertising/${a.site}/advertisers/${a.id}`;
    const tentativas: { rotulo: string; familia: string; path: string; params: Record<string, string | number>; h: Record<string, string> }[] = [
      { rotulo: 'brand_ads campanhas (v1)', familia: 'brand_ads', path: `${v}/brand_ads/campaigns`, params: {}, h: v1 },
      { rotulo: 'brand_ads métricas do período (v1)', familia: 'brand_ads', path: `${v}/brand_ads/campaigns/metrics`, params: { ...datas }, h: v1 },
      { rotulo: 'brand_ads busca diária (v2)', familia: 'brand_ads', path: `${s}/brand_ads/campaigns/search`, params: { ...datas, metrics: metricas, aggregation_type: 'DAILY', limit: 50 }, h: v2 },
      { rotulo: 'display campanhas (v1)', familia: 'display', path: `${v}/display/campaigns`, params: {}, h: v1 },
      { rotulo: 'display métricas do período (v1)', familia: 'display', path: `${v}/display/campaigns/metrics`, params: { ...datas }, h: v1 },
      { rotulo: 'display busca diária (v2)', familia: 'display', path: `${s}/display/campaigns/search`, params: { ...datas, metrics: metricas, aggregation_type: 'DAILY', limit: 50 }, h: v2 },
    ];
    const comCampanhas: { familia: string; ids: string[] }[] = [];
    for (const t of tentativas) {
      if (chamadas >= LIMITE_CHAMADAS - 4) break;
      const r = await get(t.rotulo, t.path, t.params, t.h);
      if (!r.ok) continue;
      const res = analisarSucesso(`${a.produto} ${t.rotulo}`, r.data);
      if (res.campanhas.length) comCampanhas.push({ familia: t.familia, ids: res.campanhas });
    }
    // métricas diárias por campanha (no máximo 3 campanhas por família)
    for (const { familia, ids } of comCampanhas) {
      for (const cid of ids.slice(0, 3)) {
        if (chamadas >= LIMITE_CHAMADAS - 2) break;
        const r = await get(`${familia} campanha ${cid} diária`, `${v}/${familia}/campaigns/${cid}/metrics`,
          { ...datas, aggregation_type: 'daily' }, v1);
        if (r.ok) analisarSucesso(`${a.produto} ${familia} campanha ${cid} diária`, r.data);
      }
    }
  }

  // As campanhas de Product Ads: os tipos/estratégias listados podem incluir a de seguidores.
  if (pads && chamadas < LIMITE_CHAMADAS) {
    console.log('\n  # PADS: tipos de campanha (para ver se "seguidores" aparece entre elas)');
    const r = await get('PADS campanhas no mês (DAILY)', `/advertising/${pads.site}/advertisers/${pads.id}/product_ads/campaigns/search`,
      { ...datas, metrics: 'cost', aggregation_type: 'DAILY', limit: 50 }, v2);
    if (r.ok) analisarSucesso('PADS campaigns/search DAILY (referência: é o gasto de Product Ads, não de Seguidores)', r.data);
  }
}

async function main() {
  const sql = connect();
  try {
    const app: MlAppCredentials = { clientId: requireEnv('ML_CLIENT_ID'), clientSecret: requireEnv('ML_CLIENT_SECRET') };
    const [acc] = await sql<{ id: string }[]>`
      select id from core.accounts where channel = 'mercadolivre' and active limit 1`;
    if (!acc) {
      console.log('Nenhuma conta do Mercado Livre conectada.');
      return;
    }
    getToken = createTokenProvider(sql, acc.id, (rt) => refreshTokens(app, rt));
    console.log(`Sonda de Seguidores: ${DE} a ${ATE} (horário de Brasília), até ${LIMITE_CHAMADAS} chamadas GET.`);

    try {
      await sondarFatura();
    } catch (err) {
      console.log(`  fatura: erro inesperado (${(err as Error).name})`);
    }
    if (chamadas > LIMITE_CHAMADAS - RESERVA_ADS) console.log(`  (fatura usou ${chamadas} chamadas; sobra menos para a publicidade)`);
    try {
      await sondarPublicidade();
    } catch (err) {
      console.log(`  publicidade: erro inesperado (${(err as Error).name})`);
    }

    console.log('\n=== D. RESUMO ===');
    console.log(`  chamadas à API: ${chamadas}`);
    console.log('  referência: painel atual R$ 52,12 (CDLIT por data_ref) | Mercado Ads R$ 539 (por dia do gasto)');
    if (!achados.length) console.log('  nenhuma fonte devolveu valores de custo.');
    for (const a of achados) {
      const tot = a.totalOutubro == null ? '-' : reais(a.totalOutubro);
      const perto = a.totalOutubro != null && Math.abs(a.totalOutubro - 539) <= 30 ? '  <== perto de R$ 539' : '';
      console.log(`  ${a.porDia ? '[por dia]' : '[sem dia]'} ${a.fonte}: outubro=${tot} (${a.nota})${perto}`);
    }
    const boa = achados.find((a) => a.porDia && !a.fonte.startsWith('PADS') && a.totalOutubro != null && Math.abs(a.totalOutubro - 539) <= 30);
    console.log(boa
      ? `  CONCLUSÃO: "${boa.fonte}" dá o gasto por dia, outubro = ${reais(boa.totalOutubro!)}.`
      : '  CONCLUSÃO: nenhuma fonte sondada deu o gasto de Seguidores por dia perto de R$ 539 em outubro.');
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  // Sem o corpo de respostas HTTP (HttpError traz o corpo na mensagem); outras mensagens, curtas.
  const msg = err instanceof HttpError ? `HTTP ${err.status}` : String((err as Error).message ?? '').slice(0, 120);
  console.error('ERRO:', msg);
  process.exit(1);
});
