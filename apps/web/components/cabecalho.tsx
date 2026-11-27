'use client';

import { Menu } from 'lucide-react';
import { logout } from '@/app/login/actions';
import { BotaoTema } from '@/components/botao-tema';

// Cabeçalho do painel: botão do menu (só no celular), usuário, tema e Sair.
export function Cabecalho({ nome, perfil, aoAbrirMenu }: { nome: string; perfil: string; aoAbrirMenu: () => void }) {
  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-surface px-4 py-3 md:px-8">
      <button
        type="button"
        onClick={aoAbrirMenu}
        aria-label="Abrir o menu"
        className="rounded-lg p-2 text-text hover:bg-accent-soft md:hidden"
      >
        <Menu className="size-5" aria-hidden="true" />
      </button>

      <div className="flex-1" />

      <div className="min-w-0 text-right">
        <p className="truncate text-sm font-semibold">{nome}</p>
        <p className="truncate text-xs text-muted">{perfil}</p>
      </div>

      <BotaoTema />

      <form action={logout}>
        <button type="submit" className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-accent-soft hover:text-text">
          Sair
        </button>
      </form>
    </header>
  );
}
