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

interface LinhaOrigemT {
  origem: string; leads: number; pct_negocio: number | null; pct_ganho: number | null; valor_ganho: number | null;
  ticket_medio: number | null; margem: string;
}

const COLUNAS: Coluna<LinhaOrigemT>[] = [
  { chave: 'origem', titulo: 'Origem', tipo: 'texto' },
  { chave: 'leads', titulo: 'Leads', tipo: 'num' },
  { chave: 'pct_negocio', titulo: '% → negócio', tipo: 'pct' },
  { chave: 'pct_ganho', titulo: '% → ganho', tipo: 'pct' },
  { chave: 'valor_ganho', titulo: 'Valor ganho', tipo: 'brl' },
  { chave: 'ticket_medio', titulo: 'Ticket médio', tipo: 'brl' },
  { chave: 'margem', titulo: 'Margem (em breve)', tipo: 'texto' },
];

export default async function OrigensPage({ searchParams }: { searchParams: SP }) {
  await exigirPermissao('crm_origens');
  const { profile } = await requireUser();
  const f = lerFiltrosCrm(await searchParams, hojeBrasilia());
  const titulo = <h1 className="mb-4 text-2xl font-bold tracking-tight">Origens dos leads</h1>;

  let d;
  try {
    const [linhas, opcoes, sinc, meuId] = await Promise.all([crm.origens(f), crm.opcoes(), dash.sincronizacoes(),
      profile?.role === 'vendedor' ? crm.meuBitrixId() : Promise.resolve(null)]);
    d = { linhas, opcoes, sinc, meuId };
  } catch (e) {
    return <div className="mx-auto max-w-6xl">{titulo}<ErroDados mensagem={(e as Error).message} /></div>;
  }
  const topo = <TopoCrm filtros={f} opcoes={d.opcoes} ehVendedor={profile?.role === 'vendedor'} sinc={d.sinc['bitrix24']} />;

  if (semVinculo(profile?.role, d.meuId)) {
    return <div className="mx-auto max-w-6xl">{titulo}{topo}<p className="rounded-xl border border-border bg-surface p-4 text-sm">{AVISO_SEM_VINCULO}</p></div>;
  }

  const linhas: LinhaOrigemT[] = d.linhas.map((o) => ({
    origem: o.origem, leads: o.leads, pct_negocio: o.pct_negocio, pct_ganho: o.pct_ganho, valor_ganho: o.valor_ganho,
    ticket_medio: o.ticket_medio, margem: '—',
  }));

  return (
    <div className="mx-auto max-w-6xl">
      {titulo}
      {topo}
      {f.area && <p className="mb-4 text-xs text-muted">O filtro Área de Negócio não se aplica aos leads</p>}
      {linhas.length === 0 ? <SemDados /> : (
        <TabelaDados colunas={COLUNAS} linhas={linhas} busca="origem" nomeArquivo={`crm-origens_${f.periodo.de}_${f.periodo.ate}`}
          titulo="Resultado por origem"
          descricao="De onde vêm os leads e quantos viram negócio e venda. Clique no título de uma coluna para ordenar." />
      )}
    </div>
  );
}
