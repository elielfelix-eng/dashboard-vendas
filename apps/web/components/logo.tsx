// Logotipos oficiais da marca (Manual de Marca, p. 29). Arquivos em public/marca, sem editar o desenho.
// No modo escuro, a classe .marca-escuro (globals.css) mostra a versão branca. As duas imagens ficam no DOM.
// O alt fica só na versão visível para leitores de tela.

export type VersaoLogo = 'horizontal' | 'principal' | 'icone';

const ARQUIVOS: Record<VersaoLogo, { claro: string; escuro: string; larguraMinima: number }> = {
  horizontal: { claro: '/marca/logo-horizontal.svg', escuro: '/marca/logo-horizontal-branco.svg', larguraMinima: 160 },
  principal: { claro: '/marca/logo.svg', escuro: '/marca/logo-branco.svg', larguraMinima: 200 },
  icone: { claro: '/marca/icone.svg', escuro: '/marca/icone-branco.svg', larguraMinima: 32 },
};

export function Logo({ versao, className }: { versao: VersaoLogo; className?: string }) {
  const arquivo = ARQUIVOS[versao];
  return (
    <span className={className} style={{ display: 'inline-block', minWidth: arquivo.larguraMinima }}>
      <img src={arquivo.claro} alt="Brinde do Bem" className="marca-claro h-auto w-full" />
      <img src={arquivo.escuro} alt="" aria-hidden="true" className="marca-escuro h-auto w-full" />
    </span>
  );
}
