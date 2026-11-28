'use server';

import { headers } from 'next/headers';
import { emailValido, MENSAGEM_CADASTRO, normalizarEmail } from '@/lib/cadastro-vendedor';
import { criarClienteAvulso } from '@/lib/supabase/avulso';

// Mesma resposta para qualquer e-mail: não revela quem tem conta. Logs só com códigos, nunca o e-mail.
export async function pedirNovaSenha(_prev: unknown, formData: FormData) {
  const email = normalizarEmail(String(formData.get('email') ?? ''));
  if (!emailValido(email)) return { mensagem: MENSAGEM_CADASTRO };

  try {
    const cabecalhos = await headers();
    const host = cabecalhos.get('host') ?? '';
    const proto = cabecalhos.get('x-forwarded-proto') ?? 'https';
    const { error } = await criarClienteAvulso().auth.resetPasswordForEmail(email, {
      redirectTo: `${proto}://${host}/definir-senha`,
    });
    if (error) console.error('esqueci-senha: link_nao_enviado', error.status ?? 'sem_status');
  } catch {
    console.error('esqueci-senha: erro_configuracao');
  }
  return { mensagem: MENSAGEM_CADASTRO };
}
