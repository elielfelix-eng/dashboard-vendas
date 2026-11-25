// Textos e cores da tela de alertas (sem dependências, testável).

const plural = (n: number) => (n === 1 ? 'dia útil' : 'dias úteis');

/** Quanto falta para o prazo, em dias úteis (negativo = atrasada). */
export function textoFaltam(faltam: number | null, situacao: string): string {
  if (situacao === 'prazo_desconhecido' || faltam == null) return 'prazo desconhecido';
  if (faltam < 0) return `atrasada há ${-faltam} ${plural(-faltam)}`;
  if (faltam === 0) return 'vence hoje';
  return `${faltam} ${plural(faltam)}`;
}

const NIVEIS: Record<string, { nome: string; classe: string }> = {
  '5_green': { nome: 'Verde', classe: 'bg-green-600 text-white' },
  '4_light_green': { nome: 'Verde-claro', classe: 'bg-lime-500 text-white' },
  '3_yellow': { nome: 'Amarelo', classe: 'bg-yellow-400 text-black' },
  '2_orange': { nome: 'Laranja', classe: 'bg-orange-500 text-white' },
  '1_red': { nome: 'Vermelho', classe: 'bg-red-600 text-white' },
};

/** Nome e classe de cor do nível de reputação do Mercado Livre. */
export function corDoNivel(levelId: string | null): { nome: string; classe: string } {
  return (levelId && NIVEIS[levelId]) || { nome: 'Sem reputação', classe: 'bg-bg text-muted border border-border' };
}
