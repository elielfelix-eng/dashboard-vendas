import Link from 'next/link';
import { CartaoIndicador, ErroDados, SemDados } from '@/components/cartao-indicador';
import { CascataCustos } from '@/components/cascata-custos';
import { FiltroTopo } from '@/components/filtro-topo';
import { queryFiltros } from '@/components/seletor-grao';
import { TabelaDados, type Coluna } from '@/components/tabela-dados';
import * as dash from '@/lib/dash';
import { brl, num, pct, variacao, variacaoPp } from '@/lib/formato';
import { hojeBrasilia, lerFiltros } from '@/lib/periodo';
import { exigirPermissao } from '@/lib/permissoes';

type SP = Promise<Record<string, string | string[] | undefined>>;

const ABC: Record<string, string> = { A: 'A', B: 'B', C: 'C', prejuizo: 'Prejuízo' };

interface LinhaRent {
  modelo: string; href?: string; ruim: boolean; abc: string | null; receita: number; custo_produto: number | null;
  tarifas_frete: number; custos_rateados: number; imposto_embalagem: number | null; contribuicao: number | null; contribuicao_pct: number | null;
}

const COLUNAS: Coluna<LinhaRent>[] = [
  { chave: 'modelo', titulo: 'Modelo', tipo: 'texto' },
  { chave: 'abc', titulo: 'ABC', tipo: 'texto' },
  { chave: 'receita', titulo: 'Receita', tipo: 'brl' },
  { chave: 'custo_produto', titulo: 'Custo produto', tipo: 'brl' },
  { chave: 'tarifas_frete', titulo: 'Tarifas + frete', tipo: 'brl' },
  { chave: 'custos_rateados', titulo: 'Ads e outros (rateio)', tipo: 'brl' },
  { chave: 'imposto_embalagem', titulo: 'Imposto + embalagem', tipo: 'brl' },
  { chave: 'contribuicao', titulo: 'Contribuição', tipo: 'brl' },
  { chave: 'contribuicao_pct', titulo: '%', tipo: 'pct' },
];

const pctDe = (v: number | null, r: number) => (v == null || r === 0 ? null : (v / r) * 100);

export default async function RentabilidadePage({ searchParams }: { searchParams: SP }) {
  await exigirPermissao('rentabilidade', 'custos');
  const params = await searchParams;
  const { canal, chave, periodo } = lerFiltros(params, hojeBrasilia());
  const qs = queryFiltros(params);

  let d;
  try {
    const [atual, anterior, modelos, sinc] = await Promise.all([
      dash.resumo(canal, periodo.de, periodo.ate),
      dash.resumo(canal, periodo.anteriorDe, periodo.anteriorAte),
      dash.modelos(canal, periodo.de, periodo.ate),
      dash.sincronizacoes(),
    ]);
    d = { atual, anterior, modelos, sinc };
  } catch (e) {
    return <div className="mx-auto max-w-6xl"><h1 className="mb-4 text-2xl font-semibold">Rentabilidade</h1><ErroDados mensagem={(e as Error).message} /></div>;
  }
  const { atual: a, anterior: p } = d;
  const linhas: LinhaRent[] = d.modelos
    .filter((m) => m.receita > 0 || (m.contribuicao ?? 0) !== 0)
    .map((m) => ({
      modelo: m.modelo ?? '(sem SKU)',
      href: m.modelo ? `/vendas/${encodeURIComponent(m.modelo)}${qs}` : undefined,
      ruim: m.abc === 'prejuizo',
      abc: m.abc ? ABC[m.abc] : null,
      receita: m.receita, custo_produto: m.custo_produto, tarifas_frete: m.tarifas_frete, custos_rateados: m.custos_rateados,
      imposto_embalagem: m.imposto_embalagem, contribuicao: m.contribuicao, contribuicao_pct: m.contribuicao_pct,
    }))
    .sort((x, y) => (y.contribuicao ?? 0) - (x.contribuicao ?? 0));
  const semCusto = d.modelos.filter((m) => (m.sem_custo ?? 0) > 0);

  const cascata = [
    { rotulo: 'Receita', valor: a.receita, tipo: 'receita' as const },
    { rotulo: 'Custo do produto', valor: a.custo_produto ?? 0, tipo: 'custo' as const },
    { rotulo: 'Comissão', valor: a.comissao, tipo: 'custo' as const },
    { rotulo: 'Frete', valor: a.frete, tipo: 'custo' as const },
    { rotulo: 'Parcelamento', valor: a.parcelamento, tipo: 'custo' as const },
    { rotulo: 'Product Ads', valor: a.product_ads, tipo: 'custo' as const },
    { rotulo: 'Seguidores', valor: a.seguidores, tipo: 'custo' as const },
    { rotulo: 'Estornos de publicidade', valor: a.estornos, tipo: 'custo' as const },
    { rotulo: 'DIFAL', valor: a.difal, tipo: 'custo' as const },
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
            <CartaoIndicador titulo="Receita" valor={brl(a.receita)} variacao={variacao(a.receita, p.receita)} ajuda="Só pedidos pagos." />
            <CartaoIndicador titulo="Margem bruta" valor={brl(a.margem_bruta)} variacao={variacao(a.margem_bruta, p.margem_bruta)}
              detalhe={pct(pctDe(a.margem_bruta, a.receita))} />
            <CartaoIndicador titulo="Margem de contribuição" valor={brl(a.margem_contribuicao)}
              variacao={variacaoPp(pctDe(a.margem_contribuicao, a.receita), pctDe(p.margem_contribuicao, p.receita))}
              detalhe={pct(pctDe(a.margem_contribuicao, a.receita))} />
            <CartaoIndicador titulo="Pedidos sem custo" valor={num(a.pedidos_sem_custo)}
              detalhe={semCusto.length ? `${semCusto.length} modelo(s)` : 'todos com custo'} />
          </section>

          <section className="mt-6 grid gap-4 lg:grid-cols-[2fr_1fr]">
            <div className="rounded-xl border border-border bg-surface p-4">
              <h2 className="mb-3 text-sm font-semibold">Para onde vai o dinheiro</h2>
              <CascataCustos itens={cascata} />
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <h2 className="text-sm font-semibold">Modelos sem custo no ERP</h2>
              {semCusto.length === 0 ? <p className="mt-2 text-sm text-muted">Todos os modelos vendidos têm custo.</p> : (
                <ul className="mt-2 space-y-1 text-sm">
                  {semCusto.map((m) => (
                    <li key={m.modelo ?? '-'} className="text-bad">
                      {m.modelo ? <Link href={`/vendas/${encodeURIComponent(m.modelo)}${qs}`} className="underline">{m.modelo}</Link> : '(sem SKU)'} — {m.sem_custo} pedido(s)
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-xs text-muted">A margem desses pedidos aparece maior que a real. Cadastre a cotação no ERP ou peça a correção do código.</p>
            </div>
          </section>

          <section className="mt-6">
            <h2 className="mb-1 text-sm font-semibold">Rentabilidade por modelo</h2>
            <p className="mb-2 text-xs text-muted">
              Curva ABC por lucro: A = modelos que somam os primeiros 80% do lucro, B = os próximos 15%, C = o restante.
              &quot;Ads e outros (rateio)&quot; reparte Product Ads, Seguidores, DIFAL e outras tarifas sem pedido pela receita de cada modelo.
            </p>
            <TabelaDados colunas={COLUNAS} linhas={linhas} busca="modelo" nomeArquivo={`rentabilidade_${periodo.de}_${periodo.ate}`} />
          </section>
        </>
      )}
    </div>
  );
}
