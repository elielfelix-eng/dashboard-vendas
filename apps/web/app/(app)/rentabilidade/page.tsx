import Link from 'next/link';
import { AvisoDados, CartaoIndicador, ErroDados, SemDados } from '@/components/cartao-indicador';
import { GradeArrastavel } from '@/components/grade-arrastavel';
import { CascataCustos } from '@/components/cascata-custos';
import { ComoCalculamos } from '@/components/como-calculamos';
import { FiltroTopo } from '@/components/filtro-topo';
import { GraficoMensal } from '@/components/grafico-mensal';
import { queryFiltros } from '@/components/seletor-grao';
import { TabelaAbc } from '@/components/tabela-abc';
import { TabelaDados, type Coluna } from '@/components/tabela-dados';
import { atualizadoEmCanal, avisoSemDadosShopee, semBaseAnteriorShopee, textosEstimados } from '@/lib/canais';
import * as dash from '@/lib/dash';
import { brl, num, pct, variacao, variacaoPp } from '@/lib/formato';
import { hojeBrasilia, lerFiltros } from '@/lib/periodo';
import { exigirPermissao } from '@/lib/permissoes';

type SP = Promise<Record<string, string | string[] | undefined>>;

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const pctDe = (v: number | null, r: number) => (v == null || r === 0 ? null : (v / r) * 100);

