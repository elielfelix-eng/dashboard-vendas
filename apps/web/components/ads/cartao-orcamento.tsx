import { brl, pct } from '@/lib/formato';
import { estadoOrcamento, textoAlertaOrcamento, textoValorDiario, type LinhaOrcamento } from '@/lib/ads-regras';

const NOMES: Record<string, string> = { mercadolivre: 'Mercado Livre', shopee: 'Shopee', consolidado: 'Consolidado' };

export function CartaoOrcamento({ o }: { o: LinhaOrcamento }) {
  const estado = estadoOrcamento(o);
  const alerta = textoAlertaOrcamento(o);
  const valorDiario = textoValorDiario(o);
  const orc = o.orcamento ?? 0;
  const largura = (v: number) => (orc > 0 ? Math.min(100, (v / orc) * 100) : 0);
  const wPA = largura(o.gasto_product_ads);
  const wSeg = Math.min(largura(o.gasto_seguidores), 100 - wPA);
  const cor = o.alerta === 'estouro' ? 'bg-bad' : 'bg-accent';

  return (
    <article className="rounded-xl border border-border bg-surface p-4" aria-label={`Orçamento ${NOMES[o.canal] ?? o.canal}`}>
      <h3 className="mb-3 text-sm font-semibold">{NOMES[o.canal] ?? o.canal}</h3>

      {estado === 'sem_orcamento' ? (
        <p className="text-sm text-muted">Nenhum orçamento definido para este mês. Gasto até agora: {brl(o.gasto_mes)}.</p>
      ) : (
        <>
          <div className="flex items-baseline justify-between text-sm">
            <span><strong>{brl(o.gasto_mes)}</strong> de {brl(o.orcamento)}</span>
            <span className="text-muted">{pct(o.pct_gasto)} gasto</span>
          </div>
          <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-border" role="progressbar" aria-valuemin={0} aria-valuemax={100}
            aria-valuenow={Math.round(Math.min(100, o.pct_gasto ?? 0))}>
            <div className={cor} style={{ width: `${wPA}%` }} />
            <div className={`${cor} opacity-50`} style={{ width: `${wSeg}%` }} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm" aria-label="Composição do gasto">
            <dt className="text-muted">Product Ads</dt>
            <dd className="text-right">{brl(o.gasto_product_ads)}</dd>
            {o.canal !== 'shopee' && (
              <>
                <dt className="text-muted">Seguidores</dt>
                <dd className="text-right">{brl(o.gasto_seguidores)}</dd>
              </>
            )}
            <dt className="border-t border-border pt-1 font-medium">Total gasto no mês</dt>
            <dd className="border-t border-border pt-1 text-right font-medium">{brl(o.gasto_mes)}</dd>
            <dt className="text-muted">Orçamento do mês</dt>
            <dd className="text-right">{brl(o.orcamento)}</dd>
          </dl>
          <p className="mt-1 text-xs text-muted">{pct(o.pct_mes)} do mês já decorrido ({o.dias_completos} de {o.dias_mes} dias).</p>

          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted">Projeção do mês</dt>
              <dd className="font-medium">{estado === 'primeiro_dia' ? 'ainda sem projeção' : brl(o.projecao)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Saldo</dt>
              <dd className="font-medium">{brl(o.saldo)}</dd>
            </div>
          </dl>
          {estado === 'primeiro_dia' && <p className="mt-2 text-xs text-muted">A projeção aparece a partir do segundo dia do mês, quando já há um dia fechado.</p>}
          {valorDiario && <p className="mt-2 text-sm">{valorDiario}</p>}
          {alerta && (
            <p role="alert" className={`mt-3 rounded-lg border px-3 py-2 text-sm ${alerta.tom === 'ruim' ? 'border-bad/40 text-bad' : 'border-border text-muted'}`}>
              {alerta.texto}
            </p>
          )}
        </>
      )}
    </article>
  );
}
