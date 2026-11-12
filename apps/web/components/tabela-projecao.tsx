'use client';

import { useState, useTransition } from 'react';
import { salvarPremissa } from '@/app/(app)/metas/actions';
import type { LinhaMeta } from '@/lib/dash';
import { brl, pct } from '@/lib/formato';
import type { CanalMeta } from '@/lib/metas-planilha';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const rotuloMes = (iso: string) => `${MESES[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}`;
const lerPct = (s: string) => {
  const t = s.trim().replace('%', '').replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
};

interface Props {
  linhas: LinhaMeta[];
  ano: number;
  canal: CanalMeta | 'consolidado';
  podeEditar: boolean;
  padroes: Record<number, number | null>;
}

export function TabelaProjecao({ linhas, ano, canal, podeEditar, padroes }: Props) {
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const editavel = podeEditar && canal !== 'consolidado';
  const anos = [...new Set(linhas.filter((l) => l.situacao !== 'realizado').map((l) => Number(l.mes.slice(0, 4))))];

  function salvar(mes: number | null, anoPremissa: number, texto: string) {
    const v = lerPct(texto);
    if (Number.isNaN(v)) { setErro('Use um número, por exemplo 3 ou 2,5.'); return; }
    setErro(null);
    iniciar(async () => {
      const r = await salvarPremissa(canal as CanalMeta, anoPremissa, mes, v);
      if (r.erro) setErro(r.erro);
    });
  }

  const doAno = linhas.filter((l) => l.mes.startsWith(String(ano)));
  const totalProj = doAno.reduce((s, l) => s + (l.situacao === 'realizado' ? (l.realizado ?? 0) : (l.projecao ?? 0)), 0);
  const totalMeta = doAno.reduce((s, l) => s + (l.meta ?? 0), 0);

  return (
    <div>
      {editavel && (
        <div className="mb-3 flex flex-wrap items-center gap-4 text-sm">
          <span className="font-medium">Crescimento padrão ao mês:</span>
          {anos.map((a) => (
            <label key={a} className="flex items-center gap-1">
              {a}
              <input
                defaultValue={padroes[a] == null ? '' : String(padroes[a]).replace('.', ',')}
                placeholder="0"
                onBlur={(e) => salvar(null, a, e.target.value)}
                className="w-16 rounded border border-border bg-surface px-1 py-0.5 text-right"
              />%
            </label>
          ))}
          {pendente && <span className="text-muted">Salvando…</span>}
        </div>
      )}
      {erro && <p className="mb-2 text-sm text-bad">{erro}</p>}
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted">
              <th className="px-3 py-2 text-left font-medium">Mês</th>
              <th className="px-3 py-2 text-right font-medium">Realizado</th>
              <th className="px-3 py-2 text-right font-medium">Cresc.</th>
              <th className="px-3 py-2 text-right font-medium">Projeção</th>
              <th className="px-3 py-2 text-right font-medium">Meta</th>
              <th className="px-3 py-2 text-right font-medium">Projeção − meta</th>
              <th className="px-3 py-2 text-right font-medium">% da meta</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              const valor = l.situacao === 'realizado' ? l.realizado : l.projecao;
              const dif = l.meta != null && valor != null ? valor - l.meta : null;
              const mes = Number(l.mes.slice(5, 7));
              const anoL = Number(l.mes.slice(0, 4));
              return (
                <tr key={l.mes} className="border-b border-border last:border-0">
                  <td className="px-3 py-1.5">
                    {rotuloMes(l.mes)}
                    {l.situacao === 'em_andamento' && <span className="ml-1 text-xs text-muted">(parcial)</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{brl(l.realizado)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {l.situacao === 'realizado' ? '' : editavel ? (
                      <span className="inline-flex items-center gap-1">
                        <input
                          key={`${l.mes}-${l.crescimento_pct}`}
                          defaultValue={l.crescimento_editado ? String(l.crescimento_pct).replace('.', ',') : ''}
                          placeholder={pct(l.crescimento_pct)}
                          onBlur={(e) => {
                            const atual = l.crescimento_editado ? String(l.crescimento_pct).replace('.', ',') : '';
                            if (e.target.value !== atual) salvar(mes, anoL, e.target.value);
                          }}
                          className={`w-16 rounded border px-1 py-0.5 text-right ${l.crescimento_editado ? 'border-accent' : 'border-border'} bg-surface`}
                        />
                        {l.crescimento_editado && (
                          <button type="button" title="Voltar ao padrão" onClick={() => salvar(mes, anoL, '')} className="text-muted hover:text-text">↺</button>
                        )}
                      </span>
                    ) : pct(l.crescimento_pct)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{brl(l.projecao)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{brl(l.meta)}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums ${dif == null ? '' : dif >= 0 ? 'text-good' : 'text-bad'}`}>{brl(dif)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{l.meta && valor != null ? pct((valor / l.meta) * 100) : '—'}</td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-border font-semibold">
              <td className="px-3 py-2">Total {ano}</td>
              <td />
              <td />
              <td className="px-3 py-2 text-right tabular-nums">{brl(totalProj)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{brl(totalMeta || null)}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${totalProj - totalMeta >= 0 ? 'text-good' : 'text-bad'}`}>{totalMeta ? brl(totalProj - totalMeta) : '—'}</td>
              <td className="px-3 py-2 text-right tabular-nums">{totalMeta ? pct((totalProj / totalMeta) * 100) : '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">
        Cada mês projetado = mês anterior × (1 + crescimento). A projeção parte do último mês fechado; o mês em andamento é só referência.
        No total do ano, meses já fechados entram pelo realizado.
      </p>
    </div>
  );
}
