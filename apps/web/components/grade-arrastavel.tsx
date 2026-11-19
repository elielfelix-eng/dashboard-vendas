'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { aplicarOrdem, lerOrdemGravada } from '@/lib/ordem-cards';

// Grade de cards que o usuário reorganiza arrastando pelo ícone ⠿ (mouse ou toque) ou com as setas do teclado.
// A ordem fica só neste navegador (localStorage), por tela (`id`). Sem armazenamento, segue na ordem padrão.

export interface ItemGrade {
  chave: string;
  node: ReactNode;
}

const PREFIXO = 'ordem-cards:';

function lerOrdem(id: string): string[] | null {
  try {
    return lerOrdemGravada(window.localStorage.getItem(PREFIXO + id));
  } catch {
    return null;
  }
}

function gravarOrdem(id: string, ordem: string[] | null) {
  try {
    if (ordem) window.localStorage.setItem(PREFIXO + id, JSON.stringify(ordem));
    else window.localStorage.removeItem(PREFIXO + id);
  } catch {
    // sem armazenamento (navegação privada, bloqueado): a ordem vale só nesta sessão da tela
  }
}

export function GradeArrastavel({ id, itens, className }: { id: string; itens: ItemGrade[]; className?: string }) {
  const padrao = itens.map((i) => i.chave);
  const [ordem, setOrdem] = useState<string[]>(padrao);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const interagiu = useRef(false);

  // Carrega a ordem salva depois da montagem (o servidor renderiza sempre a ordem padrão).
  useEffect(() => {
    const salva = lerOrdem(id);
    if (salva) setOrdem(salva);
  }, [id]);

  // Grava só depois de uma ação do usuário, nunca na primeira carga.
  useEffect(() => {
    if (interagiu.current) gravarOrdem(id, ordem);
  }, [id, ordem]);

  const iguala = ordem.length === padrao.length && ordem.every((c, i) => c === padrao[i]);

  function moverPara(chaveOrigem: string, chaveDestino: string) {
    if (chaveOrigem === chaveDestino) return;
    interagiu.current = true;
    setOrdem((prev) => {
      const de = prev.indexOf(chaveOrigem);
      const para = prev.indexOf(chaveDestino);
      if (de < 0 || para < 0) return prev;
      const novo = [...prev];
      novo.splice(de, 1);
      novo.splice(para, 0, chaveOrigem);
      return novo;
    });
  }

  function mover(chave: string, passo: number) {
    interagiu.current = true;
    setOrdem((prev) => {
      const i = prev.indexOf(chave);
      const j = i + passo;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const novo = [...prev];
      [novo[i], novo[j]] = [novo[j], novo[i]];
      return novo;
    });
  }

  function aoPressionar(e: PointerEvent<HTMLButtonElement>, chave: string) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setArrastando(chave);
  }

  function aoMover(e: PointerEvent<HTMLButtonElement>) {
    if (!arrastando) return;
    const alvo = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-chave]');
    const destino = alvo?.dataset.chave;
    if (destino) moverPara(arrastando, destino);
  }

  function aoSoltar() {
    setArrastando(null);
  }

  function aoTeclar(e: KeyboardEvent<HTMLButtonElement>, chave: string) {
    const antes = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
    const depois = e.key === 'ArrowRight' || e.key === 'ArrowDown';
    if (!antes && !depois) return;
    e.preventDefault();
    mover(chave, antes ? -1 : 1);
  }

  function restaurar() {
    interagiu.current = false;
    gravarOrdem(id, null);
    setOrdem(padrao);
  }

  const visiveis = aplicarOrdem(itens, ordem);

  return (
    <>
      <div className={className}>
        {visiveis.map((i) => (
          <div key={i.chave} data-chave={i.chave} className={`relative ${arrastando === i.chave ? 'opacity-60' : ''}`}>
            <button
              type="button"
              aria-label="Mover card (arraste ou use as setas do teclado)"
              title="Arraste para mudar a posição"
              onPointerDown={(e) => aoPressionar(e, i.chave)}
              onPointerMove={aoMover}
              onPointerUp={aoSoltar}
              onPointerCancel={aoSoltar}
              onKeyDown={(e) => aoTeclar(e, i.chave)}
              style={{ touchAction: 'none' }}
              className="absolute right-2 top-2 z-10 cursor-grab rounded px-1 text-sm leading-none text-muted hover:bg-border focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              ⠿
            </button>
            {i.node}
          </div>
        ))}
      </div>
      {!iguala && (
        <div className="mt-2 text-right">
          <button type="button" onClick={restaurar} className="text-xs text-muted underline">
            Restaurar ordem padrão
          </button>
        </div>
      )}
    </>
  );
}
