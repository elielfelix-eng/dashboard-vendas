import Link from 'next/link';
import { ErroDados, SemDados } from '@/components/cartao-indicador';
import { Etiqueta } from '@/components/etiqueta';
import * as alertas from '@/lib/alertas';
import { corDoNivel, rotuloOrigem, rotuloStatusEnvio, separarProducao, textoFaltam } from '@/lib/alertas-formato';
import { exigirPermissao } from '@/lib/permissoes';

type SP = Promise<Record<string, string | string[] | undefined>>;

const ROTULO_INDICADOR: Record<string, string> = { reclamacoes: 'Reclamações', cancelamentos: 'Cancelamentos', atrasos: 'Atrasos' };
const LINHAS = [
  { chave: 'reclamacoes', rotulo: 'Reclamações', cor: 'var(--bad)' },
  { chave: 'cancelamentos', rotulo: 'Cancelamentos', cor: 'var(--chart-3)' },
  { chave: 'atrasos', rotulo: 'Atrasos', cor: 'var(--warn)' },
] as const;

const hhmm = (iso: string | null) => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : null;
};
const ddmm = (iso: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '—');
const pct1 = (v: number) => `${v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const urlVenda = (orderId: string) => `https://www.mercadolivre.com.br/vendas/${encodeURIComponent(orderId)}/detalhe`;

// grafico-serie.tsx é de barras em R$ (vendas); aqui são três linhas em %, então o gráfico é um SVG simples.
function GraficoReputacao({ serie }: { serie: alertas.PontoReputacao[] }) {
  // A série (reputacao_serie) já vem em percentual (0 a 100); não multiplicar.
  const L = 720, A = 220, ml = 48, mb = 22, mt = 8, mr = 8;
  const valores = serie.flatMap((p) => LINHAS.map((l) => p[l.chave])).filter((v): v is number => v != null);
  const max = Math.max(1, ...valores);
  const x = (i: number) => ml + (serie.length < 2 ? (L - ml - mr) / 2 : (i * (L - ml - mr)) / (serie.length - 1));
  const y = (v: number) => mt + (A - mt - mb) * (1 - v / max);
  return (
    <div>
      <svg viewBox={`0 0 ${L} ${A}`} className="h-56 w-full" role="img" aria-label="Evolução dos três indicadores de reputação">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={ml} x2={L - mr} y1={mt + (A - mt - mb) * f} y2={mt + (A - mt - mb) * f} stroke="var(--border)" strokeDasharray="3 3" />
            <text x={ml - 4} y={mt + (A - mt - mb) * f + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{pct1(max * (1 - f))}</text>
          </g>
        ))}
        <text x={ml} y={A - 6} fontSize="11" fill="var(--muted)">{ddmm(serie[0].dia)}</text>
        <text x={L - mr} y={A - 6} textAnchor="end" fontSize="11" fill="var(--muted)">{ddmm(serie[serie.length - 1].dia)}</text>
        {LINHAS.map((l) => {
          const pts = serie.map((p, i) => (p[l.chave] == null ? null : `${x(i)},${y(p[l.chave] as number)}`)).filter(Boolean);
          return pts.length ? <polyline key={l.chave} points={pts.join(' ')} fill="none" stroke={l.cor} strokeWidth="2" /> : null;
        })}
      </svg>
      <ul className="mt-1 flex flex-wrap gap-4 text-xs text-muted">
        {LINHAS.map((l) => <li key={l.chave}><span className="mr-1 inline-block h-2 w-3 rounded-sm align-middle" style={{ background: l.cor }} />{l.rotulo}</li>)}
      </ul>
    </div>
  );
}

