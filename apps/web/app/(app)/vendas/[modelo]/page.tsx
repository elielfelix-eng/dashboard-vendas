import Link from 'next/link';
import { ErroDados } from '@/components/cartao-indicador';
import { FiltroTopo } from '@/components/filtro-topo';
import { queryFiltros } from '@/components/seletor-grao';
import { TabelaDados, type Coluna } from '@/components/tabela-dados';
import * as dash from '@/lib/dash';
import { hojeBrasilia, lerFiltros } from '@/lib/periodo';
import { getPermissoes, exigirPermissao } from '@/lib/permissoes';

type SP = Promise<Record<string, string | string[] | undefined>>;

const CLASSE: Record<string, string> = { pago: 'Pago', cancelado: 'Cancelado', devolvido: 'Devolvido', dividido: 'Dividido', outro: 'Outro' };

export default async function ModeloPage({ params, searchParams }: { params: Promise<{ modelo: string }>; searchParams: SP }) {
  const perms = await getPermissoes();
  if (!perms.has('vendas') && !perms.has('rentabilidade')) await exigirPermissao('vendas');
  const modelo = decodeURIComponent((await params).modelo);
  const sp = await searchParams;
  const { canal, chave, periodo } = lerFiltros(sp, hojeBrasilia());
  const verCustos = perms.has('custos');

  let skus, pedidos, sinc;
  try {
    [skus, pedidos, sinc] = await Promise.all([
      dash.skus(canal, periodo.de, periodo.ate, modelo),
      dash.pedidos(canal, periodo.de, periodo.ate, modelo),
      dash.sincronizacoes(),
    ]);
  } catch (e) {
    return <div className="mx-auto max-w-6xl"><h1 className="mb-4 text-2xl font-semibold">{modelo}</h1><ErroDados mensagem={(e as Error).message} /></div>;
  }

  const colSkus: Coluna<dash.LinhaSku>[] = [
    { chave: 'sku', titulo: 'SKU', tipo: 'texto' },
    { chave: 'kit', titulo: 'Kit', tipo: 'num' },
    { chave: 'pedidos', titulo: 'Pedidos', tipo: 'num' },
    { chave: 'unidades', titulo: 'Unid.', tipo: 'num' },
    { chave: 'vendas_brutas', titulo: 'Vendas brutas', tipo: 'brl' },
    ...(verCustos ? [
      { chave: 'receita', titulo: 'Receita', tipo: 'brl' },
      { chave: 'custo_produto', titulo: 'Custo produto', tipo: 'brl' },
      { chave: 'contribuicao', titulo: 'Contribuição', tipo: 'brl' },
    ] as Coluna<dash.LinhaSku>[] : []),
  ];
  const linhasPedidos = pedidos.map((x) => ({ ...x, classe: CLASSE[x.classe] ?? x.classe }));
  const colPedidos: Coluna<(typeof linhasPedidos)[number]>[] = [
    { chave: 'data_venda', titulo: 'Data', tipo: 'texto' },
    { chave: 'order_id', titulo: 'Nº da venda', tipo: 'texto' },
    { chave: 'sku', titulo: 'SKU', tipo: 'texto' },
    { chave: 'sku_anuncio', titulo: 'SKU no anúncio', tipo: 'texto' },
    { chave: 'qtd', titulo: 'Qtd', tipo: 'num' },
    { chave: 'valor_venda', titulo: 'Valor', tipo: 'brl' },
    { chave: 'classe', titulo: 'Situação', tipo: 'texto' },
    ...(verCustos ? [
      { chave: 'custo_produto', titulo: 'Custo produto', tipo: 'brl' },
      { chave: 'alerta_custo', titulo: 'Alerta de custo', tipo: 'texto' },
    ] as Coluna<(typeof linhasPedidos)[number]>[] : []),
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <p className="mb-1 text-sm"><Link href={`/vendas${queryFiltros(sp)}`} className="text-muted hover:underline">← Vendas</Link></p>
      <h1 className="mb-4 text-2xl font-semibold">{modelo}</h1>
      <FiltroTopo canal={canal} chave={chave} periodo={periodo} atualizadoEm={sinc.mercadolivre?.ultimoSucesso ?? null} />
      <section>
        <h2 className="mb-2 text-sm font-semibold">Por SKU</h2>
        <TabelaDados colunas={colSkus} linhas={skus} nomeArquivo={`${modelo}_skus_${periodo.de}_${periodo.ate}`} vazio="Sem vendas deste modelo no período." />
      </section>
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">Pedidos</h2>
        <TabelaDados colunas={colPedidos} linhas={linhasPedidos} busca="order_id" nomeArquivo={`${modelo}_pedidos_${periodo.de}_${periodo.ate}`} vazio="Sem pedidos no período." />
      </section>
    </div>
  );
}
