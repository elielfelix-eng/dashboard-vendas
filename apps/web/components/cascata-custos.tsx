import { brl } from '@/lib/formato';

const PCT = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * "Para onde vai o dinheiro": receita, cada custo e o que sobra (barras proporcionais à receita),
 * com quanto cada item representa a cada R$ 100 recebidos.
 */
export function CascataCustos({ itens }: { itens: { rotulo: string; valor: number; tipo: 'receita' | 'custo' | 'resultado' }[] }) {
  const base = Math.max(...itens.map((i) => Math.abs(i.valor)), 1);
  const receita = itens.find((i) => i.tipo === 'receita')?.valor ?? 0;
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[8rem_6.5rem_4.5rem_1fr] gap-2 text-xs text-muted sm:grid-cols-[11rem_8rem_5.5rem_1fr]">
        <span /><span className="text-right">R$</span><span className="text-right">a cada R$ 100</span><span />
      </div>
      {itens.map((i) => {
        const largura = Math.max((Math.abs(i.valor) / base) * 100, i.valor === 0 ? 0 : 0.5);
        const cor = i.tipo === 'receita' ? 'bg-accent' : i.tipo === 'resultado' ? (i.valor >= 0 ? 'bg-good' : 'bg-bad') : 'bg-muted';
        const sinal = i.tipo === 'custo' ? '− ' : i.tipo === 'resultado' ? '= ' : '';
        const cada100 = receita ? (i.valor / receita) * 100 : null;
        return (
          <div key={i.rotulo} className="grid grid-cols-[8rem_6.5rem_4.5rem_1fr] items-center gap-2 text-sm sm:grid-cols-[11rem_8rem_5.5rem_1fr]">
            <span className="truncate">{sinal}{i.rotulo}</span>
            <span className="text-right tabular-nums">{brl(i.valor)}</span>
            <span className="text-right tabular-nums text-muted">{cada100 == null ? '—' : `R$ ${PCT.format(cada100)}`}</span>
            <span className="h-3 rounded bg-bg"><span className={`block h-3 rounded ${cor}`} style={{ width: `${largura}%` }} /></span>
          </div>
        );
      })}
    </div>
  );
}
