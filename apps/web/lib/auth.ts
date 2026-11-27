import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';
import { medir } from './tempo';

export type Role = 'admin' | 'gestor' | 'comercial' | 'visualizador' | 'vendedor';

export interface Profile {
  role: Role;
  full_name: string | null;
  channels: string[];
}

/** Usuário logado + perfil, ou null. Uma consulta por requisição (layout e página compartilham). */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const { data: { user } } = await medir('auth.getUser', () => supabase.auth.getUser());
  if (!user) return null;
  const { data: profile } = await medir('perfil', async () => supabase
    .schema('core')
    .from('user_profiles')
    .select('role, full_name, channels')
    .eq('user_id', user.id)
    .single<Profile>());
  return { user, profile };
});

export async function requireUser() {
  const ctx = await getCurrentUser();
  if (!ctx) redirect('/login');
  return ctx;
}

export async function requireAdmin() {
  const ctx = await requireUser();
  if (ctx.profile?.role !== 'admin') redirect('/');
  return ctx;
}

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Administrador',
  gestor: 'Gestor',
  comercial: 'Comercial',
  visualizador: 'Visualizador',
  vendedor: 'Vendedor',
};
