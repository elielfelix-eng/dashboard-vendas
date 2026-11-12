import Link from 'next/link';

const OPCOES: { chave: 'dia' | 'semana' | 'mes'; rotulo: string }[] = [
  { chave: 'dia', rotulo: 'Dia' }, { chave: 'semana', rotulo: 'Semana' }, { chave: 'mes', rotulo: 'Mês' },
];

/** Links Dia | Semana | Mês que mantêm os demais filtros da URL. */
export function SeletorGrao({ atual, params, caminho }: { atual: string; params: Record<string, string | string[] | undefined>; caminho: string }) {
  return (
    <div className="flex overflow-hidden rounded-lg border border-border text-xs">
      {OPCOES.map((o) => {
        const p = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) if (typeof v === 'string' && k !== 'grao') p.set(k, v);
        p.set('grao', o.chave);
        return (
          <Link key={o.chave} href={`${caminho}?${p.toString()}`}
            className={`px-2 py-1 ${atual === o.chave ? 'bg-accent text-white' : 'hover:bg-accent-soft'}`}>
            {o.rotulo}
          </Link>
        );
      })}
    </div>
  );
}

export function lerGrao(v: string | string[] | undefined): 'dia' | 'semana' | 'mes' {
  return v === 'semana' || v === 'mes' ? v : 'dia';
}

/** Query string atual (só os filtros), para montar links internos. */
export function queryFiltros(params: Record<string, string | string[] | undefined>): string {
  const p = new URLSearchParams();
  for (const k of ['canal', 'periodo', 'de', 'ate']) {
    const v = params[k];
    if (typeof v === 'string') p.set(k, v);
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}
