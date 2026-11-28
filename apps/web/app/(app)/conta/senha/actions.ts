'use server';

import { requireUser } from '@/lib/auth';
import { validarTrocaSenha } from '@/lib/senha';
import { criarClienteAvulso } from '@/lib/supabase/avulso';
import { createClient } from '@/lib/supabase/server';

export type EstadoTroca = { erro?: string; ok?: boolean } | undefined;

export async function alterarSenha(_prev: EstadoTroca, formData: FormData): Promise<EstadoTroca> {
  const atual = String(formData.get('atual') ?? '');
  const nova = String(formData.get('nova') ?? '');
  const confirmacao = String(formData.get('confirmacao') ?? '');
  const erro = validarTrocaSenha(atual, nova, confirmacao);
  if (erro) return { erro };

  const { user } = await requireUser();
  if (!user.email) return { erro: 'Não foi possível alterar a senha.' };

  // Confere a senha atual num cliente separado, para não trocar a sessão de quem está logado.
  const conferencia = criarClienteAvulso();
  const { error: erroAtual } = await conferencia.auth.signInWithPassword({ email: user.email, password: atual });
  if (erroAtual) return { erro: 'A senha atual está incorreta.' };
  await conferencia.auth.signOut({ scope: 'local' });

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: nova });
  if (error) {
    console.error('alterar-senha: falha', error.code ?? 'sem_codigo');
    if (error.code === 'weak_password') return { erro: 'Senha fraca. Use letras e números, com pelo menos 8 caracteres.' };
    return { erro: 'Não foi possível alterar a senha. Tente de novo.' };
  }
  return { ok: true };
}
