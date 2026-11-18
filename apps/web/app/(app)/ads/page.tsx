import Link from 'next/link';
import { CartaoIndicador, ErroDados, SemDados } from '@/components/cartao-indicador';
import { CartaoOrcamento } from '@/components/ads/cartao-orcamento';
import { EditarOrcamento } from '@/components/ads/editar-orcamento';
import { FiltroTopo } from '@/components/filtro-topo';
import { GraficoAds } from '@/components/grafico-ads';
import { queryFiltros } from '@/components/seletor-grao';
import { TabelaDados, type CelulaSugestao, type Coluna } from '@/components/tabela-dados';
import * as ads from '@/lib/ads';
import {
  avisoFalhaAds, avisoSemDetalhe, contarSugestoes, primeiroDiaProximoMes, lerSugestao, ordemSugestao, ORDEM_SUGESTOES, ROTULO_NAO_ATRIBUIDO, ROTULO_SEM_CAMPANHA, roas, rotuloModelo, rotuloSugestao,
  tomSugestao, type SugestaoAds,
} from '@/lib/ads-regras';
import * as dash from '@/lib/dash';
import { brl, pct as pctTxt, variacao, variacaoPp } from '@/lib/formato';
import { hojeBrasilia, lerFiltros } from '@/lib/periodo';
import { exigirPermissao } from '@/lib/permissoes';

type SP = Promise<Record<string, string | string[] | undefined>>;

const ABAS = [
  { chave: 'modelos', rotulo: 'Por modelo' },
  { chave: 'campanhas', rotulo: 'Campanhas' },
  { chave: 'orcamento', rotulo: 'Orçamento' },
];

const MODOS: Record<string, string> = { manual: 'Manual', automatico: 'Automático' };
const rotuloModo = (m: string | null) => (m ? (MODOS[m] ?? m) : '—');
const STATUS: Record<string, string> = { active: 'Ativa', paused: 'Pausada', idle: 'Parada' };

interface LinhaModelo {
  modelo: string; foto: string | null; produto: string | null; situacao: string; investimento: number; impressoes: number; cliques: number;
  ctr: number | null; cpc: number | null; conversao: number | null; vendas_ads: number; acos: number | null;
  acos_equilibrio: number | null; lucro_pos_ads: number | null; sugestao: CelulaSugestao | null; modo: string; destaque?: boolean; href?: string;
}
interface LinhaCampanha {
  nome: string; status: string; automatica: string; orcamento_diario: number | null; roas_target: number | null; acos_equivalente: number | null;
  investimento: number; vendas_ads: number; acos: number | null; roas: number | null; modelos: number | null; modo: string; destaque?: boolean;
}

const COL_MODELOS: Coluna<LinhaModelo>[] = [
  { chave: 'modelo', titulo: 'Modelo', tipo: 'texto' },
  { chave: 'produto', titulo: 'Produto', tipo: 'texto' },
  { chave: 'situacao', titulo: 'Situação', tipo: 'texto' },
  { chave: 'investimento', titulo: 'Investimento', tipo: 'brl' },
  { chave: 'impressoes', titulo: 'Impressões', tipo: 'num' },
  { chave: 'cliques', titulo: 'Cliques', tipo: 'num' },
  { chave: 'ctr', titulo: 'CTR', tipo: 'pct' },
  { chave: 'cpc', titulo: 'CPC', tipo: 'brl' },
  { chave: 'conversao', titulo: 'Conversão', tipo: 'pct' },
  { chave: 'vendas_ads', titulo: 'Vendas por Ads', tipo: 'brl' },
  { chave: 'acos', titulo: 'ACOS', tipo: 'pct' },
  { chave: 'acos_equilibrio', titulo: 'ACOS de equilíbrio', tipo: 'pct' },
  { chave: 'lucro_pos_ads', titulo: 'Lucro após Ads', tipo: 'brl' },
  { chave: 'sugestao', titulo: 'Sugestão', tipo: 'sugestao' },
  { chave: 'modo', titulo: 'Modo', tipo: 'texto' },
];
const COL_CAMPANHAS: Coluna<LinhaCampanha>[] = [
  { chave: 'nome', titulo: 'Campanha', tipo: 'texto' },
  { chave: 'status', titulo: 'Status', tipo: 'texto' },
  { chave: 'automatica', titulo: 'Automática', tipo: 'texto' },
  { chave: 'orcamento_diario', titulo: 'Orçamento diário', tipo: 'brl' },
  { chave: 'roas_target', titulo: 'ROAS objetivo', tipo: 'roas' },
  { chave: 'acos_equivalente', titulo: 'ACOS equivalente', tipo: 'pct' },
  { chave: 'investimento', titulo: 'Investimento', tipo: 'brl' },
  { chave: 'vendas_ads', titulo: 'Vendas por Ads', tipo: 'brl' },
  { chave: 'acos', titulo: 'ACOS', tipo: 'pct' },
  { chave: 'roas', titulo: 'ROAS', tipo: 'roas' },
  { chave: 'modelos', titulo: 'Modelos', tipo: 'num' },
  { chave: 'modo', titulo: 'Modo', tipo: 'texto' },
];

