'use server';

import { revalidatePath } from 'next/cache';
import { requireUser, type Role } from '@/lib/auth';
import { PERMISSOES, type Permissao } from '@/lib/permissoes';
import { createClient } from '@/lib/supabase/server';

const PERFIS: Role[] = ['admin', 'gestor', 'comercial', 'visualizador', 'vendedor'];

export async function alterarPermissao(role: Role, permissao: Permissao, allowed: boolean): Promise<{ erro?: string }> {
  const { profile } = await requireUser();
  if (profile?.role !== 'admin') return { erro: 'Só o administrador altera permissões.' };
  if (!PERFIS.includes(role) || !PERMISSOES.some((p) => p.chave === permissao)) return { erro: 'Dados inválidos.' };
  if (role === 'admin' && permissao === 'configuracoes' && !allowed) {
    return { erro: 'O administrador precisa manter o acesso à Administração.' };
  }
  const supabase = await createClient();
  const { error } = await supabase.schema('core').from('role_permissions')
    .update({ allowed }).eq('role', role).eq('permission', permissao);
  if (error) {
    return { erro: /configuracoes/.test(error.message) ? 'O administrador precisa manter o acesso à Administração.' : 'Não foi possível salvar agora.' };
  }
  revalidatePath('/', 'layout');
  return {};
}
