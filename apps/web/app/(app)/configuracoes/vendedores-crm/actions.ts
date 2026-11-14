'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { exigirPermissao } from '@/lib/permissoes';
import { createClient } from '@/lib/supabase/server';

const ROTA = '/configuracoes/vendedores-crm';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function voltar(msg: string, tipo: 'ok' | 'erro'): never {
  revalidatePath(ROTA);
  redirect(`${ROTA}?${new URLSearchParams({ [tipo]: msg }).toString()}`);
}

export async function vincular(form: FormData): Promise<void> {
  await exigirPermissao('configuracoes');
  const user = String(form.get('user_id') ?? '');
  const bitrix = String(form.get('bitrix_id') ?? '');
  if (!UUID.test(user)) voltar('Escolha o usuário do painel.', 'erro');
  if (!/^\d+$/.test(bitrix)) voltar('Vendedor inválido.', 'erro');
  const supabase = await createClient();
  const { error } = await supabase.schema('core').rpc('crm_vincular', { p_user: user, p_bitrix: Number(bitrix) });
  if (error) voltar('Não foi possível ligar agora.', 'erro');
  voltar('Vendedor ligado.', 'ok');
}

export async function desvincular(form: FormData): Promise<void> {
  await exigirPermissao('configuracoes');
  const user = String(form.get('user_id') ?? '');
  if (!UUID.test(user)) voltar('Este vendedor não está ligado a um usuário.', 'erro');
  const supabase = await createClient();
  const { error } = await supabase.schema('core').rpc('crm_desvincular_auto', { p_user: user });
  if (error) voltar('Não foi possível desligar agora.', 'erro');
  voltar('Vendedor desligado.', 'ok');
}

export async function alternarOrigem(form: FormData): Promise<void> {
  await exigirPermissao('configuracoes');
  const source = String(form.get('source_id') ?? '');
  if (!source) voltar('Origem inválida.', 'erro');
  const ativo = form.get('ativo') === 'true';
  const supabase = await createClient();
  const { error } = await supabase.schema('core').rpc('crm_origem_ativa', { p_source: source, p_ativo: ativo });
  if (error) voltar('Não foi possível salvar agora.', 'erro');
  voltar(ativo ? 'Origem ativada.' : 'Origem desativada.', 'ok');
}
