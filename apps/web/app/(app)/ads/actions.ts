'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { validarOrcamento } from '@/lib/ads-regras';
import { getPermissoes } from '@/lib/permissoes';
import { createClient } from '@/lib/supabase/server';

function voltar(msg: string, tipo: 'ok' | 'erro'): never {
  revalidatePath('/ads');
  redirect(`/ads?${new URLSearchParams({ aba: 'orcamento', [tipo]: msg }).toString()}`);
}

/** Grava (ou substitui) uma vigência do orçamento mensal. A RLS exige editar_ads. */
export async function salvarOrcamento(form: FormData): Promise<void> {
  await requireUser();
  if (!(await getPermissoes()).has('editar_ads')) voltar('Você não tem permissão para editar o orçamento.', 'erro');
  const r = validarOrcamento({ channel: form.get('channel'), vigente_desde: form.get('vigente_desde'), valor_mensal: form.get('valor_mensal') });
  if (!r.ok) return voltar(r.erro, 'erro');
  const supabase = await createClient();
  const { data, error } = await supabase.schema('core').from('orcamento_ads')
    .upsert(r.valores, { onConflict: 'channel,vigente_desde' }).select('channel');
  if (error || !data?.length) voltar('Não foi possível salvar o orçamento. Confira se você tem permissão e tente de novo.', 'erro');
  voltar('Orçamento salvo.', 'ok');
}
