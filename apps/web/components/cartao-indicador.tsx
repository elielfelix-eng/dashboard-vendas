import type { LucideIcon } from 'lucide-react';
import { iconeDoCartao } from '@/lib/icones';

interface Props {
  titulo: string;
  valor: string;
  variacao?: { valor: number | null; rotulo: string };
  /** Para custos: subir é ruim (vermelho). */
  inverterCores?: boolean;
  detalhe?: string;
  ajuda?: string;
  /** Ícone do cartão. Sem ele, vem de iconeDoCartao(titulo). */
  icone?: LucideIcon;
}

// Ícone num quadrado suave da cor do papel (Manual de Marca p. 36: traço arredondado).
export function IconeCartao({ icone: Icone }: { icone: LucideIcon }) {
  return (
    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-brand-2" aria-hidden="true">
      <Icone className="size-5" strokeWidth={2} />
    </span>
  );
}

export function CartaoIndicador({ titulo, valor, variacao, inverterCores = false, detalhe, ajuda, icone }: Props) {
  const v = variacao?.valor;
  const bom = v == null ? null : inverterCores ? v < 0 : v > 0;
  const cor = v == null || v === 0 ? 'text-muted' : bom ? 'text-good' : 'text-bad';
  const Icone = icone ?? iconeDoCartao(titulo);
  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-surface p-4 shadow-sm" title={ajuda}>
      <div className="flex items-center gap-3">
        <IconeCartao icone={Icone} />
        <p className="min-w-0 text-sm font-semibold text-muted">{titulo}</p>
      </div>
      <p className="mt-3 text-2xl font-bold tabular-nums">{valor}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {variacao && (
          <span className={`rounded-full bg-bg px-2 py-0.5 font-semibold tabular-nums ${cor}`}>{variacao.rotulo}</span>
        )}
        {detalhe && <span className="text-muted">{detalhe}</span>}
      </div>
    </div>
  );
}

export function SemDados({ texto = 'Sem vendas no período.' }: { texto?: string }) {
  return <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">{texto}</p>;
}

/** Aviso discreto acima dos números (ex.: período em parte sem dados da Shopee). */
export function AvisoDados({ texto }: { texto: string }) {
  return <p className="mb-4 rounded-lg border border-border bg-surface px-4 py-2 text-sm text-muted">{texto}</p>;
}

export function ErroDados({ mensagem }: { mensagem: string }) {
  return <p className="rounded-xl border border-bad/40 bg-surface p-4 text-sm text-bad">{mensagem}</p>;
}
