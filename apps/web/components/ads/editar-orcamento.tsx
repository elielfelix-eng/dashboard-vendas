import { dataBr, brl } from '@/lib/formato';
import { situacaoVigencias } from '@/lib/ads-limites';
import type { VigenciaOrcamento } from '@/lib/ads';
import { salvarOrcamento } from '@/app/(app)/ads/actions';

const NOMES: Record<string, string> = { mercadolivre: 'Mercado Livre', shopee: 'Shopee' };

export function EditarOrcamento({ canais, vigencias, hoje, sugestaoData, filtros }: {
  canais: string[]; vigencias: VigenciaOrcamento[]; hoje: string; sugestaoData: string;
  /** canal/período da tela, devolvidos no redirect depois de salvar */
  filtros: Record<string, string>;
}) {
  return (
    <details className="mb-4 rounded-xl border border-border bg-surface p-4 text-sm">
      <summary className="cursor-pointer font-medium">Editar orçamento</summary>
      <form action={salvarOrcamento} className="mt-3 flex flex-wrap items-end gap-3">
        {Object.entries(filtros).map(([k, v]) => <input key={k} type="hidden" name={`f_${k}`} value={v} />)}
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Canal</span>
          <select name="channel" className="rounded-md border border-border bg-bg px-2 py-1.5">
            {canais.map((c) => <option key={c} value={c}>{NOMES[c] ?? c}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Valor mensal (R$) — Product Ads + Seguidores</span>
          <input name="valor_mensal" inputMode="decimal" required placeholder="5000" className="rounded-md border border-border bg-bg px-2 py-1.5" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Vale a partir de</span>
          <input name="vigente_desde" type="date" required defaultValue={sugestaoData} className="rounded-md border border-border bg-bg px-2 py-1.5" />
        </label>
        <button type="submit" className="rounded-md bg-accent px-3 py-1.5 text-white">Salvar</button>
      </form>
      <p className="mt-2 text-xs text-muted">Se já existe uma vigência com a mesma data no canal, o valor dela é substituído.</p>

      <h4 className="mt-4 font-medium">Histórico</h4>
      <ul className="mt-1 space-y-2">
        {canais.map((c) => {
          const lista = vigencias.filter((v) => v.channel === c);
          const sit = situacaoVigencias(lista.map((v) => v.vigente_desde), hoje);
          return (
            <li key={c}>
              <span className="text-xs text-muted">{NOMES[c] ?? c}</span>
              {lista.length === 0 ? <p className="text-muted">Sem vigências.</p> : (
                <ul>
                  {lista.map((v, i) => (
                    <li key={v.vigente_desde}>
                      desde {dataBr(v.vigente_desde)}: {brl(v.valor_mensal)}
                      {sit[i] !== 'anterior' && <span className="ml-2 rounded-full border border-border px-2 text-xs">{sit[i]}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}
