'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { validarLimites } from '@/lib/ads-limites';
import { exigirPermissao } from '@/lib/permissoes';
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

export async function salvarLimitesAds(form: FormData): Promise<void> {
  const { profile } = await requireUser();
  if (profile?.role !== 'admin') voltar('Só o administrador altera os parâmetros.', 'erro');
  const channel = String(form.get('channel') ?? '');
  const vigente = String(form.get('vigente_desde') ?? '');
  if (!CANAIS.includes(channel)) voltar('Escolha o canal.', 'erro');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vigente)) voltar('Informe a data a partir da qual vale.', 'erro');
  const r = validarLimites(Object.fromEntries(form.entries()));
  if (!r.ok) voltar(r.erro, 'erro');
  const valores = r.ok ? r.valores : {};

  const supabase = await createClient();
  const { error } = await supabase.schema('core').from('parametros_ads').upsert(
    { channel, vigente_desde: vigente, ...valores },
    { onConflict: 'channel,vigente_desde' },
  );
  if (error) voltar('Não foi possível salvar os limites de Ads agora.', 'erro');
  voltar('Limites de Ads salvos.', 'ok');
}

export async function excluirLimitesAds(form: FormData): Promise<void> {
  const { profile } = await requireUser();
  if (profile?.role !== 'admin') voltar('Só o administrador altera os parâmetros.', 'erro');
  const channel = String(form.get('channel') ?? '');
  const vigente = String(form.get('vigente_desde') ?? '');
  if (!CANAIS.includes(channel)) voltar('Canal inválido.', 'erro');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vigente)) voltar('Data da vigência inválida.', 'erro');
  const supabase = await createClient();
  const { count } = await supabase.schema('core').from('parametros_ads')
    .select('channel', { count: 'exact', head: true }).eq('channel', channel);
  if ((count ?? 0) <= 1) voltar('O canal precisa de pelo menos uma vigência de limites.', 'erro');
  const { error, data: apagadas } = await supabase.schema('core').from('parametros_ads').delete().eq('channel', channel).eq('vigente_desde', vigente).select('channel');
  if (error) voltar('Não foi possível excluir agora.', 'erro');
  if (!apagadas || apagadas.length === 0) voltar('Nada excluído: a vigência não foi encontrada.', 'erro');
  voltar('Vigência de limites excluída.', 'ok');
}

// ---------------------------------------------------------------------
// Alertas e reputacao (so quem tem a permissao 'configuracoes')
// ---------------------------------------------------------------------
const INDICADORES = ['reclamacoes', 'cancelamentos', 'atrasos'];

export async function salvarParametrosAlertas(form: FormData): Promise<void> {
  await exigirPermissao('configuracoes');
  const ant = numero(form.get('antecedencia_padrao'));
  const perto = numero(form.get('perto_limite_pct'));
  if (String(form.get('antecedencia_padrao') ?? '').trim() === '' || !Number.isInteger(ant) || ant < 0 || ant > 30) {
    voltar('A antecedência padrão deve ser um número inteiro de 0 a 30 dias úteis.', 'erro');
  }
  if (String(form.get('perto_limite_pct') ?? '').trim() === '' || Number.isNaN(perto) || perto < 1 || perto > 100) {
    voltar('"Perto do limite" deve ser um percentual de 1 a 100.', 'erro');
  }
  const supabase = await createClient();
  const { error } = await supabase.schema('core').from('parametros_alertas')
    .upsert({ id: true, antecedencia_padrao: ant, perto_limite_pct: perto }, { onConflict: 'id' });
  if (error) voltar('Não foi possível salvar os parâmetros dos alertas agora.', 'erro');
  voltar('Parâmetros dos alertas salvos.', 'ok');
}

export async function adicionarFeriado(form: FormData): Promise<void> {
  await exigirPermissao('configuracoes');
  const data = String(form.get('data') ?? '');
  const nome = String(form.get('nome') ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) voltar('Informe a data do feriado.', 'erro');
  if (nome.length < 1 || nome.length > 80) voltar('Informe o nome do feriado (até 80 caracteres).', 'erro');
  const supabase = await createClient();
  const { error } = await supabase.schema('core').from('feriados').upsert({ data, nome }, { onConflict: 'data' });
  if (error) voltar('Não foi possível salvar o feriado agora.', 'erro');
  voltar('Feriado salvo.', 'ok');
}

export async function excluirFeriado(form: FormData): Promise<void> {
  await exigirPermissao('configuracoes');
  const data = String(form.get('data') ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) voltar('Data do feriado inválida.', 'erro');
  const supabase = await createClient();
  const { error } = await supabase.schema('core').from('feriados').delete().eq('data', data);
  if (error) voltar('Não foi possível excluir o feriado agora.', 'erro');
  voltar('Feriado excluído.', 'ok');
}

export async function salvarLimiteReputacao(form: FormData): Promise<void> {
  await exigirPermissao('configuracoes');
  const level = String(form.get('level_id') ?? '').trim();
  const indicador = String(form.get('indicador') ?? '');
  const bruto = String(form.get('limite_pct') ?? '').trim();
  const limite = numero(bruto);
  if (level.length < 1 || level.length > 40) voltar('Informe o nível (cor) da reputação.', 'erro');
  if (!INDICADORES.includes(indicador)) voltar('Escolha o indicador.', 'erro');
  if (bruto === '' || Number.isNaN(limite) || limite < 0 || limite > 100) voltar('O limite deve ser um percentual de 0 a 100.', 'erro');
  const supabase = await createClient();
  const { error } = await supabase.schema('core').from('reputacao_limites')
    .upsert({ level_id: level, indicador, limite_pct: limite }, { onConflict: 'level_id,indicador' });
  if (error) voltar('Não foi possível salvar o limite agora.', 'erro');
  voltar('Limite de reputação salvo.', 'ok');
}

export async function excluirLimiteReputacao(form: FormData): Promise<void> {
  await exigirPermissao('configuracoes');
  const level = String(form.get('level_id') ?? '').trim();
  const indicador = String(form.get('indicador') ?? '');
  if (!level || !INDICADORES.includes(indicador)) voltar('Limite inválido.', 'erro');
  const supabase = await createClient();
  const { error } = await supabase.schema('core').from('reputacao_limites').delete().eq('level_id', level).eq('indicador', indicador);
  if (error) voltar('Não foi possível excluir o limite agora.', 'erro');
  voltar('Limite excluído.', 'ok');
}
