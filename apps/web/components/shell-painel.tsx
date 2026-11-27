'use client';

import { useState } from 'react';
import { Cabecalho } from '@/components/cabecalho';
import { Sidebar } from '@/components/sidebar';
import type { Permissao } from '@/lib/permissoes';

// Casca do painel: menu lateral, cabeçalho e conteúdo. Guarda só se a gaveta do celular está aberta.
export function ShellPainel({
  nome,
  perfil,
  permissoes,
  alertas,
  children,
}: {
  nome: string;
  perfil: string;
  permissoes: Permissao[];
  alertas: number;
  children: React.ReactNode;
}) {
  const [menuAberto, setMenuAberto] = useState(false);

  return (
    <div className="min-h-screen bg-bg">
      <Sidebar
        permissoes={permissoes}
        alertas={alertas}
        aberto={menuAberto}
        aoFechar={() => setMenuAberto(false)}
      />
      {menuAberto && (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" aria-hidden="true" onClick={() => setMenuAberto(false)} />
      )}
      <div className="md:pl-64">
        <Cabecalho nome={nome} perfil={perfil} aoAbrirMenu={() => setMenuAberto(true)} />
        <main className="min-w-0 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
