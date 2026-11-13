'use client';

import { useMemo, useState } from 'react';
import { TabelaDados, type Coluna } from '@/components/tabela-dados';
import type { Abc } from '@/lib/dash';

const ROTULO: Record<string, string> = { A: 'A', B: 'B', C: 'C', prejuizo: 'Prejuízo' };

type Base = { abc: Abc; abc_receita: Abc; href?: string };
type ComAbc<T> = T & { posicao: number; classe_abc: string | null; ruim: boolean };

interface Props<T extends Base> {
  colunas: Coluna<T>[];
  linhas: T[];
  busca?: keyof T & string;
  nomeArquivo: string;
  /** Sem permissão de custo só existe a curva por receita. */
  temLucro: boolean;
  titulo?: string;
  descricao?: string;
}

/** Tabela com posição, curva ABC por lucro ou por receita e filtro por classe. */
export function TabelaAbc<T extends Base>({ colunas, linhas, busca, nomeArquivo, temLucro, titulo, descricao }: Props<T>) {
  const [modo, setModo] = useState<'lucro' | 'receita'>(temLucro ? 'lucro' : 'receita');
  const [classe, setClasse] = useState('');

  const visiveis = useMemo(() => {
    const comAbc = linhas.map((l, i) => {
      const c = modo === 'lucro' ? l.abc : l.abc_receita;
      return { ...l, posicao: i + 1, classe_abc: c ? ROTULO[c] : null, ruim: c === 'prejuizo' } as ComAbc<T>;
    });
    return classe ? comAbc.filter((l) => (modo === 'lucro' ? l.abc : l.abc_receita) === classe) : comAbc;
  }, [linhas, modo, classe]);

  const cols = [
    { chave: 'posicao', titulo: '#', tipo: 'num' },
    { chave: 'classe_abc', titulo: modo === 'lucro' ? 'ABC (lucro)' : 'ABC (receita)', tipo: 'texto' },
    ...colunas,
  ] as unknown as Coluna<ComAbc<T>>[];

  const controles = (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {temLucro && (
          <div className="flex overflow-hidden rounded-lg border border-border">
            {(['lucro', 'receita'] as const).map((m) => (
              <button key={m} type="button" onClick={() => { setModo(m); setClasse(''); }}
                className={`px-2 py-1 ${modo === m ? 'bg-accent text-white' : 'hover:bg-accent-soft'}`}>
                ABC por {m}
              </button>
            ))}
          </div>
        )}
        <select aria-label="Classe da curva ABC" value={classe} onChange={(e) => setClasse(e.target.value)}
          className="rounded-lg border border-border bg-surface px-2 py-1">
          <option value="">Todas as classes</option>
          <option value="A">Classe A</option>
          <option value="B">Classe B</option>
          <option value="C">Classe C</option>
          {modo === 'lucro' && <option value="prejuizo">Prejuízo</option>}
        </select>
      </div>
  );
  return (
    <TabelaDados colunas={cols} linhas={visiveis} busca={busca as keyof ComAbc<T> & string} nomeArquivo={nomeArquivo}
      titulo={titulo} descricao={descricao} extra={controles} />
  );
}
