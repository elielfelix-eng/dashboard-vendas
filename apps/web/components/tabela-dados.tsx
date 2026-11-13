'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { FotoProduto } from '@/components/foto-produto';
import { exportarXlsx, type Coluna } from '@/lib/exportar';
import { brl, num, pct } from '@/lib/formato';

export type { Coluna } from '@/lib/exportar';

interface Props<T extends object> {
  colunas: Coluna<T>[];
  linhas: T[];
  /** Coluna usada na busca por texto. */
  busca?: keyof T & string;
  nomeArquivo: string;
  vazio?: string;
  /** Título na mesma linha da busca e do Excel, colado à tabela. */
  titulo?: string;
  /** Texto curto abaixo do título. */
  descricao?: string;
  /** Controles extras ao lado da busca (ex.: seletor da curva ABC). */
  extra?: React.ReactNode;
}
// Convenções das linhas: `href` vira link na primeira coluna; `ruim: true` pinta a linha de vermelho.

function valorOrdenacao(v: unknown): number | string {
  if (v == null) return Number.NEGATIVE_INFINITY;
  if (typeof v === 'object' && 'valor' in (v as object)) {
    const x = (v as { valor: number | null; rotulo: string });
    return x.valor ?? (x.rotulo === 'novo' ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
  }
  return typeof v === 'number' ? v : String(v).toLowerCase();
}

function formatar(tipo: Coluna<object>['tipo'], v: unknown): string {
  if (v == null) return '—';
  switch (tipo) {
    case 'brl': return brl(Number(v));
    case 'num': return num(Number(v));
    case 'pct': return pct(Number(v));
    case 'variacao': return (v as { rotulo: string }).rotulo;
    default: return String(v);
  }
}

export function TabelaDados<T extends object>({ colunas, linhas, busca, nomeArquivo, vazio = 'Nada para mostrar.', titulo, descricao, extra }: Props<T>) {
  const [ordem, setOrdem] = useState<{ chave: string; desc: boolean } | null>(null);
  const [texto, setTexto] = useState('');
  const [baixando, setBaixando] = useState(false);

  const visiveis = useMemo(() => {
    const t = texto.trim().toLowerCase();
    let r = busca && t ? linhas.filter((l) => String((l as Record<string, unknown>)[busca] ?? '').toLowerCase().includes(t)) : linhas;
    if (ordem) {
      r = [...r].sort((a, b) => {
        const va = valorOrdenacao((a as Record<string, unknown>)[ordem.chave]);
        const vb = valorOrdenacao((b as Record<string, unknown>)[ordem.chave]);
        const c = va < vb ? -1 : va > vb ? 1 : 0;
        return ordem.desc ? -c : c;
      });
    }
    return r;
  }, [linhas, texto, busca, ordem]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          {titulo && <h2 className="text-sm font-semibold">{titulo}</h2>}
          {descricao && <p className="mt-0.5 max-w-3xl text-xs text-muted">{descricao}</p>}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
        {extra}
        {busca && (
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar…"
            className="rounded-lg border border-border bg-surface px-2 py-1 text-sm"
          />
        )}
        <button
          type="button"
          disabled={baixando || !visiveis.length}
          onClick={async () => { setBaixando(true); try { await exportarXlsx(nomeArquivo, colunas, visiveis); } finally { setBaixando(false); } }}
          className="rounded-lg border border-border px-2 py-1 text-sm hover:bg-accent-soft disabled:opacity-50"
        >
          {baixando ? 'Gerando…' : '⬇ Excel'}
        </button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              {colunas.map((c) => (
                <th key={c.chave} className={`cursor-pointer select-none px-3 py-2 font-medium ${c.tipo === 'texto' ? '' : 'text-right'}`}
                  onClick={() => setOrdem((o) => ({ chave: c.chave, desc: o?.chave === c.chave ? !o.desc : c.tipo !== 'texto' }))}>
                  {c.titulo}{ordem?.chave === c.chave ? (ordem.desc ? ' ▼' : ' ▲') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visiveis.length === 0 && (
              <tr><td colSpan={colunas.length} className="px-3 py-6 text-center text-muted">{vazio}</td></tr>
            )}
            {visiveis.map((l, i) => {
              const href = (l as { href?: string }).href;
              const ruim = (l as { ruim?: boolean }).ruim === true;
              return (
                <tr key={i} className={`border-b border-border last:border-0 ${ruim ? 'text-bad' : ''}`}>
                  {colunas.map((c, j) => {
                    const v = (l as Record<string, unknown>)[c.chave];
                    const txt = formatar(c.tipo, v);
                    const varCor = c.tipo === 'variacao' && v ? ((v as { valor: number | null }).valor ?? 0) : 0;
                    return (
                      <td key={c.chave} className={`px-3 py-1.5 ${c.tipo === 'texto' ? '' : 'text-right tabular-nums'} ${varCor > 0 ? 'text-good' : varCor < 0 ? 'text-bad' : ''}`}>
                        {j === 0 && 'foto' in l ? (
                          <span className="flex items-center gap-2">
                            <FotoProduto src={(l as { foto?: string | null }).foto} alt={txt} />
                            {href ? <Link href={href} className="font-medium hover:underline">{txt}</Link> : txt}
                          </span>
                        ) : j === 0 && href ? <Link href={href} className="font-medium hover:underline">{txt}</Link> : txt}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
