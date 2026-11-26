import { AvisoDados, ErroDados, SemDados } from '@/components/cartao-indicador';
import { CartaoCanal, type DadosCartaoCanal } from '@/components/comparativo/cartao-canal';
import { FiltroTopo } from '@/components/filtro-topo';
import { GradeArrastavel } from '@/components/grade-arrastavel';
import { GraficoAnos } from '@/components/grafico-mensal';
import { TabelaDados, type CelulaSugestao, type Coluna } from '@/components/tabela-dados';
import * as ads from '@/lib/ads';
import { agregarAnual, type LinhaAno } from '@/lib/anual';
import { atualizadoEmCanal, avisoSemDadosShopee, nomeCanal } from '@/lib/canais';
import { rotuloSugestaoCanal, sugestaoParaTela, textoCrescimento, tomSugestaoCanal } from '@/lib/crescimento';
import * as dash from '@/lib/dash';
import type { Canal } from '@/lib/periodo';
import { hojeBrasilia, lerFiltros } from '@/lib/periodo';
import { exigirPermissao, type Permissao } from '@/lib/permissoes';
import Link from 'next/link';

type SP = Promise<Record<string, string | string[] | undefined>>;
const ANOS = 4; // ano atual + 3 anteriores
const um = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const ABAS = [
  { chave: 'anual', rotulo: 'Anual' },
  { chave: 'canais', rotulo: 'Canais' },
] as const;

export default async function ComparativoPage({ searchParams }: { searchParams: SP }) {
  const perms = await exigirPermissao('vendas');
  const sp = await searchParams;
  const aba = um(sp.aba) === 'canais' ? 'canais' : 'anual';

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-1 text-2xl font-semibold">Comparativo</h1>
      <nav className="mb-4 mt-3 flex gap-1 border-b border-border text-sm" aria-label="Abas">
        {ABAS.map((x) => (
          <Link key={x.chave} href={`/comparativo?aba=${x.chave}`}
            className={`-mb-px border-b-2 px-3 py-2 ${aba === x.chave ? 'border-accent font-medium' : 'border-transparent text-muted'}`}>
            {x.rotulo}
          </Link>
        ))}
      </nav>
      {aba === 'canais' ? <AbaCanais sp={sp} perms={perms} /> : <AbaAnual sp={sp} perms={perms} />}
    </div>
  );
}

