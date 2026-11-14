'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

interface Opcao { tipo: 'area' | 'vendedor' | 'origem'; valor: string; rotulo: string }

interface Props {
  opcoes: Opcao[];
  area: string | null;
  vendedor: number | null;
  origem: string | null;
  travarVendedor?: boolean;
}

const classe = 'rounded-lg border border-border bg-surface px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:text-muted';

export function SeletoresCrm({ opcoes, area, vendedor, origem, travarVendedor = false }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function ir(mudancas: Record<string, string | null>) {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(mudancas)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    router.push(`${pathname}?${p.toString()}`);
  }

  const lista = (tipo: Opcao['tipo']) => opcoes.filter((o) => o.tipo === tipo);
  const valor = (v: string) => (v === '' ? null : v);

  return (
    <>
      <select aria-label="Área" value={area ?? ''} onChange={(e) => ir({ area: valor(e.target.value) })} className={classe}>
        <option value="">Todas as áreas</option>
        {lista('area').map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
      </select>
      <select
        aria-label="Vendedor"
        value={vendedor === null ? '' : String(vendedor)}
        disabled={travarVendedor}
        onChange={(e) => ir({ vendedor: valor(e.target.value) })}
        className={classe}
      >
        <option value="">Todos os vendedores</option>
        {lista('vendedor').map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
      </select>
      <select aria-label="Origem" value={origem ?? ''} onChange={(e) => ir({ origem: valor(e.target.value) })} className={classe}>
        <option value="">Todas as origens</option>
        {lista('origem').map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
      </select>
    </>
  );
}
