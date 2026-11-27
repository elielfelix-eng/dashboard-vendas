'use client';

import { useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { CHAVE_TEMA, resolverTema, type Tema } from '@/lib/tema';

// Alterna claro e escuro e lembra a escolha no navegador (try/catch: se o armazenamento falhar, só não lembra).
export function BotaoTema() {
  const [tema, setTema] = useState<Tema>('claro');

  useEffect(() => {
    let salvo: string | null = null;
    try {
      salvo = localStorage.getItem(CHAVE_TEMA);
    } catch {
      salvo = null;
    }
    setTema(resolverTema(salvo, window.matchMedia('(prefers-color-scheme: dark)').matches));
  }, []);

  function alternar() {
    const proximo: Tema = tema === 'escuro' ? 'claro' : 'escuro';
    setTema(proximo);
    document.documentElement.setAttribute('data-theme', proximo);
    try {
      localStorage.setItem(CHAVE_TEMA, proximo);
    } catch {
      // sem armazenamento: o tema vale só nesta página
    }
  }

  const proximoNome = tema === 'escuro' ? 'claro' : 'escuro';
  const Icone = tema === 'escuro' ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={alternar}
      aria-label={`Ativar o modo ${proximoNome}`}
      title={`Modo ${proximoNome}`}
      className="rounded-lg p-2 text-muted hover:bg-accent-soft hover:text-text"
    >
      <Icone className="size-5" aria-hidden="true" />
    </button>
  );
}
