import Link from 'next/link';
import { CartaoIndicador, ErroDados, SemDados } from '@/components/cartao-indicador';
import { CascataCustos } from '@/components/cascata-custos';
import { ComoCalculamos } from '@/components/como-calculamos';
import { FiltroTopo } from '@/components/filtro-topo';
import { GraficoMensal } from '@/components/grafico-mensal';
import { queryFiltros } from '@/components/seletor-grao';
import { TabelaAbc } from '@/components/tabela-abc';
import { TabelaDados, type Coluna } from '@/components/tabela-dados';
import * as dash from '@/lib/dash';
import { brl, num, pct, variacao, variacaoPp } from '@/lib/formato';
import { hojeBrasilia, lerFiltros } from '@/lib/periodo';
import { exigirPermissao } from '@/lib/permissoes';

type SP = Promise<Record<string, string | string[] | undefined>>;

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const pctDe = (v: number | null, r: number) => (v == null || r === 0 ? null : (v / r) * 100);

interface LinhaModeloT {
  modelo: string; href?: string; produto: string | null; abc: dash.Abc; abc_receita: dash.Abc; pedidos: number; unidades: number;
  receita: number; participacao: number; tarifas_frete: number; custo_produto: number | null; custos_rateados: number;
  imposto_embalagem: number | null; contribuicao: number | null; contribuicao_pct: number | null;
}
interface LinhaSkuT {
  sku: string; href?: string; produto: string | null; kit: number | null; abc: dash.Abc; abc_receita: dash.Abc; pedidos: number;
  unidades: number; receita: number; participacao: number; tarifas_frete: number; custo_produto: number | null;
  contribuicao: number | null; contribuicao_pct: number | null;
}
interface LinhaMesT {
  mes: string; pedidos: number; vendas_brutas: number; canceladas_valor: number; devolvidas_valor: number; receita: number;
  comissao: number; frete: number; parcelamento: number; product_ads: number; seguidores: number; estornos: number;
  difal: number; outras: number; imposto_embalagem: number | null; custo_produto: number | null;
  margem_contribuicao: number | null; margem_pct: number | null;
}

const COL_MODELOS: Coluna<LinhaModeloT>[] = [
  { chave: 'modelo', titulo: 'Modelo', tipo: 'texto' },
  { chave: 'produto', titulo: 'Produto', tipo: 'texto' },
  { chave: 'pedidos', titulo: 'Pedidos', tipo: 'num' },
  { chave: 'unidades', titulo: 'Unid.', tipo: 'num' },
  { chave: 'receita', titulo: 'Receita', tipo: 'brl' },
  { chave: 'participacao', titulo: '% da receita', tipo: 'pct' },
  { chave: 'tarifas_frete', titulo: 'Tarifas + frete', tipo: 'brl' },
  { chave: 'custo_produto', titulo: 'Custo produto', tipo: 'brl' },
  { chave: 'custos_rateados', titulo: 'Ads e outros (rateio)', tipo: 'brl' },
  { chave: 'imposto_embalagem', titulo: 'Imposto + embalagem', tipo: 'brl' },
  { chave: 'contribuicao', titulo: 'Contribuição', tipo: 'brl' },
  { chave: 'contribuicao_pct', titulo: '%', tipo: 'pct' },
];
const COL_SKUS: Coluna<LinhaSkuT>[] = [
  { chave: 'sku', titulo: 'SKU', tipo: 'texto' },
  { chave: 'produto', titulo: 'Produto', tipo: 'texto' },
  { chave: 'kit', titulo: 'Kit', tipo: 'num' },
  { chave: 'pedidos', titulo: 'Pedidos', tipo: 'num' },
  { chave: 'unidades', titulo: 'Unid.', tipo: 'num' },
  { chave: 'receita', titulo: 'Receita', tipo: 'brl' },
  { chave: 'participacao', titulo: '% da receita', tipo: 'pct' },
  { chave: 'tarifas_frete', titulo: 'Tarifas + frete', tipo: 'brl' },
  { chave: 'custo_produto', titulo: 'Custo produto', tipo: 'brl' },
  { chave: 'contribuicao', titulo: 'Contribuição', tipo: 'brl' },
  { chave: 'contribuicao_pct', titulo: '%', tipo: 'pct' },
];
const COL_MESES: Coluna<LinhaMesT>[] = [
  { chave: 'mes', titulo: 'Mês', tipo: 'texto' },
  { chave: 'pedidos', titulo: 'Vendas', tipo: 'num' },
  { chave: 'vendas_brutas', titulo: 'Vendas brutas', tipo: 'brl' },
  { chave: 'canceladas_valor', titulo: '(−) Canceladas', tipo: 'brl' },
  { chave: 'devolvidas_valor', titulo: '(−) Devolvidas', tipo: 'brl' },
  { chave: 'receita', titulo: 'Vendas líquidas', tipo: 'brl' },
  { chave: 'comissao', titulo: 'Comissão', tipo: 'brl' },
  { chave: 'frete', titulo: 'Frete', tipo: 'brl' },
  { chave: 'parcelamento', titulo: 'Parcelamento', tipo: 'brl' },
  { chave: 'product_ads', titulo: 'Product Ads', tipo: 'brl' },
  { chave: 'seguidores', titulo: 'Seguidores', tipo: 'brl' },
  { chave: 'estornos', titulo: 'Estornos de publicidade', tipo: 'brl' },
  { chave: 'difal', titulo: 'ICMS-DIFAL', tipo: 'brl' },
  { chave: 'outras', titulo: 'Outras tarifas', tipo: 'brl' },
  { chave: 'imposto_embalagem', titulo: 'Imposto + embalagem', tipo: 'brl' },
  { chave: 'custo_produto', titulo: 'Custo produtos', tipo: 'brl' },
  { chave: 'margem_contribuicao', titulo: 'Margem de contribuição', tipo: 'brl' },
  { chave: 'margem_pct', titulo: 'Margem %', tipo: 'pct' },
];
const TIPO_ALERTA: Record<string, string> = {
  sem_custo: 'Sem custo no ERP (entra com custo zero)',
  faixa_atual: 'Cotação posterior à venda (usou a primeira cotação depois da data)',
};

