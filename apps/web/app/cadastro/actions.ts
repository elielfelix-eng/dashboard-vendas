'use server';

import { headers } from 'next/headers';
import { deveConvidar, emailValido, MENSAGEM_CADASTRO, normalizarEmail } from '@/lib/cadastro-vendedor';
import { criarClienteAdmin } from '@/lib/supabase/admin';

export async function solicitarCadastro(_prev: unknown, formData: FormData) {
  const email = normalizarEmail(String(formData.get('email') ?? ''));
  if (!emailValido(email)) return { mensagem: MENSAGEM_CADASTRO };

  try {
    const admin = criarClienteAdmin();
    const elegibilidade = await admin.rpc('pode_cadastrar_vendedor', { p_email: email });
    if (deveConvidar({ data: elegibilidade.data as boolean | null, error: elegibilidade.error })) {
      const cabecalhos = await headers();
      const host = cabecalhos.get('host') ?? '';
      const proto = cabecalhos.get('x-forwarded-proto') ?? 'https';
      const convite = await admin.auth.admin.inviteUserByEmail(email, {
        data: { origem: 'cadastro_proprio' },
        redirectTo: `${proto}://${host}/definir-senha`,
      });
      // Conta ja existente cai aqui: fica sem aviso para nao revelar o cadastro.
      if (convite.error) console.error('cadastro: convite_nao_enviado', convite.error.status ?? 'sem_status');
    } else if (elegibilidade.error) {
      console.error('cadastro: falha_elegibilidade', elegibilidade.error.code ?? 'sem_codigo');
    }
  } catch {
    console.error('cadastro: erro_configuracao');
  }
  return { mensagem: MENSAGEM_CADASTRO };
}
