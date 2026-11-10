import { createClient } from '@/lib/supabase/server';

const SOURCE_LABEL: Record<string, string> = {
  mercadolivre: 'Mercado Livre',
  shopee: 'Shopee',
  bitrix24: 'Bitrix24',
  erp: 'ERP (SQL Server)',
};

const fmt = (d: string | null) =>
  d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : '—';

export default async function HomePage() {
  const supabase = await createClient();
  const { data: runs } = await supabase
    .schema('core')
    .from('sync_runs')
    .select('source, status, started_at, finished_at, error')
    .order('started_at', { ascending: false })
    .limit(20);

  // Última execução de cada fonte
  const latest = new Map<string, NonNullable<typeof runs>[number]>();
  for (const r of runs ?? []) if (!latest.has(r.source)) latest.set(r.source, r);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold">Visão Geral</h1>
      <p className="mt-1 text-sm text-muted">
        Os indicadores de vendas, margem e Ads aparecerão aqui na Fase 4. Abaixo está o status das atualizações automáticas (08h, 13h e 17h).
      </p>

      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(SOURCE_LABEL).map(([key, label]) => {
          const r = latest.get(key);
          const color = !r ? 'text-muted' : r.status === 'success' ? 'text-good' : r.status === 'error' ? 'text-bad' : 'text-accent';
          const status = !r ? 'Ainda não sincronizado' : r.status === 'success' ? 'Atualizado' : r.status === 'error' ? 'Falhou' : 'Em andamento';
          return (
            <div key={key} className="rounded-xl border border-border bg-surface p-4">
              <p className="text-sm text-muted">{label}</p>
              <p className={`mt-1 font-semibold ${color}`}>{status}</p>
              <p className="mt-1 text-xs text-muted">{fmt(r?.finished_at ?? r?.started_at ?? null)}</p>
            </div>
          );
        })}
      </section>
    </div>
  );
}
