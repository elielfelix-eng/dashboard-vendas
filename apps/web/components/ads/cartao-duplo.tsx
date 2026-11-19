// Card com duas partes lado a lado (ex.: Product Ads e Seguidores de um mesmo investimento).
// Cada parte mostra valor, variação em relação ao período anterior e participação no total.
// Gasto subindo é ruim (vermelho), como nos cartões de custo.

export interface ParteCartao {
  titulo: string;
  valor: string;
  variacao: { valor: number | null; rotulo: string };
  participacao: string;
  /** Texto depois da participação. Padrão: "do total". */
  rotulo?: string;
}

function corVariacao(v: number | null, inverterCores: boolean): string {
  if (v == null || v === 0) return 'text-muted';
  const bom = inverterCores ? v < 0 : v > 0;
  return bom ? 'text-good' : 'text-bad';
}

function Parte({ p, inverterCores }: { p: ParteCartao; inverterCores: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-muted">{p.titulo}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{p.valor}</p>
      <p className="mt-1 flex flex-wrap gap-x-2 text-xs">
        <span className={corVariacao(p.variacao.valor, inverterCores)}>{p.variacao.rotulo}</span>
        <span className="text-muted">{p.participacao} {p.rotulo ?? 'do total'}</span>
      </p>
    </div>
  );
}

/** `inverterCores`: true para custos (subir é ruim, padrão); false para vendas (subir é bom). */
export function CartaoDuplo({ esquerda, direita, ajuda, inverterCores = true }: {
  esquerda: ParteCartao; direita: ParteCartao; ajuda?: string; inverterCores?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4" title={ajuda}>
      <div className="grid grid-cols-2 gap-4">
        <Parte p={esquerda} inverterCores={inverterCores} />
        <div className="border-l border-border pl-4">
          <Parte p={direita} inverterCores={inverterCores} />
        </div>
      </div>
    </div>
  );
}
