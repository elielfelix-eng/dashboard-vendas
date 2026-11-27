'use client';

import { useEffect, useState } from 'react';
import { Cabecalho } from '@/components/cabecalho';
import { Sidebar } from '@/components/sidebar';
import type { Permissao } from '@/lib/permissoes';

// Chave do navegador que guarda se o menu do desktop está recolhido ("1") ou aberto.
const CHAVE_MENU_RECOLHIDO = 'bdb-menu-recolhido';

// Casca do painel: menu lateral, cabeçalho e conteúdo.
// Guarda se a gaveta do celular está aberta e se o menu do desktop está recolhido.
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
  const [recolhido, setRecolhido] = useState(false);

  // Lê a escolha salva depois da montagem (o servidor não sabe qual foi). Sem armazenamento, fica aberto.
  useEffect(() => {
    try {
      setRecolhido(localStorage.getItem(CHAVE_MENU_RECOLHIDO) === '1');
    } catch {
      setRecolhido(false);
    }
  }, []);

  function alternarRecolhido() {
    const proximo = !recolhido;
    setRecolhido(proximo);
    try {
      localStorage.setItem(CHAVE_MENU_RECOLHIDO, proximo ? '1' : '0');
    } catch {
      // sem armazenamento: vale só nesta página
    }
  }

  return (
    <div className="min-h-screen bg-bg">
      <Sidebar
        permissoes={permissoes}
        alertas={alertas}
        aberto={menuAberto}
        recolhido={recolhido}
        aoFechar={() => setMenuAberto(false)}
      />
      {menuAberto && (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" aria-hidden="true" onClick={() => setMenuAberto(false)} />
      )}
      <div className={`transition-[padding] duration-200 ${recolhido ? 'md:pl-16' : 'md:pl-64'}`}>
        <Cabecalho
          nome={nome}
          perfil={perfil}
          aoAbrirMenu={() => setMenuAberto(true)}
          recolhido={recolhido}
          aoAlternarRecolhido={alternarRecolhido}
        />
        <main className="min-w-0 px-4 py-6 md:px-8">{children}</main>
      </div>
    </div>
  );
}
