'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getPermissoes } from '@/lib/permissoes';
import type { LinhaMetaValida } from '@/lib/metas-planilha';

const CANAIS = new Set(['mercadolivre', 'shopee', 'brindedobem']);

/** Substitui as metas dos anos presentes nas linhas (validadas no navegador; o banco confere de novo). */
export async function gravarMetas(linhas: LinhaMetaValida[]): Promise<{ gravadas?: number; erro?: string }> {
  if (!(await getPermissoes()).has('editar_metas')) return { erro: 'Você não tem permissão para alterar metas.' };
  if (!Array.isArray(linhas) || linhas.length === 0) return { erro: 'Nenhuma linha válida para gravar.' };
  const ok = linhas.every((l) => CANAIS.has(l.channel) && Number.isInteger(l.ano) && Number.isInteger(l.mes)
    && l.mes >= 1 && l.mes <= 12 && Number.isFinite(l.valor) && l.valor >= 0);
  if (!ok) return { erro: 'Há linhas inválidas. Confira a prévia.' };

  const supabase = await createClient();
  const { data, error } = await supabase.schema('core').rpc('substituir_metas', { p_linhas: linhas });
  if (error) {
    console.error('[metas] substituir_metas:', error.message);
    return { erro: 'Não foi possível gravar as metas. Nada foi alterado.' };
  }
  revalidatePath('/metas');
  revalidatePath('/');
  return { gravadas: Number(data) };
}
