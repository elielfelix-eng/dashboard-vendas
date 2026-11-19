import { CartaoIndicador, ErroDados, SemDados } from '@/components/cartao-indicador';
import { GradeArrastavel } from '@/components/grade-arrastavel';
import { TabelaDados, type Coluna } from '@/components/tabela-dados';
import { AVISO_SEM_VINCULO, TopoCrm, semVinculo } from '@/components/topo-crm';
import { requireUser } from '@/lib/auth';
import * as crm from '@/lib/crm';
import { lerFiltrosCrm } from '@/lib/crm-filtros';
import * as dash from '@/lib/dash';
import { brl, dec1, num, pct, variacao, variacaoPp } from '@/lib/formato';
import { hojeBrasilia } from '@/lib/periodo';
import { exigirPermissao } from '@/lib/permissoes';

type SP = Promise<Record<string, string | string[] | undefined>>;

interface LinhaEtapaT {
  nome: string; em_aberto: number; valor_aberto: number | null; tempo_medio_dias: number | null; marca: string; ruim?: boolean;
}

const COLUNAS: Coluna<LinhaEtapaT>[] = [
  { chave: 'nome', titulo: 'Etapa', tipo: 'texto' },
  { chave: 'em_aberto', titulo: 'Negócios em aberto', tipo: 'num' },
  { chave: 'valor_aberto', titulo: 'Valor em aberto', tipo: 'brl' },
  { chave: 'tempo_medio_dias', titulo: 'Tempo médio na etapa (dias)', tipo: 'dec1' },
  { chave: 'marca', titulo: 'Destaque', tipo: 'texto' },
];

const pctDe = (v: number, r: number) => (r === 0 ? null : (v / r) * 100);

