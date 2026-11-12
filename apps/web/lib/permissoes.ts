import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';
import { requireUser } from './auth';

export type Permissao = 'visao_geral' | 'vendas' | 'rentabilidade' | 'metas' | 'custos' | 'editar_metas' | 'configuracoes';

export const PERMISSOES: { chave: Permissao; rotulo: string }[] = [
  { chave: 'visao_geral', rotulo: 'Visão Geral' },
  { chave: 'vendas', rotulo: 'Vendas' },
  { chave: 'rentabilidade', rotulo: 'Rentabilidade' },
  { chave: 'metas', rotulo: 'Metas e Projeção' },
  { chave: 'custos', rotulo: 'Vê custo/margem' },
  { chave: 'editar_metas', rotulo: 'Editar metas e premissas' },
  { chave: 'configuracoes', rotulo: 'Administração' },
];

/** Permissões do perfil do usuário logado (uma consulta por requisição). */
export const getPermissoes = cache(async (): Promise<Set<Permissao>> => {
  const { profile } = await requireUser();
  if (!profile?.role) return new Set();
  const supabase = await createClient();
  const { data } = await supabase
    .schema('core')
    .from('role_permissions')
    .select('permission')
    .eq('role', profile.role)
    .eq('allowed', true);
  return new Set((data ?? []).map((r) => r.permission as Permissao));
});

const ORDEM_TELAS: [Permissao, string][] = [
  ['visao_geral', '/'], ['vendas', '/vendas'], ['rentabilidade', '/rentabilidade'], ['metas', '/metas'],
  ['configuracoes', '/configuracoes/permissoes'],
];

/** Primeira tela que o perfil pode abrir (ou a página "sem acesso"). */
export function primeiraTela(perms: Set<Permissao>): string {
  return ORDEM_TELAS.find(([p]) => perms.has(p))?.[1] ?? '/sem-acesso';
}

/** Redireciona quem não tem todas as permissões pedidas. */
export async function exigirPermissao(...ps: Permissao[]): Promise<Set<Permissao>> {
  const perms = await getPermissoes();
  if (!ps.every((p) => perms.has(p))) {
    const destino = primeiraTela(perms);
    redirect(destino === '/' && !perms.has('visao_geral') ? '/sem-acesso' : destino);
  }
  return perms;
}