function Tabela({ linhas, aba }: { linhas: alertas.AlertaEnvio[]; aba: 'despacho' | 'entrega' }) {
  const normais = linhas.filter((a) => a.situacao !== 'prazo_desconhecido');
  const desconhecidas = linhas.filter((a) => a.situacao === 'prazo_desconhecido');
  const celulas = (a: alertas.AlertaEnvio) => (
    <>
      <td className="px-3 py-2">
        {a.order_id ? <a href={urlVenda(a.order_id)} target="_blank" rel="noopener noreferrer" className="text-link underline">{a.order_id}</a> : '—'}
      </td>
      <td className="px-3 py-2">{a.titulo ?? a.item_id ?? '—'}</td>
      <td className="px-3 py-2">{a.grupo ?? '—'}</td>
      <td className="px-3 py-2">{ddmm(a.prazo)}</td>
      {aba === 'despacho' && <td className="px-3 py-2">{rotuloOrigem(a.origem_prazo)}</td>}
      <td className="px-3 py-2">{textoFaltam(a.faltam, a.situacao)}</td>
      <td className="px-3 py-2">{rotuloStatusEnvio(a.status_envio, a.substatus)}</td>
    </>
  );
  const colunas = ['Venda', 'Anúncio', 'Grupo', 'Prazo', ...(aba === 'despacho' ? ['Origem'] : []), 'Faltam', 'Status do envio'];
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border text-xs text-muted">
          <tr>{colunas.map((t) => <th key={t} className="px-3 py-2 font-medium">{t}</th>)}</tr>
        </thead>
        <tbody>
          {normais.map((a) => (
            <tr key={a.shipment_id} className={`border-b border-border last:border-0 ${a.situacao === 'atrasada' ? 'bg-bad/10 text-bad' : ''}`}>{celulas(a)}</tr>
          ))}
          {desconhecidas.length > 0 && (
            <>
              <tr className="bg-bg">
                <td colSpan={colunas.length} className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">
                  {`Prazo desconhecido (${desconhecidas.length}): o Mercado Livre não informou prazo de ${aba === 'despacho' ? 'despacho' : 'entrega'} para estas vendas`}
                </td>
              </tr>
              {desconhecidas.map((a) => <tr key={a.shipment_id} className="border-b border-border text-muted last:border-0">{celulas(a)}</tr>)}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}

// Pedidos em produção ainda fora da antecedência (situacao 'em_producao'): só informativos, abaixo dos riscos.
function TabelaProducao({ linhas }: { linhas: alertas.AlertaEnvio[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border text-xs text-muted">
          <tr>{['Venda', 'Anúncio', 'Grupo', 'Terminar produto', 'Faltam', 'Status do envio'].map((t) => <th key={t} className="px-3 py-2 font-medium">{t}</th>)}</tr>
        </thead>
        <tbody>
          {linhas.map((a) => (
            <tr key={a.shipment_id} className="border-b border-border last:border-0">
              <td className="px-3 py-2">
                {a.order_id ? <a href={urlVenda(a.order_id)} target="_blank" rel="noopener noreferrer" className="text-link underline">{a.order_id}</a> : '—'}
              </td>
              <td className="px-3 py-2">{a.titulo ?? a.item_id ?? '—'}</td>
              <td className="px-3 py-2">{a.grupo ?? '—'}</td>
              <td className="px-3 py-2">
                {ddmm(a.prazo)}
                {a.origem_prazo === 'estimado' && <span className="ml-1 text-xs text-muted">(estimado)</span>}
              </td>
              <td className="px-3 py-2">{textoFaltam(a.faltam, a.situacao)}</td>
              <td className="px-3 py-2">{rotuloStatusEnvio(a.status_envio, a.substatus)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function AlertasPage({ searchParams }: { searchParams: SP }) {
  await exigirPermissao('operacao');
  const params = await searchParams;
  const abaParam = Array.isArray(params.aba) ? params.aba[0] : params.aba;
  const aba: 'despacho' | 'entrega' = abaParam === 'entrega' ? 'entrega' : 'despacho';

  let d;
  try {
    const [despacho, entrega, reputacao, serie] = await Promise.all([
      alertas.listarAlertas('despacho'), alertas.listarAlertas('entrega'), alertas.reputacaoAtual(), alertas.reputacaoSerie(180),
    ]);
    d = { despacho, entrega, reputacao, serie };
  } catch (e) {
    return <div className="mx-auto max-w-6xl"><h1 className="mb-4 text-2xl font-bold tracking-tight">Alertas e Reputação</h1><ErroDados mensagem={(e as Error).message} /></div>;
  }

  const { riscos: despachoRiscos, emProducao } = separarProducao(d.despacho);
  const linhas = aba === 'despacho' ? despachoRiscos : d.entrega;
  const ultima = d.reputacao.map((r) => r.capturado_em).sort().at(-1) ?? null;
  const atualizado = hhmm(ultima);
  const nivel = corDoNivel(d.reputacao[0]?.level_id ?? null);
  const abas = [
    { chave: 'despacho', rotulo: `Despacho em risco (${despachoRiscos.length})` },
    { chave: 'entrega', rotulo: `Entrega em risco (${d.entrega.length})` },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-baseline gap-3">
        <h1 className="text-2xl font-bold tracking-tight">Alertas e Reputação</h1>
        {atualizado && <span className="text-xs text-muted">Atualizado às {atualizado}</span>}
      </div>

      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center gap-3">
          <h2 className="text-sm font-semibold">Reputação no Mercado Livre</h2>
          <Etiqueta tom={nivel.tom}>{nivel.nome}</Etiqueta>
        </div>
        {d.reputacao.length === 0 ? (
          <SemDados texto="Ainda não há leitura da reputação." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {d.reputacao.map((r) => {
              const alvo = r.acima ? 'border-bad bg-bad/10' : r.perto ? 'border-warn bg-warn/10' : 'border-border';
              return (
                <div key={r.indicador} className={`rounded-lg border p-3 ${alvo}`}>
                  <p className="text-xs text-muted">{ROTULO_INDICADOR[r.indicador] ?? r.indicador}</p>
                  <p className="text-xl font-semibold">
                    {r.valor_pct == null ? '—' : pct1(r.valor_pct)}
                    {r.limite_pct != null && <span className="text-sm font-normal text-muted"> / {pct1(r.limite_pct)}</span>}
                  </p>
                  {r.limite_pct == null && <p className="text-xs text-muted">limite não cadastrado</p>}
                  {r.acima && <p className="text-xs font-medium text-bad">acima do limite</p>}
                  {!r.acima && r.perto && <p className="text-xs font-medium text-warn">perto do limite</p>}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <nav className="mt-6 flex gap-1 border-b border-border text-sm" aria-label="Abas">
        {abas.map((x) => (
          <Link key={x.chave} href={`/alertas?aba=${x.chave}`}
            className={`-mb-px border-b-2 px-3 py-2 ${aba === x.chave ? 'border-accent font-medium' : 'border-transparent text-muted'}`}>
            {x.rotulo}
          </Link>
        ))}
      </nav>

      <section className="mt-4">
        {linhas.length === 0 ? <SemDados texto="Nenhuma venda em risco agora." /> : <Tabela linhas={linhas} aba={aba} />}
      </section>

      {aba === 'despacho' && emProducao.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">{`Em produção (fora da antecedência) (${emProducao.length})`}</h2>
          <TabelaProducao linhas={emProducao} />
        </section>
      )}

      <section className="mt-6 rounded-xl border border-border bg-surface p-4">
        <h2 className="mb-1 text-sm font-semibold">Evolução da reputação (180 dias)</h2>
        {d.serie.length === 0 ? <SemDados texto="Ainda não há histórico de reputação." /> : <GraficoReputacao serie={d.serie} />}
      </section>
    </div>
  );
}
