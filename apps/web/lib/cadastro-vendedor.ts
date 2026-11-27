// Regras de e-mail do cadastro proprio do vendedor (spec 2026-11-27-cadastro-vendedor-design).
// Funcoes puras: sem acesso ao banco nem ao Supabase.

export function normalizarEmail(texto: string): string {
  return texto.trim().toLowerCase();
}

// Formato simples: exatamente uma arroba, parte local e dominio nao vazios, sem espacos.
// A regra de dominio da empresa e a de cadastro no Bitrix ficam no banco (core.pode_cadastrar_vendedor).
export function emailValido(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Decide se o convite deve ser enviado, a partir da resposta da elegibilidade no banco.
export function deveConvidar(resposta: { data: boolean | null; error: unknown }): boolean {
  return resposta.error == null && resposta.data === true;
}

// Mesma resposta para e-mail elegivel, nao elegivel, invalido ou com erro: nao revela quem esta cadastrado.
export const MENSAGEM_CADASTRO = 'Se o e-mail estiver cadastrado, você receberá um link em instantes.';