interface LinhaModeloT {
  modelo: string; href?: string; foto: string | null; produto: string | null; abc: dash.Abc; abc_receita: dash.Abc; pedidos: number; unidades: number;
  receita: number; participacao: number; tarifas_frete: number; custo_produto: number | null; custos_rateados: number;
  imposto_embalagem: number | null; contribuicao: number | null; contribuicao_pct: number | null;
}
interface LinhaSkuT {
  sku: string; href?: string; foto: string | null; produto: string | null; kit: number | null; abc: dash.Abc; abc_receita: dash.Abc; pedidos: number;
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
// Colunas e linhas da cascata que só existem no Mercado Livre (na Shopee são sempre zero).
const SO_ML = new Set(['parcelamento', 'seguidores', 'estornos', 'difal']);

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
    const [atual, anterior, modelos, skus, mensal, alertas, { sinc, shopee }] = await Promise.all([
      dash.resumo(canal, periodo.de, periodo.ate),
      dash.resumo(canal, periodo.anteriorDe, periodo.anteriorAte),
      dash.modelos(canal, periodo.de, periodo.ate),
      dash.skus(canal, periodo.de, periodo.ate, null),
      dash.resultadoMensal(canal, inicioAno, periodo.ate),
      dash.alertas(canal, periodo.de, periodo.ate),
      dash.sincEShopee(),
    ]);
    d = { atual, anterior, modelos, skus, mensal, alertas, sinc, shopee };
  } catch (e) {
    return <div className="mx-auto max-w-6xl"><h1 className="mb-4 text-2xl font-bold tracking-tight">Rentabilidade</h1><ErroDados mensagem={(e as Error).message} /></div>;
  }
  // Shopee com o período anterior antes da 1ª venda: sem base para a comparação (setas "—").
  const a = d.atual;
  const p = semBaseAnteriorShopee(canal, periodo, d.shopee.cob) ? null : d.anterior;
  const aviso = avisoSemDadosShopee(canal, periodo, d.shopee.cob);
  const est = textosEstimados(canal);
  const soShopee = canal === 'shopee';
  const colMeses = soShopee ? COL_MESES.filter((c) => !SO_ML.has(c.chave)) : COL_MESES;
  const linkModelo = (m: string | null) => (m ? `/vendas/${encodeURIComponent(m)}${qs}` : undefined);

  const modelos: LinhaModeloT[] = d.modelos
    .filter((m) => m.receita > 0 || (m.contribuicao ?? 0) !== 0)
    .sort((x, y) => (y.contribuicao ?? 0) - (x.contribuicao ?? 0))
    .map((m) => ({
      modelo: m.modelo ?? '(sem SKU)', href: linkModelo(m.modelo), foto: m.foto, produto: m.produto, abc: m.abc, abc_receita: m.abc_receita,
      pedidos: m.pedidos, unidades: m.unidades, receita: m.receita, participacao: pctDe(m.receita, a.receita) ?? 0,
      tarifas_frete: m.tarifas_frete, custo_produto: m.custo_produto, custos_rateados: m.custos_rateados,
      imposto_embalagem: m.imposto_embalagem, contribuicao: m.contribuicao, contribuicao_pct: m.contribuicao_pct,
    }));
  const skus: LinhaSkuT[] = d.skus
    .filter((s) => s.receita > 0 || (s.contribuicao ?? 0) !== 0)
    .sort((x, y) => (y.contribuicao ?? 0) - (x.contribuicao ?? 0))
    .map((s) => ({
      sku: s.sku ?? '(sem SKU)', href: linkModelo(s.modelo), foto: s.foto, produto: s.produto, kit: s.kit, abc: s.abc, abc_receita: s.abc_receita,
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

  const cascataTodas = [
    { rotulo: 'Receita', valor: a.receita, tipo: 'receita' as const },
    { rotulo: 'Custo do produto', valor: a.custo_produto ?? 0, tipo: 'custo' as const },
    { rotulo: 'Comissão', valor: a.comissao, tipo: 'custo' as const },
    { rotulo: 'Frete', valor: a.frete, tipo: 'custo' as const },
    { rotulo: 'Parcelamento', valor: a.parcelamento, tipo: 'custo' as const, chave: 'parcelamento' },
    { rotulo: soShopee ? 'Shopee Ads' : 'Product Ads', valor: a.product_ads, tipo: 'custo' as const },
    { rotulo: 'Seguidores', valor: a.seguidores, tipo: 'custo' as const, chave: 'seguidores' },
    { rotulo: 'Estornos de publicidade', valor: a.estornos, tipo: 'custo' as const, chave: 'estornos' },
    { rotulo: 'ICMS-DIFAL', valor: a.difal, tipo: 'custo' as const, chave: 'difal' },
    { rotulo: 'Outras tarifas', valor: a.outras, tipo: 'custo' as const },
    { rotulo: 'Imposto e embalagem', valor: (a.imposto ?? 0) + (a.embalagem ?? 0), tipo: 'custo' as const },
    { rotulo: 'Contribuição', valor: a.margem_contribuicao ?? 0, tipo: 'resultado' as const },
  ];
  const cascata = cascataTodas
    .filter((x) => !soShopee || !('chave' in x && SO_ML.has(x.chave as string)))
    .map(({ rotulo, valor, tipo }) => ({ rotulo, valor, tipo }));

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-4 text-2xl font-bold tracking-tight">Rentabilidade</h1>
      <FiltroTopo canal={canal} chave={chave} periodo={periodo} shopeeAtiva={d.shopee.ativa}
        atualizadoEm={atualizadoEmCanal(canal, d.sinc, d.shopee.ativa)} />
      {aviso && !aviso.semDados && <AvisoDados texto={aviso.texto} />}
      {aviso?.semDados ? <SemDados texto={aviso.texto} /> : a.pedidos === 0 ? <SemDados /> : (
        <>
          <GradeArrastavel id="rentabilidade" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" itens={[
            { chave: 'receita', node: <CartaoIndicador titulo="Receita (vendas líquidas)" valor={brl(a.receita)} variacao={variacao(a.receita, p?.receita)} ajuda="Só pedidos pagos." /> },
            { chave: 'margem-bruta', node: <CartaoIndicador titulo="Margem bruta" valor={brl(a.margem_bruta)}
              variacao={variacaoPp(pctDe(a.margem_bruta, a.receita), p ? pctDe(p.margem_bruta, p.receita) : null)}
              detalhe={pct(pctDe(a.margem_bruta, a.receita))} /> },
            { chave: 'margem-contribuicao', node: <CartaoIndicador titulo="Margem de contribuição" valor={brl(a.margem_contribuicao)}
              variacao={variacaoPp(pctDe(a.margem_contribuicao, a.receita), p ? pctDe(p.margem_contribuicao, p.receita) : null)}
              detalhe={pct(pctDe(a.margem_contribuicao, a.receita))} /> },
            { chave: 'aguardando-fatura', node: <CartaoIndicador titulo={est.titulo} valor={`${num(a.estimados)} pedidos`}
              detalhe={est.detalhe} ajuda={est.ajuda} /> },
            { chave: 'sem-custo', node: <CartaoIndicador titulo="Sem custo do produto" valor={`${num(a.pedidos_sem_custo)} pedidos`}
              detalhe={(a.pedidos_sem_custo ?? 0) > 0 ? 'margem maior que a real: veja Pontos de atenção' : 'todos têm cotação no ERP'}
              ajuda="Pedidos pagos de modelos sem cotação de compra no ERP: entram com custo zero." /> },
          ]} />

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
            <TabelaDados colunas={colMeses} linhas={meses} nomeArquivo={`resultado-mensal_${inicioAno}_${periodo.ate}`}
              titulo={`Resultado mês a mês (${periodo.ate.slice(0, 4)})`}
              descricao={soShopee
                ? 'Vendas brutas são os pedidos pagos e os cancelados depois do pagamento; as vendas líquidas são a base da margem. As tarifas vêm do detalhe de pagamento de cada pedido; o Shopee Ads entra no dia do gasto.'
                : `Vendas brutas, canceladas e devolvidas seguem as Métricas do Mercado Livre; as vendas líquidas são a base da margem. Publicidade, ICMS-DIFAL e outras tarifas vêm da fatura e entram no mês de referência.${canal === 'consolidado' ? ' Na Shopee, as tarifas vêm do detalhe de pagamento de cada pedido.' : ''}`} />
          </section>

          <section className="mt-6">
            <TabelaAbc colunas={COL_MODELOS} linhas={modelos} busca="modelo" temLucro nomeArquivo={`rentabilidade-modelos_${periodo.de}_${periodo.ate}`}
              titulo="Resultado por modelo"
              descricao="Contribuição = receita − tarifas e frete do pedido − custo do produto − publicidade e outras tarifas rateadas pela receita − imposto e embalagem. Clique no título de uma coluna para ordenar; no modelo, para ver os SKUs e pedidos." />
          </section>

          <section className="mt-6">
            <TabelaAbc colunas={COL_SKUS} linhas={skus} busca="sku" temLucro nomeArquivo={`rentabilidade-skus_${periodo.de}_${periodo.ate}`}
              titulo="Resultado por SKU"
              descricao="Cada variação de anúncio (modelo, cor e kit) separada, com a mesma conta da tabela por modelo." />
          </section>

          <section className="mt-6 rounded-xl border border-border bg-surface p-4">
            <h2 className="text-sm font-semibold">Pontos de atenção nos dados</h2>
            <p className="mt-1 text-sm">
              <strong>{num(a.estimados)}</strong>{est.atencao}
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

          <ComoCalculamos verCustos canal={canal} />
        </>
      )}
    </div>
  );
}
