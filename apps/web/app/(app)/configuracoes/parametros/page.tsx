import { requireUser } from '@/lib/auth';
import { brl, dataBr } from '@/lib/formato';
import { exigirPermissao } from '@/lib/permissoes';
import { createClient } from '@/lib/supabase/server';
import { excluirParametro, salvarParametro } from './actions';

type SP = Promise<Record<string, string | string[] | undefined>>;
const CANAL: Record<string, string> = { mercadolivre: 'Mercado Livre', shopee: 'Shopee' };

export default async function ParametrosPage({ searchParams }: { searchParams: SP }) {
  await exigirPermissao('configuracoes');
  const { profile } = await requireUser();
  const ehAdmin = profile?.role === 'admin';
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.schema('core').from('parametros_custo')
    .select('id, channel, imposto_pct, embalagem_pedido, embalagem_peca, vigente_desde')
    .order('channel').order('vigente_desde', { ascending: false });
  const linhas = data ?? [];

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="mb-1 text-2xl font-semibold">Parâmetros de custo</h1>
      <p className="mb-4 text-sm text-muted">
        Imposto (% sobre a receita) e embalagem entram na margem de contribuição dos pedidos pagos. Cada venda usa a vigência mais
        recente com data igual ou anterior à data da venda; mudar o valor a partir de uma data não altera os meses anteriores.
        {!ehAdmin && ' Só o administrador pode alterar.'}
      </p>
      {typeof sp.ok === 'string' && <p className="mb-3 text-sm text-good">{sp.ok}</p>}
      {typeof sp.erro === 'string' && <p className="mb-3 text-sm text-bad">{sp.erro}</p>}

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted">
              <th className="px-3 py-2 text-left font-medium">Canal</th>
              <th className="px-3 py-2 text-left font-medium">Vale a partir de</th>
              <th className="px-3 py-2 text-right font-medium">Imposto %</th>
              <th className="px-3 py-2 text-right font-medium">Embalagem por pedido</th>
              <th className="px-3 py-2 text-right font-medium">Embalagem por peça</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.id} className="border-b border-border last:border-0">
                <td className="px-3 py-1.5">{CANAL[l.channel] ?? l.channel}</td>
                <td className="px-3 py-1.5">{dataBr(l.vigente_desde)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{Number(l.imposto_pct).toLocaleString('pt-BR')}%</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{brl(Number(l.embalagem_pedido))}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{brl(Number(l.embalagem_peca))}</td>
                <td className="px-3 py-1.5 text-right">
                  {ehAdmin && (
                    <form action={excluirParametro}>
                      <input type="hidden" name="id" value={l.id} />
                      <button className="text-xs text-muted hover:text-bad">Excluir</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ehAdmin && (
        <form action={salvarParametro} className="mt-6 grid gap-3 rounded-xl border border-border bg-surface p-4 text-sm sm:grid-cols-3">
          <h2 className="font-semibold sm:col-span-3">+ Nova vigência</h2>
          <label className="flex flex-col gap-1">Canal
            <select name="channel" defaultValue="mercadolivre" className="rounded border border-border bg-surface px-2 py-1">
              <option value="mercadolivre">Mercado Livre</option>
              <option value="shopee">Shopee</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">Vale a partir de
            <input type="date" name="vigente_desde" required className="rounded border border-border bg-surface px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">Imposto (%)
            <input name="imposto_pct" inputMode="decimal" placeholder="0" className="rounded border border-border bg-surface px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">Embalagem por pedido (R$)
            <input name="embalagem_pedido" inputMode="decimal" placeholder="0,00" className="rounded border border-border bg-surface px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1">Embalagem por peça (R$)
            <input name="embalagem_peca" inputMode="decimal" placeholder="0,00" className="rounded border border-border bg-surface px-2 py-1" />
          </label>
          <div className="flex items-end">
            <button className="rounded-lg bg-accent px-3 py-1.5 text-white">Salvar vigência</button>
          </div>
          <p className="text-xs text-muted sm:col-span-3">Salvar uma data que já existe para o canal substitui os valores daquela vigência.</p>
        </form>
      )}
    </div>
  );
}
