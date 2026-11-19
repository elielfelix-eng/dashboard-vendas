// Card com duas partes lado a lado (ex.: Product Ads e Seguidores de um mesmo investimento).
// Cada parte mostra valor, variação em relação ao período anterior e participação no total.
// Gasto subindo é ruim (vermelho), como nos cartões de custo.

export interface ParteCartao {
  titulo: string;
  valor: string;
  variacao: { valor: number | null; rotulo: string };
  participacao: string;
}

function corVariacao(v: number | null): string {
  if (v == null || v === 0) return 'text-muted';
  return v < 0 ? 'text-good' : 'text-bad';
}

function Parte({ p }: { p: ParteCartao }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-muted">{p.titulo}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{p.valor}</p>
      <p className="mt-1 flex flex-wrap gap-x-2 text-xs">
        <span className={corVariacao(p.variacao.valor)}>{p.variacao.rotulo}</span>
        <span className="text-muted">{p.participacao} do total</span>
      </p>
    </div>
  );
}

export function CartaoDuplo({ esquerda, direita, ajuda }: { esquerda: ParteCartao; direita: ParteCartao; ajuda?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4" title={ajuda}>
      <div className="grid grid-cols-2 gap-4">
        <Parte p={esquerda} />
        <div className="border-l border-border pl-4">
          <Parte p={direita} />
        </div>
      </div>
    </div>
  );
}
