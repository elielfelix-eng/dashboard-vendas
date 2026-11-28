// Login com Google: só entra quem já tem conta criada no Supabase (cadastro aberto desligado no Supabase).
// Funções puras, sem acesso ao Supabase.

// null = pode trocar o código pela sessão; texto = para onde mandar a pessoa.
export function destinoCallback(params: URLSearchParams): string | null {
  if (params.get('error') || params.get('error_code') || !params.get('code')) return '/login?erro=google';
  return null;
}

// Mesma mensagem para e-mail sem conta e para falha do Google: não revela quem tem acesso.
export const MENSAGEM_ERRO_GOOGLE =
  'Não foi possível entrar com o Google. Se o seu e-mail ainda não tem acesso ao painel, peça ao administrador.';