const EXPLICACOES: [string, string][] = [
  ['Investimento', 'O que foi gasto em Product Ads no período, como consumido em cada dia.'],
  ['Vendas por Ads', 'Vendas que o Mercado Livre atribui aos anúncios patrocinados.'],
  ['ROAS', 'Quanto você vendeu por Ads para cada R$ 1 investido (vendas por Ads ÷ investimento). ROAS 5x significa R$ 5 vendidos por R$ 1 gasto.'],
  ['ACOS', 'Quanto do valor vendido por Ads foi gasto em Ads (investimento ÷ vendas por Ads). É o inverso do ROAS: ROAS 5x equivale a ACOS de 20%.'],
  ['TACOS', 'Quanto do total vendido no canal (com e sem Ads) foi gasto em Ads (investimento ÷ vendas brutas do canal). Mostra o peso do Ads no negócio inteiro.'],
  ['% de vendas via Ads', 'Parte das vendas brutas do canal que veio de anúncios patrocinados.'],
  ['ACOS de equilíbrio', 'É a margem do modelo antes do Ads dividida pela receita dele. A margem antes do Ads é o que sobra de todas as vendas do modelo no período: receita − custo do produto − tarifas e frete − imposto e embalagem − a parte dele nos custos do período (rateados pela receita), sem contar o Ads. Se o ACOS passa desse número, o Ads dá prejuízo.'],
  ['Lucro após Ads', 'A margem antes do Ads do modelo (todas as vendas dele no período, depois de custo do produto, tarifas e frete, imposto e embalagem e a parte dele nos custos do período) menos o investimento em Ads atribuído ao modelo.'],
  ['Não atribuído a anúncio', 'Investimento que não dá para ligar a um modelo: o gasto que o Mercado Livre não ligou a um anúncio e o gasto de anúncios sem modelo identificado. Aparece na última linha para a soma bater com o total.'],
  ['Não atribuído a campanha', 'Na aba Campanhas, a última linha é o investimento do total que não aparece em nenhuma campanha (por exemplo, cobranças da fatura do Mercado Livre), para a soma bater com o total.'],
];

