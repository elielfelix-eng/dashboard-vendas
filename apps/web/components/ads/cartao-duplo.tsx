// Card com duas partes lado a lado (ex.: Product Ads e Seguidores de um mesmo investimento).
// Cada parte mostra valor, variação em relação ao período anterior e participação no total.
// Gasto subindo é ruim (vermelho), como nos cartões de custo.
import type { LucideIcon } from 'lucide-react';
import { IconeCartao } from '@/components/cartao-indicador';
import { iconeDoCartao } from '@/lib/icones';

export interface ParteCartao {
  titulo: string;
  valor: string;
  variacao: { valor: number | null; rotulo: string };
  participacao: string;
  /** Texto depois da participação. Padrão: "do total". */
  rotulo?: string;
  /** Ícone da parte. Sem ele, vem de iconeDoCartao(titulo). */
  icone?: LucideIcon;
}

function corVariacao(v: number | null, inverterCores: boolean): string {
  if (v == null || v === 0) return 'text-muted';
  const bom = inverterCores ? v < 0 : v > 0;
  return bom ? 'text-good' : 'text-bad';
}

function Parte({ p, inverterCores }: { p: ParteCartao; inverterCores: boolean }) {
  const Icone = p.icone ?? iconeDoCartao(p.titulo);
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-3">
        <IconeCartao icone={Icone} />
        <p className="min-w-0 text-sm font-semibold text-muted">{p.titulo}</p>
      </div>
      <p className="mt-3 text-2xl font-bold tabular-nums">{p.valor}</p>
      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className={`rounded-full bg-bg px-2 py-0.5 font-semibold tabular-nums ${corVariacao(p.variacao.valor, inverterCores)}`}>
          {p.variacao.rotulo}
        </span>
        <span className="text-muted">{p.rotulo === undefined ? `${p.participacao} do total` : p.participacao}</span>
      </p>
    </div>
  );
}

/** `inverterCores`: true para custos (subir é ruim, padrão); false para vendas (subir é bom). */
export function CartaoDuplo({ esquerda, direita, ajuda, inverterCores = true }: {
  esquerda: ParteCartao; direita: ParteCartao; ajuda?: string; inverterCores?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm" title={ajuda}>
      <div className="grid grid-cols-2 gap-4">
        <Parte p={esquerda} inverterCores={inverterCores} />
        <div className="border-l border-border pl-4">
          <Parte p={direita} inverterCores={inverterCores} />
        </div>
      </div>
    </div>
  );
}
