import { brl } from '@/lib/formato';

/** "Para onde vai o dinheiro": receita, cada custo e o que sobra (barras proporcionais à receita). */
export function CascataCustos({ itens }: { itens: { rotulo: string; valor: number; tipo: 'receita' | 'custo' | 'resultado' }[] }) {
  const base = Math.max(...itens.map((i) => Math.abs(i.valor)), 1);
  return (
    <div className="space-y-1.5">
      {itens.map((i) => {
        const largura = Math.max((Math.abs(i.valor) / base) * 100, i.valor === 0 ? 0 : 0.5);
        const cor = i.tipo === 'receita' ? 'bg-accent' : i.tipo === 'resultado' ? (i.valor >= 0 ? 'bg-good' : 'bg-bad') : 'bg-muted';
        const sinal = i.tipo === 'custo' ? '− ' : i.tipo === 'resultado' ? '= ' : '';
        return (
          <div key={i.rotulo} className="grid grid-cols-[9rem_7.5rem_1fr] items-center gap-2 text-sm sm:grid-cols-[11rem_8rem_1fr]">
            <span className="truncate">{sinal}{i.rotulo}</span>
            <span className="text-right tabular-nums">{brl(i.valor)}</span>
            <span className="h-3 rounded bg-bg"><span className={`block h-3 rounded ${cor}`} style={{ width: `${largura}%` }} /></span>
          </div>
        );
      })}
    </div>
  );
}
