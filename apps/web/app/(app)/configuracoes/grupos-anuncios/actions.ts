'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { validarGrupo } from '@/lib/grupos';
import { exigirPermissao } from '@/lib/permissoes';
import { createClient } from '@/lib/supabase/server';

const CANAL = 'mercadolivre';

function voltar(msg: string, tipo: 'ok' | 'erro'): never {
  revalidatePath('/configuracoes/grupos-anuncios');
  redirect(`/configuracoes/grupos-anuncios?${new URLSearchParams({ [tipo]: msg }).toString()}`);
}

export async function criarGrupo(form: FormData): Promise<void> {
  await exigirPermissao('editar_grupos');
  const r = validarGrupo(String(form.get('nome') ?? ''), String(form.get('antecedencia') ?? ''));
  if (!r.ok) voltar(r.erro, 'erro');
  const v = r.ok ? r : { nome: '', antecedencia: 0 };
  const supabase = await createClient();
  const { error } = await supabase.schema('core').from('grupos_anuncio')
    .insert({ nome: v.nome, antecedencia_dias: v.antecedencia });
  if (error) voltar('Não foi possível criar o grupo agora (o nome pode já existir).', 'erro');
  voltar('Grupo criado.', 'ok');
}

export async function editarGrupo(form: FormData): Promise<void> {
  await exigirPermissao('editar_grupos');
  const id = Number(form.get('id'));
  if (!Number.isInteger(id)) voltar('Grupo inválido.', 'erro');
  const r = validarGrupo(String(form.get('nome') ?? ''), String(form.get('antecedencia') ?? ''));
  if (!r.ok) voltar(r.erro, 'erro');
  const v = r.ok ? r : { nome: '', antecedencia: 0 };
  const supabase = await createClient();
  const { data, error } = await supabase.schema('core').from('grupos_anuncio')
    .update({ nome: v.nome, antecedencia_dias: v.antecedencia }).eq('id', id).select('id');
  if (error) voltar('Não foi possível salvar o grupo agora (o nome pode já existir).', 'erro');
  if (!data || data.length === 0) voltar('Grupo não encontrado.', 'erro');
  voltar('Grupo salvo.', 'ok');
}

export async function excluirGrupo(form: FormData): Promise<void> {
  await exigirPermissao('editar_grupos');
  const id = Number(form.get('id'));
  if (!Number.isInteger(id)) voltar('Grupo inválido.', 'erro');
  const supabase = await createClient();
  const { error } = await supabase.schema('core').from('grupos_anuncio').delete().eq('id', id);
  if (error) voltar('Não foi possível excluir o grupo agora.', 'erro');
  voltar('Grupo excluído. Os anúncios voltaram a usar o padrão.', 'ok');
}

export async function atribuirAnuncios(form: FormData): Promise<void> {
  await exigirPermissao('editar_grupos');
  const itens = [...new Set(form.getAll('item_id').map((v) => String(v)).filter(Boolean))];
  if (itens.length === 0) voltar('Marque ao menos um anúncio.', 'erro');
  const bruto = String(form.get('grupo_id') ?? '').trim();
  const supabase = await createClient();
  if (bruto === '') {
    const { error } = await supabase.schema('core').from('grupo_anuncio_itens')
      .delete().eq('channel', CANAL).in('item_id', itens);
    if (error) voltar('Não foi possível tirar os anúncios do grupo agora.', 'erro');
    voltar(`${itens.length} anúncio(s) sem grupo (usam o padrão).`, 'ok');
  }
  const grupoId = Number(bruto);
  if (!Number.isInteger(grupoId)) voltar('Grupo inválido.', 'erro');
  const { error } = await supabase.schema('core').from('grupo_anuncio_itens').upsert(
    itens.map((item_id) => ({ channel: CANAL, item_id, grupo_id: grupoId })),
    { onConflict: 'channel,item_id' },
  );
  if (error) voltar('Não foi possível mover os anúncios agora.', 'erro');
  voltar(`${itens.length} anúncio(s) movido(s).`, 'ok');
}
