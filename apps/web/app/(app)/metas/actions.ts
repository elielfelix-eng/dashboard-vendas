'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getPermissoes } from '@/lib/permissoes';
import type { CanalMeta } from '@/lib/metas-planilha';

const CANAIS: CanalMeta[] = ['mercadolivre', 'shopee', 'brindedobem'];

/** Grava o crescimento % de um mês (ou o padrão do canal no ano, com mes = null). null remove = volta ao padrão. */
export async function salvarPremissa(canal: CanalMeta, ano: number, mes: number | null, crescimento: number | null): Promise<{ erro?: string }> {
  if (!(await getPermissoes()).has('editar_metas')) return { erro: 'Você não tem permissão para editar as premissas.' };
  if (!CANAIS.includes(canal) || !Number.isInteger(ano) || (mes != null && (mes < 1 || mes > 12))) return { erro: 'Dados inválidos.' };
  if (crescimento != null && (!Number.isFinite(crescimento) || crescimento < -100 || crescimento > 1000)) {
    return { erro: 'Informe um crescimento entre -100% e 1000%.' };
  }
  const supabase = await createClient();
  const tabela = supabase.schema('core').from('premissas_projecao');
  const apagar = tabela.delete().eq('channel', canal).eq('ano', ano);
  const { error: e1 } = await (mes == null ? apagar.is('mes', null) : apagar.eq('mes', mes));
  if (e1) return { erro: 'Não foi possível salvar agora.' };
  if (crescimento != null) {
    const { error: e2 } = await supabase.schema('core').from('premissas_projecao')
      .insert({ channel: canal, ano, mes, crescimento_pct: crescimento });
    if (e2) return { erro: 'Não foi possível salvar agora.' };
  }
  revalidatePath('/metas');
  revalidatePath('/');
  return {};
}
