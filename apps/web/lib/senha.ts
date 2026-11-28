// Regras de senha do painel (criar pelo link, recuperar e alterar). Funções puras.
export const SENHA_MINIMA = 8;

// Devolve a mensagem de erro, ou null quando está tudo certo.
export function validarNovaSenha(nova: string, confirmacao: string): string | null {
  if (nova.length < SENHA_MINIMA) return `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`;
  if (nova !== confirmacao) return 'As senhas não conferem.';
  return null;
}

export function validarTrocaSenha(atual: string, nova: string, confirmacao: string): string | null {
  if (!atual) return 'Informe a senha atual.';
  const erro = validarNovaSenha(nova, confirmacao);
  if (erro) return erro;
  if (nova === atual) return 'A nova senha precisa ser diferente da atual.';
  return null;
}
