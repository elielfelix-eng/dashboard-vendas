import { brl, pct } from '@/lib/formato';
import {
  rotuloSugestaoCanal, textoCrescimento, textoMargem, tomSugestaoCanal, type Sugestao, type TomSugestaoCanal,
} from '@/lib/crescimento';

// Card de um canal na aba Canais do Comparativo: vendas, crescimento (período anterior e ano passado),
// margem depois do Ads (só com custos), Ads (só com a permissão de Ads) e a sugestão com o motivo (só com custos).

export const CLASSE_TOM: Record<TomSugestaoCanal, string> = {
  bom: 'bg-good/15 text-good',
  ruim: 'bg-bad/15 text-bad',
  neutro: 'bg-border text-text',
  cinza: 'border border-dashed border-border text-muted',
};

export interface DadosCartaoCanal {
  nome: string;
  vendasAtual: number;
  /** Nulo quando o período de comparação começa antes dos dados do canal (aparece "sem dado"). */
  vendasAnterior: number | null;
  vendasAnoPassado: number | null;
  /** Margem depois do Ads (% da receita); nula sem a permissão de custos ou sem receita. */
  margemAtual: number | null;
  margemAnterior: number | null;
  /** Investimento e TACOS do Ads; nulo sem a permissão de Ads. */
  ads: { investimento: number; tacos: number | null } | null;
  /** Sugestão e motivo; nulo sem a permissão de custos (decisão do dono) ou sem percentuais vigentes. */
  sugestao: { sugestao: Sugestao; motivo: string } | null;
  /** Período inteiro sem dados do canal: o texto entra no lugar dos números. */
  semDados: string | null;
  /** Aviso discreto abaixo dos números (ex.: comparação sem base). */
  aviso: string | null;
  verCustos: boolean;
}

function Crescimento({ rotulo, atual, referencia }: { rotulo: string; atual: number; referencia: number | null }) {
  const v = textoCrescimento(atual, referencia);
  const cor = v.valor == null || v.valor === 0 ? 'text-muted' : v.valor > 0 ? 'text-good' : 'text-bad';
  return (
    <div>
      <dt className="text-xs text-muted">{rotulo}</dt>
      <dd className={`font-medium tabular-nums ${cor}`}>
        {v.rotulo}
        {v.valor != null && <span className="ml-1 text-xs font-normal text-muted">({brl(referencia)})</span>}
      </dd>
    </div>
  );
}

export function CartaoCanal({ d }: { d: DadosCartaoCanal }) {
  return (
    <article className="h-full rounded-xl border border-border bg-surface p-4" aria-label={`Canal ${d.nome}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{d.nome}</h3>
        {d.sugestao && (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${CLASSE_TOM[tomSugestaoCanal(d.sugestao.sugestao)]}`}>
            {rotuloSugestaoCanal(d.sugestao.sugestao)}
          </span>
        )}
      </div>

      {d.semDados ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted">{d.semDados}</p>
      ) : (
        <>
          <p className="text-sm text-muted">Vendas brutas</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{brl(d.vendasAtual)}</p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <Crescimento rotulo="Sobre o período anterior" atual={d.vendasAtual} referencia={d.vendasAnterior} />
            <Crescimento rotulo="Sobre o mesmo período do ano passado" atual={d.vendasAtual} referencia={d.vendasAnoPassado} />
            {d.verCustos && (
              <div>
                <dt className="text-xs text-muted">Margem depois do Ads</dt>
                <dd className="font-medium tabular-nums">
                  {textoMargem(d.margemAtual)}
                  {d.margemAnterior != null && <span className="ml-1 text-xs font-normal text-muted">(antes {textoMargem(d.margemAnterior)})</span>}
                </dd>
              </div>
            )}
            {d.ads && (
              <div>
                <dt className="text-xs text-muted">Investimento em Ads</dt>
                <dd className="font-medium tabular-nums">
                  {brl(d.ads.investimento)}
                  <span className="ml-1 text-xs font-normal text-muted">TACOS {pct(d.ads.tacos)}</span>
                </dd>
              </div>
            )}
          </dl>
          {d.sugestao && <p className="mt-3 text-xs text-muted">{d.sugestao.motivo}.</p>}
          {d.aviso && <p className="mt-2 text-xs text-muted">{d.aviso}</p>}
        </>
      )}
    </article>
  );
}
