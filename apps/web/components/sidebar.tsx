'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/components/logo';
import { itemAtivo, menuVisivel } from '@/lib/menu';
import type { Permissao } from '@/lib/permissoes';

// Menu lateral agrupado. No desktop é fixo; no celular é uma gaveta que fecha ao escolher uma tela.
// A permissão de cada perfil vem do servidor (getPermissoes), e aqui só se decide o que mostrar.
export function Sidebar({
  permissoes,
  alertas = 0,
  aberto,
  aoFechar,
}: {
  permissoes: Permissao[];
  alertas?: number;
  aberto: boolean;
  aoFechar: () => void;
}) {
  const pathname = usePathname();
  const grupos = menuVisivel(permissoes);

  return (
    <aside
      className={[
        'fixed inset-y-0 left-0 z-40 flex w-64 flex-col overflow-y-auto border-r border-border bg-surface transition-transform',
        aberto ? 'translate-x-0' : '-translate-x-full',
        'md:translate-x-0',
      ].join(' ')}
    >
      <div className="h-1 shrink-0 bg-accent" aria-hidden="true" />
      <div className="px-5 py-5">
        <Logo versao="horizontal" className="w-40" />
      </div>

      <nav className="flex-1 px-3 pb-4" aria-label="Menu principal">
        {grupos.map((grupo) => (
          <div key={grupo.rotulo} className="mb-5">
            <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted">{grupo.rotulo}</p>
            {grupo.itens.map((item) => {
              const Icone = item.icone;
              if (!item.pronto) {
                return (
                  <span
                    key={item.href}
                    className="flex items-center gap-3 px-2 py-1.5 text-sm text-muted"
                    title="Disponível em uma próxima fase"
                  >
                    <Icone className="size-4 shrink-0" aria-hidden="true" />
                    <span className="flex-1">{item.rotulo}</span>
                    <span className="rounded bg-bg px-1.5 text-[10px]">em breve</span>
                  </span>
                );
              }
              const ativo = itemAtivo(item.href, pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={aoFechar}
                  aria-current={ativo ? 'page' : undefined}
                  className={[
                    'relative flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm',
                    ativo ? 'bg-accent-soft font-semibold text-text' : 'text-text/80 hover:bg-accent-soft',
                  ].join(' ')}
                >
                  {ativo && <span className="absolute inset-y-1 left-0 w-1 rounded-full bg-accent" aria-hidden="true" />}
                  <Icone className={`size-4 shrink-0 ${ativo ? 'text-text' : 'text-brand-2'}`} aria-hidden="true" />
                  <span className="flex-1">{item.rotulo}</span>
                  {item.href === '/alertas' && alertas > 0 && (
                    <span className="rounded-full bg-bad px-1.5 text-[11px] font-semibold text-surface" aria-label={`${alertas} alertas`}>
                      {alertas}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
