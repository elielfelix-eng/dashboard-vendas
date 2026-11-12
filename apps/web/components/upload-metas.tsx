'use client';

import { useState, useTransition } from 'react';
import { readSheet } from 'read-excel-file/browser';
import { gravarMetas } from '@/app/(app)/configuracoes/metas/actions';
import { brl } from '@/lib/formato';
import { validarLinhasMetas, type ErroLinha, type LinhaMetaValida } from '@/lib/metas-planilha';

const NOMES: Record<string, string> = { mercadolivre: 'Mercado Livre', shopee: 'Shopee', brindedobem: 'Brinde do Bem' };

export function UploadMetas() {
  const [arquivo, setArquivo] = useState<string | null>(null);
  const [validas, setValidas] = useState<LinhaMetaValida[]>([]);
  const [erros, setErros] = useState<ErroLinha[]>([]);
  const [totais, setTotais] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [pendente, iniciar] = useTransition();

  async function ler(f: File) {
    setMsg(null);
    setArquivo(f.name);
    try {
      const linhas = await readSheet(f);
      const r = validarLinhasMetas(linhas as unknown[][]);
      setValidas(r.validas); setErros(r.erros); setTotais(r.totais);
    } catch {
      setValidas([]); setTotais({});
      setErros([{ linha: 0, motivo: 'não foi possível ler o arquivo. Use um .xlsx do Excel.' }]);
    }
  }

  const anos = [...new Set(validas.map((v) => v.ano))].sort();

  return (
    <div className="space-y-4">
      <label className="block rounded-xl border border-dashed border-border bg-surface p-6 text-center text-sm hover:bg-accent-soft">
        <input type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && ler(e.target.files[0])} />
        {arquivo ? <>Arquivo: <strong>{arquivo}</strong> (clique para trocar)</> : 'Clique para escolher a planilha (.xlsx)'}
      </label>

      {arquivo && (
        <div className="rounded-xl border border-border bg-surface p-4 text-sm">
          <h2 className="font-semibold">Prévia</h2>
          {validas.length > 0 && (
            <>
              <p className="mt-1 text-muted">{validas.length} linha(s) válida(s) · ano(s): {anos.join(', ')}</p>
              <ul className="mt-2 space-y-0.5">
                {Object.entries(totais).map(([c, v]) => <li key={c}>{NOMES[c] ?? c}: <strong>{brl(v)}</strong></li>)}
              </ul>
            </>
          )}
          {erros.length > 0 && (
            <div className="mt-3 text-bad">
              <p className="font-medium">Corrija a planilha antes de gravar ({erros.length} problema(s)):</p>
              <ul className="mt-1 list-disc pl-5">
                {erros.slice(0, 30).map((e, i) => <li key={i}>{e.linha ? `linha ${e.linha}: ` : ''}{e.motivo}</li>)}
              </ul>
            </div>
          )}
          <button
            type="button"
            disabled={pendente || erros.length > 0 || validas.length === 0}
            onClick={() => iniciar(async () => {
              const r = await gravarMetas(validas);
              setMsg(r.erro ? { tipo: 'erro', texto: r.erro } : { tipo: 'ok', texto: `${r.gravadas} meta(s) gravada(s). As metas de ${anos.join(', ')} foram substituídas.` });
            })}
            className="mt-4 rounded-lg bg-accent px-3 py-1.5 text-white disabled:opacity-50"
          >
            {pendente ? 'Gravando…' : `Gravar (substitui as metas de ${anos.join(', ') || '—'})`}
          </button>
          {msg && <p className={`mt-2 ${msg.tipo === 'ok' ? 'text-good' : 'text-bad'}`}>{msg.texto}</p>}
        </div>
      )}
    </div>
  );
}