export default async function RentabilidadePage({ searchParams }: { searchParams: SP }) {
  await exigirPermissao('rentabilidade', 'custos');
  const params = await searchParams;
  const { canal, chave, periodo } = lerFiltros(params, hojeBrasilia());
  const qs = queryFiltros(params);
  const inicioAno = `${periodo.ate.slice(0, 4)}-01-01`;

  let d;
  try {
    const [atual, anterior, modelos, skus, mensal, alertas, sinc] = await Promise.all([
      dash.resumo(canal, periodo.de, periodo.ate),
      dash.resumo(canal, periodo.anteriorDe, periodo.anteriorAte),
      dash.modelos(canal, periodo.de, periodo.ate),
      dash.skus(canal, periodo.de, periodo.ate, null),
      dash.resultadoMensal(canal, inicioAno, periodo.ate),
      dash.alertas(canal, periodo.de, periodo.ate),
      dash.sincronizacoes(),
    ]);
    d = { atual, anterior, modelos, skus, mensal, alertas, sinc };
  } catch (e) {
    return <div className="mx-auto max-w-6xl"><h1 className="mb-4 text-2xl font-semibold">Rentabilidade</h1><ErroDados mensagem={(e as Error).message} /></div>;
  }
  const { atual: a, anterior: p } = d;
  const linkModelo = (m: string | null) => (m ? `/vendas/${encodeURIComponent(m)}${qs}` : undefined);

  const modelos: LinhaModeloT[] = d.modelos
    .filter((m) => m.receita > 0 || (m.contribuicao ?? 0) !== 0)
    .sort((x, y) => (y.contribuicao ?? 0) - (x.contribuicao ?? 0))
    .map((m) => ({
      modelo: m.modelo ?? '(sem SKU)', href: linkModelo(m.modelo), produto: m.produto, abc: m.abc, abc_receita: m.abc_receita,
      pedidos: m.pedidos, unidades: m.unidades, receita: m.receita, participacao: pctDe(m.receita, a.receita) ?? 0,
      tarifas_frete: m.tarifas_frete, custo_produto: m.custo_produto, custos_rateados: m.custos_rateados,
      imposto_embalagem: m.imposto_embalagem, contribuicao: m.contribuicao, contribuicao_pct: m.contribuicao_pct,
    }));
  const skus: LinhaSkuT[] = d.skus
    .filter((s) => s.receita > 0 || (s.contribuicao ?? 0) !== 0)
    .sort((x, y) => (y.contribuicao ?? 0) - (x.contribuicao ?? 0))
    .map((s) => ({
      sku: s.sku ?? '(sem SKU)', href: linkModelo(s.modelo), produto: s.produto, kit: s.kit, abc: s.abc, abc_receita: s.abc_receita,
      pedidos: s.pedidos, unidades: s.unidades, receita: s.receita, participacao: pctDe(s.receita, a.receita) ?? 0,
      tarifas_frete: s.tarifas_frete, custo_produto: s.custo_produto, contribuicao: s.contribuicao, contribuicao_pct: s.contribuicao_pct,
    }));
  const meses: LinhaMesT[] = d.mensal.map((m) => ({
    mes: `${MESES[Number(m.mes.slice(5, 7)) - 1]}/${m.mes.slice(0, 4)}`, pedidos: m.pedidos, vendas_brutas: m.vendas_brutas,
    canceladas_valor: m.canceladas_valor, devolvidas_valor: m.devolvidas_valor, receita: m.receita, comissao: m.comissao,
    frete: m.frete, parcelamento: m.parcelamento, product_ads: m.product_ads, seguidores: m.seguidores, estornos: m.estornos,
    difal: m.difal, outras: m.outras, imposto_embalagem: (m.imposto ?? 0) + (m.embalagem ?? 0), custo_produto: m.custo_produto,
    margem_contribuicao: m.margem_contribuicao, margem_pct: pctDe(m.margem_contribuicao, m.receita),
  }));

  const cascata = [
    { rotulo: 'Receita', valor: a.receita, tipo: 'receita' as const },
    { rotulo: 'Custo do produto', valor: a.custo_produto ?? 0, tipo: 'custo' as const },
    { rotulo: 'Comissão', valor: a.comissao, tipo: 'custo' as const },
    { rotulo: 'Frete', valor: a.frete, tipo: 'custo' as const },
    { rotulo: 'Parcelamento', valor: a.parcelamento, tipo: 'custo' as const },
    { rotulo: 'Product Ads', valor: a.product_ads, tipo: 'custo' as const },
    { rotulo: 'Seguidores', valor: a.seguidores, tipo: 'custo' as const },
    { rotulo: 'Estornos de publicidade', valor: a.estornos, tipo: 'custo' as const },
    { rotulo: 'ICMS-DIFAL', valor: a.difal, tipo: 'custo' as const },
    { rotulo: 'Outras tarifas', valor: a.outras, tipo: 'custo' as const },
    { rotulo: 'Imposto e embalagem', valor: (a.imposto ?? 0) + (a.embalagem ?? 0), tipo: 'custo' as const },
    { rotulo: 'Contribuição', valor: a.margem_contribuicao ?? 0, tipo: 'resultado' as const },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-4 text-2xl font-semibold">Rentabilidade</h1>
      <FiltroTopo canal={canal} chave={chave} periodo={periodo} atualizadoEm={d.sinc.mercadolivre?.ultimoSucesso ?? null} />
      {a.pedidos === 0 ? <SemDados /> : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <CartaoIndicador titulo="Receita (vendas líquidas)" valor={brl(a.receita)} variacao={variacao(a.receita, p.receita)} ajuda="Só pedidos pagos." />
            <CartaoIndicador titulo="Margem bruta" valor={brl(a.margem_bruta)}
              variacao={variacaoPp(pctDe(a.margem_bruta, a.receita), pctDe(p.margem_bruta, p.receita))}
              detalhe={pct(pctDe(a.margem_bruta, a.receita))} />
            <CartaoIndicador titulo="Margem de contribuição" valor={brl(a.margem_contribuicao)}
              variacao={variacaoPp(pctDe(a.margem_contribuicao, a.receita), pctDe(p.margem_contribuicao, p.receita))}
              detalhe={pct(pctDe(a.margem_contribuicao, a.receita))} />
            <CartaoIndicador titulo="Pedidos com custo estimado ou ausente" valor={num((a.estimados ?? 0) + (a.pedidos_sem_custo ?? 0))}
              detalhe={`${num(a.estimados)} com frete/comissão estimados · ${num(a.pedidos_sem_custo)} sem custo`} />
          </section>

          <section className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-surface p-4">
              <h2 className="mb-3 text-sm font-semibold">Para onde vai cada R$ 100 recebidos</h2>
              <CascataCustos itens={cascata} />
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <h2 className="mb-1 text-sm font-semibold">Receita e margem por mês ({periodo.ate.slice(0, 4)})</h2>
              <p className="mb-2 text-xs text-muted">De janeiro até o fim do período escolhido.</p>
              <GraficoMensal linhas={d.mensal} />
            </div>
          </section>

          <section className="mt-6">
            <h2 className="mb-1 text-sm font-semibold">Resultado mês a mês ({periodo.ate.slice(0, 4)})</h2>
            <p className="mb-2 text-xs text-muted">
              Vendas brutas, canceladas e devolvidas seguem as Métricas do Mercado Livre; as vendas líquidas são a base da margem.
              Publicidade, ICMS-DIFAL e outras tarifas vêm da fatura e entram no mês de referência.
            </p>
            <TabelaDados colunas={COL_MESES} linhas={meses} nomeArquivo={`resultado-mensal_${inicioAno}_${periodo.ate}`} />
          </section>

          <section className="mt-6">
            <h2 className="mb-1 text-sm font-semibold">Resultado por modelo</h2>
            <p className="mb-2 text-xs text-muted">
              Contribuição = receita − tarifas e frete do pedido − custo do produto − publicidade e outras tarifas rateadas pela receita
              − imposto e embalagem. Clique no título de uma coluna para ordenar; no modelo, para ver os SKUs e pedidos.
            </p>
            <TabelaAbc colunas={COL_MODELOS} linhas={modelos} busca="modelo" temLucro nomeArquivo={`rentabilidade-modelos_${periodo.de}_${periodo.ate}`} />
          </section>

          <section className="mt-6">
            <h2 className="mb-1 text-sm font-semibold">Resultado por SKU</h2>
            <p className="mb-2 text-xs text-muted">Cada variação de anúncio (modelo, cor e kit) separada, com a mesma conta da tabela por modelo.</p>
            <TabelaAbc colunas={COL_SKUS} linhas={skus} busca="sku" temLucro nomeArquivo={`rentabilidade-skus_${periodo.de}_${periodo.ate}`} />
          </section>

          <section className="mt-6 rounded-xl border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold">Pontos de atenção nos dados</h2>
            <p className="mt-1 text-sm">
              <strong>{num(a.estimados)}</strong> pedido(s) do período ainda não aparecem na fatura do Mercado Livre: o frete e a comissão
              deles foram estimados pelo próprio pedido e serão trocados pelos valores faturados nas próximas atualizações.
            </p>
            {d.alertas.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Todos os pedidos pagos do período têm custo na data da venda.</p>
            ) : (
              <table className="mt-3 w-full text-sm">
                <thead><tr className="border-b border-border text-left text-xs text-muted"><th className="py-1">Modelo</th><th>Situação</th><th className="text-right">Pedidos pagos</th></tr></thead>
                <tbody>
                  {d.alertas.map((x) => (
                    <tr key={`${x.codigo}-${x.tipo}`} className="border-b border-border last:border-0">
                      <td className="py-1.5">{x.codigo ? <Link href={`/vendas/${encodeURIComponent(x.codigo)}${qs}`} className="underline">{x.codigo}</Link> : '(sem SKU)'}</td>
                      <td className={x.tipo === 'sem_custo' ? 'text-bad' : 'text-muted'}>{TIPO_ALERTA[x.tipo] ?? x.tipo}</td>
                      <td className="text-right tabular-nums">{num(x.pedidos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-2 text-xs text-muted">Sem custo, a margem do pedido aparece maior que a real. Cadastre a cotação no ERP ou peça a correção do código do anúncio.</p>
          </section>

          <ComoCalculamos verCustos />
        </>
      )}
    </div>
  );
}
