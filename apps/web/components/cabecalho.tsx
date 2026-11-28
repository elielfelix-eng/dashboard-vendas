'use client';

import Link from 'next/link';
import { KeyRound, Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { logout } from '@/app/login/actions';
import { BotaoTema } from '@/components/botao-tema';

// Cabeçalho do painel: botão da gaveta (só no celular), recolher o menu (só no desktop), usuário, tema, Alterar senha e Sair.
export function Cabecalho({
  nome,
  perfil,
  aoAbrirMenu,
  recolhido = false,
  aoAlternarRecolhido,
}: {
  nome: string;
  perfil: string;
  aoAbrirMenu: () => void;
  recolhido?: boolean;
  aoAlternarRecolhido?: () => void;
}) {
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

      {aoAlternarRecolhido && (
        <button
          type="button"
          onClick={aoAlternarRecolhido}
          aria-label={recolhido ? 'Expandir o menu' : 'Recolher o menu'}
          title={recolhido ? 'Expandir o menu' : 'Recolher o menu'}
          className="hidden rounded-lg p-2 text-text hover:bg-accent-soft md:inline-flex"
        >
          {recolhido ? <PanelLeftOpen className="size-5" aria-hidden="true" /> : <PanelLeftClose className="size-5" aria-hidden="true" />}
        </button>
      )}

      <div className="flex-1" />

      <div className="min-w-0 text-right">
        <p className="truncate text-sm font-semibold">{nome}</p>
        <p className="truncate text-xs text-muted">{perfil}</p>
      </div>

      <BotaoTema />

      <Link
        href="/conta/senha"
        aria-label="Alterar senha"
        title="Alterar senha"
        className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm text-muted hover:bg-accent-soft hover:text-text"
      >
        <KeyRound className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">Alterar senha</span>
      </Link>

      <form action={logout}>
        <button type="submit" className="rounded-lg px-2 py-1 text-sm text-muted hover:bg-accent-soft hover:text-text">
          Sair
        </button>
      </form>
    </header>
  );
}
