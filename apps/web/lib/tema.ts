// Escolha de tema (claro ou escuro), guardada no navegador da pessoa (research.md R3).
// Sem escolha válida salva, vale o tema do sistema. Função pura, sem acesso ao navegador.

export type Tema = 'claro' | 'escuro';

export const CHAVE_TEMA = 'bdb-tema';

export function resolverTema(salvo: string | null, sistemaEscuro: boolean): Tema {
  if (salvo === 'claro' || salvo === 'escuro') return salvo;
  return sistemaEscuro ? 'escuro' : 'claro';
}
