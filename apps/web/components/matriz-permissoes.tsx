'use client';

import { useOptimistic, useState, useTransition } from 'react';
import { alterarPermissao } from '@/app/(app)/configuracoes/permissoes/actions';
import type { Role } from '@/lib/auth';
import type { Permissao } from '@/lib/permissoes';

interface Props {
  perfis: { role: Role; rotulo: string }[];
  permissoes: { chave: Permissao; rotulo: string }[];
  marcadas: string[]; // "role|permissao"
  podeEditar: boolean;
}

export function MatrizPermissoes({ perfis, permissoes, marcadas, podeEditar }: Props) {
  const [estado, marcar] = useOptimistic(new Set(marcadas), (s: Set<string>, mud: { k: string; v: boolean }) => {
    const n = new Set(s);
    if (mud.v) n.add(mud.k); else n.delete(mud.k);
    return n;
  });
  const [, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  return (
    <div>
      {erro && <p className="mb-2 text-sm text-bad">{erro}</p>}
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted">
              <th className="px-3 py-2 text-left font-medium">Perfil</th>
              {permissoes.map((p) => <th key={p.chave} className="px-3 py-2 text-center font-medium">{p.rotulo}</th>)}
            </tr>
          </thead>
          <tbody>
            {perfis.map((r) => (
              <tr key={r.role} className="border-b border-border last:border-0">
                <td className="px-3 py-2 font-medium">{r.rotulo}</td>
                {permissoes.map((p) => {
                  const k = `${r.role}|${p.chave}`;
                  const travado = r.role === 'admin' && p.chave === 'configuracoes';
                  return (
                    <td key={p.chave} className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        aria-label={`${r.rotulo}: ${p.rotulo}`}
                        title={travado ? 'O administrador sempre mantém o acesso à Administração.' : undefined}
                        checked={estado.has(k)}
                        disabled={!podeEditar || travado}
                        onChange={(e) => {
                          const v = e.target.checked;
                          setErro(null);
                          iniciar(async () => {
                            marcar({ k, v });
                            const res = await alterarPermissao(r.role, p.chave, v);
                            if (res.erro) setErro(res.erro);
                          });
                        }}
                        className="h-4 w-4 accent-[var(--accent)]"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
