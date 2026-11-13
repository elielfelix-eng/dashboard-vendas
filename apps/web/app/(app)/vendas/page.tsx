import { CartaoIndicador, ErroDados, SemDados } from '@/components/cartao-indicador';
import { FiltroTopo } from '@/components/filtro-topo';
import { GraficoSerie } from '@/components/grafico-serie';
import { lerGrao, queryFiltros, SeletorGrao } from '@/components/seletor-grao';
import { TabelaDados, type Coluna } from '@/components/tabela-dados';
import * as dash from '@/lib/dash';
import { brl, num, pct, variacao } from '@/lib/formato';
import { hojeBrasilia, lerFiltros } from '@/lib/periodo';
import { exigirPermissao } from '@/lib/permissoes';

type SP = Promise<Record<string, string | string[] | undefined>>;

interface LinhaVendas {
  modelo: string; href?: string; pedidos: number; unidades: number; vendas_brutas: number;
  variacao: { valor: number | null; rotulo: string }; participacao: number; ticket_medio: number; pct_cancel_devol: number;
}

const COLUNAS: Coluna<LinhaVendas>[] = [
  { chave: 'modelo', titulo: 'Modelo', tipo: 'texto' },
  { chave: 'pedidos', titulo: 'Pedidos', tipo: 'num' },
  { chave: 'unidades', titulo: 'Unid.', tipo: 'num' },
  { chave: 'vendas_brutas', titulo: 'Vendas brutas', tipo: 'brl' },
  { chave: 'variacao', titulo: 'Var.', tipo: 'variacao' },
  { chave: 'participacao', titulo: 'Part. %', tipo: 'pct' },
  { chave: 'ticket_medio', titulo: 'Ticket', tipo: 'brl' },
  { chave: 'pct_cancel_devol', titulo: 'Cancel./devol. %', tipo: 'pct' },
];

export default async function VendasPage({ searchParams }: { searchParams: SP }) {
  await exigirPermissao('vendas');
  const params = await searchParams;
  const hoje = hojeBrasilia();
  const { canal, chave, periodo } = lerFiltros(params, hoje);
  const grao = lerGrao(params.grao);
  const qs = queryFiltros(params);

  let d;
  try {
    const [atual, anterior, sAtual, sAnterior, mAtual, mAnterior, sinc] = await Promise.all([
      dash.resumo(canal, periodo.de, periodo.ate),
      dash.resumo(canal, periodo.anteriorDe, periodo.anteriorAte),
      dash.serie(canal, periodo.de, periodo.ate, grao),
      dash.serie(canal, periodo.anteriorDe, periodo.anteriorAte, grao),
      dash.modelos(canal, periodo.de, periodo.ate),
      dash.modelos(canal, periodo.anteriorDe, periodo.anteriorAte),
      dash.sincronizacoes(),
    ]);
    d = { atual, anterior, sAtual, sAnterior, mAtual, mAnterior, sinc };
  } catch (e) {
    return <div className="mx-auto max-w-6xl"><h1 className="mb-4 text-2xl font-semibold">Vendas</h1><ErroDados mensagem={(e as Error).message} /></div>;
  }
  const { atual: a, anterior: p } = d;
  const anteriorPorModelo = new Map(d.mAnterior.map((m) => [m.modelo, m.vendas_brutas]));
  const linhas: LinhaVendas[] = d.mAtual
    .filter((m) => m.pedidos > 0)
    .map((m) => ({
      modelo: m.modelo ?? '(sem SKU)',
      href: m.modelo ? `/vendas/${encodeURIComponent(m.modelo)}${qs}` : undefined,
      pedidos: m.pedidos, unidades: m.unidades, vendas_brutas: m.vendas_brutas,
      variacao: variacao(m.vendas_brutas, anteriorPorModelo.get(m.modelo) ?? 0),
      participacao: a.vendas_brutas > 0 ? (m.vendas_brutas / a.vendas_brutas) * 100 : 0,
      ticket_medio: m.ticket_medio, pct_cancel_devol: m.pct_cancel_devol,
    }));

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-4 text-2xl font-semibold">Vendas</h1>
      <FiltroTopo canal={canal} chave={chave} periodo={periodo} atualizadoEm={d.sinc.mercadolivre?.ultimoSucesso ?? null} />
      {a.pedidos === 0 ? <SemDados /> : (
        <>
          <p className="mb-3 text-xs text-muted">
            Como nas Métricas do Mercado Livre: vendas brutas e quantidade de vendas incluem as canceladas e as devolvidas;
            pedidos cancelados porque o carrinho foi dividido não contam. Vendas líquidas são só os pedidos pagos.
          </p>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <CartaoIndicador titulo="Vendas brutas" valor={brl(a.vendas_brutas)} variacao={variacao(a.vendas_brutas, p.vendas_brutas)} />
            <CartaoIndicador titulo="Quantidade de vendas" valor={num(a.pedidos)} variacao={variacao(a.pedidos, p.pedidos)} />
            <CartaoIndicador titulo="Unidades vendidas" valor={num(a.unidades)} variacao={variacao(a.unidades, p.unidades)} />
            <CartaoIndicador titulo="Preço médio por venda" valor={brl(a.ticket_medio)} variacao={variacao(a.ticket_medio, p.ticket_medio)} />
            <CartaoIndicador titulo="Preço médio por unidade" valor={brl(a.unidades ? a.vendas_brutas / a.unidades : null)}
              variacao={variacao(a.unidades ? a.vendas_brutas / a.unidades : null, p.unidades ? p.vendas_brutas / p.unidades : null)} />
            <CartaoIndicador titulo="Vendas canceladas" valor={brl(a.canceladas_valor)} inverterCores
              variacao={variacao(a.canceladas_valor, p.canceladas_valor)} detalhe={`${num(a.cancelados)} vendas`} />
            <CartaoIndicador titulo="Vendas devolvidas" valor={brl(a.devolvidas_valor)} inverterCores
              variacao={variacao(a.devolvidas_valor, p.devolvidas_valor)} detalhe={`${num(a.devolvidos)} vendas`} />
            <CartaoIndicador titulo="Vendas líquidas" valor={brl(a.receita)} variacao={variacao(a.receita, p.receita)}
              detalhe={`${pct(a.pct_cancel_devol)} canceladas ou devolvidas`} ajuda="Só os pedidos pagos: é a base da margem." />
          </section>
          <section className="mt-6 rounded-xl border border-border bg-surface p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Vendas brutas</h2>
              <SeletorGrao atual={grao} params={params} caminho="/vendas" />
            </div>
            <GraficoSerie atual={d.sAtual} anterior={d.sAnterior} grao={grao} />
          </section>
          <section className="mt-6">
            <TabelaDados colunas={COLUNAS} linhas={linhas} busca="modelo" nomeArquivo={`vendas-por-modelo_${periodo.de}_${periodo.ate}`}
              titulo="Vendas por modelo"
              descricao={`Todos os ${linhas.length} modelos vendidos no período, do maior para o menor. Clique no modelo para ver SKUs e pedidos.`} />
          </section>
        </>
      )}
    </div>
  );
}
