interface Props {
  titulo: string;
  valor: string;
  variacao?: { valor: number | null; rotulo: string };
  /** Para custos: subir é ruim (vermelho). */
  inverterCores?: boolean;
  detalhe?: string;
  ajuda?: string;
}

export function CartaoIndicador({ titulo, valor, variacao, inverterCores = false, detalhe, ajuda }: Props) {
  const v = variacao?.valor;
  const bom = v == null ? null : inverterCores ? v < 0 : v > 0;
  const cor = v == null || v === 0 ? 'text-muted' : bom ? 'text-good' : 'text-bad';
  return (
    <div className="rounded-xl border border-border bg-surface p-4" title={ajuda}>
      <p className="text-sm text-muted">{titulo}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{valor}</p>
      <div className="mt-1 flex flex-wrap gap-x-2 text-xs">
        {variacao && <span className={cor}>{variacao.rotulo}</span>}
        {detalhe && <span className="text-muted">{detalhe}</span>}
      </div>
    </div>
  );
}

export function SemDados({ texto = 'Sem vendas no período.' }: { texto?: string }) {
  return <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted">{texto}</p>;
}

export function ErroDados({ mensagem }: { mensagem: string }) {
  return <p className="rounded-xl border border-bad/40 bg-surface p-4 text-sm text-bad">{mensagem}</p>;
}