// ---------------------------------------------------------------------
// Aba Anual: a comparação ano a ano (a tela que já existia), agora também da Shopee.
// ---------------------------------------------------------------------
async function AbaAnual({ sp, perms }: { sp: Record<string, string | string[] | undefined>; perms: Set<Permissao> }) {
  const verCustos = perms.has('custos');
  const c = um(sp.canal);
  const canal: Canal = c === 'mercadolivre' || c === 'shopee' ? c : 'consolidado';
  const hoje = hojeBrasilia();
  const inicio = `${Number(hoje.slice(0, 4)) - (ANOS - 1)}-01-01`;

  let mensal, shopee;
  try {
    const sinc = await dash.sincronizacoes();
    [mensal, shopee] = await Promise.all([dash.resultadoMensal(canal, inicio, hoje), dash.contextoShopee(sinc)]);
  } catch (e) {
    return <ErroDados mensagem={(e as Error).message} />;
  }
  const anos = agregarAnual(mensal);
  const primeiroComVenda = mensal.find((m) => m.pedidos > 0)?.mes;
  const meses = primeiroComVenda ? mensal.filter((m) => m.mes >= `${primeiroComVenda.slice(0, 4)}-01-01`) : [];
  const aviso = avisoSemDadosShopee(canal, { de: inicio, ate: hoje, anteriorDe: inicio }, shopee.cob);

  // Sem a permissão de custos as tarifas da Shopee vêm vazias: na Shopee a coluna de custos sai;
  // no consolidado ela soma só as tarifas do Mercado Livre (e o Ads dos dois canais), e o título avisa.
  const tituloCustos = canal === 'mercadolivre' ? 'Custos Mercado Livre'
    : canal === 'shopee' ? 'Custos Shopee'
    : verCustos ? 'Custos dos canais' : 'Custos dos canais (tarifas só do ML)';
  const colunas: Coluna<LinhaAno>[] = [
    { chave: 'ano', titulo: 'Ano', tipo: 'texto' },
    { chave: 'meses_venda', titulo: 'Meses com venda', tipo: 'num' },
    { chave: 'pedidos', titulo: 'Vendas', tipo: 'num' },
    { chave: 'receita', titulo: 'Receita', tipo: 'brl' },
    ...(canal === 'shopee' && !verCustos ? [] : [{ chave: 'custos_ml', titulo: tituloCustos, tipo: 'brl' }] as Coluna<LinhaAno>[]),
    { chave: 'publicidade', titulo: 'Publicidade (incluída)', tipo: 'brl' },
    ...(verCustos ? [
      { chave: 'custo_produto', titulo: 'Custo produtos', tipo: 'brl' },
      { chave: 'margem', titulo: 'Margem de contribuição', tipo: 'brl' },
      { chave: 'margem_pct', titulo: 'Margem %', tipo: 'pct' },
    ] as Coluna<LinhaAno>[] : []),
  ];
  const canaisBotao: Canal[] = shopee.ativa || canal === 'shopee' ? ['consolidado', 'mercadolivre', 'shopee'] : ['consolidado', 'mercadolivre'];

  return (
    <>
      <p className="mb-4 text-sm text-muted">
        Os últimos {ANOS} anos, mês a mês. O ano atual vai até hoje; cada pedido usa o custo da época.
      </p>
      <div className="mb-4 flex w-fit overflow-hidden rounded-lg border border-border text-sm">
        {canaisBotao.map((x) => (
          <Link key={x} href={`/comparativo?aba=anual&canal=${x}`}
            className={`px-3 py-1.5 ${canal === x ? 'bg-accent text-white' : 'hover:bg-accent-soft'}`}>
            {nomeCanal(x)}
          </Link>
        ))}
      </div>
      {aviso && !aviso.semDados && <AvisoDados texto={aviso.texto} />}
      {aviso?.semDados ? <SemDados texto={aviso.texto} /> : !anos.length ? <SemDados texto="Sem vendas nos últimos anos." /> : (
        <>
          <section>
            <TabelaDados colunas={colunas} linhas={anos.map((x) => ({ ...x, ano: String(x.ano) as unknown as number }))}
              nomeArquivo={`comparativo-anual_${canal}_${hoje}`} titulo="Resultado por ano"
              descricao={canal === 'consolidado' && !verCustos
                ? 'Sem a permissão de ver custos, as tarifas da Shopee não aparecem: a coluna de custos soma só as tarifas do Mercado Livre e o Ads dos dois canais.'
                : undefined} />
          </section>
          <section className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-surface p-4">
              <h2 className="mb-2 text-sm font-semibold">Receita por mês, ano a ano</h2>
              <GraficoAnos linhas={meses} medida="receita" rotulo="Receita" />
            </div>
            {verCustos && (
              <div className="rounded-xl border border-border bg-surface p-4">
                <h2 className="mb-2 text-sm font-semibold">Margem de contribuição por mês, ano a ano</h2>
                <GraficoAnos linhas={meses} medida="margem_contribuicao" rotulo="Margem" />
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------
// Aba Canais: Mercado Livre e Shopee lado a lado, cada um com os próprios números (escolha do dono).
// crescimento_canal('consolidado') é chamado UMA vez por carga (o banco calcula os 3 períodos dos 2 canais).
// ---------------------------------------------------------------------
interface LinhaTabelaCanal {
  canal: string; vendas: number | null; anterior: { valor: number | null; rotulo: string }; ano: { valor: number | null; rotulo: string };
  margem: number | null; investimento: number | null; tacos: number | null; sugestao: CelulaSugestao | null;
}

async function AbaCanais({ sp, perms }: { sp: Record<string, string | string[] | undefined>; perms: Set<Permissao> }) {
  const verCustos = perms.has('custos');
  const verAds = perms.has('ads');
  const hoje = hojeBrasilia();
  const { chave, periodo } = lerFiltros(sp, hoje);

  let d;
  try {
    const sinc = await dash.sincronizacoes();
    const [cresc, shopee, adsMl, adsSh] = await Promise.all([
      dash.crescimentoCanal('consolidado', periodo.de, periodo.ate, periodo.anteriorDe, periodo.anteriorAte),
      dash.contextoShopee(sinc),
      verAds ? ads.adsResumo('mercadolivre', periodo.de, periodo.ate, false) : Promise.resolve(null),
      verAds ? ads.adsResumo('shopee', periodo.de, periodo.ate, false) : Promise.resolve(null),
    ]);
    d = { cresc, shopee, adsMl, adsSh, sinc };
  } catch (e) {
    return <ErroDados mensagem={(e as Error).message} />;
  }

  const cartoes: { canal: 'mercadolivre' | 'shopee'; dados: DadosCartaoCanal }[] = d.cresc.map((l) => {
    const aviso = l.canal === 'shopee' ? avisoSemDadosShopee('shopee', periodo, d.shopee.cob) : null;
    const semDados = aviso?.semDados ? aviso.texto : null;
    const r = l.canal === 'shopee' ? d.adsSh : d.adsMl;
    const parametros = l.pct_crescimento != null && l.pct_queda != null ? { pct_crescimento: l.pct_crescimento, pct_queda: l.pct_queda } : null;
    return {
      canal: l.canal,
      dados: {
        nome: nomeCanal(l.canal),
        vendasAtual: l.vendas_atual, vendasAnterior: l.vendas_anterior, vendasAnoPassado: l.vendas_ano_passado,
        margemAtual: l.margem_pos_ads_atual, margemAnterior: l.margem_pos_ads_anterior,
        ads: r ? { investimento: r.investimento, tacos: r.tacos } : null,
        // Sugestão e motivo só para quem vê custos (decisão do dono): a permissão é passada explicitamente.
        sugestao: semDados ? null : sugestaoParaTela(l, parametros, verCustos),
        semDados,
        aviso: aviso && !aviso.semDados ? aviso.texto : null,
        verCustos,
      },
    };
  });

  const linhas: LinhaTabelaCanal[] = cartoes.map(({ dados: x }) => {
    const sem = { valor: null, rotulo: 'sem dados' };
    return {
      canal: x.nome,
      vendas: x.semDados ? null : x.vendasAtual,
      anterior: x.semDados ? sem : textoCrescimento(x.vendasAtual, x.vendasAnterior),
      ano: x.semDados ? sem : textoCrescimento(x.vendasAtual, x.vendasAnoPassado),
      margem: x.semDados ? null : x.margemAtual,
      investimento: x.semDados ? null : x.ads?.investimento ?? null,
      tacos: x.semDados ? null : x.ads?.tacos ?? null,
      sugestao: x.sugestao
        ? { rotulo: rotuloSugestaoCanal(x.sugestao.sugestao), tom: tomSugestaoCanal(x.sugestao.sugestao), motivo: x.sugestao.motivo, pausado: false, valor: 0 }
        : null,
    };
  });
  const colunas: Coluna<LinhaTabelaCanal>[] = [
    { chave: 'canal', titulo: 'Canal', tipo: 'texto' },
    { chave: 'vendas', titulo: 'Vendas brutas', tipo: 'brl' },
    { chave: 'anterior', titulo: 'Sobre o período anterior', tipo: 'variacao' },
    { chave: 'ano', titulo: 'Sobre o ano passado', tipo: 'variacao' },
    ...(verCustos ? [{ chave: 'margem', titulo: 'Margem depois do Ads %', tipo: 'pct' }] as Coluna<LinhaTabelaCanal>[] : []),
    ...(verAds ? [
      { chave: 'investimento', titulo: 'Investimento em Ads', tipo: 'brl' },
      { chave: 'tacos', titulo: 'TACOS', tipo: 'pct' },
    ] as Coluna<LinhaTabelaCanal>[] : []),
    ...(verCustos ? [{ chave: 'sugestao', titulo: 'Sugestão', tipo: 'sugestao' }] as Coluna<LinhaTabelaCanal>[] : []),
  ];

  return (
    <>
      <p className="mb-4 text-sm text-muted">
        Cada canal com os próprios números: vendas brutas do período comparadas ao período anterior de mesmo tamanho e ao mesmo
        período do ano passado.{verCustos
          ? ' A sugestão usa o crescimento e a margem depois do Ads, com os percentuais de Administração › Parâmetros.'
          : ''}
      </p>
      <FiltroTopo canal="consolidado" chave={chave} periodo={periodo} mostrarCanal={false}
        atualizadoEm={atualizadoEmCanal('consolidado', d.sinc, d.shopee.ativa)} />
      {!cartoes.length ? <SemDados texto="Nenhum canal liberado para o seu perfil." /> : (
        <>
          <GradeArrastavel id="comparativo-canais" className="grid gap-4 md:grid-cols-2"
            itens={cartoes.map((c) => ({ chave: c.canal, node: <CartaoCanal d={c.dados} /> }))} />
          <section className="mt-6">
            <TabelaDados colunas={colunas} linhas={linhas} nomeArquivo={`comparativo-canais_${periodo.de}_${periodo.ate}`}
              titulo="Canais lado a lado"
              descricao="Vendas brutas como em Vendas. A taxa de conversão da Shopee não entra: a Shopee só informa as visitas acumuladas, sem o período." />
          </section>
        </>
      )}
    </>
  );
}
