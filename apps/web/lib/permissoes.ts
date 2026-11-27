import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';
import { requireUser } from './auth';
import { medir } from './tempo';

export type Permissao = 'visao_geral' | 'vendas' | 'rentabilidade' | 'metas' | 'custos' | 'editar_metas' | 'configuracoes'
  | 'ads' | 'editar_ads' | 'crm_funil' | 'crm_vendedores' | 'crm_origens'
  | 'operacao' | 'editar_grupos';

export const PERMISSOES: { chave: Permissao; rotulo: string }[] = [
  { chave: 'visao_geral', rotulo: 'Visão Geral' },
  { chave: 'vendas', rotulo: 'Vendas' },
  { chave: 'rentabilidade', rotulo: 'Rentabilidade' },
  { chave: 'metas', rotulo: 'Metas e Projeção' },
  { chave: 'custos', rotulo: 'Vê custo/margem' },
  { chave: 'editar_metas', rotulo: 'Editar metas e premissas' },
  { chave: 'configuracoes', rotulo: 'Administração' },
  { chave: 'ads', rotulo: 'Ads' },
  { chave: 'editar_ads', rotulo: 'Editar Ads (orçamento e modo automático)' },
  { chave: 'crm_funil', rotulo: 'CRM – Funil' },
  { chave: 'crm_vendedores', rotulo: 'CRM – Vendedores' },
  { chave: 'crm_origens', rotulo: 'CRM – Origens' },
  { chave: 'operacao', rotulo: 'Alertas e Reputação' },
  { chave: 'editar_grupos', rotulo: 'Editar grupos de anúncios' },
];

/**
 * Permissões do perfil do usuário logado e se a consulta falhou (uma consulta por requisição).
 * O cache do painel (rpc-cache.ts) usa `erro` para não guardar nada quando as permissões não foram lidas.
 */
export const getPermissoesComErro = cache(async (): Promise<{ permissoes: Set<Permissao>; erro: boolean }> => {
  const { profile } = await requireUser();
  if (!profile?.role) return { permissoes: new Set(), erro: false };
  const supabase = await createClient();
  const { data, error } = await medir('permissoes', async () => supabase
    .schema('core')
    .from('role_permissions')
    .select('permission')
    .eq('role', profile.role)
    .eq('allowed', true));
  return { permissoes: new Set((data ?? []).map((r) => r.permission as Permissao)), erro: !!error };
});

/** Permissões do perfil do usuário logado (uma consulta por requisição). Erro na consulta = nenhuma (como antes). */
export const getPermissoes = cache(async (): Promise<Set<Permissao>> => (await getPermissoesComErro()).permissoes);

const ORDEM_TELAS: [Permissao, string][] = [
  ['visao_geral', '/'], ['vendas', '/vendas'], ['rentabilidade', '/rentabilidade'], ['ads', '/ads'], ['operacao', '/alertas'], ['metas', '/metas'],
  ['crm_funil', '/crm/funil'], ['crm_vendedores', '/crm/vendedores'], ['crm_origens', '/crm/origens'],
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
