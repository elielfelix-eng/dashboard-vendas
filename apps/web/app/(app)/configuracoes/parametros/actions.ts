'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

const CANAIS = ['mercadolivre', 'shopee'];

const numero = (v: FormDataEntryValue | null) => {
  const t = String(v ?? '').trim();
  if (t === '') return 0;
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  return Number.isFinite(n) ? n : NaN;
};

function voltar(msg: string, tipo: 'ok' | 'erro'): never {
  revalidatePath('/', 'layout');
  redirect(`/configuracoes/parametros?${new URLSearchParams({ [tipo]: msg }).toString()}`);
}

export async function salvarParametro(form: FormData): Promise<void> {
  const { profile } = await requireUser();
  if (profile?.role !== 'admin') voltar('Só o administrador altera os parâmetros.', 'erro');
  const channel = String(form.get('channel') ?? '');
  const vigente = String(form.get('vigente_desde') ?? '');
  const imposto = numero(form.get('imposto_pct'));
  const embPedido = numero(form.get('embalagem_pedido'));
  const embPeca = numero(form.get('embalagem_peca'));
  if (!CANAIS.includes(channel)) voltar('Escolha o canal.', 'erro');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vigente)) voltar('Informe a data a partir da qual vale.', 'erro');
  if ([imposto, embPedido, embPeca].some((n) => Number.isNaN(n) || n < 0)) voltar('Use números positivos, por exemplo 5 ou 1,50.', 'erro');
  if (imposto > 100) voltar('O imposto deve ficar entre 0 e 100%.', 'erro');

  const supabase = await createClient();
  const { error } = await supabase.schema('core').from('parametros_custo').upsert(
    { channel, vigente_desde: vigente, imposto_pct: imposto, embalagem_pedido: embPedido, embalagem_peca: embPeca },
    { onConflict: 'channel,vigente_desde' },
  );
  if (error) voltar('Não foi possível salvar agora.', 'erro');
  voltar('Vigência salva.', 'ok');
}

export async function excluirParametro(form: FormData): Promise<void> {
  const { profile } = await requireUser();
  if (profile?.role !== 'admin') voltar('Só o administrador altera os parâmetros.', 'erro');
  const id = Number(form.get('id'));
  const supabase = await createClient();
  const { data: linha } = await supabase.schema('core').from('parametros_custo').select('channel').eq('id', id).single();
  if (!linha) voltar('Vigência não encontrada.', 'erro');
  const { count } = await supabase.schema('core').from('parametros_custo')
    .select('id', { count: 'exact', head: true }).eq('channel', linha!.channel);
  if ((count ?? 0) <= 1) voltar('O canal precisa de pelo menos uma vigência.', 'erro');
  const { error } = await supabase.schema('core').from('parametros_custo').delete().eq('id', id);
  if (error) voltar('Não foi possível excluir agora.', 'erro');
  voltar('Vigência excluída.', 'ok');
}
