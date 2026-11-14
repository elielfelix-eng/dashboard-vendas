import { ErroDados, SemDados } from '@/components/cartao-indicador';
import { TabelaDados, type Coluna } from '@/components/tabela-dados';
import { AVISO_SEM_VINCULO, TopoCrm, semVinculo } from '@/components/topo-crm';
import { requireUser } from '@/lib/auth';
import * as crm from '@/lib/crm';
import { lerFiltrosCrm } from '@/lib/crm-filtros';
import * as dash from '@/lib/dash';
import { hojeBrasilia } from '@/lib/periodo';
import { exigirPermissao } from '@/lib/permissoes';

type SP = Promise<Record<string, string | string[] | undefined>>;

interface LinhaVendedorT {
  vendedor: string; leads: number; primeiro_contato_horas: number | null; negocios: number; ganhos: number; perdidos: number;
  conversao: number | null; valor_ganho: number | null; ticket_medio: number | null; margem: string; destaque?: boolean;
}

const COLUNAS: Coluna<LinhaVendedorT>[] = [
  { chave: 'vendedor', titulo: 'Vendedor', tipo: 'texto' },
  { chave: 'leads', titulo: 'Leads', tipo: 'num' },
  { chave: 'primeiro_contato_horas', titulo: 'Tempo até o 1º contato (horas)', tipo: 'dec1' },
  { chave: 'negocios', titulo: 'Negócios', tipo: 'num' },
  { chave: 'ganhos', titulo: 'Ganhos', tipo: 'num' },
  { chave: 'perdidos', titulo: 'Perdidos', tipo: 'num' },
  { chave: 'conversao', titulo: 'Conversão', tipo: 'pct' },
  { chave: 'valor_ganho', titulo: 'Valor ganho', tipo: 'brl' },
  { chave: 'ticket_medio', titulo: 'Ticket médio', tipo: 'brl' },
  { chave: 'margem', titulo: 'Margem (em breve)', tipo: 'texto' },
];

export default async function VendedoresPage({ searchParams }: { searchParams: SP }) {
  await exigirPermissao('crm_vendedores');
  const { profile } = await requireUser();
  const f = lerFiltrosCrm(await searchParams, hojeBrasilia());
  const titulo = <h1 className="mb-4 text-2xl font-semibold">Vendedores</h1>;

  let d;
  try {
    const [linhas, opcoes, sinc] = await Promise.all([crm.vendedores(f), crm.opcoes(), dash.sincronizacoes()]);
    d = { linhas, opcoes, sinc };
  } catch (e) {
    return <div className="mx-auto max-w-6xl">{titulo}<ErroDados mensagem={(e as Error).message} /></div>;
  }
  const topo = <TopoCrm filtros={f} opcoes={d.opcoes} ehVendedor={profile?.role === 'vendedor'} atualizadoEm={d.sinc['bitrix24']?.ultimoSucesso ?? null} />;

  if (semVinculo(profile?.role, d.opcoes)) {
    return <div className="mx-auto max-w-6xl">{titulo}{topo}<p className="rounded-xl border border-border bg-surface p-4 text-sm">{AVISO_SEM_VINCULO}</p></div>;
  }

  const todas: LinhaVendedorT[] = d.linhas.map((v) => ({
    vendedor: v.vendedor, leads: v.leads, primeiro_contato_horas: v.primeiro_contato_horas, negocios: v.negocios, ganhos: v.ganhos,
    perdidos: v.perdidos, conversao: v.conversao, valor_ganho: v.valor_ganho, ticket_medio: v.ticket_medio, margem: '—',
    ...(v.bitrix_id == null && v.vendedor === 'Média da equipe' ? { destaque: true } : {}),
  }));
  // "Média da equipe" sempre por último.
  const linhas = [...todas.filter((l) => !l.destaque), ...todas.filter((l) => l.destaque)];

  return (
    <div className="mx-auto max-w-6xl">
      {titulo}
      {topo}
      {linhas.length === 0 ? <SemDados /> : (
        <TabelaDados colunas={COLUNAS} linhas={linhas} busca="vendedor" nomeArquivo={`crm-vendedores_${f.periodo.de}_${f.periodo.ate}`}
          titulo="Ranking de vendedores"
          descricao="Leads e negócios de cada responsável. A linha em itálico é a média da equipe, só para comparar. Clique no título de uma coluna para ordenar." />
      )}
    </div>
  );
}
