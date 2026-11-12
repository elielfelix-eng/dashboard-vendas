import Link from 'next/link';

interface Props {
  pedidosSemCusto: number | null;
  sincronizacoes: Record<string, { status: string; quando: string | null }>;
  linkSemCusto?: string;
}

const FONTES: [string, string][] = [['mercadolivre', 'Mercado Livre'], ['erp', 'ERP (custos)']];

const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'nunca';

export function PainelAtencao({ pedidosSemCusto, sincronizacoes, linkSemCusto = '/rentabilidade' }: Props) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="text-sm font-semibold">Atenção</h2>
      <ul className="mt-2 space-y-1.5 text-sm">
        {pedidosSemCusto != null && pedidosSemCusto > 0 && (
          <li className="text-bad">
            • {pedidosSemCusto} pedido(s) sem custo no período — a margem deles fica maior que a real.{' '}
            <Link href={linkSemCusto} className="underline">Ver modelos</Link>
          </li>
        )}
        {FONTES.map(([k, nome]) => {
          const s = sincronizacoes[k];
          const ok = s?.status === 'success';
          return (
            <li key={k} className={ok ? 'text-muted' : 'text-bad'}>
              • {nome}: {!s ? 'ainda não sincronizado' : ok ? `atualizado em ${hora(s.quando)} ✓` : s.status === 'error' ? `falhou em ${hora(s.quando)}` : 'atualizando…'}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