export default async function AdsPage({ searchParams }: { searchParams: SP }) {
  const perms = await exigirPermissao('ads');
  const verCustos = perms.has('custos');
  const verVendas = perms.has('vendas');
  const podeEditarOrcamento = perms.has('editar_ads');
  const params = await searchParams;
  const { canal, chave, periodo } = lerFiltros(params, hojeBrasilia());
  const abaParam = Array.isArray(params.aba) ? params.aba[0] : params.aba;
  const aba = ABAS.some((a) => a.chave === abaParam) ? abaParam! : 'modelos';

  const sug = lerSugestao(params.sug);
  const qs = queryFiltros(params);
  const linkSug = (s: SugestaoAds | null) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (k === 'sug' || v === undefined) continue;
      q.set(k, Array.isArray(v) ? v[0] : v);
    }
    if (s) q.set('sug', s);
    q.set('aba', 'modelos');
    return `/ads?${q.toString()}`;
  };
  const filtrosTela: Record<string, string> = {};
  for (const k of ['canal', 'periodo', 'de', 'ate']) {
    const v = params[k];
    if (typeof v === 'string') filtrosTela[k] = v;
  }
  const msgOk = Array.isArray(params.ok) ? params.ok[0] : params.ok;
  const msgErro = Array.isArray(params.erro) ? params.erro[0] : params.erro;
  const link = (novaAba: string) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (k === 'aba' || v === undefined) continue;
      q.set(k, Array.isArray(v) ? v[0] : v);
    }
    q.set('aba', novaAba);
    return `/ads?${q.toString()}`;
  };

  let d;
  try {
    // Os cartões não usam nao_atribuido (a tabela tem a linha própria): detalhe = false pula a atribuição
    // por modelo nas duas chamadas. Tabelas só da aba aberta; nada na Shopee (tela sem dados).
    const [atual, anterior, serie, modelos, campanhas, sinc] = await Promise.all([
      ads.adsResumo(canal, periodo.de, periodo.ate, false),
      ads.adsResumo(canal, periodo.anteriorDe, periodo.anteriorAte, false),
      ads.adsSerie(canal, periodo.de, periodo.ate),
      aba === 'modelos' && canal !== 'shopee' ? ads.adsModelos(canal, periodo.de, periodo.ate) : Promise.resolve([]),
      aba === 'campanhas' && canal !== 'shopee' ? ads.adsCampanhas(canal, periodo.de, periodo.ate) : Promise.resolve([]),
      dash.sincronizacoes(),
    ]);
    // Orçamento: só com a aba aberta; sempre do mês corrente.
    const [orcamento, vigencias] = aba === 'orcamento' && canal !== 'shopee'
      ? await Promise.all([ads.adsOrcamento(canal), podeEditarOrcamento ? ads.orcamentoVigencias() : Promise.resolve([])])
      : [[], []];
    d = { atual, anterior, serie, modelos, campanhas, sinc, orcamento, vigencias };
  } catch (e) {
    return <div className="mx-auto max-w-6xl"><h1 className="mb-4 text-2xl font-semibold">Ads</h1><ErroDados mensagem={(e as Error).message} /></div>;
  }
  const { atual: a, anterior: p } = d;
  const semShopee = canal === 'shopee';
  const semInvestimento = !a || (a.investimento === 0 && a.vendas_ads === 0);
  const statsMl = d.sinc.mercadolivre?.stats ?? null;
  const falhaAds = semShopee ? null : avisoFalhaAds(statsMl);
  const semDetalhe = a ? avisoSemDetalhe(a.tem_detalhe) : null;

  const contagem = contarSugestoes(d.modelos);
  const celulaSugestao = (s: SugestaoAds | null, motivo: string | null, pausado: boolean | null): CelulaSugestao | null =>
    s || pausado ? { rotulo: rotuloSugestao(s), tom: tomSugestao(s), motivo: motivo ?? null, pausado: !!pausado, valor: ordemSugestao(s) } : null;
  const linhasModelos: LinhaModelo[] = d.modelos
    .filter((m) => m.modelo != null && (!sug || m.sugestao === sug))
    .sort((x, y) => y.investimento - x.investimento)
    .map((m) => ({
      modelo: rotuloModelo(m.modelo), foto: m.foto, produto: m.produto, situacao: m.pausado ? 'pausado' : '', investimento: m.investimento,
      impressoes: m.impressoes, cliques: m.cliques, ctr: m.ctr, cpc: m.cpc, conversao: m.conversao, vendas_ads: m.vendas_ads, acos: m.acos,
      acos_equilibrio: m.acos_equilibrio, lucro_pos_ads: m.lucro_pos_ads, sugestao: celulaSugestao(m.sugestao, m.motivo, m.pausado), modo: rotuloModo(m.modo),
      href: verVendas && m.modelo ? `/vendas/${encodeURIComponent(m.modelo)}${qs}` : undefined,
    }));
  const nao = d.modelos.find((m) => m.modelo == null);
  if (nao && !sug) {
    linhasModelos.push({
      modelo: ROTULO_NAO_ATRIBUIDO, foto: null, produto: null, situacao: '', investimento: nao.investimento, impressoes: nao.impressoes,
      cliques: nao.cliques, ctr: nao.ctr, cpc: nao.cpc, conversao: nao.conversao, vendas_ads: nao.vendas_ads, acos: nao.acos,
      acos_equilibrio: null, lucro_pos_ads: null, sugestao: null, modo: '—', destaque: true,
    });
  }
  const linhasCampanhas: LinhaCampanha[] = d.campanhas
    .filter((c) => c.campanha_id != null)
    .sort((x, y) => y.investimento - x.investimento)
    .map((c) => ({
      nome: c.nome, status: c.status ? (STATUS[c.status] ?? c.status) : '—', automatica: c.automatica == null ? '—' : c.automatica ? 'Sim' : 'Não',
      orcamento_diario: c.orcamento_diario, roas_target: c.roas_target, acos_equivalente: c.acos_equivalente, investimento: c.investimento,
      vendas_ads: c.vendas_ads, acos: c.acos, roas: c.roas, modelos: c.modelos, modo: rotuloModo(c.modo),
    }));
  // Linha final da aba (campanha nula): o que o cartão tem a mais que as campanhas; a soma bate com o cartão.
  const semCampanha = d.campanhas.find((c) => c.campanha_id == null);
  if (semCampanha) {
    linhasCampanhas.push({
      nome: ROTULO_SEM_CAMPANHA, status: '—', automatica: '—', orcamento_diario: null, roas_target: null, acos_equivalente: null,
      investimento: semCampanha.investimento, vendas_ads: semCampanha.vendas_ads, acos: null, roas: null, modelos: null, modo: '—', destaque: true,
    });
  }

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-4 text-2xl font-semibold">Ads</h1>
      <FiltroTopo canal={canal} chave={chave} periodo={periodo} shopeeAtiva atualizadoEm={d.sinc.mercadolivre?.ultimoSucesso ?? null} />

      {falhaAds && (
        <div role="alert" className="mb-4 rounded-lg border border-bad/40 bg-surface px-4 py-2 text-sm text-bad">{falhaAds}</div>
      )}

      {semShopee ? (
        <SemDados texto="A Shopee ainda não está conectada ao painel; assim que os dados chegarem, aparecem aqui." />
      ) : (
        <>
          {semInvestimento && <div className="mb-4"><SemDados texto="Sem investimento em Ads no período." /></div>}
          {!semInvestimento && (
            <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <CartaoIndicador titulo="Investimento" valor={brl(a.investimento)} variacao={variacao(a.investimento, p?.investimento)} inverterCores />
            <CartaoIndicador titulo="Vendas por Ads" valor={brl(a.vendas_ads)} variacao={variacao(a.vendas_ads, p?.vendas_ads)}
              ajuda="Vendas que o Mercado Livre atribui aos anúncios patrocinados." />
            <CartaoIndicador titulo="ROAS" valor={roas(a.roas)} variacao={variacao(a.roas, p?.roas)}
              ajuda="Vendas por Ads para cada R$ 1 investido." />
            <CartaoIndicador titulo="ACOS" valor={pctTxt(a.acos)} variacao={variacaoPp(a.acos, p?.acos)} inverterCores
              ajuda="Investimento ÷ vendas por Ads." />
            <CartaoIndicador titulo="TACOS" valor={pctTxt(a.tacos)} variacao={variacaoPp(a.tacos, p?.tacos)} inverterCores
              ajuda="Investimento ÷ vendas brutas do canal." />
            <CartaoIndicador titulo="% das vendas via Ads" valor={pctTxt(a.pct_vendas_ads)} variacao={variacaoPp(a.pct_vendas_ads, p?.pct_vendas_ads)}
              ajuda="Vendas por Ads ÷ vendas brutas do canal." />
          </section>

          {semDetalhe && <p className="mt-4 rounded-lg border border-border bg-surface px-4 py-2 text-sm text-muted">{semDetalhe[0].toUpperCase() + semDetalhe.slice(1)}.</p>}

          <section className="mt-6 rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-1 text-sm font-semibold">Investimento e vendas por Ads, dia a dia</h2>
            <p className="mb-2 text-xs text-muted">Barras: quanto foi investido no dia. Linha: quanto foi vendido por Ads no dia.</p>
            <GraficoAds serie={d.serie} />
          </section>

            </>
          )}

          <nav className="mt-6 flex gap-1 border-b border-border text-sm" aria-label="Abas">
            {ABAS.map((x) => (
              <Link key={x.chave} href={link(x.chave)}
                className={`-mb-px border-b-2 px-3 py-2 ${aba === x.chave ? 'border-accent font-medium' : 'border-transparent text-muted'}`}>
                {x.rotulo}
              </Link>
            ))}
          </nav>

          <section className="mt-4">
            {aba === 'orcamento' ? (
              <>
                <p className="mb-3 text-sm text-muted">O acompanhamento do orçamento é sempre do mês atual, independente do período escolhido.</p>
                {msgOk && <p className="mb-3 rounded-lg border border-border bg-surface px-4 py-2 text-sm">{msgOk}</p>}
                {msgErro && <p className="mb-3 rounded-lg border border-bad/40 bg-surface px-4 py-2 text-sm text-bad">{msgErro}</p>}
                {podeEditarOrcamento && (
                  <EditarOrcamento canais={['mercadolivre', 'shopee']} vigencias={d.vigencias} hoje={hojeBrasilia()} sugestaoData={primeiroDiaProximoMes(hojeBrasilia())}
                    filtros={filtrosTela} />
                )}
                {d.orcamento.length === 0 ? (
                  <SemDados texto="Nenhum canal conectado com orçamento para mostrar." />
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {d.orcamento.map((o) => <CartaoOrcamento key={o.canal} o={o} />)}
                  </div>
                )}
              </>
            ) : aba === 'campanhas' ? (
              <TabelaDados colunas={COL_CAMPANHAS} linhas={linhasCampanhas} busca="nome" nomeArquivo={`ads-campanhas_${periodo.de}_${periodo.ate}`}
                titulo="Campanhas" vazio="Sem campanhas com Ads no período."
                descricao="ROAS objetivo é a meta configurada no Mercado Livre; o ACOS equivalente é o mesmo número visto como percentual (1 ÷ ROAS). A última linha reúne o investimento que não aparece em nenhuma campanha." />
            ) : (
              <>
              <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs" aria-label="Filtrar por sugestão">
                <span className="mr-1 text-muted">Sugestão:</span>
                <Link href={linkSug(null)} className={`rounded-full border px-2.5 py-1 ${!sug ? 'border-accent bg-accent text-white' : 'border-border hover:bg-accent-soft'}`}>
                  Todas
                </Link>
                {ORDEM_SUGESTOES.map((x) => (
                  <Link key={x} href={linkSug(x)}
                    className={`rounded-full border px-2.5 py-1 ${sug === x ? 'border-accent bg-accent text-white' : 'border-border hover:bg-accent-soft'}`}>
                    {rotuloSugestao(x)} ({contagem[x]})
                  </Link>
                ))}
              </div>
              <TabelaDados colunas={COL_MODELOS} linhas={linhasModelos} busca="modelo" nomeArquivo={`ads-modelos_${periodo.de}_${periodo.ate}`}
                titulo="Resultado do Ads por modelo" vazio={sug ? 'Nenhum modelo com essa sugestão no período.' : 'Sem investimento por modelo no período.'}
                descricao={`${verCustos ? 'Compare o ACOS com o ACOS de equilíbrio: acima dele, a venda por Ads dá prejuízo. ' : ''}A última linha reúne o que não dá para ligar a um modelo (gasto sem anúncio e anúncios sem modelo).`} />
              </>
            )}
          </section>

          <details className="mt-6 rounded-xl border border-border bg-surface p-4 text-sm">
            <summary className="cursor-pointer font-semibold">Como os números são calculados</summary>
            <dl className="mt-3 space-y-2">
              {EXPLICACOES.filter(([t]) => verCustos || (t !== 'ACOS de equilíbrio' && t !== 'Lucro após Ads')).map(([t, x]) => (
                <div key={t}><dt className="font-medium">{t}</dt><dd className="text-muted">{x}</dd></div>
              ))}
            </dl>
          </details>
        </>
      )}
    </div>
  );
}
