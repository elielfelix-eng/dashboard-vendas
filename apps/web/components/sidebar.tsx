'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Logo } from '@/components/logo';
import { itemAtivo, menuVisivel } from '@/lib/menu';
import type { Permissao } from '@/lib/permissoes';

// Menu lateral agrupado. No desktop pode ficar aberto (com texto) ou recolhido (só ícones).
// No celular é sempre uma gaveta com texto, que fecha ao escolher uma tela.
// A permissão de cada perfil vem do servidor (getPermissoes), e aqui só se decide o que mostrar.
export function Sidebar({
  permissoes,
  alertas = 0,
  aberto,
  recolhido = false,
  aoFechar,
}: {
  permissoes: Permissao[];
  alertas?: number;
  aberto: boolean;
  recolhido?: boolean;
  aoFechar: () => void;
}) {
  const pathname = usePathname();
  const grupos = menuVisivel(permissoes);

  // Só se aplica a partir de md (desktop). No celular o texto sempre aparece.
  const ocultaSeRecolhido = recolhido ? 'md:hidden' : '';
  const textoSeRecolhido = recolhido ? 'md:sr-only' : '';
  const centralizaSeRecolhido = recolhido ? 'md:justify-center md:px-0' : '';

  return (
    <aside
      className={[
        'fixed inset-y-0 left-0 z-40 flex flex-col overflow-y-auto overflow-x-hidden border-r border-border bg-surface transition-[transform,width] duration-200',
        recolhido ? 'w-64 md:w-16' : 'w-64 md:w-64',
        aberto ? 'translate-x-0' : '-translate-x-full',
        'md:translate-x-0',
      ].join(' ')}
    >
      <div className="h-1 shrink-0 bg-accent" aria-hidden="true" />
      <div className={`px-5 py-5 ${recolhido ? 'md:flex md:justify-center md:px-0' : ''}`}>
        <div className={ocultaSeRecolhido}>
          <Logo versao="horizontal" className="w-40" />
        </div>
        {recolhido && (
          <div className="hidden md:block">
            <Logo versao="icone" className="w-8" />
          </div>
        )}
      </div>

      <nav className="flex-1 px-3 pb-4" aria-label="Menu principal">
        {grupos.map((grupo) => (
          <div key={grupo.rotulo} className="mb-5">
            <p className={`px-2 pb-1 text-[11px] font-bold uppercase tracking-wider text-muted ${ocultaSeRecolhido}`}>
              {grupo.rotulo}
            </p>
            {grupo.itens.map((item) => {
              const Icone = item.icone;
              if (!item.pronto) {
                return (
                  <span
                    key={item.href}
                    className={`flex items-center gap-3 px-2 py-1.5 text-sm text-muted ${centralizaSeRecolhido}`}
                    title="Disponível em uma próxima fase"
                  >
                    <Icone className="size-4 shrink-0" aria-hidden="true" />
                    <span className={`flex-1 ${textoSeRecolhido}`}>{item.rotulo}</span>
                    <span className={`rounded bg-bg px-1.5 text-[10px] ${ocultaSeRecolhido}`}>em breve</span>
                  </span>
                );
              }
              const ativo = itemAtivo(item.href, pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={aoFechar}
                  title={recolhido ? item.rotulo : undefined}
                  aria-current={ativo ? 'page' : undefined}
                  className={[
                    'relative flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm',
                    centralizaSeRecolhido,
                    ativo ? 'bg-accent-soft font-semibold text-text' : 'text-text/80 hover:bg-accent-soft',
                  ].join(' ')}
                >
                  {ativo && <span className="absolute inset-y-1 left-0 w-1 rounded-full bg-accent" aria-hidden="true" />}
                  <Icone className={`size-4 shrink-0 ${ativo ? 'text-text' : 'text-brand-2'}`} aria-hidden="true" />
                  <span className={`flex-1 ${textoSeRecolhido}`}>{item.rotulo}</span>
                  {item.href === '/alertas' && alertas > 0 && (
                    <span
                      className={`rounded-full bg-bad px-1.5 text-[11px] font-semibold text-surface ${ocultaSeRecolhido}`}
                      aria-label={`${alertas} alertas`}
                    >
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