function Barras({ itens }: { itens: { rotulo: string; texto: string; largura: number }[] }) {
  return (
    <ul className="space-y-2">
      {itens.map((i) => (
        <li key={i.rotulo} className="text-sm">
          <div className="mb-0.5 flex justify-between gap-2"><span>{i.rotulo}</span><span className="tabular-nums text-muted">{i.texto}</span></div>
          <div className="h-3 rounded bg-accent-soft"><div className="h-3 rounded bg-accent" style={{ width: `${Math.max(0, Math.min(100, i.largura))}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

export default async function FunilPage({ searchParams }: { searchParams: SP }) {
  await exigirPermissao('crm_funil');
  const { profile } = await requireUser();
  const f = lerFiltrosCrm(await searchParams, hojeBrasilia());
  const p = f.periodo;
  const titulo = <h1 className="mb-4 text-2xl font-semibold">Funil de vendas</h1>;

  let d;
  try {
    const [atual, anterior, funil, etapas, motivos, opcoes, sinc, meuId] = await Promise.all([
      crm.resumo(f), crm.resumo(f, p.anteriorDe, p.anteriorAte), crm.funil(f), crm.etapas(f), crm.motivosPerda(f),
      crm.opcoes(), dash.sincronizacoes(), profile?.role === 'vendedor' ? crm.meuBitrixId() : Promise.resolve(null),
    ]);
    d = { atual: atual[0], anterior: anterior[0], funil, etapas, motivos, opcoes, sinc, meuId };
  } catch (e) {
    return <div className="mx-auto max-w-6xl">{titulo}<ErroDados mensagem={(e as Error).message} /></div>;
  }
  const topo = <TopoCrm filtros={f} opcoes={d.opcoes} ehVendedor={profile?.role === 'vendedor'} sinc={d.sinc['bitrix24']} />;

  if (semVinculo(profile?.role, d.meuId)) {
    return <div className="mx-auto max-w-6xl">{titulo}{topo}<p className="rounded-xl border border-border bg-surface p-4 text-sm">{AVISO_SEM_VINCULO}</p></div>;
  }

  const a = d.atual;
  const b = d.anterior;
  const maxFunil = Math.max(1, ...d.funil.map((x) => x.quantidade));
  const etapas: LinhaEtapaT[] = [...d.etapas]
    .sort((x, y) => (x.ordem ?? 9999) - (y.ordem ?? 9999))
    .map((e) => ({
      nome: e.nome, em_aberto: e.em_aberto, valor_aberto: e.valor_aberto, tempo_medio_dias: e.tempo_medio_dias,
      marca: e.gargalo ? 'maior gargalo' : '', ...(e.gargalo ? { ruim: true } : {}),
    }));
  const maxPerda = Math.max(1, ...d.motivos.map((m) => m.pct ?? 0));
  const vazio = !a || (a.leads_novos === 0 && a.negocios_coorte === 0 && d.funil.every((x) => x.quantidade === 0));

  return (
    <div className="mx-auto max-w-6xl">
      {titulo}
      {topo}
      {f.area && <p className="mb-4 text-xs text-muted">O filtro Área de Negócio não se aplica aos leads</p>}
      {vazio ? <SemDados /> : (
        <>
          <GradeArrastavel id="crm-funil" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" itens={[
            { chave: 'leads-novos', node: <CartaoIndicador titulo="Leads novos" valor={num(a.leads_novos)} variacao={variacao(a.leads_novos, b?.leads_novos)} /> },
            { chave: 'lead-negocio', node: <CartaoIndicador titulo="% Lead → negócio" valor={pct(pctDe(a.leads_com_negocio, a.leads_novos))}
              variacao={variacaoPp(pctDe(a.leads_com_negocio, a.leads_novos), b ? pctDe(b.leads_com_negocio, b.leads_novos) : null)}
              ajuda="Dos leads que chegaram no período, quantos viraram negócio." /> },
            { chave: 'negocio-ganho', node: <CartaoIndicador titulo="% Negócio → ganho" valor={pct(pctDe(a.ganhos_coorte, a.negocios_coorte))}
              variacao={variacaoPp(pctDe(a.ganhos_coorte, a.negocios_coorte), b ? pctDe(b.ganhos_coorte, b.negocios_coorte) : null)}
              ajuda="Dos negócios nascidos desses leads, quantos já foram ganhos até hoje." /> },
            { chave: 'valor-ganho', node: <CartaoIndicador titulo="Valor ganho" valor={brl(a.valor_ganho)} variacao={variacao(a.valor_ganho, b?.valor_ganho)} /> },
            { chave: 'ciclo', node: <CartaoIndicador titulo="Ciclo médio (dias)" valor={dec1(a.ciclo_medio_dias)} variacao={variacao(a.ciclo_medio_dias, b?.ciclo_medio_dias)} inverterCores
              ajuda="Dias entre criar o negócio e ganhá-lo." /> },
          ]} />

          <section className="mt-6 rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-3 text-sm font-semibold">Funil do período</h2>
            <Barras itens={d.funil.map((x) => ({ rotulo: x.etapa, texto: num(x.quantidade), largura: (x.quantidade / maxFunil) * 100 }))} />
          </section>

          <section className="mt-6">
            <TabelaDados colunas={COLUNAS} linhas={etapas} nomeArquivo={`crm-etapas_${p.de}_${p.ate}`} titulo="Etapas do negócio"
              descricao="Negócios que estão em cada etapa agora. A etapa em que os negócios ficam mais tempo parados é marcada como maior gargalo." />
          </section>

          <section className="mt-6 rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-1 text-sm font-semibold">Motivos de perda</h2>
            <p className="mb-3 text-xs text-muted">Percentual dos negócios perdidos no período, por etapa em que foram perdidos.</p>
            {d.motivos.length === 0 ? <p className="text-sm text-muted">Nenhum negócio perdido no período.</p> : (
              <Barras itens={d.motivos.map((m) => ({ rotulo: m.motivo, texto: `${pct(m.pct)} (${num(m.perdidos)})`, largura: ((m.pct ?? 0) / maxPerda) * 100 }))} />
            )}
          </section>
        </>
      )}
    </div>
  );
}
