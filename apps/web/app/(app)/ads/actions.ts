'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { TAG_PAINEL } from '@/lib/cache-chave';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { urlRetornoOrcamento, validarOrcamento } from '@/lib/ads-regras';
import { getPermissoes } from '@/lib/permissoes';
import { createClient } from '@/lib/supabase/server';

/** Filtros da tela (campos ocultos f_canal, f_periodo, f_de, f_ate); a URL só aceita chaves e valores conhecidos. */
const filtrosDe = (form: FormData) => Object.fromEntries(['canal', 'periodo', 'de', 'ate'].map((k) => [k, form.get(`f_${k}`)]));

function voltar(form: FormData, msg: string, tipo: 'ok' | 'erro'): never {
  revalidatePath('/ads');
  revalidateTag(TAG_PAINEL);
  redirect(urlRetornoOrcamento(filtrosDe(form), tipo, msg));
}

/** Grava (ou substitui) uma vigência do orçamento mensal. A RLS exige editar_ads. */
export async function salvarOrcamento(form: FormData): Promise<void> {
  await requireUser();
  if (!(await getPermissoes()).has('editar_ads')) voltar(form, 'Você não tem permissão para editar o orçamento.', 'erro');
  const r = validarOrcamento({ channel: form.get('channel'), vigente_desde: form.get('vigente_desde'), valor_mensal: form.get('valor_mensal') });
  if (!r.ok) return voltar(form, r.erro, 'erro');
  const supabase = await createClient();
  const { data, error } = await supabase.schema('core').from('orcamento_ads')
    .upsert(r.valores, { onConflict: 'channel,vigente_desde' }).select('channel');
  if (error || !data?.length) voltar(form, 'Não foi possível salvar o orçamento. Confira se você tem permissão e tente de novo.', 'erro');
  voltar(form, 'Orçamento salvo.', 'ok');
}
