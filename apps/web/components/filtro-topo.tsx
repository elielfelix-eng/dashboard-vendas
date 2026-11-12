'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { PERIODOS, type Canal, type Periodo, type PeriodoChave } from '@/lib/periodo';

const CANAIS: { chave: Canal; rotulo: string; ativo: boolean }[] = [
  { chave: 'consolidado', rotulo: 'Consolidado', ativo: true },
  { chave: 'mercadolivre', rotulo: 'Mercado Livre', ativo: true },
  { chave: 'shopee', rotulo: 'Shopee', ativo: false },
];

interface Props {
  canal: Canal;
  chave: PeriodoChave;
  periodo: Periodo;
  atualizadoEm: string | null;
  mostrarCanal?: boolean;
}

export function FiltroTopo({ canal, chave, periodo, atualizadoEm, mostrarCanal = true }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [de, setDe] = useState(periodo.de);
  const [ate, setAte] = useState(periodo.ate);

  function ir(mudancas: Record<string, string | null>) {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(mudancas)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    router.push(`${pathname}?${p.toString()}`);
  }

  const hora = atualizadoEm
    ? new Date(atualizadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="mb-6 flex flex-col gap-3 rounded-xl border border-border bg-surface p-3 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        {mostrarCanal && (
          <div className="flex overflow-hidden rounded-lg border border-border text-sm">
            {CANAIS.map((c) => (
              <button
                key={c.chave}
                type="button"
                disabled={!c.ativo}
                title={c.ativo ? undefined : 'Em breve'}
                onClick={() => ir({ canal: c.chave })}
                className={`px-3 py-1.5 ${canal === c.chave ? 'bg-accent text-white' : 'hover:bg-accent-soft'} disabled:cursor-not-allowed disabled:text-muted disabled:hover:bg-transparent`}
              >
                {c.rotulo}{!c.ativo && <span className="ml-1 text-[10px]">em breve</span>}
              </button>
            ))}
          </div>
        )}
        <select
          aria-label="Período"
          value={chave}
          onChange={(e) => ir({ periodo: e.target.value, de: null, ate: null })}
          className="rounded-lg border border-border bg-surface px-2 py-1.5 text-sm"
        >
          {PERIODOS.map((p) => <option key={p.chave} value={p.chave}>{p.rotulo}</option>)}
        </select>
        {chave === 'personalizado' && (
          <form
            className="flex items-center gap-1 text-sm"
            onSubmit={(e) => { e.preventDefault(); ir({ periodo: 'personalizado', de, ate }); }}
          >
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className="rounded border border-border bg-surface px-1 py-1" />
            <span>a</span>
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className="rounded border border-border bg-surface px-1 py-1" />
            <button className="rounded bg-accent px-2 py-1 text-white">Aplicar</button>
          </form>
        )}
      </div>
      <div className="flex flex-col text-xs text-muted md:items-end">
        <span>{periodo.rotulo}</span>
        <span>{hora ? `● Atualizado em ${hora}` : '● Ainda sem atualização'}</span>
      </div>
    </div>
  );
}
