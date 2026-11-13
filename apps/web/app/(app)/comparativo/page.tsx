import { ErroDados, SemDados } from '@/components/cartao-indicador';
import { GraficoAnos } from '@/components/grafico-mensal';
import { TabelaDados, type Coluna } from '@/components/tabela-dados';
import { agregarAnual, type LinhaAno } from '@/lib/anual';
import * as dash from '@/lib/dash';
import type { Canal } from '@/lib/periodo';
import { hojeBrasilia } from '@/lib/periodo';
import { exigirPermissao } from '@/lib/permissoes';
import Link from 'next/link';

type SP = Promise<Record<string, string | string[] | undefined>>;
const ANOS = 4; // ano atual + 3 anteriores

export default async function ComparativoPage({ searchParams }: { searchParams: SP }) {
  const perms = await exigirPermissao('vendas');
  const verCustos = perms.has('custos');
  const sp = await searchParams;
  const canal: Canal = sp.canal === 'mercadolivre' ? 'mercadolivre' : 'consolidado';
  const hoje = hojeBrasilia();
  const inicio = `${Number(hoje.slice(0, 4)) - (ANOS - 1)}-01-01`;

  let mensal;
  try {
    mensal = await dash.resultadoMensal(canal, inicio, hoje);
  } catch (e) {
    return <div className="mx-auto max-w-6xl"><h1 className="mb-4 text-2xl font-semibold">Comparativo anual</h1><ErroDados mensagem={(e as Error).message} /></div>;
  }
  const anos = agregarAnual(mensal);
  const primeiroComVenda = mensal.find((m) => m.pedidos > 0)?.mes;
  const meses = primeiroComVenda ? mensal.filter((m) => m.mes >= `${primeiroComVenda.slice(0, 4)}-01-01`) : [];

  const colunas: Coluna<LinhaAno>[] = [
    { chave: 'ano', titulo: 'Ano', tipo: 'texto' },
    { chave: 'meses_venda', titulo: 'Meses com venda', tipo: 'num' },
    { chave: 'pedidos', titulo: 'Vendas', tipo: 'num' },
    { chave: 'receita', titulo: 'Receita', tipo: 'brl' },
    { chave: 'custos_ml', titulo: 'Custos Mercado Livre', tipo: 'brl' },
    { chave: 'publicidade', titulo: 'Publicidade (incluída)', tipo: 'brl' },
    ...(verCustos ? [
      { chave: 'custo_produto', titulo: 'Custo produtos', tipo: 'brl' },
      { chave: 'margem', titulo: 'Margem de contribuição', tipo: 'brl' },
      { chave: 'margem_pct', titulo: 'Margem %', tipo: 'pct' },
    ] as Coluna<LinhaAno>[] : []),
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-1 text-2xl font-semibold">Comparativo anual</h1>
      <p className="mb-4 text-sm text-muted">
        Os últimos {ANOS} anos, mês a mês. O ano atual vai até hoje; cada pedido usa o custo da época.
      </p>
      <div className="mb-4 flex overflow-hidden rounded-lg border border-border text-sm w-fit">
        {(['consolidado', 'mercadolivre'] as const).map((c) => (
          <Link key={c} href={`/comparativo?canal=${c}`}
            className={`px-3 py-1.5 ${canal === c ? 'bg-accent text-white' : 'hover:bg-accent-soft'}`}>
            {c === 'consolidado' ? 'Consolidado' : 'Mercado Livre'}
          </Link>
        ))}
      </div>
      {!anos.length ? <SemDados texto="Sem vendas nos últimos anos." /> : (
        <>
          <section>
            <TabelaDados colunas={colunas} linhas={anos.map((x) => ({ ...x, ano: String(x.ano) as unknown as number }))}
              nomeArquivo={`comparativo-anual_${hoje}`} titulo="Resultado por ano" />
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
    </div>
  );
}
